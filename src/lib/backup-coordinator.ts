import { createProjectBackup, type BackupReport } from "@/commands/fs"
import { flushAndSuspendAutoSave, resumeAutoSave } from "@/lib/auto-save"
import { flushAllDocumentSaves } from "@/lib/document-save-coordinator"
import { withDurabilityLock } from "@/lib/durability-lock"
import { useWikiStore } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"

export function createConsistentProjectBackup(
  project: WikiProject,
  destination: string,
): Promise<BackupReport> {
  return withDurabilityLock(async () => {
    const queueMod = await import("@/lib/ingest-queue")
    const dedupQueueMod = await import("@/lib/dedup-queue")
    const fileSyncMod = await import("@/lib/project-file-sync")
    const scheduledImportMod = await import("@/lib/scheduled-import")
    await flushAllDocumentSaves()
    await flushAndSuspendAutoSave()

    const sourceWatchConfig = useWikiStore.getState().sourceWatchConfig
    const scheduledImportConfig = useWikiStore.getState().scheduledImportConfig
    let ingestPaused = false
    let dedupPaused = false
    let result: BackupReport | undefined
    let operationError: unknown

    try {
      scheduledImportMod.stopScheduledImport()
      await fileSyncMod.stopProjectFileSync()
      await queueMod.pauseQueue()
      ingestPaused = true
      await dedupQueueMod.pauseQueue()
      dedupPaused = true
      result = await createProjectBackup(project.path, destination)
    } catch (error) {
      operationError = error
    }

    const recoveryErrors: unknown[] = []
    try {
      if (ingestPaused) await queueMod.restoreQueue(project.id, project.path)
    } catch (error) {
      recoveryErrors.push(error)
    }
    try {
      if (dedupPaused) await dedupQueueMod.restoreQueue(project.id, project.path)
    } catch (error) {
      recoveryErrors.push(error)
    }
    try {
      if (sourceWatchConfig.enabled) {
        await fileSyncMod.startProjectFileSync(project, sourceWatchConfig)
      }
      scheduledImportMod.startScheduledImport(project, scheduledImportConfig)
    } catch (error) {
      recoveryErrors.push(error)
    } finally {
      resumeAutoSave()
    }

    if (operationError || recoveryErrors.length > 0 || !result) {
      throw new Error(
        [operationError, ...recoveryErrors]
          .filter(Boolean)
          .map(String)
          .join(" | ") || "Backup did not produce a report",
      )
    }
    return result
  })
}
