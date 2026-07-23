import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useLintStore } from "@/stores/lint-store"
import { useChatStore } from "@/stores/chat-store"
import { useResearchStore } from "@/stores/research-store"
import { useUpdateStore } from "@/stores/update-store"
import { BASE_FONT_SIZE_PX, useZoomStore } from "@/stores/zoom-store"
import { listDirectory, openProject, registerClipProjects } from "@/commands/fs"
import { getLastProject, getRecentProjects, saveLastProject, loadLlmConfig, loadLanguage, loadSearchApiConfig, loadEmbeddingConfig, loadMineruConfig, loadMultimodalConfig, loadOutputLanguage, loadProviderConfigs, loadActivePresetId, loadProxyConfig, loadScheduledImportConfig, saveScheduledImportConfig, loadSourceWatchConfig, loadApiConfig, loadGeneralConfig, loadZoomLevel } from "@/lib/project-store"
import { loadReviewItems, loadLintItems, loadChatHistory, loadResearchTasks } from "@/lib/persist"
import { checkForUpdates, UPDATE_CHECK_CACHE_MS } from "@/lib/update-check"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import type { WikiProject } from "@/types/wiki"
import { RELEASE_REPOSITORY, REPOSITORY_URL } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { isTauriRuntime } from "@/lib/tauri-runtime"
import { isDesktopRuntimeUnavailable, selectDirectory } from "@/lib/native-dialog"

function applyDocumentZoom(level: number) {
  document.documentElement.style.fontSize = `${BASE_FONT_SIZE_PX * level}px`
}

function App() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const zoomLevel = useZoomStore((s) => s.level)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)
  const [migrationError, setMigrationError] = useState<string | null>(null)
  const projectTransitionRef = useRef<Promise<void>>(Promise.resolve())

  // Set up auto-save and clip watcher once on mount
  useEffect(() => {
    let cancelled = false
    Promise.all([import("@/lib/auto-save"), import("@/lib/clip-watcher")])
      .then(([autoSave, clipWatcher]) => {
        if (cancelled) return
        autoSave.setupAutoSave()
        clipWatcher.startClipWatcher()
      })
      .catch((error) => console.error("[startup] failed to initialize background services", error))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return

    let disposed = false
    let unlisten: (() => void) | undefined
    void listen("potato-box://quit-requested", async () => {
      try {
        const { withDurabilityLock } = await import("@/lib/durability-lock")
        await withDurabilityLock(async () => {
          const { flushAllDocumentSaves } = await import("@/lib/document-save-coordinator")
          const { flushAndSuspendAutoSave, resumeAutoSave } = await import("@/lib/auto-save")
          try {
            await flushAllDocumentSaves()
            const currentProject = useWikiStore.getState().project
            if (currentProject) {
              await saveScheduledImportConfig(
                currentProject.path,
                useWikiStore.getState().scheduledImportConfig,
              )
            }
            await flushAndSuspendAutoSave()
            const { resetProjectState } = await import("@/lib/reset-project-state")
            await resetProjectState()
            await invoke("complete_graceful_quit")
          } catch (error) {
            resumeAutoSave()
            throw error
          }
        })
      } catch (error) {
        await invoke("cancel_graceful_quit").catch(() => undefined)
        window.alert(`potato box could not quit because current work was not saved: ${error}`)
      }
    }).then((dispose) => {
      if (disposed) dispose()
      else {
        unlisten = dispose
        void invoke("frontend_ready_for_quit").catch((error) =>
          console.error("Failed to complete quit-listener handshake:", error),
        )
      }
    }).catch((error) => console.error("Failed to install quit handler:", error))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    // Apply interface zoom globally, including welcome/settings screens. We
    // scale the rem base instead of using transform: scale() so layout and
    // pointer coordinates remain native; fixed-pixel panels keep their caps.
    applyDocumentZoom(zoomLevel)
  }, [zoomLevel])

  // Dev-only helper for visually testing the update-banner UX.
  // Open dev tools and run:
  //   __potatobox_testUpdateBanner()
  // to inject a fake "available" result into the update store —
  // banner appears at the top + red dot lights up the gear icon.
  // Run again with arg `false` (or call setDismissed via the store)
  // to clear. Gated on `import.meta.env.DEV` so the helper never
  // ships in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(async () => {
      // Expose the live store getter on window so you can inspect
      // state from devtools when debugging banner behavior.
      ;(window as unknown as { __potatobox_updateStore?: typeof useUpdateStore }).__potatobox_updateStore = useUpdateStore
      ;(window as unknown as { __potatobox_testUpdateBanner?: (clear?: boolean) => void }).__potatobox_testUpdateBanner = (clear = false) => {
        if (clear) {
          useUpdateStore.getState().setResult(
            { kind: "up-to-date", local: __APP_VERSION__, remote: __APP_VERSION__ },
            Date.now(),
          )
          useUpdateStore.getState().setDismissed(null)
          console.log("[test] update banner cleared")
          return
        }
        useUpdateStore.getState().setResult(
          {
            kind: "available",
            local: __APP_VERSION__,
            remote: "v999.0.0",
            release: {
              name: "v999.0.0 (test)",
              tag_name: "v999.0.0",
              body:
                "Test release for banner-UX verification.\n\n" +
                "- Bigger red dot on the Settings icon\n" +
                "- Top banner with one-click dismiss\n" +
                "- Once dismissed, won't reappear for this version",
              html_url: `${REPOSITORY_URL ?? "https://github.com/example/potato-box"}/releases`,
              published_at: new Date().toISOString(),
            },
          },
          Date.now(),
        )
        useUpdateStore.getState().setDismissed(null)
        console.log(
          "[test] update banner injected. Run __potatobox_testUpdateBanner(true) to clear.",
        )
      }
    })()
  }, [])

  // Background update check — hydrate persisted user preferences, then
  // hit GitHub at most once every UPDATE_CHECK_CACHE_MS. Runs 1.5 s
  // after mount so it doesn't contend with the heaviest startup work
  // (project load, file tree, vector store init) but still surfaces
  // a new release in time for the user to notice it during their
  // first interaction. Silent on failure; the UI in Settings → About
  // lets the user retry manually.
  useEffect(() => {
    if (!RELEASE_REPOSITORY) return
    let cancelled = false
    const timer = setTimeout(async () => {
      if (cancelled) return
      try {
        const { loadUpdateCheckState, saveUpdateCheckState } = await import(
          "@/lib/project-store"
        )

        const persisted = await loadUpdateCheckState()
        if (persisted) useUpdateStore.getState().hydrate(persisted)

        const state = useUpdateStore.getState()
        if (!state.enabled) {
          console.log("[update-check] skipped: user disabled auto-check in settings")
          return
        }

        const now = Date.now()
        // Cache hit requires BOTH the timestamp AND the in-memory
        // result to be present. `lastCheckedAt` is persisted to
        // disk but `lastResult` deliberately is not — keeping the
        // GitHub payload out of the persisted store keeps disk
        // size + privacy footprint small. The downside: a fresh
        // cold start has `lastResult === null` even when
        // `lastCheckedAt` is recent, in which case we MUST refetch
        // — otherwise we'd skip the check AND have no result to
        // display, leaving the banner permanently stuck off.
        // (This was the user-reported bug: "kind=none, no banner".)
        const fresh =
          state.lastCheckedAt !== null &&
          state.lastResult !== null &&
          now - state.lastCheckedAt < UPDATE_CHECK_CACHE_MS
        if (fresh) {
          const ageMin = Math.round((now - (state.lastCheckedAt ?? 0)) / 60_000)
          console.log(
            `[update-check] skipped: cache hit (last check ${ageMin} min ago, ` +
              `cache window ${UPDATE_CHECK_CACHE_MS / 60_000} min). ` +
              `Last result: kind=${state.lastResult?.kind ?? "none"}`,
          )
          return
        }

        useUpdateStore.getState().setChecking(true)
        console.log(
          `[update-check] fetching GitHub releases (local=${__APP_VERSION__})`,
        )
        const result = await checkForUpdates({
          currentVersion: __APP_VERSION__,
          repo: RELEASE_REPOSITORY,
        })
        if (cancelled) return
        useUpdateStore.getState().setResult(result, Date.now())
        if (result.kind === "available") {
          console.log(
            `[update-check] update available: local=${result.local} → remote=${result.remote}`,
          )
        } else if (result.kind === "up-to-date") {
          console.log(
            `[update-check] up to date: local=${result.local}, remote latest=${result.remote}`,
          )
        } else {
          console.log(`[update-check] error: ${result.message}`)
        }
        await saveUpdateCheckState({
          enabled: useUpdateStore.getState().enabled,
          lastCheckedAt: Date.now(),
          dismissedVersion: useUpdateStore.getState().dismissedVersion,
        })
      } catch {
        // Silent — Settings → About lets the user retry manually.
      }
    }, 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      try {
        const migrationFailure = await invoke<string | null>("app_migration_error")
        if (migrationFailure) {
          setMigrationError(migrationFailure)
          return
        }
        const savedZoom = await loadZoomLevel()
        applyDocumentZoom(savedZoom)
        useZoomStore.getState().setLevel(savedZoom)

        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        const savedProviderConfigs = await loadProviderConfigs()
        if (savedProviderConfigs) {
          useWikiStore.getState().setProviderConfigs(savedProviderConfigs)
        }
        const savedActivePreset = await loadActivePresetId()
        if (savedActivePreset) {
          useWikiStore.getState().setActivePresetId(savedActivePreset)
          // Re-resolve the active preset's LlmConfig from (preset defaults
          // + saved overrides). Without this, preset default updates
          // (e.g. a corrected Anthropic model ID shipped in a release)
          // never reach users who are relying on defaults — their stored
          // `llmConfig` snapshot from a previous launch would keep the
          // old value. Overrides still win, so an explicit user choice
          // is preserved.
          const { LLM_PRESETS } = await import("@/components/settings/llm-presets")
          const { resolveConfig } = await import("@/components/settings/preset-resolver")
          const preset = LLM_PRESETS.find((p) => p.id === savedActivePreset)
          if (preset) {
            const currentFallback = useWikiStore.getState().llmConfig
            const override = (savedProviderConfigs ?? {})[savedActivePreset]
            const resolved = resolveConfig(preset, override, currentFallback)
            useWikiStore.getState().setLlmConfig(resolved)
            const { saveLlmConfig } = await import("@/lib/project-store")
            await saveLlmConfig(resolved)
          }
        }
        const savedSearchConfig = await loadSearchApiConfig()
        if (savedSearchConfig) {
          useWikiStore.getState().setSearchApiConfig(savedSearchConfig)
        }
        const savedEmbeddingConfig = await loadEmbeddingConfig()
        if (savedEmbeddingConfig) {
          useWikiStore.getState().setEmbeddingConfig(savedEmbeddingConfig)
        }
        const savedMultimodalConfig = await loadMultimodalConfig()
        if (savedMultimodalConfig) {
          useWikiStore.getState().setMultimodalConfig(savedMultimodalConfig)
        }

        const savedMineruConfig = await loadMineruConfig()
        if (savedMineruConfig) {
          useWikiStore.getState().setMineruConfig(savedMineruConfig)
        }
        const savedProxy = await loadProxyConfig()
        if (savedProxy) {
          useWikiStore.getState().setProxyConfig(savedProxy)
        }
        // Local HTTP API server config — global (single token + enable
        // flag for the whole install, not per-project). The Rust side
        // reads `apiConfig.{enabled,token,mcpEnabled}` from `app-state.json`
        // directly; this only hydrates the Zustand store so the
        // Settings UI reflects the persisted values.
        const savedApi = await loadApiConfig()
        if (savedApi) {
          useWikiStore.getState().setApiConfig({
            enabled: typeof savedApi.enabled === "boolean" ? savedApi.enabled : true,
            mcpEnabled:
              typeof savedApi.mcpEnabled === "boolean"
                ? savedApi.mcpEnabled
                : false,
            token: typeof savedApi.token === "string" ? savedApi.token : "",
          })
        }
        const savedGeneral = await loadGeneralConfig()
        useWikiStore.getState().setGeneralConfig(savedGeneral)
        try {
          await invoke<string>("set_close_behavior", { value: savedGeneral.closeBehavior })
        } catch (err) {
          console.warn("[general] failed to hydrate close behavior:", err)
        }
        try {
          const currentAutostart = await isAutostartEnabled()
          if (savedGeneral.autostart && !currentAutostart) {
            await enableAutostart()
          } else if (!savedGeneral.autostart && currentAutostart) {
            await disableAutostart()
          }
        } catch (err) {
          console.warn("[general] failed to sync autostart:", err)
        }
        const savedLang = await loadLanguage()
        if (savedLang) {
          await i18n.changeLanguage(savedLang)
        }
        const lastProject = await getLastProject()
        if (lastProject) {
          try {
            const proj = await openProject(lastProject.path)
            await handleProjectOpened(proj)
          } catch {
            // Last project no longer valid
          }
        }
      } catch {
        // ignore init errors
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  async function handleProjectOpened(proj: WikiProject) {
    const transition = projectTransitionRef.current
      .catch(() => undefined)
      .then(() => performProjectOpen(proj))
    projectTransitionRef.current = transition.catch(() => undefined)
    return transition
  }

  async function performProjectOpen(proj: WikiProject) {
    const { withDurabilityLock } = await import("@/lib/durability-lock")
    return withDurabilityLock(() => performProjectOpenLocked(proj))
  }

  async function performProjectOpenLocked(proj: WikiProject) {
    const { flushAllDocumentSaves } = await import("@/lib/document-save-coordinator")
    await flushAllDocumentSaves()

    // Preflight every incoming state file before stopping the outgoing
    // project. Corrupt durable state therefore leaves the current workspace
    // fully active and cannot start hidden workers for a half-open project.
    const [
      projectOutputLang,
      savedScheduledImport,
      sourceWatchConfig,
      tree,
      savedReview,
      savedLint,
      savedChat,
      savedResearch,
    ] = await Promise.all([
      loadOutputLanguage(proj.id),
      loadScheduledImportConfig(proj.path),
      loadSourceWatchConfig(proj.id),
      listDirectory(proj.path),
      loadReviewItems(proj.path),
      loadLintItems(proj.path),
      loadChatHistory(proj.path),
      loadResearchTasks(proj.path),
    ])
    const scheduledImportConfig = savedScheduledImport
      ? {
          ...savedScheduledImport,
          path:
            savedScheduledImport.path &&
            !savedScheduledImport.path.startsWith("/") &&
            !savedScheduledImport.path.match(/^[a-zA-Z]:[/\\]/)
              ? `${proj.path}/${savedScheduledImport.path}`
              : savedScheduledImport.path,
        }
      : {
          enabled: false,
          path: `${proj.path}/raw/sources`,
          interval: 60,
          lastScan: null,
        }

    // Flush the OUTGOING project's review/lint/chat state to disk and suspend
    // auto-save before reset empties the stores — otherwise the debounced
    // writers would persist empty arrays back over the old project's pending
    // review / deep-research items.
    const { runWithSuspendedAutoSave } = await import("@/lib/auto-save")
    let incomingInstalled = false
    await runWithSuspendedAutoSave(async () => {
      // Clear all per-project state BEFORE loading new project data
      // to prevent cross-project contamination. MUST be awaited so the
      // ingest queue / graph cache are actually cleared before the new
      // project's state is populated.
      const { resetProjectState } = await import("@/lib/reset-project-state")
      await resetProjectState()

      setProject(proj)
      incomingInstalled = true
      useWikiStore.getState().setOutputLanguage(projectOutputLang ?? "auto")
      useWikiStore.getState().setScheduledImportConfig(scheduledImportConfig)
      useWikiStore.getState().setSourceWatchConfig(sourceWatchConfig)
      setSelectedFile(null)
      setActiveView("wiki")
      // Bump data version so any cached graphs/views invalidate
      useWikiStore.getState().bumpDataVersion()
      setFileTree(tree)
      useReviewStore.getState().setItems(savedReview)
      useLintStore.getState().setItems(savedLint)
      useChatStore.getState().setConversations(savedChat.conversations)
      useChatStore.getState().setMessages(savedChat.messages)
      if (savedChat.conversations.length > 0) {
        const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
        if (sorted[0]) {
          useChatStore.getState().setActiveConversation(sorted[0].id)
        }
      }
      useResearchStore.getState().setTasks(savedResearch)

      // Activate mutation-producing workers only after all incoming state has
      // been validated and installed.
      const { restoreQueue: restoreIngestQueue } = await import("@/lib/ingest-queue")
      await restoreIngestQueue(proj.id, proj.path)
      const { restoreQueue: restoreDedupQueue } = await import("@/lib/dedup-queue")
      await restoreDedupQueue(proj.id, proj.path)

      if (
        scheduledImportConfig.enabled &&
        scheduledImportConfig.path &&
        scheduledImportConfig.interval > 0
      ) {
        const { startScheduledImport } = await import("@/lib/scheduled-import")
        startScheduledImport(proj, scheduledImportConfig)
      }
      if (sourceWatchConfig.enabled) {
        const { startProjectFileSync } = await import("@/lib/project-file-sync")
        await startProjectFileSync(proj, sourceWatchConfig)
      }

      try {
        const recents = await getRecentProjects()
        const byId = new Map(recents.map((recent) => [recent.id, recent]))
        byId.set(proj.id, proj)
        await registerClipProjects(proj.id, [...byId.values()])
      } catch (err) {
        console.error("Failed to register clipper projects:", err)
      }
      await saveLastProject(proj)
    }, async () => {
      if (!incomingInstalled) return
      // If project loading fails after resetProjectState() and before persisted
      // state has been fully activated, stop every incoming worker before
      // auto-save resumes.
      const { resetProjectState } = await import("@/lib/reset-project-state")
      await resetProjectState()
      setProject(null)
      setFileTree([])
      setSelectedFile(null)
    })
  }

  async function handleSelectRecent(proj: WikiProject) {
    try {
      const validated = await openProject(proj.path)
      await handleProjectOpened(validated)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  async function handleOpenProject() {
    try {
      const selected = await selectDirectory({ title: i18n.t("welcome.openProject") })
      if (!selected) return
      const proj = await openProject(selected)
      await handleProjectOpened(proj)
    } catch (err) {
      const message = isDesktopRuntimeUnavailable(err)
        ? i18n.t("nativeRuntime.desktopRequired")
        : String(err)
      window.alert(`Failed to open project: ${message}`)
    }
  }

  async function handleSwitchProject() {
    const { withDurabilityLock } = await import("@/lib/durability-lock")
    await withDurabilityLock(performSwitchProjectLocked)
  }

  async function performSwitchProjectLocked() {
    const { flushAndSuspendAutoSave, resumeAutoSave } = await import("@/lib/auto-save")
    try {
      const { flushAllDocumentSaves } = await import("@/lib/document-save-coordinator")
      await flushAllDocumentSaves()
      // Save all outgoing state before stopping workers or clearing stores.
      // A failed write keeps the user in the current project instead of
      // silently discarding data during navigation.
      const currentProject = useWikiStore.getState().project
      if (currentProject) {
        const currentConfig = useWikiStore.getState().scheduledImportConfig
        await saveScheduledImportConfig(currentProject.path, currentConfig)
      }
      await flushAndSuspendAutoSave()
      const { stopScheduledImport } = await import("@/lib/scheduled-import")
      stopScheduledImport()
    } catch (err) {
      resumeAutoSave()
      window.alert(`Could not switch projects because current data could not be saved: ${err}`)
      return
    }

    // Clear only after queue persistence and worker shutdown complete. A
    // failure leaves the current project selected and auto-save enabled.
    try {
      const { resetProjectState } = await import("@/lib/reset-project-state")
      await resetProjectState()
    } catch (err) {
      resumeAutoSave()
      window.alert(`Could not switch projects safely: ${err}`)
      return
    }
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (migrationError) {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6 text-foreground">
        <section className="w-full max-w-xl space-y-4 border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">App data migration needs attention</h1>
          <p className="text-sm text-muted-foreground">
            potato box stopped before loading or writing settings. Resolve the filesystem issue,
            then retry. Legacy data and partially copied files were left in place.
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap border bg-muted p-3 text-xs">
            {migrationError}
          </pre>
          <Button
            onClick={() => {
              void invoke("retry_app_data_migration")
                .then(() => window.location.reload())
                .catch((error) => setMigrationError(String(error)))
            }}
          >
            Retry migration
          </Button>
        </section>
      </main>
    )
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectRecent}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleProjectOpened}
      />
    </>
  )
}

export default App
