/**
 * Centralized reset of all per-project state.
 * MUST be called (and AWAITED) both when leaving a project and when opening a
 * new one, to prevent cross-project data contamination.
 *
 * Returns once every store/cache has actually been cleared — the caller can
 * trust that downstream project-opening steps will not race with lingering
 * cleanup.
 */

import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { useActivityStore } from "@/stores/activity-store"
import { useResearchStore } from "@/stores/research-store"
import { useLintStore } from "@/stores/lint-store"
import { useWikiStore } from "@/stores/wiki-store"

export async function resetProjectState(): Promise<void> {
  const wikiState = useWikiStore.getState()
  const outgoingProject = wikiState.project
  const sourceWatchConfig = wikiState.sourceWatchConfig
  const scheduledImportConfig = wikiState.scheduledImportConfig

  // Load and stop producers before pausing either queue. Import or stop
  // failures are navigation failures because leaving a producer attached to
  // the old project can mutate it after the UI has switched.
  const [queueMod, dedupQueueMod, fileSyncMod, scheduledImportMod] = await Promise.all([
    import("@/lib/ingest-queue"),
    import("@/lib/dedup-queue"),
    import("@/lib/project-file-sync"),
    import("@/lib/scheduled-import"),
  ])

  scheduledImportMod.stopScheduledImport()
  await fileSyncMod.stopProjectFileSync()

  let ingestPaused = false
  let dedupPaused = false
  try {
    await queueMod.pauseQueue()
    ingestPaused = true
    await dedupQueueMod.pauseQueue()
    dedupPaused = true
  } catch (error) {
    // A partial pause is rolled back before the error reaches the caller, so
    // the old project remains fully usable and another switch can be retried.
    const recoveryErrors: unknown[] = []
    if (outgoingProject) {
      if (ingestPaused) {
        try {
          await queueMod.restoreQueue(outgoingProject.id, outgoingProject.path)
        } catch (recoveryError) {
          recoveryErrors.push(recoveryError)
        }
      }
      if (dedupPaused) {
        try {
          await dedupQueueMod.restoreQueue(outgoingProject.id, outgoingProject.path)
        } catch (recoveryError) {
          recoveryErrors.push(recoveryError)
        }
      }
      try {
        if (sourceWatchConfig.enabled) {
          await fileSyncMod.startProjectFileSync(outgoingProject, sourceWatchConfig)
        }
        scheduledImportMod.startScheduledImport(outgoingProject, scheduledImportConfig)
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError)
      }
    }

    if (recoveryErrors.length > 0) {
      const combined = new Error(
        `Project switch failed and the outgoing workers could not be fully restored: ${[error, ...recoveryErrors].map(String).join(" | ")}`,
      ) as Error & { errors: unknown[] }
      combined.errors = [error, ...recoveryErrors]
      throw combined
    }
    throw error
  }

  // Clear stores only after every persistence barrier has succeeded.
  useChatStore.setState({
    conversations: [],
    messages: [],
    activeConversationId: null,
    mode: "chat",
    ingestSource: null,
    isStreaming: false,
    streamingContent: "",
  })

  useReviewStore.setState({
    items: [],
  })

  useLintStore.setState({
    items: [],
  })

  useActivityStore.setState({
    items: [],
  })

  useResearchStore.setState({
    tasks: [],
    panelOpen: false,
  })

  // The graph cache is derived data. Failure to clear it is visible in logs
  // but does not compromise outgoing-project durability.
  try {
    const { clearGraphCache } = await import("@/lib/graph-relevance")
    clearGraphCache()
  } catch (error) {
    console.warn("[Reset Project State] clearGraphCache failed:", error)
  }
}
