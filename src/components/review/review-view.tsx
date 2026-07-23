import { useCallback } from "react"
import { queueResearch } from "@/lib/deep-research"
import {
  AlertTriangle,
  Copy,
  FileQuestion,
  CheckCircle2,
  Lightbulb,
  MessageSquare,
  X,
  Check,
  Search,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import { writeFile, readFile, listDirectory, deleteManagedReviewFile } from "@/commands/fs"
import { getRelativePath, isAbsolutePath, isPathWithinBase, normalizePath } from "@/lib/path-utils"
import { hasConfiguredDeepResearchSources } from "@/lib/web-search"
import { deriveQueryTitle, makeQueryFileName } from "@/lib/wiki-filename"
import { useTranslation } from "react-i18next"
import { parseReviewAction } from "@/lib/review-actions"
import { quoteYamlString } from "@/lib/yaml-string"

const typeConfig: Record<ReviewItem["type"], { icon: typeof AlertTriangle; label: string; color: string }> = {
  contradiction: { icon: AlertTriangle, label: "Contradiction", color: "text-amber-500" },
  duplicate: { icon: Copy, label: "Possible Duplicate", color: "text-blue-500" },
  "missing-page": { icon: FileQuestion, label: "Missing Page", color: "text-purple-500" },
  confirm: { icon: MessageSquare, label: "Needs Confirmation", color: "text-foreground" },
  suggestion: { icon: Lightbulb, label: "Suggestion", color: "text-emerald-500" },
}

export function ReviewView() {
  const { t } = useTranslation()
  const items = useReviewStore((s) => s.items)
  const resolveItem = useReviewStore((s) => s.resolveItem)
  const dismissItem = useReviewStore((s) => s.dismissItem)
  const clearResolved = useReviewStore((s) => s.clearResolved)
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const handleResolve = useCallback(async (id: string, action: string) => {
    const pp = project ? normalizePath(project.path) : ""
    const item = items.find((i) => i.id === id)
    const parsedAction = parseReviewAction(action)

    if (parsedAction.kind === "research" && project) {
      const searchConfig = useWikiStore.getState().searchApiConfig
      if (!hasConfiguredDeepResearchSources(searchConfig)) {
        window.alert(t("research.notConfigured"))
        return
      }
      if (item) {
        const llmConfig = useWikiStore.getState().llmConfig
        const topic = parsedAction.topic
          || item.title.replace(/^(Save to Wiki|Create|Research)[:\s]*/i, "").trim()
          || item.description.split("\n")[0]
        queueResearch(pp, topic, llmConfig, searchConfig, item.searchQueries, id)
      } else {
        resolveItem(id, action)
      }
      return
    }

    if (parsedAction.kind === "save" && project) {
      // Decode and save the content to wiki
      try {
        const encoded = parsedAction.payload
        const content = decodeURIComponent(atob(encoded))

        // Strip hidden comments
        const cleanContent = content
          .replace(/<!--\s*save-worthy:.*?-->/g, "")
          .replace(/<!--\s*sources:.*?-->/g, "")
          .trimEnd()

        const title = deriveQueryTitle(cleanContent)
        const { date, fileName } = makeQueryFileName(title)
        const filePath = `${pp}/wiki/queries/${fileName}`

        const frontmatter = `---\ntype: query\ntitle: ${quoteYamlString(title)}\ncreated: ${date}\ntags: []\n---\n\n`
        const pageContent = frontmatter + cleanContent
        await writeFile(filePath, pageContent)

        // Update index
        const indexPath = `${pp}/wiki/index.md`
        let indexContent = ""
        try { indexContent = await readFile(indexPath) } catch { indexContent = "# Wiki Index\n" }
        const linkTarget = fileName.replace(/\.md$/, "")
        const entry = `- [[queries/${linkTarget}|${title}]]`
        if (indexContent.includes("## Queries")) {
          indexContent = indexContent.replace(/(## Queries\n)/, (match) => `${match}${entry}\n`)
        } else {
          indexContent = indexContent.trimEnd() + "\n\n## Queries\n" + entry + "\n"
        }
        await writeFile(indexPath, indexContent)

        // Append log
        const logPath = `${pp}/wiki/log.md`
        let logContent = ""
        try { logContent = await readFile(logPath) } catch { logContent = "# Wiki Log\n" }
        await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Saved query page \`${fileName}\`\n`)

        // Refresh tree
        const tree = await listDirectory(pp)
        setFileTree(tree)
        useWikiStore.getState().openFileInPreview(filePath, pageContent)
        useWikiStore.getState().bumpDataVersion()

        resolveItem(id, "Saved to Wiki")
      } catch (err) {
        console.error("Failed to save to wiki from review:", err)
        window.alert(t("review.actionFailed", { defaultValue: "The review action failed. Nothing was marked resolved." }))
      }
    } else if (parsedAction.kind === "open" && project) {
      // Open a page in the right-side preview without resolving the
      // review item. Viewing is not the same as accepting / fixing it.
      const page = parsedAction.path ?? item?.affectedPages?.[0] ?? item?.sourcePath ?? ""
      if (!page) return
      const normalizedPage = normalizePath(page)
      const candidates = normalizedPage.startsWith(pp)
        ? [normalizedPage]
        : normalizedPage.startsWith("wiki/") || normalizedPage.startsWith("raw/")
          ? [`${pp}/${normalizedPage}`, `${pp}/${normalizedPage}.md`]
          : [`${pp}/wiki/${normalizedPage}`, `${pp}/wiki/${normalizedPage}.md`]
      for (const path of candidates.filter((candidate) => isPathWithinBase(candidate, pp))) {
        try {
          const content = await readFile(path)
          useWikiStore.getState().openFileInPreview(path, content)
          return
        } catch {
          // try next
        }
      }
    } else if (parsedAction.kind === "delete" && project) {
      const requestedPath = normalizePath(parsedAction.path)
      const filePath = isAbsolutePath(requestedPath) ? requestedPath : `${pp}/${requestedPath.replace(/^\/+/, "")}`
      const relativePath = getRelativePath(filePath, pp)
      const allowedRoot = relativePath.startsWith("wiki/") || relativePath.startsWith("raw/sources/")
      if (!isPathWithinBase(filePath, pp) || !allowedRoot) {
        console.error("Rejected review delete outside managed project roots:", requestedPath)
        window.alert(t("review.invalidDeleteTarget", { defaultValue: "This delete target is outside the managed project folders." }))
        return
      }
      const confirmed = window.confirm(
        t("review.deleteConfirm", {
          path: relativePath,
          defaultValue: `Delete ${relativePath}? This cannot be undone.`,
        }),
      )
      if (!confirmed) return
      try {
        await deleteManagedReviewFile(pp, filePath)
        const tree = await listDirectory(pp)
        setFileTree(tree)
        resolveItem(id, "Deleted")
      } catch (err) {
        console.error("Failed to delete:", err)
        window.alert(t("review.actionFailed", { defaultValue: "The review action failed. Nothing was marked resolved." }))
      }
    } else if (
      parsedAction.kind === "create"
      && project
    ) {
      const realAction = parsedAction.label
      if (item) {
        try {
          const title = item.title.replace(/^(Create|Save|Add)[:\s]*/i, "").trim() || "Untitled"
          const { date, fileName } = makeQueryFileName(title)

          // Determine page type from review type or action text
          const pageType = detectPageType(realAction, item.type)
          const dir = pageType === "query" ? "queries" : pageType === "entity" ? "entities" : pageType === "concept" ? "concepts" : "queries"
          const filePath = `${pp}/wiki/${dir}/${fileName}`

          const frontmatter = `---\ntype: ${pageType}\ntitle: ${quoteYamlString(title)}\ncreated: ${date}\ntags: []\nrelated: []\n---\n\n`
          const body = `# ${title}\n\n${item.description}\n`
          const pageContent = frontmatter + body
          await writeFile(filePath, pageContent)

          // Update index
          const indexPath = `${pp}/wiki/index.md`
          let indexContent = ""
          try { indexContent = await readFile(indexPath) } catch { indexContent = "# Wiki Index\n" }
          const sectionHeader = `## ${dir.charAt(0).toUpperCase() + dir.slice(1)}`
          const linkTarget = fileName.replace(/\.md$/, "")
          const entry = `- [[${dir}/${linkTarget}|${title}]]`
          if (indexContent.includes(sectionHeader)) {
            indexContent = indexContent.replace(new RegExp(`(${sectionHeader}\n)`), (match) => `${match}${entry}\n`)
          } else {
            indexContent = indexContent.trimEnd() + `\n\n${sectionHeader}\n${entry}\n`
          }
          await writeFile(indexPath, indexContent)

          // Log
          const logPath = `${pp}/wiki/log.md`
          let logContent = ""
          try { logContent = await readFile(logPath) } catch { logContent = "# Wiki Log\n" }
          await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Created ${pageType} page \`${fileName}\` from review\n`)

          // Refresh
          const tree = await listDirectory(pp)
          setFileTree(tree)
          useWikiStore.getState().openFileInPreview(filePath, pageContent)
          useWikiStore.getState().bumpDataVersion()

          resolveItem(id, `Created: wiki/${dir}/${fileName}`)
        } catch (err) {
          console.error("Failed to create page from review:", err)
          window.alert(t("review.actionFailed", { defaultValue: "The review action failed. Nothing was marked resolved." }))
        }
      } else {
        resolveItem(id, action)
      }
    } else if (parsedAction.kind === "dismiss") {
      resolveItem(id, action)
    } else {
      console.error("Rejected unsupported review action:", action)
      window.alert(t("review.unsupportedAction", { defaultValue: "This review action is not supported and was not executed." }))
    }
  }, [project, items, resolveItem, setFileTree])

  const pending = items.filter((i) => !i.resolved)
  const resolved = items.filter((i) => i.resolved)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {t("review.title")}
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {pending.length}
            </span>
          )}
        </h2>
        {resolved.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearResolved} className="text-xs">
            <Trash2 className="mr-1 h-3 w-3" />
            {t("review.clearResolved")}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
            <p>{t("review.allClear")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {pending.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDismiss={dismissItem}
              />
            ))}
            {resolved.length > 0 && pending.length > 0 && (
              <div className="my-2 text-center text-xs text-muted-foreground">
                {t("review.resolvedDivider")}
              </div>
            )}
            {resolved.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDismiss={dismissItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewCard({
  item,
  onResolve,
  onDismiss,
}: {
  item: ReviewItem
  onResolve: (id: string, action: string) => void
  onDismiss: (id: string) => void
}) {
  const { t } = useTranslation()
  const config = typeConfig[item.type]
  const Icon = config.icon

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-opacity ${
        item.resolved ? "opacity-50" : ""
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
          <span className="font-medium">{item.title}</span>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label={t("review.dismiss", { defaultValue: "Dismiss review item" })}
          title={t("review.dismiss", { defaultValue: "Dismiss review item" })}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">{item.description}</p>

      {item.affectedPages && item.affectedPages.length > 0 && (
        <div className="mb-3 text-xs text-muted-foreground">
          Pages: {item.affectedPages.join(", ")}
        </div>
      )}

      {!item.resolved ? (
        <div className="flex flex-wrap gap-1.5">
          {(item.type === "suggestion" || item.type === "missing-page") && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onResolve(item.id, "__deep_research__")}
            >
              <Search className="h-3.5 w-3.5" /> {t("research.title")}
            </Button>
          )}
          {item.options.map((opt) => (
            <Button
              key={opt.action}
              variant={parseReviewAction(opt.action).kind === "delete" ? "destructive" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onResolve(item.id, opt.action)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3 w-3" />
          {item.resolvedAction}
        </div>
      )}
    </div>
  )
}

/** Infer wiki page type from action text and review item type */
function detectPageType(action: string, reviewType: string): string {
  const lower = action.toLowerCase()
  if (lower.includes("entity") || lower.includes("实体")) return "entity"
  if (lower.includes("concept") || lower.includes("概念")) return "concept"
  if (lower.includes("comparison") || lower.includes("compare") || lower.includes("比较")) return "comparison"
  if (lower.includes("synthesis") || lower.includes("综合")) return "synthesis"
  if (reviewType === "missing-page") return "concept"
  if (reviewType === "contradiction") return "query"
  if (reviewType === "suggestion") return "query"
  // Default: research/investigate/create → query
  return "query"
}
