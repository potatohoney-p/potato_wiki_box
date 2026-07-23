import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"
import { isAbsolutePath } from "@/lib/path-utils"

/** Raw shape returned by the Rust commands — id is attached client-side. */
interface RawProject {
  name: string
  path: string
}

export async function readFile(
  path: string,
  options?: { extractImages?: boolean },
): Promise<string> {
  return invoke<string>("read_file", {
    path,
    extractImages: options?.extractImages,
  })
}

export async function readTextFileLimited(path: string, maxBytes: number): Promise<string> {
  assertAbsoluteFsPath("readTextFileLimited", path)
  return invoke<string>("read_text_file_limited", { path, maxBytes })
}

export async function writeFile(path: string, contents: string): Promise<void> {
  assertAbsoluteFsPath("writeFile", path)
  return invoke<void>("write_file", { path, contents })
}

export async function writeFileBase64(path: string, base64: string): Promise<void> {
  assertAbsoluteFsPath("writeFileBase64", path)
  return invoke<void>("write_file_base64", { path, base64 })
}

export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  assertAbsoluteFsPath("writeFileAtomic", path)
  return invoke<void>("write_file_atomic", { path, contents })
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_directory", { path })
}

export async function copyFile(
  source: string,
  destination: string
): Promise<void> {
  return invoke("copy_file", { source, destination })
}

export async function copyDirectory(
  source: string,
  destination: string
): Promise<string[]> {
  return invoke<string[]>("copy_directory", { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return invoke<string>("preprocess_file", { path })
}

export async function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path })
}

export async function deleteManagedReviewFile(
  projectPath: string,
  path: string,
): Promise<void> {
  assertAbsoluteFsPath("deleteManagedReviewFile project", projectPath)
  assertAbsoluteFsPath("deleteManagedReviewFile target", path)
  return invoke("delete_managed_review_file", { projectPath, path })
}

export async function findRelatedWikiPages(
  projectPath: string,
  sourceName: string
): Promise<string[]> {
  return invoke<string[]>("find_related_wiki_pages", { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  assertAbsoluteFsPath("createDirectory", path)
  return invoke<void>("create_directory", { path })
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path })
}

export async function getFileModifiedTime(path: string): Promise<number> {
  return invoke<number>("get_file_modified_time", { path })
}

export async function getFileSize(path: string): Promise<number> {
  return invoke<number>("get_file_size", { path })
}

export async function getFileMd5(path: string): Promise<string> {
  return invoke<string>("get_file_md5", { path })
}

function assertAbsoluteFsPath(operation: string, path: string): void {
  if (!isAbsolutePath(path)) {
    throw new Error(`${operation} requires an absolute path: ${path}`)
  }
}

/** Mirror of `commands::fs::FileBase64` (Rust side). */
export interface FileBase64 {
  base64: string
  mimeType: string
}

/**
 * Read any file off disk as base64 + a guessed mime type. The
 * vision-caption pipeline uses this to pick up extracted images
 * without having to read them as UTF-8 strings (PNG bytes aren't
 * valid UTF-8 — `readFile` would corrupt them).
 */
export async function readFileAsBase64(path: string): Promise<FileBase64> {
  return invoke<FileBase64>("read_file_as_base64", { path })
}

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  const raw = await invoke<RawProject>("create_project", { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = await invoke<RawProject>("open_project", { path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProjectFolder(path: string): Promise<void> {
  return invoke<void>("open_project_folder", { path })
}

export async function clipServerStatus(): Promise<string> {
  return invoke<string>("clip_server_status")
}

export interface ClipProjectRegistration {
  id: string
  name: string
  path: string
}

export interface PendingClip {
  id: string
  projectId: string
  filePath: string
  createdAt: number
}

export async function registerClipProjects(
  currentProjectId: string,
  projects: ClipProjectRegistration[],
): Promise<void> {
  return invoke<void>("clip_register_projects", { currentProjectId, projects })
}

export async function getPendingClips(projectId: string): Promise<PendingClip[]> {
  return invoke<PendingClip[]>("clip_pending_clips", { projectId })
}

export async function acknowledgeClips(projectId: string, clipIds: string[]): Promise<void> {
  return invoke<void>("clip_acknowledge_clips", { projectId, clipIds })
}

export interface BackupReport {
  path: string
  files: number
  uncompressedBytes: number
  archiveBytes: number
  sha256: string
  createdAt: string
}

export interface RestoreReport {
  projectPath: string
  files: number
  uncompressedBytes: number
}

export async function createProjectBackup(
  projectPath: string,
  destination: string,
): Promise<BackupReport> {
  return invoke<BackupReport>("create_project_backup", { projectPath, destination })
}

export async function restoreProjectBackup(
  archivePath: string,
  destinationParent: string,
): Promise<RestoreReport> {
  return invoke<RestoreReport>("restore_project_backup", { archivePath, destinationParent })
}

export async function apiServerStatus(): Promise<string> {
  return invoke<string>("api_server_status")
}

export async function apiServerReloadConfig(): Promise<string> {
  return invoke<string>("api_server_reload_config")
}

export async function mcpServerEntryPath(): Promise<string> {
  return invoke<string>("mcp_server_entry_path")
}
