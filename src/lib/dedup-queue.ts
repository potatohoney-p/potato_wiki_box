/**
 * Persistent serial queue for duplicate-merge operations.
 *
 * Why a queue (and not just kicking off `executeMerge` from the click
 * handler):
 *   - Merges rewrite cross-references across the entire wiki. Two
 *     concurrent merges race on the same files, last write wins, and
 *     half the rewrites silently disappear.
 *   - LLM calls take seconds; the user wants to queue several merges
 *     and walk away. The queue must survive app close so an
 *     interrupted merge resumes on next launch.
 *
 * Mirrors `ingest-queue.ts` almost line-for-line: same lifecycle
 * (pause / restore on project switch), same persistence file shape,
 * same retry-up-to-3 policy, same registry-based path resolution so
 * a relocated project still finds its tasks.
 */
import { writeFileAtomic } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { getProjectPathById } from "@/lib/project-identity"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { executeMerge } from "@/lib/dedup-runner"
import type { DuplicateGroup } from "@/lib/dedup"
import { readDurableJson } from "@/lib/durable-json"

// ── Types ─────────────────────────────────────────────────────────────────

export interface DedupTask {
  id: string
  projectId: string
  group: DuplicateGroup
  canonicalSlug: string
  status: "pending" | "processing" | "done" | "failed"
  addedAt: number
  error: string | null
  retryCount: number
}

// ── State ─────────────────────────────────────────────────────────────────

let queue: DedupTask[] = []
let processing = false
let currentProjectId = ""
let currentProjectPath = ""
let currentAbortController: AbortController | null = null
let runnerEpoch = 0
let activeRunner: Promise<void> | null = null

// ── Persistence ───────────────────────────────────────────────────────────

function queueFilePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.potato-box/dedup-queue.json`
}

function serializedQueue(): string {
  return JSON.stringify(queue.filter((task) => task.status !== "done"), null, 2)
}

/** Durability barrier used when navigation depends on the queue being saved. */
async function persistQueue(projectPath: string): Promise<void> {
  await writeFileAtomic(queueFilePath(projectPath), serializedQueue())
}

async function loadQueue(
  projectPath: string,
  projectId: string,
): Promise<DedupTask[]> {
  const tasks = await readDurableJson(
    queueFilePath(projectPath),
    isDedupTaskArray,
    "Duplicate merge queue",
  )
  if (!tasks) return []
  return tasks.map((task) => ({ ...task, projectId: task.projectId ?? projectId }))
}

function isDedupTaskArray(value: unknown): value is DedupTask[] {
  return Array.isArray(value) && value.every((task) => {
    if (!task || typeof task !== "object") return false
    const candidate = task as Partial<DedupTask>
    return typeof candidate.id === "string"
      && (candidate.projectId === undefined || typeof candidate.projectId === "string")
      && Boolean(candidate.group && Array.isArray(candidate.group.slugs))
      && typeof candidate.canonicalSlug === "string"
      && ["pending", "processing", "done", "failed"].includes(String(candidate.status))
      && typeof candidate.addedAt === "number"
      && (candidate.error === null || typeof candidate.error === "string")
      && typeof candidate.retryCount === "number"
  })
}

// ── Queue Operations ──────────────────────────────────────────────────────

function generateId(): string {
  return `dedup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Stable key for matching a queued task to a UI card. Order-independent
 * lowercase join — same shape used by dedup-storage's canonical key.
 */
export function groupKey(slugs: readonly string[]): string {
  return [...slugs].map((s) => s.toLowerCase()).sort().join(",")
}

/**
 * Add a merge to the queue. The project MUST be the currently-active
 * project. Returns the new task's id. Idempotent on the same group:
 * if there's already a pending/processing/failed task for the same
 * slug-set, the existing id is returned instead of a duplicate.
 */
export async function enqueueMerge(
  projectId: string,
  group: DuplicateGroup,
  canonicalSlug: string,
): Promise<string> {
  if (!currentProjectId || currentProjectId !== projectId) {
    throw new Error(
      `enqueueMerge: project ${projectId} is not the active project (current: ${currentProjectId || "<none>"})`,
    )
  }

  const key = groupKey(group.slugs)
  const existing = queue.find(
    (t) =>
      t.projectId === projectId &&
      t.status !== "done" &&
      groupKey(t.group.slugs) === key,
  )
  if (existing) return existing.id

  const task: DedupTask = {
    id: generateId(),
    projectId,
    group,
    canonicalSlug,
    status: "pending",
    addedAt: Date.now(),
    error: null,
    retryCount: 0,
  }

  queue.push(task)
  try {
    await persistQueue(currentProjectPath)
  } catch (error) {
    queue = queue.filter((candidate) => candidate.id !== task.id)
    throw error
  }
  processNext(currentProjectId)
  return task.id
}

/**
 * Reset a failed task back to pending so it gets another shot. Clears
 * the error and resets retryCount so the user gets the full 3
 * attempts again.
 */
export async function retryTask(taskId: string): Promise<void> {
  const task = queue.find((t) => t.id === taskId)
  if (!task) return
  if (task.projectId !== currentProjectId) return

  const previous = {
    status: task.status,
    error: task.error,
    retryCount: task.retryCount,
  }
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
 * Cancel/delete a task. If it's currently running, abort the LLM call
 * first — the merge writes will be left where they were when the
 * abort fired. Backup snapshots already on disk are kept either way.
 */
export async function cancelTask(taskId: string): Promise<void> {
  let task = queue.find((t) => t.id === taskId)
  if (!task) return
  if (task.projectId !== currentProjectId) return

  if (task.status === "processing") {
    runnerEpoch++
    if (currentAbortController) {
      currentAbortController.abort()
    }
    await activeRunner?.catch(() => undefined)
    task = queue.find((candidate) => candidate.id === taskId)
    if (!task) return
    task.status = "pending"
  }

  const previousQueue = queue
  queue = queue.filter((t) => t.id !== taskId)
  try {
    await persistQueue(currentProjectPath)
  } catch (error) {
    queue = previousQueue
    processNext(currentProjectId)
    throw error
  }
  processNext(currentProjectId)
}

export function getQueue(): readonly DedupTask[] {
  return queue
}

export function getQueueSummary(): {
  pending: number
  processing: number
  failed: number
  total: number
} {
  return {
    pending: queue.filter((t) => t.status === "pending").length,
    processing: queue.filter((t) => t.status === "processing").length,
    failed: queue.filter((t) => t.status === "failed").length,
    total: queue.length,
  }
}

/**
 * Test-only: wipe in-memory state without touching disk. Production
 * code should always use `pauseQueue()` so pending state lands in
 * the right project's file before the slate is cleared.
 */
export function clearQueueState(): void {
  runnerEpoch++
  if (currentAbortController) {
    currentAbortController.abort()
  }
  queue = []
  processing = false
  currentProjectId = ""
  currentProjectPath = ""
  currentAbortController = null
  activeRunner = null
}

/**
 * Project-switch handshake: flush the active project's queue to disk
 * (reverting any in-flight task to pending so it gets re-tried on
 * resume), then clear in-memory state.
 */
export async function pauseQueue(): Promise<void> {
  if (!currentProjectId || !currentProjectPath) return

  const pausedProjectPath = currentProjectPath
  runnerEpoch++
  if (currentAbortController) {
    currentAbortController.abort()
  }
  await activeRunner?.catch(() => undefined)

  for (const task of queue) {
    if (task.status === "processing") {
      task.status = "pending"
    }
  }

  // A project switch is allowed only after the current queue is durable. On
  // failure the in-memory queue remains associated with this project.
  try {
    await persistQueue(pausedProjectPath)
  } catch (error) {
    throw error
  }

  queue = []
  currentProjectId = ""
  currentProjectPath = ""
  currentAbortController = null
}

/**
 * Load a project's queue from disk and resume processing. Tasks left
 * in "processing" by an abrupt exit get reverted to "pending" so they
 * pick up on next process tick.
 */
export async function restoreQueue(
  projectId: string,
  projectPath: string,
): Promise<void> {
  const pp = normalizePath(projectPath)
  queue = []
  processing = false
  currentAbortController = null
  runnerEpoch++
  activeRunner = null
  currentProjectId = projectId
  currentProjectPath = pp

  const saved = await loadQueue(pp, projectId)
  if (saved.length === 0) return

  const mine = saved.filter((t) => t.projectId === projectId)
  if (mine.length !== saved.length) {
    console.warn(
      `[Dedup Queue] Dropped ${saved.length - mine.length} cross-project tasks during restore`,
    )
  }

  let restored = 0
  for (const task of mine) {
    if (task.status === "processing") {
      task.status = "pending"
      restored++
    }
  }

  queue = mine
  await persistQueue(pp)

  const pending = queue.filter((t) => t.status === "pending").length
  const failed = queue.filter((t) => t.status === "failed").length
  if (pending > 0 || restored > 0) {
    console.log(
      `[Dedup Queue] Restored: ${pending} pending, ${failed} failed, ${restored} resumed from interrupted`,
    )
    processNext(projectId)
  }
}

// ── Processing ────────────────────────────────────────────────────────────

const MAX_RETRIES = 3

function processNext(projectId: string): void {
  if (processing || activeRunner) return
  if (currentProjectId !== projectId) return
  if (!queue.some((task) => task.projectId === projectId && task.status === "pending")) {
    return
  }

  const epoch = runnerEpoch
  processing = true
  const run = processOne(projectId, epoch)
  activeRunner = run
  void run.finally(() => {
    if (activeRunner !== run) return
    activeRunner = null
    processing = false
    if (currentProjectId === projectId && runnerEpoch === epoch) {
      processNext(projectId)
    }
  }).catch((error) => {
    console.error("[Dedup Queue] Runner stopped:", error)
  })
}

async function processOne(projectId: string, epoch: number): Promise<void> {
  if (currentProjectId !== projectId || runnerEpoch !== epoch) return

  const next = queue.find(
    (t) => t.projectId === projectId && t.status === "pending",
  )
  if (!next) return

  const registryPath = await getProjectPathById(projectId)
  const pp = registryPath ? normalizePath(registryPath) : ""
  if (currentProjectId !== projectId || runnerEpoch !== epoch) return

  if (!pp) {
    next.status = "failed"
    next.error = "Project not found in registry (was it deleted?)"
    await persistQueue(currentProjectPath)
    return
  }

  next.status = "processing"
  await persistQueue(pp)
  if (currentProjectId !== projectId || runnerEpoch !== epoch) return

  const llmConfig = useWikiStore.getState().llmConfig

  if (!hasUsableLlm(llmConfig)) {
    next.status = "failed"
    next.error = "LLM not configured — set API key in Settings"
    await persistQueue(pp)
    return
  }

  console.log(
    `[Dedup Queue] Processing: merge ${next.group.slugs.join(",")} → ${next.canonicalSlug}`,
  )

  const controller = new AbortController()
  currentAbortController = controller

  try {
    await executeMerge(pp, next.group, next.canonicalSlug, llmConfig, {
      signal: controller.signal,
    })
    if (currentProjectId !== projectId || runnerEpoch !== epoch) return

    queue = queue.filter((t) => t.id !== next.id)
    await persistQueue(pp)
    // Tell the rest of the app the wiki tree changed.
    useWikiStore.getState().bumpDataVersion()

    console.log(`[Dedup Queue] Done: ${next.group.slugs.join(",")}`)
  } catch (err) {
    if (currentProjectId !== projectId || runnerEpoch !== epoch) return
    const message = err instanceof Error ? err.message : String(err)
    next.retryCount++
    next.error = message

    if (next.retryCount >= MAX_RETRIES) {
      next.status = "failed"
      console.log(
        `[Dedup Queue] Failed (${next.retryCount}x): ${next.group.slugs.join(",")} — ${message}`,
      )
    } else {
      next.status = "pending"
      console.log(
        `[Dedup Queue] Error (retry ${next.retryCount}/${MAX_RETRIES}): ${next.group.slugs.join(",")} — ${message}`,
      )
    }
    await persistQueue(pp)
  } finally {
    if (currentAbortController === controller) {
      currentAbortController = null
    }
  }
}
