import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export class PersistedStateError extends Error {
  readonly sourcePath: string
  readonly recoveryPath: string | null

  constructor(message: string, sourcePath: string, recoveryPath: string | null) {
    super(message)
    this.name = "PersistedStateError"
    this.sourcePath = sourcePath
    this.recoveryPath = recoveryPath
  }
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\bENOENT\b|does not exist|not found/i.test(message)
}

function recoveryFilePath(path: string): string {
  const normalized = normalizePath(path)
  const marker = "/.potato-box/"
  const markerIndex = normalized.toLowerCase().indexOf(marker)
  const stateRoot = markerIndex >= 0
    ? `${normalized.slice(0, markerIndex)}${marker.slice(0, -1)}`
    : normalized.slice(0, normalized.lastIndexOf("/"))
  const relative = markerIndex >= 0
    ? normalized.slice(markerIndex + marker.length)
    : normalized.slice(normalized.lastIndexOf("/") + 1)
  const safeName = relative.replace(/[^A-Za-z0-9._-]+/g, "_")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `${stateRoot}/recovery/${safeName}.corrupt-${stamp}.json`
}

async function preserveCorruptState(path: string, raw: string): Promise<string | null> {
  const recoveryPath = recoveryFilePath(path)
  try {
    await createDirectory(recoveryPath.slice(0, recoveryPath.lastIndexOf("/")))
    await writeFileAtomic(recoveryPath, raw)
    return recoveryPath
  } catch (error) {
    console.error(`[Persistence] Could not create recovery copy for ${path}:`, error)
    return null
  }
}

export async function readDurableJson<T>(
  path: string,
  validator: (value: unknown) => value is T,
  label: string,
): Promise<T | undefined> {
  let raw: string
  try {
    raw = await readFile(path)
  } catch (error) {
    if (isMissingFileError(error)) return undefined
    throw new PersistedStateError(
      `Could not read ${label} at ${path}: ${String(error)}`,
      path,
      null,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const recoveryPath = await preserveCorruptState(path, raw)
    throw new PersistedStateError(
      `${label} contains invalid JSON at ${path}.${recoveryPath ? ` A recovery copy was saved to ${recoveryPath}.` : " The original file was left untouched."} ${String(error)}`,
      path,
      recoveryPath,
    )
  }

  if (!validator(parsed)) {
    const recoveryPath = await preserveCorruptState(path, raw)
    throw new PersistedStateError(
      `${label} has an invalid data shape at ${path}.${recoveryPath ? ` A recovery copy was saved to ${recoveryPath}.` : " The original file was left untouched."}`,
      path,
      recoveryPath,
    )
  }
  return parsed
}
