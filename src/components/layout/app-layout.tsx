import { useCallback, useEffect, useRef, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { IconSidebar } from "./icon-sidebar"
import { UpdateBanner } from "./update-banner"
import { SidebarPanel } from "./sidebar-panel"
import { ContentArea } from "./content-area"
import { ResearchPanel } from "./research-panel"
import { ActivityPanel } from "./activity-panel"
import { useResearchStore } from "@/stores/research-store"
import { ErrorBoundary } from "@/components/error-boundary"
import { getAppLayoutVisibility } from "./app-layout-visibility"
import { PanelLeftOpen, PanelRightOpen, X } from "lucide-react"

interface AppLayoutProps {
  onSwitchProject: () => void
}

export function AppLayout({ onSwitchProject }: AppLayoutProps) {
  const project = useWikiStore((s) => s.project)
  const activeView = useWikiStore((s) => s.activeView)
  const researchPanelOpen = useResearchStore((s) => s.panelOpen)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [leftWidth, setLeftWidth] = useState(220)
  const [rightWidth, setRightWidth] = useState(400)
  const [isCompact, setIsCompact] = useState(false)
  const [compactLeftOpen, setCompactLeftOpen] = useState(false)
  const [compactRightOpen, setCompactRightOpen] = useState(false)
  const isDraggingLeft = useRef(false)
  const isDraggingRight = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const loadFileTree = useCallback(async () => {
    if (!project) return
    const projectId = project.id
    const projectPath = normalizePath(project.path)
    try {
      const tree = await listDirectory(projectPath)
      const activeProject = useWikiStore.getState().project
      if (
        activeProject?.id !== projectId ||
        normalizePath(activeProject.path) !== projectPath
      ) return
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }, [project, setFileTree])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(max-width: 767px)")
    const update = () => setIsCompact(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    setCompactLeftOpen(false)
    setCompactRightOpen(false)
  }, [activeView])

  const startDrag = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault()
      if (side === "left") isDraggingLeft.current = true
      else isDraggingRight.current = true
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      document.body.dataset.panelResizing = "true"

      const handleMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()

        if (isDraggingLeft.current) {
          const newWidth = e.clientX - rect.left
          // Hard cap: 150 to 400px
          setLeftWidth(Math.max(150, Math.min(400, newWidth)))
        }
        if (isDraggingRight.current) {
          const newWidth = rect.right - e.clientX
          // Hard cap: 250 to 50% of container
          setRightWidth(Math.max(250, Math.min(rect.width * 0.5, newWidth)))
        }
      }

      const handleMouseUp = () => {
        isDraggingLeft.current = false
        isDraggingRight.current = false
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        delete document.body.dataset.panelResizing
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    },
    []
  )

  // Settings and Chat are standalone views. Hide the project file tree,
  // activity strip, and optional right research panel there so those
  // screens use the whole work area.
  const { showLeftPanel, hasRightPanel } = getAppLayoutVisibility(activeView, researchPanelOpen)

  return (
    // Outer column layout: full-width update banner on top (when an
    // update is available AND not dismissed for this version), the
    // existing IconSidebar + content row below. Banner is shrink-0
    // so it doesn't compress the work area; main row is flex-1 so
    // it fills the rest of the viewport.
    <div className="flex h-full flex-col bg-background text-foreground">
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <IconSidebar onSwitchProject={onSwitchProject} />
        <div ref={containerRef} className="relative flex min-w-0 flex-1 overflow-hidden">
          {isCompact && (compactLeftOpen || compactRightOpen) && (
            <button
              type="button"
              aria-label="Close side panel"
              className="absolute inset-0 z-20 bg-black/35"
              onClick={() => {
                setCompactLeftOpen(false)
                setCompactRightOpen(false)
              }}
            />
          )}
          {isCompact && showLeftPanel && !compactLeftOpen && (
            <button
              type="button"
              title="Open project files"
              aria-label="Open project files"
              className="absolute left-2 top-2 z-10 flex size-9 items-center justify-center rounded-md border bg-background shadow-sm"
              onClick={() => {
                setCompactRightOpen(false)
                setCompactLeftOpen(true)
              }}
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}
          {isCompact && hasRightPanel && !compactRightOpen && (
            <button
              type="button"
              title="Open research panel"
              aria-label="Open research panel"
              className="absolute right-2 top-2 z-10 flex size-9 items-center justify-center rounded-md border bg-background shadow-sm"
              onClick={() => {
                setCompactLeftOpen(false)
                setCompactRightOpen(true)
              }}
            >
              <PanelRightOpen className="size-4" />
            </button>
          )}

          {showLeftPanel && (!isCompact || compactLeftOpen) && (
            <>
              {/* Left: File tree + Activity */}
              <div
                className={isCompact
                  ? "absolute inset-y-0 left-0 z-30 flex w-[min(85vw,320px)] flex-col overflow-hidden border-r bg-background shadow-xl"
                  : "flex shrink-0 flex-col overflow-hidden border-r"}
                style={isCompact ? undefined : { width: leftWidth }}
              >
                {isCompact && (
                  <button
                    type="button"
                    title="Close project files"
                    aria-label="Close project files"
                    className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-md border bg-background"
                    onClick={() => setCompactLeftOpen(false)}
                  >
                    <X className="size-4" />
                  </button>
                )}
                <div className="flex-1 overflow-hidden">
                  <SidebarPanel />
                </div>
                <ActivityPanel />
              </div>
              {!isCompact && (
                <div
                  className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
                  onMouseDown={startDrag("left")}
                />
              )}
            </>
          )}

          {/* Center: Chat, wiki preview, or tool view */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <ErrorBoundary>
              <ContentArea />
            </ErrorBoundary>
          </div>

          {/* Right panels */}
          {hasRightPanel && (!isCompact || compactRightOpen) && (
            <>
              {!isCompact && (
                <div
                  className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
                  onMouseDown={startDrag("right")}
                />
              )}
              <div
                className={isCompact
                  ? "absolute inset-y-0 right-0 z-30 flex w-[min(92vw,400px)] flex-col overflow-hidden border-l bg-background shadow-xl"
                  : "flex shrink-0 flex-col overflow-hidden border-l"}
                style={isCompact ? undefined : { width: rightWidth }}
              >
                {isCompact && (
                  <button
                    type="button"
                    title="Close research panel"
                    aria-label="Close research panel"
                    className="absolute left-2 top-2 z-10 flex size-8 items-center justify-center rounded-md border bg-background"
                    onClick={() => setCompactRightOpen(false)}
                  >
                    <X className="size-4" />
                  </button>
                )}
                <ErrorBoundary>
                  <ResearchPanel />
                </ErrorBoundary>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
