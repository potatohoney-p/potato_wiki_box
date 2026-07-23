use std::collections::{HashSet, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server, StatusCode};
use uuid::Uuid;

use crate::api_server;

/// Daemon status: 0=starting, 1=running, 2=port_conflict, 3=error.
static DAEMON_STATUS: AtomicU8 = AtomicU8::new(0);
static PROJECTS: Mutex<Vec<RegisteredProject>> = Mutex::new(Vec::new());
static RATE_LIMIT: OnceLock<Mutex<VecDeque<Instant>>> = OnceLock::new();

const PORT: u16 = 19827;
const MAX_BIND_RETRIES: u32 = 3;
const MAX_RESTART_RETRIES: u32 = 10;
const BIND_RETRY_DELAY_SECS: u64 = 2;
const RESTART_DELAY_SECS: u64 = 5;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_PROJECTS: usize = 200;
const MAX_PENDING_CLIPS: usize = 1_000;
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);
const RATE_LIMIT_MAX_REQUESTS: usize = 120;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipProjectRegistration {
    id: String,
    name: String,
    path: String,
}

#[derive(Debug, Clone)]
struct RegisteredProject {
    id: String,
    name: String,
    path: PathBuf,
    current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingClipRecord {
    id: String,
    project_id: String,
    relative_path: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingClip {
    id: String,
    project_id: String,
    file_path: String,
    created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClipRequest {
    project_id: String,
    #[serde(default)]
    idempotency_key: Option<String>,
    #[serde(default = "default_title")]
    title: String,
    #[serde(default)]
    url: String,
    content: String,
}

#[derive(Debug)]
struct ClipError {
    status: u16,
    message: String,
}

impl ClipError {
    fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

fn default_title() -> String {
    "Untitled".to_string()
}

pub fn get_daemon_status() -> &'static str {
    match DAEMON_STATUS.load(Ordering::Relaxed) {
        0 => "starting",
        1 => "running",
        2 => "port_conflict",
        _ => "error",
    }
}

pub fn current_project_path() -> String {
    PROJECTS
        .lock()
        .ok()
        .and_then(|projects| projects.iter().find(|project| project.current).cloned())
        .map(|project| normalize_path(&project.path))
        .unwrap_or_default()
}

pub fn all_projects() -> Vec<(String, String)> {
    PROJECTS
        .lock()
        .map(|projects| {
            projects
                .iter()
                .map(|project| (project.name.clone(), normalize_path(&project.path)))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn clip_register_projects(
    current_project_id: String,
    projects: Vec<ClipProjectRegistration>,
) -> Result<(), String> {
    validate_uuid(&current_project_id, "current project id")?;
    if projects.is_empty() {
        return Err("At least one project is required".to_string());
    }
    if projects.len() > MAX_PROJECTS {
        return Err(format!("At most {MAX_PROJECTS} projects can be registered"));
    }

    let mut seen_ids = HashSet::new();
    let mut registered = Vec::with_capacity(projects.len());
    for project in projects {
        let is_current = project.id == current_project_id;
        if let Err(error) = validate_uuid(&project.id, "project id") {
            if is_current {
                return Err(error);
            }
            continue;
        }
        if !seen_ids.insert(project.id.clone()) {
            continue;
        }
        let path = match canonical_project_path(&project.path) {
            Ok(path) => path,
            Err(error) if is_current => return Err(error),
            Err(_) => continue,
        };
        let name = clean_project_name(&project.name, &path);
        registered.push(RegisteredProject {
            current: is_current,
            id: project.id,
            name,
            path,
        });
    }

    if !registered.iter().any(|project| project.current) {
        return Err("The current project is not in the registered project list".to_string());
    }

    let mut guard = PROJECTS
        .lock()
        .map_err(|_| "Clip project registry is unavailable".to_string())?;
    *guard = registered;
    Ok(())
}

#[tauri::command]
pub fn clip_pending_clips(project_id: String) -> Result<Vec<PendingClip>, String> {
    validate_uuid(&project_id, "project id")?;
    let project = registered_project(&project_id)
        .ok_or_else(|| "Project is not registered with the clipper".to_string())?;
    load_pending_clips(&project)
}

#[tauri::command]
pub fn clip_acknowledge_clips(project_id: String, clip_ids: Vec<String>) -> Result<(), String> {
    validate_uuid(&project_id, "project id")?;
    if clip_ids.len() > MAX_PENDING_CLIPS {
        return Err(format!(
            "At most {MAX_PENDING_CLIPS} clips can be acknowledged at once"
        ));
    }
    let project = registered_project(&project_id)
        .ok_or_else(|| "Project is not registered with the clipper".to_string())?;
    let queue_dir = clip_queue_dir(&project.path);
    for clip_id in clip_ids {
        validate_uuid(&clip_id, "clip id")?;
        let marker = queue_dir.join(format!("{clip_id}.json"));
        match fs::remove_file(marker) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Failed to acknowledge clip: {error}")),
        }
    }
    Ok(())
}

pub fn start_clip_server(app: AppHandle) {
    thread::spawn(move || {
        let mut restart_count = 0u32;
        loop {
            let Some(server) = bind_server_with_retry() else {
                DAEMON_STATUS.store(2, Ordering::Relaxed);
                thread::sleep(Duration::from_secs(BIND_RETRY_DELAY_SECS * 6));
                continue;
            };

            DAEMON_STATUS.store(1, Ordering::Relaxed);
            println!("[Clip Server] Listening on http://127.0.0.1:{PORT}");

            for request in server.incoming_requests() {
                process_request(&app, request);
            }

            DAEMON_STATUS.store(3, Ordering::Relaxed);
            restart_count += 1;
            if restart_count >= MAX_RESTART_RETRIES {
                eprintln!("[Clip Server] Exceeded max restarts ({MAX_RESTART_RETRIES})");
                return;
            }
            thread::sleep(Duration::from_secs(RESTART_DELAY_SECS));
        }
    });
}

fn bind_server_with_retry() -> Option<Server> {
    for attempt in 1..=MAX_BIND_RETRIES {
        match Server::http(format!("127.0.0.1:{PORT}")) {
            Ok(server) => return Some(server),
            Err(error) => {
                eprintln!(
                    "[Clip Server] Bind attempt {attempt}/{MAX_BIND_RETRIES} failed: {error}"
                );
                if attempt < MAX_BIND_RETRIES {
                    thread::sleep(Duration::from_secs(BIND_RETRY_DELAY_SECS));
                }
            }
        }
    }
    None
}

fn process_request(app: &AppHandle, mut request: tiny_http::Request) {
    let method = request.method().clone();
    let url = request.url().split('?').next().unwrap_or("").to_string();
    let headers = request_headers(&request);
    let origin = header_value(&headers, "origin");

    if !origin_is_allowed(origin) {
        respond_json(
            request,
            403,
            json!({ "ok": false, "error": "Origin is not allowed" }),
            None,
        );
        return;
    }

    if method == Method::Options {
        respond_options(request, origin);
        return;
    }

    if !allow_request() {
        respond_json(
            request,
            429,
            json!({ "ok": false, "error": "Too many requests" }),
            origin,
        );
        return;
    }

    if !is_authorized(app, &headers) {
        respond_json(
            request,
            401,
            json!({ "ok": false, "error": "Unauthorized" }),
            origin,
        );
        return;
    }

    match (method, url.as_str()) {
        (Method::Get, "/status") => respond_json(
            request,
            200,
            json!({
                "ok": true,
                "version": env!("CARGO_PKG_VERSION"),
                "authRequired": true,
            }),
            origin,
        ),
        (Method::Get, "/projects") => {
            let projects = public_projects();
            respond_json(
                request,
                200,
                json!({ "ok": true, "projects": projects }),
                origin,
            );
        }
        (Method::Post, "/clip") => {
            let body = match read_body(&mut request) {
                Ok(body) => body,
                Err(error) => {
                    let status = if error == "Request body too large" {
                        413
                    } else {
                        400
                    };
                    respond_json(
                        request,
                        status,
                        json!({ "ok": false, "error": error }),
                        origin,
                    );
                    return;
                }
            };
            match handle_clip(&body) {
                Ok(body) => respond_json(request, 201, body, origin),
                Err(error) => respond_json(
                    request,
                    error.status,
                    json!({ "ok": false, "error": error.message }),
                    origin,
                ),
            }
        }
        _ => respond_json(
            request,
            404,
            json!({ "ok": false, "error": "Not found" }),
            origin,
        ),
    }
}

fn request_headers(request: &tiny_http::Request) -> Vec<(String, String)> {
    request
        .headers()
        .iter()
        .map(|header| {
            (
                header.field.as_str().to_ascii_lowercase().to_string(),
                header.value.as_str().to_string(),
            )
        })
        .collect()
}

fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

fn origin_is_allowed(origin: Option<&str>) -> bool {
    origin
        .map(|value| {
            value.starts_with("chrome-extension://") || value.starts_with("moz-extension://")
        })
        .unwrap_or(true)
}

fn is_authorized(app: &AppHandle, headers: &[(String, String)]) -> bool {
    let Some(expected) = api_server::api_token(app) else {
        return false;
    };
    headers.iter().any(|(key, value)| {
        let supplied = if key == "x-potato-box-token" {
            Some(value.as_str())
        } else if key == "authorization" {
            value.strip_prefix("Bearer ")
        } else {
            None
        };
        supplied
            .map(|token| constant_time_eq(token.as_bytes(), expected.as_bytes()))
            .unwrap_or(false)
    })
}

fn allow_request() -> bool {
    let now = Instant::now();
    let window_start = now - RATE_LIMIT_WINDOW;
    let lock = RATE_LIMIT.get_or_init(|| Mutex::new(VecDeque::new()));
    let Ok(mut hits) = lock.lock() else {
        return false;
    };
    while hits.front().map(|hit| *hit < window_start).unwrap_or(false) {
        hits.pop_front();
    }
    if hits.len() >= RATE_LIMIT_MAX_REQUESTS {
        return false;
    }
    hits.push_back(now);
    true
}

fn read_body(request: &mut tiny_http::Request) -> Result<String, String> {
    let mut reader = request.as_reader().take(MAX_BODY_BYTES as u64 + 1);
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read request body: {error}"))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("Request body too large".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "Request body must be UTF-8".to_string())
}

fn respond_options(request: tiny_http::Request, origin: Option<&str>) {
    let mut response = Response::empty(StatusCode(204));
    add_response_headers(&mut response, origin);
    response.add_header(
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
    );
    response.add_header(
        Header::from_bytes(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Potato-Box-Token",
        )
        .unwrap(),
    );
    response.add_header(Header::from_bytes("Access-Control-Max-Age", "600").unwrap());
    let _ = request.respond(response);
}

fn respond_json(request: tiny_http::Request, status: u16, body: Value, origin: Option<&str>) {
    let mut response = Response::from_string(body.to_string()).with_status_code(StatusCode(status));
    add_response_headers(&mut response, origin);
    let _ = request.respond(response);
}

fn add_response_headers<R: Read>(response: &mut Response<R>, origin: Option<&str>) {
    response
        .add_header(Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap());
    response.add_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
    response.add_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap());
    if let Some(origin) = origin.filter(|value| origin_is_allowed(Some(value))) {
        response.add_header(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
        response.add_header(Header::from_bytes("Vary", "Origin").unwrap());
    }
}

fn public_projects() -> Vec<Value> {
    PROJECTS
        .lock()
        .map(|projects| {
            projects
                .iter()
                .map(|project| {
                    json!({
                        "id": project.id,
                        "name": project.name,
                        "current": project.current,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn handle_clip(body: &str) -> Result<Value, ClipError> {
    let request: ClipRequest = serde_json::from_str(body)
        .map_err(|_| ClipError::new(400, "Request body must be valid clip JSON"))?;
    validate_uuid(&request.project_id, "project id")
        .map_err(|message| ClipError::new(400, message))?;
    let project = registered_project(&request.project_id)
        .ok_or_else(|| ClipError::new(404, "Unknown project"))?;

    let title = single_line(&request.title, 500);
    let title = if title.is_empty() {
        default_title()
    } else {
        title
    };
    if request.content.trim().is_empty() {
        return Err(ClipError::new(400, "content is required"));
    }
    if request.url.len() > 4_096
        || (!request.url.is_empty()
            && !request.url.starts_with("http://")
            && !request.url.starts_with("https://"))
    {
        return Err(ClipError::new(400, "url must be an HTTP(S) URL"));
    }

    let source_dir = project.path.join("raw").join("sources");
    fs::create_dir_all(&source_dir)
        .map_err(|_| ClipError::new(500, "Could not prepare the project source directory"))?;
    let queue_dir = clip_queue_dir(&project.path);
    fs::create_dir_all(&queue_dir)
        .map_err(|_| ClipError::new(500, "Could not prepare the clip queue"))?;
    let receipt_dir = clip_receipt_dir(&project.path);
    fs::create_dir_all(&receipt_dir)
        .map_err(|_| ClipError::new(500, "Could not prepare clip receipts"))?;
    cleanup_expired_clip_receipts(&receipt_dir);

    let clip_id = request
        .idempotency_key
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_uuid(&clip_id, "idempotency key").map_err(|message| ClipError::new(400, message))?;
    let receipt_path = receipt_dir.join(format!("{clip_id}.json"));
    if receipt_path.exists() {
        let record = load_clip_record(&receipt_path, &project.id)?;
        return existing_clip_response(&project, &queue_dir, record);
    }

    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let slug = slugify(&title);
    let markdown = build_markdown(&title, &request.url, &request.content, &date);
    let (file_path, relative_path) = create_unique_clip(&source_dir, &slug, &timestamp, &markdown)?;

    let record = PendingClipRecord {
        id: clip_id.clone(),
        project_id: project.id.clone(),
        relative_path: relative_path.clone(),
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    if let Err(error) = write_pending_record(&queue_dir, &record) {
        let _ = fs::remove_file(&file_path);
        return Err(ClipError::new(
            500,
            format!("The clip could not be durably queued: {error}"),
        ));
    }
    if let Err(error) = write_clip_record(&receipt_path, &record) {
        let _ = fs::remove_file(queue_dir.join(format!("{clip_id}.json")));
        let _ = fs::remove_file(&file_path);
        return Err(ClipError::new(
            500,
            format!("The clip receipt could not be saved: {error}"),
        ));
    }

    Ok(json!({
        "ok": true,
        "clipId": clip_id,
        "path": relative_path,
        "status": "queued",
        "autoIngestQueued": true,
        "duplicate": false,
        "warning": Value::Null,
        "fileName": file_path.file_name().and_then(|name| name.to_str()).unwrap_or("clip.md"),
    }))
}

fn load_clip_record(path: &Path, project_id: &str) -> Result<PendingClipRecord, ClipError> {
    let raw = fs::read_to_string(path)
        .map_err(|error| ClipError::new(500, format!("Failed to read clip receipt: {error}")))?;
    let record: PendingClipRecord = serde_json::from_str(&raw)
        .map_err(|error| ClipError::new(409, format!("Clip receipt is corrupt: {error}")))?;
    if record.project_id != project_id
        || validate_uuid(&record.id, "clip id").is_err()
        || !is_safe_source_relative_path(&record.relative_path)
    {
        return Err(ClipError::new(
            409,
            "Clip receipt does not match this project",
        ));
    }
    Ok(record)
}

fn existing_clip_response(
    project: &RegisteredProject,
    queue_dir: &Path,
    record: PendingClipRecord,
) -> Result<Value, ClipError> {
    let file_path = project.path.join(&record.relative_path);
    if !file_path.is_file() {
        return Err(ClipError::new(
            409,
            "The idempotent clip receipt exists, but its source file is missing",
        ));
    }
    let queued = queue_dir.join(format!("{}.json", record.id)).is_file();
    Ok(json!({
        "ok": true,
        "clipId": record.id,
        "path": record.relative_path,
        "status": if queued { "queued" } else { "processed" },
        "autoIngestQueued": queued,
        "duplicate": true,
        "warning": Value::Null,
        "fileName": file_path.file_name().and_then(|name| name.to_str()).unwrap_or("clip.md"),
    }))
}

fn build_markdown(title: &str, url: &str, content: &str, date: &str) -> String {
    let title = single_line_metadata(title, "Untitled");
    let url = single_line_metadata(url, "");
    let date = single_line_metadata(date, "");
    let yaml_title = serde_json::to_string(&title).unwrap_or_else(|_| "\"Untitled\"".to_string());
    let yaml_url = serde_json::to_string(&url).unwrap_or_else(|_| "\"\"".to_string());
    let source_line = if url.is_empty() {
        String::new()
    } else {
        format!("Source: {url}\n\n")
    };
    format!(
        "---\ntype: clip\ntitle: {yaml_title}\nurl: {yaml_url}\nclipped: {date}\norigin: web-clip\nsources: []\ntags: [web-clip]\n---\n\n# {title}\n\n{source_line}{}\n",
        content.trim()
    )
}

fn single_line_metadata(value: &str, fallback: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn create_unique_clip(
    source_dir: &Path,
    slug: &str,
    timestamp: &str,
    markdown: &str,
) -> Result<(PathBuf, String), ClipError> {
    for index in 1..=1_000u32 {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!("-{index}")
        };
        let file_name = format!("{slug}-{timestamp}{suffix}.md");
        let path = source_dir.join(&file_name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file
                    .write_all(markdown.as_bytes())
                    .and_then(|_| file.sync_all())
                {
                    let _ = fs::remove_file(&path);
                    return Err(ClipError::new(500, format!("Failed to save clip: {error}")));
                }
                return Ok((path, format!("raw/sources/{file_name}")));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(ClipError::new(
                    500,
                    format!("Failed to create clip: {error}"),
                ))
            }
        }
    }
    Err(ClipError::new(
        409,
        "Could not allocate a unique clip filename",
    ))
}

fn write_pending_record(queue_dir: &Path, record: &PendingClipRecord) -> Result<(), String> {
    let path = queue_dir.join(format!("{}.json", record.id));
    write_clip_record(&path, record)
}

fn write_clip_record(path: &Path, record: &PendingClipRecord) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(record).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(&payload)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn load_pending_clips(project: &RegisteredProject) -> Result<Vec<PendingClip>, String> {
    let queue_dir = clip_queue_dir(&project.path);
    let entries = match fs::read_dir(queue_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Failed to read the clip queue: {error}")),
    };

    let mut clips = Vec::new();
    for entry in entries.flatten().take(MAX_PENDING_CLIPS) {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<PendingClipRecord>(&raw) else {
            continue;
        };
        if record.project_id != project.id
            || validate_uuid(&record.id, "clip id").is_err()
            || !is_safe_source_relative_path(&record.relative_path)
        {
            continue;
        }
        let file_path = project.path.join(&record.relative_path);
        if !file_path.is_file() {
            continue;
        }
        clips.push(PendingClip {
            id: record.id,
            project_id: record.project_id,
            file_path: normalize_path(&file_path),
            created_at: record.created_at,
        });
    }
    clips.sort_by_key(|clip| clip.created_at);
    Ok(clips)
}

fn clip_queue_dir(project_path: &Path) -> PathBuf {
    project_path.join(".potato-box").join("clip-queue")
}

fn clip_receipt_dir(project_path: &Path) -> PathBuf {
    project_path.join(".potato-box").join("clip-receipts")
}

fn cleanup_expired_clip_receipts(receipt_dir: &Path) {
    const RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
    let Ok(entries) = fs::read_dir(receipt_dir) else {
        return;
    };
    for entry in entries.flatten().take(4_096) {
        let path = entry.path();
        let valid_receipt_name = path
            .file_stem()
            .and_then(|value| value.to_str())
            .is_some_and(|value| Uuid::parse_str(value).is_ok())
            && path.extension().and_then(|value| value.to_str()) == Some("json");
        if !valid_receipt_name {
            continue;
        }
        let expired = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
            .is_ok_and(|elapsed| elapsed > RETENTION);
        if expired {
            let _ = fs::remove_file(path);
        }
    }
}

fn is_safe_source_relative_path(path: &str) -> bool {
    let mut components = Path::new(path).components();
    matches!(components.next(), Some(Component::Normal(value)) if value == "raw")
        && matches!(components.next(), Some(Component::Normal(value)) if value == "sources")
        && components.all(|component| matches!(component, Component::Normal(_)))
}

fn registered_project(project_id: &str) -> Option<RegisteredProject> {
    PROJECTS.lock().ok().and_then(|projects| {
        projects
            .iter()
            .find(|project| project.id == project_id)
            .cloned()
    })
}

fn canonical_project_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("Project path must be absolute".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Project path is unavailable: {error}"))?;
    if !canonical.is_dir() {
        return Err("Project path must be a directory".to_string());
    }
    Ok(canonical)
}

fn clean_project_name(name: &str, path: &Path) -> String {
    let cleaned = single_line(name, 120);
    if !cleaned.is_empty() {
        return cleaned;
    }
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Project")
        .to_string()
}

fn single_line(value: &str, max_chars: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn slugify(title: &str) -> String {
    let slug = title
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || character == ' ' || character == '-' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .to_lowercase()
        .chars()
        .take(64)
        .collect::<String>();
    if slug.is_empty() {
        "clip".to_string()
    } else {
        slug
    }
}

fn validate_uuid(value: &str, label: &str) -> Result<(), String> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| format!("Invalid {label}"))
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let max_len = left.len().max(right.len());
    let mut diff = left.len() ^ right.len();
    for index in 0..max_len {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        diff |= (a ^ b) as usize;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_are_limited_to_browser_extensions_and_non_browser_clients() {
        assert!(origin_is_allowed(None));
        assert!(origin_is_allowed(Some("chrome-extension://abc")));
        assert!(origin_is_allowed(Some("moz-extension://abc")));
        assert!(!origin_is_allowed(Some("https://example.com")));
        assert!(!origin_is_allowed(Some("null")));
    }

    #[test]
    fn source_paths_cannot_escape_the_project() {
        assert!(is_safe_source_relative_path("raw/sources/page.md"));
        assert!(is_safe_source_relative_path("raw/sources/folder/page.md"));
        assert!(!is_safe_source_relative_path("raw/sources/../secret.md"));
        assert!(!is_safe_source_relative_path("wiki/page.md"));
        assert!(!is_safe_source_relative_path("C:/secret.md"));
    }

    #[test]
    fn markdown_frontmatter_escapes_untrusted_metadata() {
        let markdown = build_markdown(
            "Title\nadmin: true",
            "https://example.com/\"x",
            "Body",
            "2026-07-10",
        );
        assert!(markdown.contains("title: \"Title admin: true\""));
        assert!(markdown.contains("url: \"https://example.com/\\\"x\""));
        assert!(!markdown.contains("\nadmin: true\n"));
        assert!(markdown.contains("# Title admin: true"));
    }

    #[test]
    fn slug_falls_back_and_is_bounded() {
        assert_eq!(slugify("!!!"), "clip");
        assert!(slugify(&"a".repeat(100)).len() <= 64);
    }

    #[test]
    fn constant_time_comparison_checks_length_and_bytes() {
        assert!(constant_time_eq(b"token", b"token"));
        assert!(!constant_time_eq(b"token", b"Token"));
        assert!(!constant_time_eq(b"token", b"token-longer"));
    }

    #[test]
    fn clip_receipts_are_create_once_and_round_trip() {
        let root =
            std::env::temp_dir().join(format!("potato-box-clip-receipt-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let path = root.join(format!("{id}.json"));
        let record = PendingClipRecord {
            id: id.clone(),
            project_id: uuid::Uuid::new_v4().to_string(),
            relative_path: "raw/sources/page.md".to_string(),
            created_at: 1,
        };

        write_clip_record(&path, &record).unwrap();
        assert!(write_clip_record(&path, &record).is_err());
        let loaded = load_clip_record(&path, &record.project_id).unwrap();
        assert_eq!(loaded.id, id);
        assert_eq!(loaded.relative_path, "raw/sources/page.md");
        let _ = fs::remove_dir_all(root);
    }
}
