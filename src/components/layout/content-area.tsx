import { lazy, Suspense } from "react"
import { LoaderCircle } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"

const ChatPanel = lazy(() =>
  import("@/components/chat/chat-panel").then(({ ChatPanel }) => ({ default: ChatPanel })),
)
const SettingsView = lazy(() =>
  import("@/components/settings/settings-view").then(({ SettingsView }) => ({
    default: SettingsView,
  })),
)
const SourcesView = lazy(() =>
  import("@/components/sources/sources-view").then(({ SourcesView }) => ({
    default: SourcesView,
  })),
)
const ReviewView = lazy(() =>
  import("@/components/review/review-view").then(({ ReviewView }) => ({ default: ReviewView })),
)
const LintView = lazy(() =>
  import("@/components/lint/lint-view").then(({ LintView }) => ({ default: LintView })),
)
const SearchView = lazy(() =>
  import("@/components/search/search-view").then(({ SearchView }) => ({ default: SearchView })),
)
const GraphView = lazy(() =>
  import("@/components/graph/graph-view").then(({ GraphView }) => ({ default: GraphView })),
)
const PreviewPanel = lazy(() =>
  import("./preview-panel").then(({ PreviewPanel }) => ({ default: PreviewPanel })),
)
const KnowledgeHealthView = lazy(() =>
  import("@/components/health/knowledge-health-view").then(({ KnowledgeHealthView }) => ({
    default: KnowledgeHealthView,
  })),
)

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  const content = (() => {
    switch (activeView) {
    case "chat":
      return <ChatPanel />
    case "wiki":
      return <PreviewPanel />
    case "settings":
      return <SettingsView />
    case "sources":
      return <SourcesView />
    case "review":
      return <ReviewView />
    case "lint":
      return <LintView />
    case "search":
      return <SearchView />
    case "graph":
      return <GraphView />
    case "health":
      return <KnowledgeHealthView />
    default:
      return <PreviewPanel />
    }
  })()

  return <Suspense fallback={<ViewLoading />}>{content}</Suspense>
}

function ViewLoading() {
  return (
    <div
      className="flex h-full min-h-0 items-center justify-center"
      role="status"
      aria-label="Loading view"
    >
      <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  )
}
