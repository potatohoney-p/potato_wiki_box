import { writeFileAtomic } from "@/commands/fs"
import { autoIngest, type IngestFileMutation } from "./ingest"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath, isAbsolutePath } from "@/lib/path-utils"
import { getProjectPathById } from "@/lib/project-identity"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { readDurableJson } from "@/lib/durable-json"
import { vectorPageIdFromPath } from "@/lib/wiki-page-id"

// ── Types ─────────────────────────────────────────────────────────────────

export interface IngestTask {
  id: string
  /** Stable project UUID (see project-identity.ts). Prefer this to
   *  `projectPath` because the filesystem location can change — tasks
   *  look up the current path via the registry at run time. */
  projectId: string
  sourcePath: string  // relative to project: "raw/sources/folder/file.pdf"
  folderContext: string  // e.g. "AI-Research > papers" or ""
  status: "pending" | "processing" | "done" | "failed"
  addedAt: number
  error: string | null
  retryCount: number
}

// ── State ─────────────────────────────────────────────────────────────────

let queue: IngestTask[] = []
let processing = false
/** UUID of the currently-active project. Used as a stale-context guard
 *  in processNext: if this changes mid-ingest (user switched projects),
 *  the orphaned runner bails instead of writing to the old project. */
let currentProjectId = ""
/** Cached filesystem path of the currently-active project. Kept in lock-
 *  step with `currentProjectId` by pauseQueue / restoreQueue so sync
 *  callers (saveQueue, cancelTask, etc.) don't need a registry lookup. */
let currentProjectPath = ""
let currentAbortController: AbortController | null = null
let queueEpoch = 0
let runnerCounter = 0
let activeRunner: { id: number; promise: Promise<void> } | null = null
let pausing = false
let completedSinceIdle = 0
// Track whether any task has been processed since the last drain.
// Prevents the sweep from running on every idle/no-op call.
let processedSinceDrain = false
// Abort controller for the review-sweep LLM call so switching projects
// cancels a long-running judgment instead of burning tokens.
let sweepAbortController: AbortController | null = null

function resetQueueAccounting(): void {
  completedSinceIdle = 0
}

// ── Persistence ───────────────────────────────────────────────────────────

function queueFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.potato-box/ingest-queue.json`
}

function serializedQueue(): string {
  return JSON.stringify(queue.filter((task) => task.status !== "done"), null, 2)
}

function cloneQueue(): IngestTask[] {
  return queue.map((task) => ({ ...task }))
}

/** Durability barrier used when navigation depends on the queue being saved. */
async function persistQueue(projectPath: string): Promise<void> {
  await writeFileAtomic(queueFilePath(projectPath), serializedQueue())
}

/**
 * Runner checkpoints are best effort: an individual processing attempt must
 * not crash solely because its status indicator could not be updated. Project
 * switches call persistQueue directly and therefore fail closed.
 */
async function saveQueue(projectPath: string): Promise<void> {
  try {
    await persistQueue(projectPath)
  } catch (error) {
    console.error("[Ingest Queue] Failed to persist queue checkpoint:", error)
  }
}

async function loadQueue(projectPath: string, projectId: string): Promise<IngestTask[]> {
  const tasks = await readDurableJson(
    queueFilePath(projectPath),
    isIngestTaskArray,
    "Ingest queue",
  )
  if (!tasks) return []
  // Backfill projectId for tasks persisted before the field existed.
  return tasks.map((task) => ({ ...task, projectId: task.projectId ?? projectId }))
}

function isIngestTaskArray(value: unknown): value is IngestTask[] {
  return Array.isArray(value) && value.every((task) => {
    if (!task || typeof task !== "object") return false
    const candidate = task as Partial<IngestTask>
    return typeof candidate.id === "string"
      && (candidate.projectId === undefined || typeof candidate.projectId === "string")
      && typeof candidate.sourcePath === "string"
      && typeof candidate.folderContext === "string"
      && ["pending", "processing", "done", "failed"].includes(String(candidate.status))
      && typeof candidate.addedAt === "number"
      && (candidate.error === null || typeof candidate.error === "string")
      && typeof candidate.retryCount === "number"
  })
}

// ── Queue Operations ──────────────────────────────────────────────────────

function generateId(): string {
  return `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeSourcePathForQueue(sourcePath: string): string {
  const normalized = normalizePath(sourcePath)
  if (currentProjectPath && normalized.startsWith(`${currentProjectPath}/`)) {
    return normalized.slice(currentProjectPath.length + 1)
  }
  return normalized
}

function sameQueuedSourcePath(a: string, b: string): boolean {
  return normalizeSourcePathForQueue(a) === normalizeSourcePathForQueue(b)
}

function upsertQueuedIngestTask(
  projectId: string,
  sourcePath: string,
  folderContext: string,
): string {
  if (queue.length === 0 && !processing) {
    resetQueueAccounting()
  }
  const normalizedSourcePath = normalizeSourcePathForQueue(sourcePath)
  const pendingOrFailed = queue.find((t) =>
    t.projectId === projectId &&
    (t.status === "pending" || t.status === "failed") &&
    sameQueuedSourcePath(t.sourcePath, normalizedSourcePath)
  )

  if (pendingOrFailed) {
    pendingOrFailed.sourcePath = normalizedSourcePath
    pendingOrFailed.folderContext = folderContext || pendingOrFailed.folderContext
    pendingOrFailed.status = "pending"
    pendingOrFailed.error = null
    pendingOrFailed.retryCount = 0
    return pendingOrFailed.id
  }

  const processingTask = queue.find((t) =>
    t.projectId === projectId &&
    t.status === "processing" &&
    sameQueuedSourcePath(t.sourcePath, normalizedSourcePath)
  )
  const pendingRerun = processingTask
    ? queue.find((t) =>
        t.projectId === projectId &&
        t.status === "pending" &&
        sameQueuedSourcePath(t.sourcePath, normalizedSourcePath)
      )
    : null

  if (pendingRerun) {
    return pendingRerun.id
  }

  const task: IngestTask = {
    id: generateId(),
    projectId,
    sourcePath: normalizedSourcePath,
    folderContext,
    status: "pending",
    addedAt: Date.now(),
    error: null,
    retryCount: 0,
  }
  queue.push(task)
  return task.id
}

/**
 * Delete files written by a cancelled / failed ingest, AND drop the
 * matching pages' chunks from LanceDB. Called from the cancel paths
 * (cancelTask, cancelAllTasks).
 *
 * Per-file errors are swallowed (best-effort cleanup) — a missing
 * file or LanceDB unavailable shouldn't abort the cancel flow.
 * Structural pages (index/log/overview) aren't embedded, so the
 * cascade no-ops for them.
 */
export async function cleanupWrittenFiles(
  projectPath: string,
  filePaths: string[],
): Promise<void> {
  const { cascadeDeleteWikiPage } = await import("@/lib/wiki-page-delete")
  for (const filePath of filePaths) {
    const fullPath = isAbsolutePath(filePath)
      ? normalizePath(filePath)
      : `${projectPath}/${filePath}`
    try {
      await cascadeDeleteWikiPage(projectPath, fullPath)
    } catch {
      // file may not exist / lancedb unavailable — non-critical
    }
  }
}

async function rollbackIngestMutations(
  projectPath: string,
  mutations: readonly IngestFileMutation[],
): Promise<void> {
  if (mutations.length === 0) return
  const { cascadeDeleteWikiPage } = await import("@/lib/wiki-page-delete")
  const embeddingConfig = useWikiStore.getState().embeddingConfig

  for (const mutation of [...mutations].reverse()) {
    const fullPath = isAbsolutePath(mutation.path)
      ? normalizePath(mutation.path)
      : `${projectPath}/${normalizePath(mutation.path)}`
    try {
      if (mutation.previousContent === null) {
        await cascadeDeleteWikiPage(projectPath, fullPath)
        continue
      }

      await writeFileAtomic(fullPath, mutation.previousContent)
      const slug = fullPath.split("/").pop()?.replace(/\.md$/i, "") ?? ""
      const pageId = vectorPageIdFromPath(fullPath, `${projectPath}/wiki`)
      if (
        embeddingConfig.enabled &&
        embeddingConfig.model &&
        slug &&
        !["index", "log", "overview"].includes(slug)
      ) {
        try {
          const { embedPage } = await import("@/lib/embedding")
          const title = mutation.previousContent.match(
            /^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m,
          )?.[1]?.trim() ?? slug
          await embedPage(
            projectPath,
            pageId,
            title,
            mutation.previousContent,
            embeddingConfig,
          )
        } catch (error) {
          console.warn(`[Ingest Queue] Failed to restore embedding for ${mutation.path}:`, error)
        }
      }
    } catch (error) {
      console.error(`[Ingest Queue] Failed to roll back ${mutation.path}:`, error)
    }
  }

  try {
    const { listDirectory } = await import("@/commands/fs")
    useWikiStore.getState().setFileTree(await listDirectory(projectPath))
    useWikiStore.getState().bumpDataVersion()
  } catch {
    // Files are already durable; a later tree refresh will reconcile the UI.
  }
}

/**
 * Add a file to the ingest queue. The project MUST be the currently-
 * active project — switching first is a prerequisite. Returns the new
 * task's id.
 */
export async function enqueueIngest(
  projectId: string,
  sourcePath: string,
  folderContext: string = "",
): Promise<string> {
  if (!currentProjectId || currentProjectId !== projectId) {
    throw new Error(
      `enqueueIngest: project ${projectId} is not the active project (current: ${currentProjectId || "<none>"})`,
    )
  }

  const previousQueue = cloneQueue()
  const previousCompleted = completedSinceIdle
  const id = upsertQueuedIngestTask(projectId, sourcePath, folderContext)
  try {
    await persistQueue(currentProjectPath)
  } catch (error) {
    queue = previousQueue
    completedSinceIdle = previousCompleted
    throw error
  }

  processNext(currentProjectId)

  return id
}

/**
 * Add multiple files to the queue at once. Same active-project
 * requirement as enqueueIngest.
 */
export async function enqueueBatch(
  projectId: string,
  files: Array<{ sourcePath: string; folderContext: string }>,
): Promise<string[]> {
  if (!currentProjectId || currentProjectId !== projectId) {
    throw new Error(
      `enqueueBatch: project ${projectId} is not the active project (current: ${currentProjectId || "<none>"})`,
    )
  }

  const previousQueue = cloneQueue()
  const previousCompleted = completedSinceIdle
  const ids: string[] = []
  for (const file of files) {
    ids.push(upsertQueuedIngestTask(projectId, file.sourcePath, file.folderContext))
  }

  try {
    await persistQueue(currentProjectPath)
  } catch (error) {
    queue = previousQueue
    completedSinceIdle = previousCompleted
    throw error
  }
  console.log(`[Ingest Queue] Enqueued ${files.length} files`)
  processNext(currentProjectId)

  return ids
}

/**
 * Retry a failed task. Only valid for tasks in the active project's
 * queue.
 */
export async function retryTask(taskId: string): Promise<void> {
  const task = queue.find((t) => t.id === taskId)
  if (!task) return
  if (task.projectId !== currentProjectId) return

  const previous = { status: task.status, error: task.error, retryCount: task.retryCount }
  task.status = "pending"
  task.error = null
  task.retryCount = 0
  try {
    await persistQueue(currentProjectPath)
  } catch (error) {
    Object.assign(task, previous)
    throw error
  }
  processNext(currentProjectId)
}

/**
 * Retry every failed task for the active project.
 * Returns the number of tasks requeued.
 */
export async function retryAllFailedTasks(): Promise<number> {
  if (!currentProjectId) return 0

  const previousQueue = cloneQueue()
  let requeued = 0
  for (const task of queue) {
    if (task.projectId !== currentProjectId || task.status !== "failed") continue
    task.status = "pending"
    task.error = null
    task.retryCount = 0
    requeued++
  }

  if (requeued === 0) return 0

  try {
    await persistQueue(currentProjectPath)
  } catch (error) {
    queue = previousQueue
    throw error
  }
  processNext(currentProjectId)
  return requeued
}

/**
 * Cancel a pending or processing task.
 * If processing, aborts the LLM call and cleans up generated files.
 */
export async function cancelTask(taskId: string): Promise<void> {
  const task = queue.find((t) => t.id === taskId)
  if (!task) return
  if (task.projectId !== currentProjectId) return

  const previousQueue = cloneQueue().map((candidate) =>
    candidate.id === taskId && candidate.status === "processing"
      ? { ...candidate, status: "pending" as const }
      : candidate,
  )
  if (task.status === "processing") {
    // Abort the in-progress LLM call
    if (currentAbortController) {
      currentAbortController.abort()
    }
  }

  const settlingRunner = task.status === "processing" ? activeRunner?.promise : null
  queue = queue.filter((t) => t.id !== taskId)
  try {
    await settlingRunner
    await persistQueue(currentProjectPath)
  } catch (error) {
    queue = previousQueue
    processNext(currentProjectId)
    throw error
  }
  console.log(`[Ingest Queue] Cancelled: ${task.sourcePath}`)

  processNext(currentProjectId)
}

/**
 * Clear all done/failed tasks from the active project's queue.
 */
export async function clearCompletedTasks(): Promise<void> {
  const previousQueue = cloneQueue()
  queue = queue.filter((t) => t.status === "pending" || t.status === "processing")
  try {
    await persistQueue(currentProjectPath)
  } catch (error) {
    queue = previousQueue
    throw error
  }
}

/**
 * Cancel everything that's not finished in the active project's queue:
 * aborts the running task (if any), cleans up its partial output, and
 * drops every pending + processing item.
 *
 * Failed tasks are retained so the user can still see / retry them.
 * Returns the number of tasks removed from the queue.
 */
export async function cancelAllTasks(): Promise<number> {
  const previousQueue = cloneQueue().map((task) =>
    task.status === "processing" ? { ...task, status: "pending" as const } : task,
  )
  const settlingRunner = activeRunner?.promise
  if (currentAbortController) {
    currentAbortController.abort()
  }

  const before = queue.length
  queue = queue.filter((t) => t.status === "failed")
  const removed = before - queue.length

  try {
    await settlingRunner
    await persistQueue(currentProjectPath)
  } catch (error) {
    queue = previousQueue
    processNext(currentProjectId)
    throw error
  }
  console.log(`[Ingest Queue] Cancelled all: ${removed} tasks removed`)
  return removed
}

/**
 * Get current queue state.
 */
export function getQueue(): readonly IngestTask[] {
  return queue
}

/**
 * Get queue summary.
 */
export function getQueueSummary(): { pending: number; processing: number; failed: number; completed: number; total: number } {
  const activeTotal = queue.length + completedSinceIdle
  return {
    pending: queue.filter((t) => t.status === "pending").length,
    processing: queue.filter((t) => t.status === "processing").length,
    failed: queue.filter((t) => t.status === "failed").length,
    completed: completedSinceIdle,
    total: activeTotal,
  }
}

/**
 * Clear all in-memory queue state without touching disk. Used by tests
 * that want a clean slate between cases. **Production code should use
 * `pauseQueue()` on project switch**, which flushes pending state to
 * disk before clearing memory.
 */
export function clearQueueState(): void {
  queueEpoch++
  if (currentAbortController) {
    currentAbortController.abort()
  }
  if (sweepAbortController) {
    sweepAbortController.abort()
  }
  queue = []
  processing = false
  // Test-only hard reset. Production project switches use pauseQueue(),
  // which keeps the runner barrier until the aborted operation settles.
  activeRunner = null
  pausing = false
  currentProjectId = ""
  currentProjectPath = ""
  currentAbortController = null
  sweepAbortController = null
  processedSinceDrain = false
  resetQueueAccounting()
}

/**
 * Project-switch handshake. Flushes the active project's current queue
 * state to its disk file (so pending/failed tasks survive the switch),
 * reverts any processing task to pending, then clears in-memory state
 * so the next `restoreQueue()` can safely load a different project.
 *
 * Must be called before opening or switching to a different project.
 * Must be `await`ed — the disk flush is async.
 */
export async function pauseQueue(): Promise<void> {
  if (!currentProjectId || !currentProjectPath) {
    // Nothing to pause (no active project)
    return
  }

  const pausedProjectPath = currentProjectPath
  pausing = true
  queueEpoch++

  if (currentAbortController) {
    currentAbortController.abort()
  }
  if (sweepAbortController) {
    sweepAbortController.abort()
    sweepAbortController = null
  }

  // Revert any in-flight processing task back to pending so when the
  // user returns to this project, the task is re-tried from scratch.
  for (const task of queue) {
    if (task.status === "processing") {
      task.status = "pending"
    }
  }

  try {
    // Wait for the cancelled runner to roll back its mutation journal before
    // another project is allowed to start a writer.
    await activeRunner?.promise

    // Unlike normal checkpoints this write is a navigation barrier. A
    // failure leaves the queue attached to the current project.
    await persistQueue(pausedProjectPath)
  } catch (error) {
    pausing = false
    if (queue.some((task) => task.status === "pending")) {
      processNext(currentProjectId)
    }
    throw error
  }

  queue = []
  currentProjectId = ""
  currentProjectPath = ""
  pausing = false
  processedSinceDrain = false
  resetQueueAccounting()
}

// ── Restore on startup ───────────────────────────────────────────────────

/**
 * Load queue from disk and resume processing. Called on app startup
 * and when opening / switching to a project. `pauseQueue()` must have
 * been called first (or the active project already cleared) so that
 * in-memory state is not contaminated from the previous project.
 */
export async function restoreQueue(
  projectId: string,
  projectPath: string,
): Promise<void> {
  queueEpoch++
  const pp = normalizePath(projectPath)
  // Defensive: reset in-memory state (should already be empty via
  // pauseQueue, but clearing again costs nothing).
  queue = []
  processing = false
  currentAbortController = null
  pausing = false
  resetQueueAccounting()
  currentProjectId = projectId
  currentProjectPath = pp

  const saved = await loadQueue(pp, projectId)

  if (saved.length === 0) return

  // Drop any cross-project contamination (shouldn't happen in practice
  // but defends against a corrupt queue file).
  const mine = saved.filter((t) => t.projectId === projectId)
  if (mine.length !== saved.length) {
    console.warn(
      `[Ingest Queue] Dropped ${saved.length - mine.length} cross-project tasks during restore`,
    )
  }

  // Reset any "processing" tasks back to "pending" (interrupted by app close)
  let restored = 0
  for (const task of mine) {
    if (task.status === "processing") {
      task.status = "pending"
      restored++
    }
  }

  queue = mine
  await saveQueue(pp)

  const pending = queue.filter((t) => t.status === "pending").length
  const failed = queue.filter((t) => t.status === "failed").length

  if (pending > 0 || restored > 0) {
    console.log(`[Ingest Queue] Restored: ${pending} pending, ${failed} failed, ${restored} resumed from interrupted`)
    processNext(projectId)
  }
}

// ── Processing ────────────────────────────────────────────────────────────

const MAX_RETRIES = 3

async function onQueueDrained(projectId: string, projectPath: string): Promise<void> {
  if (!processedSinceDrain) return
  // Stale-context guard — if we switched projects mid-drain, the sweep
  // would burn tokens analyzing the wrong project.
  if (currentProjectId !== projectId) return
  processedSinceDrain = false

  sweepAbortController = new AbortController()
  const signal = sweepAbortController.signal

  try {
    const { sweepResolvedReviews } = await import("@/lib/sweep-reviews")
    if (
      signal.aborted ||
      currentProjectId !== projectId ||
      currentProjectPath !== projectPath
    ) return
    await sweepResolvedReviews(projectPath, signal)
  } catch (err) {
    console.error("[Ingest Queue] Failed to load sweep-reviews:", err)
  } finally {
    if (sweepAbortController && sweepAbortController.signal === signal) {
      sweepAbortController = null
    }
  }
}

function processNext(projectId: string): void {
  // This is the runner barrier: aborting a request does not make its promise
  // disappear. A replacement runner starts only after the previous promise
  // settles, preventing two ingests from writing the same project at once.
  if (activeRunner || pausing) return
  const epoch = queueEpoch
  const runner = { id: ++runnerCounter, promise: Promise.resolve() }
  activeRunner = runner
  processing = true
  runner.promise = processNextTask(projectId, epoch)
    .catch((error) => {
      console.error("[Ingest Queue] runner failed:", error)
    })
    .finally(() => {
      if (activeRunner?.id !== runner.id) return
      activeRunner = null
      processing = false
      currentAbortController = null
      if (
        !pausing &&
        currentProjectId &&
        queue.some((task) => task.projectId === currentProjectId && task.status === "pending")
      ) {
        processNext(currentProjectId)
      }
    })
}

async function processNextTask(projectId: string, epoch: number): Promise<void> {
  // Stale-context guard: processNext may be invoked by an orphaned
  // recursion from a previous project. If we're no longer active, bail.
  if (currentProjectId !== projectId || queueEpoch !== epoch) return

  const next = queue.find((t) => t.projectId === projectId && t.status === "pending")
  if (!next) {
    // Queue drained — trigger review cleanup (auto-resolve stale items)
    const pathAtDrain = currentProjectPath
    await onQueueDrained(projectId, pathAtDrain).catch((err) =>
      console.error("[Ingest Queue] sweep failed:", err),
    )
    return
  }

  // Look up the project's current filesystem path from the registry —
  // it may have moved since the task was enqueued. If the project isn't
  // in the registry (was deleted or never registered), mark as failed.
  const registryPath = await getProjectPathById(projectId)
  const pp = registryPath ? normalizePath(registryPath) : ""

  // Check we're still active after the registry await.
  if (currentProjectId !== projectId || queueEpoch !== epoch) return
  if (!queue.some((task) => task.id === next.id)) return

  if (!pp) {
    next.status = "failed"
    next.error = "Project not found in registry (was it deleted?)"
    await saveQueue(currentProjectPath)
    return
  }

  const controller = new AbortController()
  currentAbortController = controller
  next.status = "processing"
  await saveQueue(pp)
  if (currentProjectId !== projectId || queueEpoch !== epoch) {
    if (currentAbortController === controller) currentAbortController = null
    return
  }

  const llmConfig = useWikiStore.getState().llmConfig

  // Check if LLM is configured
  if (!hasUsableLlm(llmConfig)) {
    if (currentAbortController === controller) currentAbortController = null
    next.status = "failed"
    next.error = "LLM not configured — set API key in Settings"
    await saveQueue(pp)
    return
  }

  const fullSourcePath = isAbsolutePath(next.sourcePath)
    ? normalizePath(next.sourcePath)
    : `${pp}/${next.sourcePath}`

  console.log(`[Ingest Queue] Processing: ${next.sourcePath} (${queue.filter((t) => t.projectId === projectId && t.status === "pending").length} remaining)`)

  const mutationJournal = new Map<string, IngestFileMutation>()
  const recordMutation = (mutation: IngestFileMutation) => {
    const key = normalizePath(mutation.path).toLowerCase()
    if (!mutationJournal.has(key)) mutationJournal.set(key, mutation)
  }
  const rollback = async () => {
    await rollbackIngestMutations(pp, [...mutationJournal.values()])
    mutationJournal.clear()
  }

  try {
    const writtenFiles = await autoIngest(
      pp,
      fullSourcePath,
      llmConfig,
      controller.signal,
      next.folderContext,
      recordMutation,
    )
    // Stale-context guard: project switched during the long LLM call.
    // Bail without mutating queue or writing to disk — pauseQueue has
    // already persisted the correct state to the old project's file,
    // and the new project's queue must not be touched by this orphan.
    if (currentProjectId !== projectId || queueEpoch !== epoch) {
      await rollback()
      return
    }
    if (!queue.some((task) => task.id === next.id)) {
      await rollback()
      return
    }

    // Safety net: autoIngest resolving with zero files means nothing
    // was really ingested (e.g. abort during webview refresh where the
    // historical `return []` error path masqueraded as success). Treat
    // as failure so the task stays in the queue and retries.
    if (writtenFiles.length === 0) {
      throw new Error("Ingest produced no output files")
    }

    // Success: remove from queue
    if (currentAbortController === controller) currentAbortController = null
    mutationJournal.clear()
    queue = queue.filter((t) => t.id !== next.id)
    completedSinceIdle++
    processedSinceDrain = true
    await saveQueue(pp)

    console.log(`[Ingest Queue] Done: ${next.sourcePath}`)
  } catch (err) {
    await rollback()
    if (currentProjectId !== projectId || queueEpoch !== epoch) return
    if (!queue.some((task) => task.id === next.id)) return
    if (currentAbortController === controller) currentAbortController = null
    const message = err instanceof Error ? err.message : String(err)
    next.retryCount++
    next.error = message

    if (next.retryCount >= MAX_RETRIES) {
      next.status = "failed"
      console.log(`[Ingest Queue] Failed (${next.retryCount}x): ${next.sourcePath} — ${message}`)
    } else {
      next.status = "pending" // will retry
      console.log(`[Ingest Queue] Error (retry ${next.retryCount}/${MAX_RETRIES}): ${next.sourcePath} — ${message}`)
    }

    await saveQueue(pp)
  }

  if (currentProjectId !== projectId || queueEpoch !== epoch) return
  if (queue.some((task) => task.projectId === projectId && task.status === "pending")) {
    await processNextTask(projectId, epoch)
    return
  }
  await onQueueDrained(projectId, pp)

}
