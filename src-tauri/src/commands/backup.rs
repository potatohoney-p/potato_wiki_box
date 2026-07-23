use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::commands::fs::replace_file_atomically;
use crate::panic_guard::run_guarded;

const BACKUP_FORMAT_VERSION: u32 = 2;
const MAX_RESTORE_ENTRIES: usize = 100_000;
const MAX_RESTORE_BYTES: u64 = 20 * 1024 * 1024 * 1024;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIdentity {
    id: String,
    created_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifestFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    #[serde(rename = "format")]
    backup_format: String,
    version: u32,
    #[serde(default)]
    created_at: String,
    #[serde(default = "default_project_name")]
    project_name: String,
    #[serde(default)]
    files: Vec<BackupManifestFile>,
}

fn default_project_name() -> String {
    "potato-box-project".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    path: String,
    files: usize,
    uncompressed_bytes: u64,
    archive_bytes: u64,
    sha256: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    project_path: String,
    files: usize,
    uncompressed_bytes: u64,
}

#[tauri::command]
pub async fn create_project_backup(
    project_path: String,
    destination: String,
) -> Result<BackupReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("create_project_backup", || {
            create_project_backup_impl(&project_path, &destination)
        })
    })
    .await
    .map_err(|error| format!("Backup task failed to join: {error}"))?
}

#[tauri::command]
pub async fn restore_project_backup(
    archive_path: String,
    destination_parent: String,
) -> Result<RestoreReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("restore_project_backup", || {
            restore_project_backup_impl(&archive_path, &destination_parent)
        })
    })
    .await
    .map_err(|error| format!("Restore task failed to join: {error}"))?
}

fn create_project_backup_impl(
    project_path: &str,
    destination: &str,
) -> Result<BackupReport, String> {
    let root = canonical_directory(project_path, "project")?;
    if !is_valid_project_root(&root) {
        return Err("The selected folder is not a potato box project".to_string());
    }
    let destination = absolute_path(destination, "backup destination")?;
    if !destination
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        return Err("Backup destination must end in .zip".to_string());
    }
    let file_name = destination
        .file_name()
        .ok_or_else(|| "Backup destination has no file name".to_string())?
        .to_os_string();
    let parent = destination
        .parent()
        .ok_or_else(|| "Backup destination has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create backup destination: {error}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Failed to resolve backup destination: {error}"))?;
    if canonical_parent.starts_with(&root) {
        return Err("Store backups outside the project being backed up".to_string());
    }
    let destination = canonical_parent.join(file_name);
    let temp = destination.with_file_name(format!(
        ".{}.{}.tmp",
        destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("potato-box-backup.zip"),
        uuid::Uuid::new_v4(),
    ));

    let created_at = chrono::Utc::now().to_rfc3339();
    let project_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("potato-box-project");
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|error| format!("Failed to create backup archive: {error}"))?;
    let mut zip = ZipWriter::new(file);
    let file_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    let directory_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .unix_permissions(0o700);

    let mut files = 0usize;
    let mut archive_entries = 1usize; // manifest
    let mut uncompressed_bytes = 0u64;
    let mut manifest_files = Vec::new();
    let backup_result = (|| -> Result<(), String> {
        for entry in WalkDir::new(&root).follow_links(false) {
            let entry = entry.map_err(|error| format!("Failed to inspect project: {error}"))?;
            if entry.file_type().is_symlink() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&root)
                .map_err(|_| "Project file escaped the project root".to_string())?;
            if relative.as_os_str().is_empty() {
                continue;
            }
            let name = relative.to_string_lossy().replace('\\', "/");
            if should_skip_backup_entry(&name) {
                continue;
            }
            if archive_entries >= MAX_RESTORE_ENTRIES {
                return Err(format!(
                    "Project contains too many entries to restore safely (limit: {MAX_RESTORE_ENTRIES})"
                ));
            }
            if entry.file_type().is_dir() {
                zip.add_directory(format!("{name}/"), directory_options)
                    .map_err(|error| format!("Failed to add backup directory: {error}"))?;
                archive_entries += 1;
                continue;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Failed to read project metadata: {error}"))?;
            if uncompressed_bytes.saturating_add(metadata.len()) > MAX_RESTORE_BYTES {
                return Err(format!(
                    "Project is larger than the restore size limit ({} bytes)",
                    MAX_RESTORE_BYTES
                ));
            }
            let canonical_entry = entry
                .path()
                .canonicalize()
                .map_err(|error| format!("Failed to resolve project file: {error}"))?;
            if !canonical_entry.starts_with(&root) {
                return Err("Project file escaped the project root".to_string());
            }
            zip.start_file(&name, file_options)
                .map_err(|error| format!("Failed to add backup file: {error}"))?;
            let mut source = File::open(canonical_entry)
                .map_err(|error| format!("Failed to open project file for backup: {error}"))?;
            let mut hasher = Sha256::new();
            let mut copied = 0u64;
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let read = source
                    .read(&mut buffer)
                    .map_err(|error| format!("Failed to read project file for backup: {error}"))?;
                if read == 0 {
                    break;
                }
                zip.write_all(&buffer[..read])
                    .map_err(|error| format!("Failed to copy project file into backup: {error}"))?;
                hasher.update(&buffer[..read]);
                copied = copied.saturating_add(read as u64);
            }
            if copied != metadata.len() {
                return Err(format!(
                    "Project file changed while the backup was being created: {name}"
                ));
            }
            manifest_files.push(BackupManifestFile {
                path: name,
                size: copied,
                sha256: format!("{:x}", hasher.finalize()),
            });
            files += 1;
            archive_entries += 1;
            uncompressed_bytes = uncompressed_bytes.saturating_add(copied);
        }
        Ok(())
    })();

    if let Err(error) = backup_result {
        drop(zip);
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    let manifest = BackupManifest {
        backup_format: "potato-box-project".to_string(),
        version: BACKUP_FORMAT_VERSION,
        created_at: created_at.clone(),
        project_name: project_name.to_string(),
        files: manifest_files,
    };
    zip.start_file("potato-box-backup.json", file_options)
        .map_err(|error| format!("Failed to write backup manifest: {error}"))?;
    let manifest = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize backup manifest: {error}"))?;
    zip.write_all(&manifest)
        .map_err(|error| format!("Failed to write backup manifest: {error}"))?;
    let finished = zip
        .finish()
        .map_err(|error| format!("Failed to finish backup archive: {error}"))?;
    finished
        .sync_all()
        .map_err(|error| format!("Failed to flush backup archive: {error}"))?;
    drop(finished);
    replace_file_atomically(&temp, &destination).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Failed to install backup archive: {error}")
    })?;

    let archive_bytes = fs::metadata(&destination)
        .map_err(|error| format!("Failed to inspect backup archive: {error}"))?
        .len();
    let sha256 = hash_file(&destination)?;
    Ok(BackupReport {
        path: normalize_path(&destination),
        files,
        uncompressed_bytes,
        archive_bytes,
        sha256,
        created_at,
    })
}

fn restore_project_backup_impl(
    archive_path: &str,
    destination_parent: &str,
) -> Result<RestoreReport, String> {
    let archive_path = absolute_path(archive_path, "backup archive")?;
    if !archive_path.is_file() {
        return Err("Backup archive does not exist".to_string());
    }
    let parent = canonical_directory(destination_parent, "restore destination")?;
    let file = File::open(&archive_path)
        .map_err(|error| format!("Failed to open backup archive: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Backup archive is invalid: {error}"))?;
    if archive.len() > MAX_RESTORE_ENTRIES {
        return Err("Backup contains too many entries".to_string());
    }

    let manifest = backup_manifest(&mut archive)?;
    let restore_name = unique_restore_name(&parent, &sanitize_project_name(&manifest.project_name));
    let root = parent.join(restore_name);
    if root.exists() {
        return Err("Restore destination already exists".to_string());
    }
    fs::create_dir(&root)
        .map_err(|error| format!("Failed to create restore directory: {error}"))?;

    let result = extract_archive(&mut archive, &root, &manifest);
    let (files, uncompressed_bytes) = match result {
        Ok(result) => result,
        Err(error) => {
            cleanup_partial_restore(&parent, &root);
            return Err(error);
        }
    };
    if !is_valid_project_root(&root) {
        cleanup_partial_restore(&parent, &root);
        return Err("Backup is missing required potato box project files".to_string());
    }
    if let Err(error) = rekey_restored_project(&root) {
        cleanup_partial_restore(&parent, &root);
        return Err(error);
    }
    Ok(RestoreReport {
        project_path: normalize_path(&root),
        files,
        uncompressed_bytes,
    })
}

fn is_valid_project_root(root: &Path) -> bool {
    root.join("schema.md").is_file()
        && root.join("wiki").is_dir()
        && root.join("wiki/index.md").is_file()
}

fn rekey_restored_project(root: &Path) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let state_dir = root.join(".potato-box");
    fs::create_dir_all(&state_dir)
        .map_err(|error| format!("Failed to create restored project state: {error}"))?;

    let identity = ProjectIdentity {
        id: id.clone(),
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    write_json_atomically(&state_dir.join("project.json"), &identity)?;

    for (queue_name, nested_tasks) in [
        ("ingest-queue.json", false),
        ("dedup-queue.json", false),
        ("file-change-queue.json", true),
    ] {
        let queue_path = state_dir.join(queue_name);
        if !queue_path.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&queue_path)
            .map_err(|error| format!("Failed to read restored {queue_name}: {error}"))?;
        let mut value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|error| format!("Restored {queue_name} is invalid: {error}"))?;
        let tasks = if nested_tasks {
            value
                .as_object_mut()
                .and_then(|object| object.get_mut("tasks"))
                .and_then(serde_json::Value::as_array_mut)
                .ok_or_else(|| format!("Restored {queue_name} must contain a tasks array"))?
        } else {
            value
                .as_array_mut()
                .ok_or_else(|| format!("Restored {queue_name} must contain a JSON array"))?
        };
        for task in tasks {
            let object = task
                .as_object_mut()
                .ok_or_else(|| format!("Restored {queue_name} contains an invalid task"))?;
            object.insert(
                "projectId".to_string(),
                serde_json::Value::String(id.clone()),
            );
        }
        write_json_atomically(&queue_path, &value)?;
    }

    Ok(id)
}

fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Restored state path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create restored state directory: {error}"))?;
    let temp = parent.join(format!(".restore-{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to serialize restored state: {error}"))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|error| format!("Failed to create restored state file: {error}"))?;
    output
        .write_all(&bytes)
        .and_then(|_| output.sync_all())
        .map_err(|error| {
            let _ = fs::remove_file(&temp);
            format!("Failed to flush restored state: {error}")
        })?;
    drop(output);
    replace_file_atomically(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Failed to install restored state: {error}")
    })
}

fn extract_archive(
    archive: &mut ZipArchive<File>,
    root: &Path,
    manifest: &BackupManifest,
) -> Result<(usize, u64), String> {
    let verify_inventory = manifest.version >= 2;
    let mut expected = BTreeMap::new();
    if verify_inventory {
        for file in &manifest.files {
            let path = Path::new(&file.path);
            if file.path == "potato-box-backup.json"
                || path.is_absolute()
                || path
                    .components()
                    .any(|component| !matches!(component, Component::Normal(_)))
                || expected.insert(file.path.clone(), file.clone()).is_some()
            {
                return Err("Backup manifest contains an unsafe or duplicate file path".to_string());
            }
        }
    }
    let mut verified = BTreeSet::new();
    let mut files = 0usize;
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read backup entry: {error}"))?;
        if entry.name() == "potato-box-backup.json" {
            continue;
        }
        if entry
            .unix_mode()
            .map(|mode| mode & 0o170000 == 0o120000)
            .unwrap_or(false)
        {
            return Err("Backup contains a symbolic link".to_string());
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "Backup contains an unsafe path".to_string())?;
        if enclosed
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err("Backup contains an unsafe path".to_string());
        }
        total = total.saturating_add(entry.size());
        if total > MAX_RESTORE_BYTES {
            return Err("Backup expands beyond the restore size limit".to_string());
        }
        let destination = root.join(enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| format!("Failed to create restored directory: {error}"))?;
            continue;
        }
        let expected_file = if verify_inventory {
            let Some(expected_file) = expected.get(entry.name()) else {
                return Err(format!(
                    "Backup contains a file missing from its manifest: {}",
                    entry.name()
                ));
            };
            if expected_file.size != entry.size() {
                return Err(format!(
                    "Backup file size does not match its manifest: {}",
                    entry.name()
                ));
            }
            Some(expected_file.clone())
        } else {
            None
        };
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create restored parent: {error}"))?;
        }
        let expected_size = entry.size();
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| format!("Failed to create restored file: {error}"))?;
        let mut copied = 0u64;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = entry
                .read(&mut buffer)
                .map_err(|error| format!("Failed to extract backup file: {error}"))?;
            if read == 0 {
                break;
            }
            copied = copied.saturating_add(read as u64);
            if copied > expected_size {
                return Err("Backup entry expanded beyond its declared size".to_string());
            }
            output
                .write_all(&buffer[..read])
                .map_err(|error| format!("Failed to write restored file: {error}"))?;
            hasher.update(&buffer[..read]);
        }
        if copied != expected_size {
            return Err("Backup entry size did not match its metadata".to_string());
        }
        output
            .sync_all()
            .map_err(|error| format!("Failed to flush restored file: {error}"))?;
        if let Some(expected_file) = expected_file {
            let actual = format!("{:x}", hasher.finalize());
            if actual != expected_file.sha256 {
                return Err(format!(
                    "Backup file checksum does not match its manifest: {}",
                    expected_file.path
                ));
            }
            verified.insert(expected_file.path);
        }
        files += 1;
    }
    if verify_inventory && verified.len() != expected.len() {
        return Err("Backup is missing one or more files declared by its manifest".to_string());
    }
    Ok((files, total))
}

fn backup_manifest(archive: &mut ZipArchive<File>) -> Result<BackupManifest, String> {
    let mut manifest = archive
        .by_name("potato-box-backup.json")
        .map_err(|_| "Backup manifest is missing".to_string())?;
    if manifest.size() > 64 * 1024 * 1024 {
        return Err("Backup manifest is too large".to_string());
    }
    let mut raw = String::new();
    manifest
        .read_to_string(&mut raw)
        .map_err(|error| format!("Failed to read backup manifest: {error}"))?;
    let value: BackupManifest = serde_json::from_str(&raw)
        .map_err(|error| format!("Backup manifest is invalid: {error}"))?;
    if value.backup_format != "potato-box-project"
        || !(1..=BACKUP_FORMAT_VERSION).contains(&value.version)
    {
        return Err("Backup format is not supported".to_string());
    }
    Ok(value)
}

fn sanitize_project_name(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| {
            if character.is_alphanumeric()
                || character == ' '
                || character == '-'
                || character == '_'
            {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(80)
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if cleaned.is_empty() {
        "potato-box-project".to_string()
    } else if is_windows_reserved_name(&cleaned) {
        format!("project-{cleaned}")
    } else {
        cleaned
    }
}

fn is_windows_reserved_name(value: &str) -> bool {
    let upper = value.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .and_then(|suffix| suffix.parse::<u8>().ok())
            .map(|number| (1..=9).contains(&number))
            .unwrap_or(false)
}

fn unique_restore_name(parent: &Path, project_name: &str) -> String {
    let date = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let base = format!("{project_name}-restored-{date}");
    if !parent.join(&base).exists() {
        return base;
    }
    format!("{base}-{}", uuid::Uuid::new_v4().simple())
}

fn cleanup_partial_restore(parent: &Path, root: &Path) {
    let safe = root
        .parent()
        .and_then(|candidate| candidate.canonicalize().ok())
        .zip(parent.canonicalize().ok())
        .map(|(candidate, expected)| candidate == expected)
        .unwrap_or(false);
    if safe {
        let _ = fs::remove_dir_all(root);
    }
}

fn should_skip_backup_entry(name: &str) -> bool {
    name == ".git"
        || name.starts_with(".git/")
        || name == "node_modules"
        || name.starts_with("node_modules/")
        || name == ".potato-box/lancedb"
        || name.starts_with(".potato-box/lancedb/")
        || name == ".llm-wiki/lancedb"
        || name.starts_with(".llm-wiki/lancedb/")
        || name.ends_with(".migration-tmp")
        || name.ends_with(".tmp")
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Failed to open backup for hashing: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to hash backup: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn canonical_directory(path: &str, label: &str) -> Result<PathBuf, String> {
    let path = absolute_path(path, label)?;
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve {label}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("{label} must be a directory"));
    }
    Ok(canonical)
}

fn absolute_path(path: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute path"));
    }
    Ok(path)
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_names_are_safe_single_segments() {
        assert_eq!(
            sanitize_project_name("../../Research: 2026"),
            "Research--2026"
        );
        assert_eq!(sanitize_project_name(""), "potato-box-project");
        assert_eq!(sanitize_project_name("CON"), "project-CON");
        assert_eq!(sanitize_project_name("lpt1"), "project-lpt1");
    }

    #[test]
    fn temporary_and_repository_files_are_skipped() {
        assert!(should_skip_backup_entry(".git/config"));
        assert!(should_skip_backup_entry("node_modules/pkg/index.js"));
        assert!(should_skip_backup_entry("wiki/.draft.tmp"));
        assert!(should_skip_backup_entry(".potato-box/lancedb/data.arrow"));
        assert!(!should_skip_backup_entry(".potato-box/review.json"));
    }

    #[test]
    fn backup_round_trip_preserves_project_and_internal_state() {
        let fixture =
            std::env::temp_dir().join(format!("potato-box-backup-test-{}", uuid::Uuid::new_v4()));
        let project = fixture.join("research");
        let restore_parent = fixture.join("restored");
        fs::create_dir_all(project.join("wiki")).unwrap();
        fs::create_dir_all(project.join(".potato-box")).unwrap();
        fs::create_dir_all(&restore_parent).unwrap();
        fs::write(project.join("schema.md"), "# Schema\n").unwrap();
        fs::write(project.join("wiki/index.md"), "# Index\n").unwrap();
        fs::write(project.join(".potato-box/review.json"), "{}").unwrap();
        let original_id = uuid::Uuid::new_v4().to_string();
        fs::write(
            project.join(".potato-box/project.json"),
            serde_json::to_vec(&serde_json::json!({
                "id": original_id.clone(),
                "createdAt": 1,
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            project.join(".potato-box/ingest-queue.json"),
            serde_json::to_vec(&serde_json::json!([{
                "id": "task-1",
                "projectId": original_id.clone(),
            }]))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            project.join(".potato-box/file-change-queue.json"),
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "tasks": [{ "id": "change-1", "projectId": original_id.clone() }],
            }))
            .unwrap(),
        )
        .unwrap();
        let archive = fixture.join("research.zip");

        let backup = create_project_backup_impl(
            project.to_string_lossy().as_ref(),
            archive.to_string_lossy().as_ref(),
        )
        .unwrap();
        let mut archive_reader = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        let manifest = backup_manifest(&mut archive_reader).unwrap();
        assert_eq!(manifest.version, 2);
        assert_eq!(manifest.files.len(), 6);
        assert!(manifest.files.iter().all(|file| file.sha256.len() == 64));
        let restored = restore_project_backup_impl(
            archive.to_string_lossy().as_ref(),
            restore_parent.to_string_lossy().as_ref(),
        )
        .unwrap();
        let restored_root = PathBuf::from(restored.project_path);

        assert!(backup.archive_bytes > 0);
        assert_eq!(backup.files, 6);
        assert_eq!(
            fs::read_to_string(restored_root.join("wiki/index.md")).unwrap(),
            "# Index\n"
        );
        assert!(restored_root.join(".potato-box/review.json").is_file());
        let restored_identity: ProjectIdentity = serde_json::from_slice(
            &fs::read(restored_root.join(".potato-box/project.json")).unwrap(),
        )
        .unwrap();
        assert_ne!(restored_identity.id, original_id);
        let restored_queue: serde_json::Value = serde_json::from_slice(
            &fs::read(restored_root.join(".potato-box/ingest-queue.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            restored_queue[0]["projectId"].as_str(),
            Some(restored_identity.id.as_str())
        );
        let restored_file_queue: serde_json::Value = serde_json::from_slice(
            &fs::read(restored_root.join(".potato-box/file-change-queue.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            restored_file_queue["tasks"][0]["projectId"].as_str(),
            Some(restored_identity.id.as_str())
        );
        let _ = fs::remove_dir_all(fixture);
    }

    #[test]
    fn restore_rejects_parent_traversal_entries() {
        let fixture =
            std::env::temp_dir().join(format!("potato-box-backup-test-{}", uuid::Uuid::new_v4()));
        let restore_parent = fixture.join("restored");
        fs::create_dir_all(&restore_parent).unwrap();
        let archive_path = fixture.join("unsafe.zip");
        let file = File::create(&archive_path).unwrap();
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        archive
            .start_file("potato-box-backup.json", options)
            .unwrap();
        archive
            .write_all(br#"{"format":"potato-box-project","version":1,"projectName":"unsafe"}"#)
            .unwrap();
        archive.start_file("../escape.txt", options).unwrap();
        archive.write_all(b"escape").unwrap();
        archive.finish().unwrap();

        let error = restore_project_backup_impl(
            archive_path.to_string_lossy().as_ref(),
            restore_parent.to_string_lossy().as_ref(),
        )
        .unwrap_err();
        assert!(error.contains("unsafe path"));
        assert!(!fixture.join("escape.txt").exists());
        let _ = fs::remove_dir_all(fixture);
    }

    #[test]
    fn restore_rejects_v2_files_missing_from_manifest() {
        let fixture =
            std::env::temp_dir().join(format!("potato-box-backup-test-{}", uuid::Uuid::new_v4()));
        let restore_parent = fixture.join("restored");
        fs::create_dir_all(&restore_parent).unwrap();
        let archive_path = fixture.join("unverified.zip");
        let file = File::create(&archive_path).unwrap();
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        archive.start_file("schema.md", options).unwrap();
        archive.write_all(b"# Schema").unwrap();
        archive.start_file("wiki/index.md", options).unwrap();
        archive.write_all(b"# Index").unwrap();
        archive
            .start_file("potato-box-backup.json", options)
            .unwrap();
        archive
            .write_all(
                br#"{"format":"potato-box-project","version":2,"createdAt":"now","projectName":"invalid","files":[]}"#,
            )
            .unwrap();
        archive.finish().unwrap();

        let error = restore_project_backup_impl(
            archive_path.to_string_lossy().as_ref(),
            restore_parent.to_string_lossy().as_ref(),
        )
        .unwrap_err();
        assert!(error.contains("missing from its manifest"));
        let _ = fs::remove_dir_all(fixture);
    }

    #[test]
    fn restore_rejects_v2_file_content_that_does_not_match_its_hash() {
        let fixture =
            std::env::temp_dir().join(format!("potato-box-backup-test-{}", uuid::Uuid::new_v4()));
        let restore_parent = fixture.join("restored");
        fs::create_dir_all(&restore_parent).unwrap();
        let archive_path = fixture.join("tampered.zip");
        let file = File::create(&archive_path).unwrap();
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        archive.start_file("schema.md", options).unwrap();
        archive.write_all(b"# Schema").unwrap();
        archive.start_file("wiki/index.md", options).unwrap();
        archive.write_all(b"# Index").unwrap();
        archive
            .start_file("potato-box-backup.json", options)
            .unwrap();
        archive
            .write_all(
                serde_json::to_string(&serde_json::json!({
                    "format": "potato-box-project",
                    "version": 2,
                    "createdAt": "now",
                    "projectName": "tampered",
                    "files": [
                        { "path": "schema.md", "size": 8, "sha256": "0".repeat(64) },
                        { "path": "wiki/index.md", "size": 7, "sha256": "0".repeat(64) }
                    ]
                }))
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        archive.finish().unwrap();

        let error = restore_project_backup_impl(
            archive_path.to_string_lossy().as_ref(),
            restore_parent.to_string_lossy().as_ref(),
        )
        .unwrap_err();
        assert!(error.contains("checksum"), "unexpected error: {error}");
        let _ = fs::remove_dir_all(fixture);
    }
}
