import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  DatabaseBackup,
  FileJson,
  FileText,
  FolderArchive,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  apiServerStatus,
  clipServerStatus,
  getPendingClips,
  listDirectory,
  openProjectFolder,
  readTextFileLimited,
  restoreProjectBackup,
  writeFileAtomic,
  type BackupReport,
  type RestoreReport,
} from "@/commands/fs"
import { createConsistentProjectBackup } from "@/lib/backup-coordinator"
import { runStructuralLint } from "@/lib/lint"
import {
  calculateHealthScore,
  calculateProvenanceCoverage,
  lintMetrics,
  projectFileMetrics,
  redactDiagnosticValue,
} from "@/lib/knowledge-health"
import { getQueueSummary } from "@/lib/ingest-queue"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { useActivityStore } from "@/stores/activity-store"
import { useFileSyncStore } from "@/stores/file-sync-store"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"

interface HealthSnapshot {
  score: number
  scannedAt: number
  wikiPages: number
  sourceFiles: number
  mediaFiles: number
  provenanceCoverage: number
  brokenLinks: number
  orphanPages: number
  duplicateBasenames: number
  pendingReviews: number
  failedTasks: number
  pendingClips: number
  clipStatus: string
  apiStatus: string
  llmReady: boolean
  fileSyncError: string | null
}

type OperationState =
  | { kind: "idle" }
  | { kind: "running"; message: string }
  | { kind: "backup"; report: BackupReport }
  | { kind: "restore"; report: RestoreReport }
  | { kind: "diagnostics"; path?: string }
  | { kind: "error"; message: string }

export function KnowledgeHealthView() {
  const { t, i18n } = useTranslation()
  const project = useWikiStore((state) => state.project)
  const dataVersion = useWikiStore((state) => state.dataVersion)
  const llmConfig = useWikiStore((state) => state.llmConfig)
  const setFileTree = useWikiStore((state) => state.setFileTree)
  const pendingReviews = useReviewStore((state) => state.items.filter((item) => !item.resolved).length)
  const fileSyncError = useFileSyncStore((state) => state.lastError)
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null)
  const [scanning, setScanning] = useState(false)
  const [operation, setOperation] = useState<OperationState>({ kind: "idle" })
  const scanEpoch = useRef(0)

  const scan = useCallback(async () => {
    if (!project) return
    const epoch = ++scanEpoch.current
    const projectId = project.id
    setScanning(true)
    setOperation((current) => current.kind === "error" ? { kind: "idle" } : current)
    try {
      const tree = await listDirectory(project.path)
      if (scanEpoch.current !== epoch || useWikiStore.getState().project?.id !== projectId) return
      setFileTree(tree)
      const files = projectFileMetrics(tree)
      const [lint, clips, clipStatus, apiStatus, provenanceCoverage] = await Promise.all([
        runStructuralLint(project.path),
        getPendingClips(project.id).catch(() => []),
        clipServerStatus().catch(() => "error"),
        apiServerStatus().catch(() => "error"),
        calculateProvenanceCoverage(
          files.provenanceMarkdownFiles,
          (path) => readTextFileLimited(path, 8 * 1024 * 1024),
        ),
      ])
      const lintSummary = lintMetrics(lint)
      const queue = getQueueSummary()
      const score = calculateHealthScore({
        brokenLinks: lintSummary.brokenLinks,
        duplicateBasenames: files.duplicateBasenames,
        failedTasks: queue.failed,
        pendingClips: clips.length,
        orphanPages: lintSummary.orphanPages,
        provenanceCoverage,
        fileSyncError: Boolean(fileSyncError),
      })
      if (scanEpoch.current !== epoch || useWikiStore.getState().project?.id !== projectId) return
      setSnapshot({
        score,
        scannedAt: Date.now(),
        wikiPages: files.wikiPages,
        sourceFiles: files.sourceFiles,
        mediaFiles: files.mediaFiles,
        provenanceCoverage,
        brokenLinks: lintSummary.brokenLinks,
        orphanPages: lintSummary.orphanPages,
        duplicateBasenames: files.duplicateBasenames,
        pendingReviews,
        failedTasks: queue.failed,
        pendingClips: clips.length,
        clipStatus,
        apiStatus,
        llmReady: hasUsableLlm(llmConfig),
        fileSyncError,
      })
    } catch (error) {
      if (scanEpoch.current === epoch) {
        setOperation({ kind: "error", message: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (scanEpoch.current === epoch) setScanning(false)
    }
  }, [fileSyncError, llmConfig, pendingReviews, project, setFileTree])

  useEffect(() => {
    scanEpoch.current += 1
    setSnapshot(null)
    setScanning(false)
  }, [project?.id])

  useEffect(() => {
    void scan()
    // dataVersion deliberately retriggers a scan after ingest/delete changes.
  }, [dataVersion, project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const diagnostics = useMemo(() => {
    if (!project || !snapshot) return null
    const store = useWikiStore.getState()
    const raw = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      app: { name: "potato box", version: __APP_VERSION__ },
      project: { id: project.id, name: project.name },
      health: snapshot,
      configuration: {
        llm: { provider: store.llmConfig.provider, model: store.llmConfig.model, configured: hasUsableLlm(store.llmConfig) },
        embedding: { enabled: store.embeddingConfig.enabled, model: store.embeddingConfig.model },
        sourceWatch: store.sourceWatchConfig,
        scheduledImport: { enabled: store.scheduledImportConfig.enabled, interval: store.scheduledImportConfig.interval },
        api: { enabled: store.apiConfig.enabled, mcpEnabled: store.apiConfig.mcpEnabled, tokenConfigured: Boolean(store.apiConfig.token) },
      },
      failedActivity: useActivityStore.getState().items
        .filter((item) => item.status === "error")
        .slice(0, 50)
        // Activity titles/details can contain external source paths, provider
        // URLs, prompts, and response bodies. Export only structured metadata.
        .map(({ id, type, createdAt }) => ({ id, type, createdAt, status: "error" })),
    }
    return redactDiagnosticValue(raw, [project.path])
  }, [project, snapshot])

  const findings = useMemo(() => {
    if (!snapshot) return []
    const values: Array<{ severity: "error" | "warning" | "info"; text: string }> = []
    if (!snapshot.llmReady) values.push({ severity: "error", text: t("health.findings.llm", { defaultValue: "No usable LLM provider is configured." }) })
    if (snapshot.fileSyncError) values.push({ severity: "error", text: snapshot.fileSyncError })
    if (snapshot.failedTasks) values.push({ severity: "error", text: t("health.findings.failedTasks", { count: snapshot.failedTasks, defaultValue: `${snapshot.failedTasks} ingest task(s) need attention.` }) })
    if (snapshot.brokenLinks) values.push({ severity: "warning", text: t("health.findings.brokenLinks", { count: snapshot.brokenLinks, defaultValue: `${snapshot.brokenLinks} broken wiki link(s) were found.` }) })
    if (snapshot.duplicateBasenames) values.push({ severity: "warning", text: t("health.findings.collisions", { count: snapshot.duplicateBasenames, defaultValue: `${snapshot.duplicateBasenames} duplicate page basename(s) can resolve ambiguously.` }) })
    if (snapshot.provenanceCoverage < 80) values.push({ severity: "warning", text: t("health.findings.provenance", { value: snapshot.provenanceCoverage, defaultValue: `Only ${snapshot.provenanceCoverage}% of content pages declare sources.` }) })
    if (snapshot.pendingClips) values.push({ severity: "info", text: t("health.findings.clips", { count: snapshot.pendingClips, defaultValue: `${snapshot.pendingClips} web clip(s) are waiting for ingest.` }) })
    if (snapshot.orphanPages) values.push({ severity: "info", text: t("health.findings.orphans", { count: snapshot.orphanPages, defaultValue: `${snapshot.orphanPages} page(s) have no inbound links.` }) })
    return values
  }, [snapshot, t])

  const handleBackup = useCallback(async () => {
    if (!project) return
    const date = new Date().toISOString().slice(0, 10)
    const destination = await saveDialog({
      defaultPath: `${project.name.replace(/[^A-Za-z0-9_-]+/g, "-")}-${date}.potato-box.zip`,
      filters: [{ name: "potato box backup", extensions: ["zip"] }],
    })
    if (!destination) return
    setOperation({ kind: "running", message: t("health.operations.backingUp", { defaultValue: "Creating and verifying backup..." }) })
    try {
      setOperation({ kind: "backup", report: await createConsistentProjectBackup(project, destination) })
    } catch (error) {
      setOperation({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }, [project, t])

  const handleRestore = useCallback(async () => {
    const archive = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "potato box backup", extensions: ["zip"] }],
    })
    if (typeof archive !== "string") return
    const destination = await openDialog({ multiple: false, directory: true })
    if (typeof destination !== "string") return
    setOperation({ kind: "running", message: t("health.operations.restoring", { defaultValue: "Validating and restoring backup..." }) })
    try {
      setOperation({ kind: "restore", report: await restoreProjectBackup(archive, destination) })
    } catch (error) {
      setOperation({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }, [t])

  const handleExportDiagnostics = useCallback(async () => {
    if (!diagnostics || !project) return
    const destination = await saveDialog({
      defaultPath: `${project.name.replace(/[^A-Za-z0-9_-]+/g, "-")}-diagnostics.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    })
    if (!destination) return
    try {
      await writeFileAtomic(destination, JSON.stringify(diagnostics, null, 2))
      setOperation({ kind: "diagnostics", path: destination })
    } catch (error) {
      setOperation({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }, [diagnostics, project])

  const handleCopyDiagnostics = useCallback(async () => {
    if (!diagnostics) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      setOperation({ kind: "diagnostics" })
    } catch (error) {
      setOperation({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }, [diagnostics])

  if (!project) return null

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{t("health.title", { defaultValue: "Knowledge Health" })}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void scan()} disabled={scanning} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
            {t("health.refresh", { defaultValue: "Refresh" })}
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-5">
        {!snapshot ? (
          operation.kind === "error" && !scanning ? (
            <div className="min-h-48 py-8">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                {operation.message}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => void scan()} className="gap-1.5"><RefreshCw className="h-4 w-4" />{t("health.refresh", { defaultValue: "Retry scan" })}</Button>
                <Button variant="outline" onClick={handleBackup} className="gap-1.5"><DatabaseBackup className="h-4 w-4" />{t("health.operations.backup", { defaultValue: "Create backup" })}</Button>
                <Button variant="outline" onClick={handleRestore} className="gap-1.5"><RotateCcw className="h-4 w-4" />{t("health.operations.restore", { defaultValue: "Restore to new folder" })}</Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" /> {t("health.scanning", { defaultValue: "Scanning project..." })}
            </div>
          )
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 border-b pb-5 md:grid-cols-4">
              <Metric icon={ShieldCheck} label={t("health.score", { defaultValue: "Health score" })} value={`${snapshot.score}/100`} tone={snapshot.score >= 85 ? "good" : snapshot.score >= 60 ? "warn" : "bad"} />
              <Metric icon={FileText} label={t("health.pages", { defaultValue: "Wiki pages" })} value={String(snapshot.wikiPages)} />
              <Metric icon={FolderArchive} label={t("health.sources", { defaultValue: "Source files" })} value={String(snapshot.sourceFiles)} />
              <Metric icon={Link2} label={t("health.provenance", { defaultValue: "Provenance" })} value={`${snapshot.provenanceCoverage}%`} tone={snapshot.provenanceCoverage >= 80 ? "good" : "warn"} />
            </section>

            <section className="border-b py-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t("health.findings.title", { defaultValue: "Findings" })}</h2>
                <span className="text-xs text-muted-foreground">
                  {new Date(snapshot.scannedAt).toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
                </span>
              </div>
              {findings.length === 0 ? (
                <div className="flex items-center gap-2 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                  <Check className="h-4 w-4" /> {t("health.findings.clear", { defaultValue: "No actionable health findings." })}
                </div>
              ) : (
                <div className="divide-y rounded-md border">
                  {findings.map((finding, index) => (
                    <div key={`${finding.severity}-${index}`} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${finding.severity === "error" ? "text-destructive" : finding.severity === "warning" ? "text-amber-600" : "text-muted-foreground"}`} />
                      <span>{finding.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="border-b py-5">
              <h2 className="mb-3 text-sm font-semibold">{t("health.services", { defaultValue: "Local services" })}</h2>
              <div className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <ServiceRow label={t("health.serviceLabels.clipper", { defaultValue: "Clipper" })} value={snapshot.clipStatus} />
                <ServiceRow label={t("health.serviceLabels.api", { defaultValue: "API" })} value={snapshot.apiStatus} />
                <ServiceRow label={t("health.serviceLabels.llm", { defaultValue: "LLM" })} value={snapshot.llmReady ? "ready" : "notConfigured"} />
                <ServiceRow label={t("health.serviceLabels.fileSync", { defaultValue: "File sync" })} value={snapshot.fileSyncError ? "error" : "ready"} />
              </div>
            </section>

            <section className="py-5">
              <h2 className="mb-3 text-sm font-semibold">{t("health.operations.title", { defaultValue: "Recovery and support" })}</h2>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleBackup} className="gap-1.5"><DatabaseBackup className="h-4 w-4" />{t("health.operations.backup", { defaultValue: "Create backup" })}</Button>
                <Button variant="outline" onClick={handleRestore} className="gap-1.5"><RotateCcw className="h-4 w-4" />{t("health.operations.restore", { defaultValue: "Restore to new folder" })}</Button>
                <Button variant="outline" onClick={handleExportDiagnostics} disabled={!diagnostics} className="gap-1.5"><FileJson className="h-4 w-4" />{t("health.operations.export", { defaultValue: "Export diagnostics" })}</Button>
                <Button variant="outline" size="icon" onClick={handleCopyDiagnostics} disabled={!diagnostics} title={t("health.operations.copy", { defaultValue: "Copy diagnostics" })} aria-label={t("health.operations.copy", { defaultValue: "Copy diagnostics" })}><ClipboardCopy className="h-4 w-4" /></Button>
              </div>
              <OperationResult operation={operation} onOpenRestore={(path) => void openProjectFolder(path)} />
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Metric({ icon: Icon, label, value, tone = "neutral" }: { icon: typeof ShieldCheck; label: string; value: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const toneClass = tone === "good" ? "text-emerald-700 dark:text-emerald-400" : tone === "warn" ? "text-amber-700 dark:text-amber-400" : tone === "bad" ? "text-destructive" : "text-foreground"
  return <div className="rounded-md border bg-muted/20 p-3"><Icon className="mb-2 h-4 w-4 text-muted-foreground" /><div className={`text-xl font-semibold ${toneClass}`}>{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{label}</div></div>
}

function ServiceRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation()
  const healthy = value === "running" || value === "ready"
  return <div className="flex items-center justify-between border-b py-2"><span className="text-muted-foreground">{label}</span><span className={healthy ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{t(`health.status.${value}`, { defaultValue: value })}</span></div>
}

function OperationResult({ operation, onOpenRestore }: { operation: OperationState; onOpenRestore: (path: string) => void }) {
  const { t } = useTranslation()
  if (operation.kind === "idle") return null
  if (operation.kind === "running") return <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />{operation.message}</div>
  if (operation.kind === "error") return <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{operation.message}</div>
  if (operation.kind === "backup") return <div className="mt-3 rounded-md border px-3 py-2 text-sm"><div className="font-medium">{t("health.operations.backupVerified", { defaultValue: "Backup verified" })}</div><div className="mt-1 break-all text-xs text-muted-foreground">{operation.report.path}<br />SHA-256 {operation.report.sha256}<br />{t("health.operations.backupDetails", { files: operation.report.files, size: formatBytes(operation.report.archiveBytes), defaultValue: `${operation.report.files} files, ${formatBytes(operation.report.archiveBytes)}` })}</div></div>
  if (operation.kind === "restore") return <div className="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"><div className="min-w-0"><div className="font-medium">{t("health.operations.restored", { defaultValue: "Restored to a new folder" })}</div><div className="truncate text-xs text-muted-foreground" title={operation.report.projectPath}>{operation.report.projectPath}</div></div><Button variant="outline" size="sm" onClick={() => onOpenRestore(operation.report.projectPath)}>{t("health.operations.openFolder", { defaultValue: "Open folder" })}</Button></div>
  return <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" />{operation.path ? t("health.operations.diagnosticsExported", { path: operation.path, defaultValue: `Diagnostics exported to ${operation.path}` }) : t("health.operations.diagnosticsCopied", { defaultValue: "Diagnostics copied" })}</div>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
