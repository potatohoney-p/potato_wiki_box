import { readFile, writeFileAtomic, fileExists } from "@/commands/fs"
import { normalizePath, isAbsolutePath } from "@/lib/path-utils"

/**
 * SHA256-based ingest cache.
 * Stores hash of source file content → skips re-ingest if unchanged.
 * Cache file: .potato-box/ingest-cache.json
 */

interface CacheEntry {
  hash: string
  timestamp: number
  filesWritten: string[]
  complete: true
}

interface CacheData {
  version: 2
  entries: Record<string, CacheEntry> // keyed by source filename
}

async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

function cachePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.potato-box/ingest-cache.json`
}

async function loadCache(projectPath: string): Promise<CacheData> {
  try {
    const raw = await readFile(cachePath(projectPath))
    const parsed = JSON.parse(raw) as Partial<CacheData>
    if (parsed.version !== 2 || !parsed.entries || typeof parsed.entries !== "object") {
      return { version: 2, entries: {} }
    }
    return parsed as CacheData
  } catch {
    return { version: 2, entries: {} }
  }
}

async function saveCache(projectPath: string, cache: CacheData): Promise<void> {
  try {
    await writeFileAtomic(cachePath(projectPath), JSON.stringify(cache, null, 2))
  } catch {
    // non-critical
  }
}

/**
 * Check if a source file has already been ingested with the same content.
 * Returns the list of previously written files if cached, or null if ingest
 * is needed.
 *
 * IMPORTANT: a cache hit is only returned if every previously-written file
 * still exists on disk. Otherwise we treat the cache as stale and fall
 * through to a full re-ingest. Historically we returned the cached list
 * blindly, which surfaced ghost entries in the activity panel — clicking
 * them gave the preview panel a missing file, and the auto-save path then
 * materialized a `[Binary file: ...]` stub at the now-empty location.
 */
export async function checkIngestCache(
  projectPath: string,
  sourceFileName: string,
  sourceContent: string,
): Promise<string[] | null> {
  const cache = await loadCache(projectPath)
  const entry = cache.entries[sourceFileName]
  if (!entry || entry.complete !== true || !Array.isArray(entry.filesWritten) || entry.filesWritten.length === 0) return null

  const currentHash = await sha256(sourceContent)
  if (entry.hash !== currentHash) return null

  const pp = normalizePath(projectPath)
  for (const filePath of entry.filesWritten) {
    const fullPath = isAbsolutePath(filePath)
      ? normalizePath(filePath)
      : `${pp}/${filePath}`
    try {
      if (!(await fileExists(fullPath))) {
        console.log(
          `[ingest-cache] cache miss for ${sourceFileName}: ${filePath} no longer on disk`,
        )
        return null
      }
    } catch {
      // If the existence check itself fails, fall back to re-ingest —
      // safer than trusting a stale cache entry.
      return null
    }
  }

  return entry.filesWritten
}

/**
 * Save ingest result to cache after successful ingest.
 */
export async function saveIngestCache(
  projectPath: string,
  sourceFileName: string,
  sourceContent: string,
  filesWritten: string[],
): Promise<void> {
  if (filesWritten.length === 0) {
    throw new Error("Cannot cache an ingest result with no output files")
  }
  const cache = await loadCache(projectPath)
  const hash = await sha256(sourceContent)
  const newEntries = { ...cache.entries }
  newEntries[sourceFileName] = {
    hash,
    timestamp: Date.now(),
    filesWritten,
    complete: true,
  }
  await saveCache(projectPath, { version: 2, entries: newEntries })
}

/**
 * Remove a source file entry from cache (e.g., when source is deleted).
 */
export async function removeFromIngestCache(
  projectPath: string,
  sourceFileName: string,
): Promise<void> {
  const cache = await loadCache(projectPath)
  const newEntries = { ...cache.entries }
  delete newEntries[sourceFileName]
  await saveCache(projectPath, { version: 2, entries: newEntries })
}
