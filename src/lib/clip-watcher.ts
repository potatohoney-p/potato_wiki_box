import { useWikiStore } from "@/stores/wiki-store"
import { enqueueIngest } from "./ingest-queue"
import { acknowledgeClips, getPendingClips, listDirectory } from "@/commands/fs"
import { hasUsableLlm } from "@/lib/has-usable-llm"

const POLL_INTERVAL = 3000 // Check every 3 seconds
let intervalId: ReturnType<typeof setInterval> | null = null
let polling = false
const refreshedWithoutLlm = new Set<string>()

function isActiveProject(projectId: string, projectPath: string): boolean {
  const active = useWikiStore.getState().project
  return active?.id === projectId && active.path === projectPath
}

async function pollPendingClips(): Promise<void> {
  if (polling) return
  polling = true
  try {
    const initialStore = useWikiStore.getState()
    const project = initialStore.project
    if (!project) return
    const clips = await getPendingClips(project.id)
    if (!isActiveProject(project.id, project.path) || clips.length === 0) return

    for (const clip of clips) {
      if (clip.projectId !== project.id || !isActiveProject(project.id, project.path)) {
        continue
      }
      if (!refreshedWithoutLlm.has(clip.id)) {
        const tree = await listDirectory(project.path)
        if (!isActiveProject(project.id, project.path)) return
        refreshedWithoutLlm.add(clip.id)
        useWikiStore.getState().setFileTree(tree)
      }

      const llmConfig = useWikiStore.getState().llmConfig
      if (!hasUsableLlm(llmConfig)) continue

      await enqueueIngest(project.id, clip.filePath)
      await acknowledgeClips(project.id, [clip.id])
      refreshedWithoutLlm.delete(clip.id)
    }
  } catch (err) {
    console.error("Failed to poll pending web clips:", err)
  } finally {
    polling = false
  }
}

/**
 * Start polling the clip server for new web clips.
 * When a clip is detected, triggers auto-ingest and refreshes the file tree.
 */
export function startClipWatcher() {
  if (intervalId) return // Already running

  intervalId = setInterval(() => void pollPendingClips(), POLL_INTERVAL)
}

export function stopClipWatcher() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  polling = false
  refreshedWithoutLlm.clear()
}
