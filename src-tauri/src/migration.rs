use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

use crate::commands::fs::replace_file_atomically;

pub const PROJECT_STATE_DIR: &str = ".potato-box";
const LEGACY_PROJECT_STATE_DIR: &str = ".llm-wiki";
const LEGACY_APP_IDENTIFIERS: &[&str] = &["com.llmwiki.app", "LLM Wiki", "llm-wiki"];

/// Copy legacy project state into the potato box namespace while preserving
/// the source for rollback. Conflicting files are retained under migrations/
/// legacy-conflicts-v1 instead of being silently discarded.
pub fn migrate_project_state(project_root: &Path) -> Result<(), String> {
    let legacy = project_root.join(LEGACY_PROJECT_STATE_DIR);
    let target = project_root.join(PROJECT_STATE_DIR);
    if !legacy.is_dir() {
        fs::create_dir_all(&target)
            .map_err(|error| format!("Failed to create project state directory: {error}"))?;
        return Ok(());
    }

    fs::create_dir_all(&target)
        .map_err(|error| format!("Failed to create project state directory: {error}"))?;
    let report = copy_project_state_preserving_legacy(&legacy, &target)?;
    reconcile_project_identity_files(&target)?;
    write_migration_marker(
        &target,
        "copied-preserved",
        Some(report.copied),
        &report.conflicts,
    )
}

/// Copy the previous Tauri app-data directory before any settings or API
/// server reads occur. Existing potato box files always win on collision.
pub fn migrate_legacy_app_data(app: &AppHandle) -> Result<(), String> {
    let target = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app-data directory: {error}"))?;
    let marker = target.join("migrations").join("legacy-app-data-v1.json");
    if marker.is_file() {
        return Ok(());
    }
    fs::create_dir_all(&target)
        .map_err(|error| format!("Failed to create app-data directory: {error}"))?;

    let Some(parent) = target.parent() else {
        return Ok(());
    };
    let mut migrated_from: Option<PathBuf> = None;
    let mut copied = 0usize;
    for identifier in LEGACY_APP_IDENTIFIERS {
        let candidate = parent.join(identifier);
        if candidate == target || !candidate.is_dir() {
            continue;
        }
        copied += copy_missing_tree(&candidate, &target)?;
        migrated_from = Some(candidate);
        break;
    }

    if let Some(source) = migrated_from {
        let marker_parent = marker.parent().expect("migration marker has a parent");
        fs::create_dir_all(marker_parent)
            .map_err(|error| format!("Failed to create app migration directory: {error}"))?;
        write_json_new(
            &marker,
            &json!({
                "version": 1,
                "migratedAt": chrono::Utc::now().to_rfc3339(),
                "source": source.file_name().and_then(|name| name.to_str()).unwrap_or("legacy"),
                "filesCopied": copied,
            }),
        )?;
    }
    Ok(())
}

pub fn write_app_migration_failure(app: &AppHandle, error: &str) -> Result<(), String> {
    let target = app
        .path()
        .app_data_dir()
        .map_err(|path_error| format!("Could not resolve app-data directory: {path_error}"))?;
    let report = target
        .join("migrations")
        .join("legacy-app-data-failure.json");
    fs::create_dir_all(report.parent().expect("migration report has a parent")).map_err(
        |create_error| format!("Failed to create migration report directory: {create_error}"),
    )?;
    let temp = report.with_file_name(format!(
        ".legacy-app-data-failure.{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let payload = serde_json::to_vec_pretty(&json!({
        "version": 1,
        "failedAt": chrono::Utc::now().to_rfc3339(),
        "error": error,
    }))
    .map_err(|serialize_error| {
        format!("Failed to serialize migration report: {serialize_error}")
    })?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|open_error| format!("Failed to create migration report: {open_error}"))?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|write_error| format!("Failed to write migration report: {write_error}"))?;
    drop(file);
    replace_file_atomically(&temp, &report).map_err(|replace_error| {
        let _ = fs::remove_file(&temp);
        format!("Failed to install migration report: {replace_error}")
    })
}

pub fn clear_app_migration_failure(app: &AppHandle) {
    if let Ok(target) = app.path().app_data_dir() {
        let report = target
            .join("migrations")
            .join("legacy-app-data-failure.json");
        let _ = fs::remove_file(report);
    }
}

#[derive(Default)]
struct ProjectCopyReport {
    copied: usize,
    conflicts: Vec<String>,
}

fn copy_project_state_preserving_legacy(
    source: &Path,
    target: &Path,
) -> Result<ProjectCopyReport, String> {
    let mut report = ProjectCopyReport::default();
    let conflict_root = target.join("migrations").join("legacy-conflicts-v1");
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(|error| format!("Failed to inspect legacy state: {error}"))?;
        if entry.file_type().is_symlink() || !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|_| "Legacy state path escaped its source root".to_string())?;
        let destination = target.join(relative);
        if destination.exists() {
            if files_equal(entry.path(), &destination)? {
                continue;
            }
            let conflict = conflict_root.join(relative);
            if !conflict.exists() {
                copy_file_verified(entry.path(), &conflict)?;
            }
            report
                .conflicts
                .push(relative.to_string_lossy().replace('\\', "/"));
            continue;
        }
        copy_file_verified(entry.path(), &destination)?;
        report.copied += 1;
    }
    Ok(report)
}

fn copy_missing_tree(source: &Path, target: &Path) -> Result<usize, String> {
    let mut copied = 0usize;
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(|error| format!("Failed to inspect legacy state: {error}"))?;
        if entry.file_type().is_symlink() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|_| "Legacy state path escaped its source root".to_string())?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let destination = target.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| format!("Failed to create migrated directory: {error}"))?;
            continue;
        }
        if !entry.file_type().is_file() || destination.exists() {
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create migrated parent: {error}"))?;
        }
        let temp = destination.with_file_name(format!(
            ".{}.{}.migration-tmp",
            destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("state"),
            uuid::Uuid::new_v4(),
        ));
        fs::copy(entry.path(), &temp)
            .map_err(|error| format!("Failed to copy legacy state file: {error}"))?;
        if let Ok(file) = OpenOptions::new().read(true).open(&temp) {
            let _ = file.sync_all();
        }
        fs::rename(&temp, &destination).map_err(|error| {
            let _ = fs::remove_file(&temp);
            format!("Failed to install migrated state file: {error}")
        })?;
        copied += 1;
    }
    Ok(copied)
}

fn copy_file_verified(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create migrated parent: {error}"))?;
    }
    let temp = destination.with_file_name(format!(
        ".{}.{}.migration-tmp",
        destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("state"),
        uuid::Uuid::new_v4(),
    ));
    fs::copy(source, &temp)
        .map_err(|error| format!("Failed to copy legacy state file: {error}"))?;
    if !files_equal(source, &temp)? {
        let _ = fs::remove_file(&temp);
        return Err("Migrated state verification failed".to_string());
    }
    if let Ok(file) = OpenOptions::new().read(true).open(&temp) {
        let _ = file.sync_all();
    }
    fs::rename(&temp, destination).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Failed to install migrated state file: {error}")
    })
}

fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let left_meta = fs::metadata(left)
        .map_err(|error| format!("Failed to inspect legacy state file: {error}"))?;
    let right_meta = fs::metadata(right)
        .map_err(|error| format!("Failed to inspect migrated state file: {error}"))?;
    if left_meta.len() != right_meta.len() {
        return Ok(false);
    }
    let mut left_file = fs::File::open(left)
        .map_err(|error| format!("Failed to open legacy state file: {error}"))?;
    let mut right_file = fs::File::open(right)
        .map_err(|error| format!("Failed to open migrated state file: {error}"))?;
    let mut left_buffer = [0u8; 64 * 1024];
    let mut right_buffer = [0u8; 64 * 1024];
    loop {
        let left_read = left_file
            .read(&mut left_buffer)
            .map_err(|error| format!("Failed to verify legacy state: {error}"))?;
        let right_read = right_file
            .read(&mut right_buffer)
            .map_err(|error| format!("Failed to verify migrated state: {error}"))?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn reconcile_project_identity_files(target: &Path) -> Result<(), String> {
    let identity_path = target.join("project.json");
    if !identity_path.is_file() {
        return Ok(());
    }
    let identity: serde_json::Value = serde_json::from_slice(
        &fs::read(&identity_path)
            .map_err(|error| format!("Failed to read migrated project identity: {error}"))?,
    )
    .map_err(|error| format!("Migrated project identity is invalid: {error}"))?;
    let Some(project_id) = identity.get("id").and_then(serde_json::Value::as_str) else {
        return Err("Migrated project identity has no id".to_string());
    };
    uuid::Uuid::parse_str(project_id)
        .map_err(|_| "Migrated project identity id is not a UUID".to_string())?;

    for (name, nested) in [
        ("ingest-queue.json", false),
        ("dedup-queue.json", false),
        ("file-change-queue.json", true),
    ] {
        let path = target.join(name);
        if !path.is_file() {
            continue;
        }
        let mut value: serde_json::Value = serde_json::from_slice(
            &fs::read(&path).map_err(|error| format!("Failed to read migrated {name}: {error}"))?,
        )
        .map_err(|error| format!("Migrated {name} is invalid: {error}"))?;
        let tasks = if nested {
            value
                .as_object_mut()
                .and_then(|object| object.get_mut("tasks"))
                .and_then(serde_json::Value::as_array_mut)
                .ok_or_else(|| format!("Migrated {name} has no tasks array"))?
        } else {
            value
                .as_array_mut()
                .ok_or_else(|| format!("Migrated {name} is not an array"))?
        };
        for task in tasks {
            let object = task
                .as_object_mut()
                .ok_or_else(|| format!("Migrated {name} contains an invalid task"))?;
            object.insert("projectId".to_string(), json!(project_id));
        }
        let payload = serde_json::to_vec_pretty(&value)
            .map_err(|error| format!("Failed to serialize migrated {name}: {error}"))?;
        let temp = target.join(format!(".{name}.{}.migration-tmp", uuid::Uuid::new_v4()));
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("Failed to create migrated {name}: {error}"))?;
        output
            .write_all(&payload)
            .and_then(|_| output.sync_all())
            .map_err(|error| format!("Failed to flush migrated {name}: {error}"))?;
        drop(output);
        replace_file_atomically(&temp, &path).map_err(|error| {
            let _ = fs::remove_file(&temp);
            format!("Failed to install migrated {name}: {error}")
        })?;
    }
    Ok(())
}

fn write_migration_marker(
    target: &Path,
    strategy: &str,
    files_copied: Option<usize>,
    conflicts: &[String],
) -> Result<(), String> {
    let marker = target
        .join("migrations")
        .join("legacy-project-state-v1.json");
    if marker.exists() {
        return Ok(());
    }
    fs::create_dir_all(marker.parent().expect("migration marker has a parent"))
        .map_err(|error| format!("Failed to create migration marker directory: {error}"))?;
    write_json_new(
        &marker,
        &json!({
            "version": 1,
            "migratedAt": chrono::Utc::now().to_rfc3339(),
            "source": LEGACY_PROJECT_STATE_DIR,
            "strategy": strategy,
            "filesCopied": files_copied,
            "conflicts": conflicts,
        }),
    )
}

fn write_json_new(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Failed to create migration marker: {error}"))?;
    let payload = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to serialize migration marker: {error}"))?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to write migration marker: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_state_is_copied_and_preserved_for_rollback() {
        let root =
            std::env::temp_dir().join(format!("potato-box-migration-{}", uuid::Uuid::new_v4()));
        let legacy = root.join(LEGACY_PROJECT_STATE_DIR);
        fs::create_dir_all(legacy.join("chats")).unwrap();
        fs::write(legacy.join("chats/one.json"), "[]").unwrap();

        migrate_project_state(&root).unwrap();

        assert!(root
            .join(PROJECT_STATE_DIR)
            .join("chats/one.json")
            .is_file());
        assert!(legacy.join("chats/one.json").is_file());
        assert!(root
            .join(PROJECT_STATE_DIR)
            .join("migrations/legacy-project-state-v1.json")
            .is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn new_state_wins_when_legacy_and_new_files_collide() {
        let root =
            std::env::temp_dir().join(format!("potato-box-migration-{}", uuid::Uuid::new_v4()));
        let legacy = root.join(LEGACY_PROJECT_STATE_DIR);
        let target = root.join(PROJECT_STATE_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(legacy.join("review.json"), "legacy").unwrap();
        fs::write(target.join("review.json"), "current").unwrap();

        migrate_project_state(&root).unwrap();

        assert_eq!(
            fs::read_to_string(target.join("review.json")).unwrap(),
            "current"
        );
        assert_eq!(
            fs::read_to_string(target.join("migrations/legacy-conflicts-v1/review.json")).unwrap(),
            "legacy"
        );
        let _ = fs::remove_dir_all(root);
    }
}
