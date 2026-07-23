export type ReviewAction =
  | { kind: "create"; label: string }
  | { kind: "dismiss" }
  | { kind: "research"; topic?: string }
  | { kind: "open"; path?: string }
  | { kind: "delete"; path: string }
  | { kind: "save"; payload: string }
  | { kind: "unknown" }

const CREATE_LABELS = new Set([
  "create",
  "create page",
  "add page",
  "save as page",
  "创建页面",
  "페이지 만들기",
])

const DISMISS_LABELS = new Set([
  "skip",
  "dismiss",
  "ignore",
  "approve",
  "keep existing",
  "no",
  "跳过",
  "忽略",
  "건너뛰기",
  "무시",
])

const OPEN_LABELS = new Set(["open", "view", "open page", "view page", "打开", "查看"])

export function parseReviewAction(rawAction: string): ReviewAction {
  const action = rawAction.trim()
  const lower = action.toLowerCase()
  if (action === "__deep_research__") return { kind: "research" }
  if (action === "__create_page__") return { kind: "create", label: "Create Page" }
  if (action.startsWith("__create_page__:")) {
    return { kind: "create", label: action.slice("__create_page__:".length).trim() || "Create Page" }
  }
  if (action === "__dismiss__" || DISMISS_LABELS.has(lower)) return { kind: "dismiss" }
  if (action.startsWith("save:")) return { kind: "save", payload: action.slice(5) }
  if (action.startsWith("open:")) return { kind: "open", path: action.slice(5).trim() }
  if (action.startsWith("delete:")) return { kind: "delete", path: action.slice(7).trim() }
  if (OPEN_LABELS.has(lower)) return { kind: "open" }
  if (CREATE_LABELS.has(lower)) return { kind: "create", label: action }

  const research = /^(research|investigate|explore|look into)(?:\s+(.+))?$/i.exec(action)
  if (research) return { kind: "research", topic: research[2]?.trim() }
  if (["研究", "调研", "探索", "조사", "연구"].includes(action)) return { kind: "research" }
  return { kind: "unknown" }
}
