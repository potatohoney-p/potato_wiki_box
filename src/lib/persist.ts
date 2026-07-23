import { writeFileAtomic, createDirectory } from "@/commands/fs"
import type { ReviewItem } from "@/stores/review-store"
import type { LintItem } from "@/stores/lint-store"
import type { DisplayMessage, Conversation } from "@/stores/chat-store"
import { normalizePath } from "@/lib/path-utils"
import { isSafeStorageId, requireSafeStorageId } from "@/lib/safe-storage-id"
import { readDurableJson } from "@/lib/durable-json"
import type { ResearchTask } from "@/stores/research-store"

async function ensureDir(projectPath: string): Promise<void> {
  await createDirectory(`${projectPath}/.potato-box`).catch(() => {})
  await createDirectory(`${projectPath}/.potato-box/chats`).catch(() => {})
}

export async function saveReviewItems(projectPath: string, items: ReviewItem[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)
  await writeFileAtomic(`${pp}/.potato-box/review.json`, JSON.stringify(items, null, 2))
}

export async function loadReviewItems(projectPath: string): Promise<ReviewItem[]> {
  const pp = normalizePath(projectPath)
  return await readDurableJson(
    `${pp}/.potato-box/review.json`,
    isReviewItemArray,
    "Review state",
  ) ?? []
}

export async function saveLintItems(projectPath: string, items: LintItem[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)
  await writeFileAtomic(`${pp}/.potato-box/lint.json`, JSON.stringify(items, null, 2))
}

export async function loadLintItems(projectPath: string): Promise<LintItem[]> {
  const pp = normalizePath(projectPath)
  return await readDurableJson(
    `${pp}/.potato-box/lint.json`,
    isLintItemArray,
    "Lint state",
  ) ?? []
}

interface PersistedChatData {
  conversations: Conversation[]
  messages: DisplayMessage[]
}

function stripPersistedMessageImages(msg: DisplayMessage): DisplayMessage {
  if (!msg.images || msg.images.length === 0) return msg
  const { images: _images, ...rest } = msg
  return rest
}

export async function saveChatHistory(
  projectPath: string,
  conversations: Conversation[],
  messages: DisplayMessage[]
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)

  const safeConversations = conversations.filter((conversation) => isSafeStorageId(conversation.id))
  const safeConversationIds = new Set(safeConversations.map((conversation) => conversation.id))

  // Save conversation list
  await writeFileAtomic(
    `${pp}/.potato-box/conversations.json`,
    JSON.stringify(safeConversations, null, 2)
  )

  // Save each conversation's messages separately
  const byConversation = new Map<string, DisplayMessage[]>()
  for (const msg of messages) {
    if (!safeConversationIds.has(msg.conversationId)) continue
    const list = byConversation.get(msg.conversationId) ?? []
    // Images can be multi-megabyte base64 payloads. Keep them in memory for the
    // current chat turn, but don't persist them into chat JSON where they would
    // quickly bloat auto-save files and project backups.
    list.push(stripPersistedMessageImages(msg))
    byConversation.set(msg.conversationId, list)
  }

  for (const [convId, msgs] of byConversation) {
    // Keep last 100 messages per conversation
    const toSave = msgs.slice(-100)
    await writeFileAtomic(
      chatConversationFilePath(pp, convId),
      JSON.stringify(toSave, null, 2)
    )
  }
}

export async function loadChatHistory(projectPath: string): Promise<PersistedChatData> {
  const pp = normalizePath(projectPath)
  // Try new format: separate files per conversation. A present-but-corrupt
  // file is not treated as a missing file or legacy fallback.
  const conversations = await readDurableJson(
    `${pp}/.potato-box/conversations.json`,
    isConversationArray,
    "Conversation index",
  )
  if (conversations) {
    const allMessages: DisplayMessage[] = []
    for (const conv of conversations) {
      const msgs = await readDurableJson(
        chatConversationFilePath(pp, conv.id),
        (value): value is DisplayMessage[] => isMessageArray(value, conv.id),
        `Chat messages for ${conv.id}`,
      )
      if (msgs) {
        allMessages.push(...msgs)
      }
    }
    return { conversations, messages: allMessages }
  }

  const parsed = await readDurableJson(
    `${pp}/.potato-box/chat-history.json`,
    isLegacyChatShape,
    "Legacy chat history",
  )
  if (parsed !== undefined) {
      if (Array.isArray(parsed)) {
        // Very old format: flat array
        const legacyMessages = sanitizeLegacyMessages(parsed)
        const defaultConv: Conversation = {
          id: "default",
          title: "Previous Conversations",
          createdAt: legacyMessages[0]?.timestamp ?? Date.now(),
          updatedAt: legacyMessages[legacyMessages.length - 1]?.timestamp ?? Date.now(),
        }
        const migratedMessages = legacyMessages.map((m) => ({
          ...m,
          conversationId: "default",
        }))
        return { conversations: [defaultConv], messages: migratedMessages }
      }

      // Old combined format
      const data = parsed as Partial<PersistedChatData>
      const conversations = sanitizeConversations(data.conversations)
      const ids = new Set(conversations.map((conversation) => conversation.id))
      const messages = Array.isArray(data.messages)
        ? data.messages.filter(
            (message): message is DisplayMessage =>
              isDisplayMessage(message) && ids.has(message.conversationId),
          )
        : []
      return { conversations, messages }
  }
  return { conversations: [], messages: [] }
}

export async function saveResearchTasks(
  projectPath: string,
  tasks: ResearchTask[],
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)
  await writeFileAtomic(
    `${pp}/.potato-box/research.json`,
    JSON.stringify(tasks, null, 2),
  )
}

export async function loadResearchTasks(projectPath: string): Promise<ResearchTask[]> {
  const pp = normalizePath(projectPath)
  const tasks = await readDurableJson(
    `${pp}/.potato-box/research.json`,
    isResearchTaskArray,
    "Research tasks",
  ) ?? []
  return tasks.map((task) =>
    ["queued", "searching", "synthesizing", "saving"].includes(task.status)
      ? { ...task, status: "error", error: "Research was interrupted before completion. Start it again from the unresolved review item." }
      : task,
  )
}

export function chatConversationFilePath(projectPath: string, conversationId: string): string {
  const safeId = requireSafeStorageId(conversationId, "conversation id")
  return `${normalizePath(projectPath)}/.potato-box/chats/${safeId}.json`
}

function sanitizeConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return []
  return value.filter((conversation): conversation is Conversation => {
    if (!conversation || typeof conversation !== "object") return false
    const candidate = conversation as Partial<Conversation>
    return (
      isSafeStorageId(candidate.id) &&
      typeof candidate.title === "string" &&
      typeof candidate.createdAt === "number" &&
      Number.isFinite(candidate.createdAt) &&
      typeof candidate.updatedAt === "number" &&
      Number.isFinite(candidate.updatedAt)
    )
  })
}

function isConversationArray(value: unknown): value is Conversation[] {
  return Array.isArray(value) && sanitizeConversations(value).length === value.length
}

function isReviewItemArray(value: unknown): value is ReviewItem[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false
    const candidate = item as Partial<ReviewItem>
    return typeof candidate.id === "string"
      && typeof candidate.type === "string"
      && typeof candidate.title === "string"
      && typeof candidate.resolved === "boolean"
      && typeof candidate.createdAt === "number"
  })
}

function isLintItemArray(value: unknown): value is LintItem[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false
    const candidate = item as Partial<LintItem>
    return typeof candidate.id === "string"
      && typeof candidate.type === "string"
      && typeof candidate.severity === "string"
      && typeof candidate.page === "string"
      && typeof candidate.detail === "string"
      && typeof candidate.createdAt === "number"
  })
}

function isResearchTaskArray(value: unknown): value is ResearchTask[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false
    const candidate = item as Partial<ResearchTask>
    return typeof candidate.id === "string"
      && (candidate.reviewId === undefined || typeof candidate.reviewId === "string")
      && typeof candidate.topic === "string"
      && ["queued", "searching", "synthesizing", "saving", "done", "error"].includes(String(candidate.status))
      && Array.isArray(candidate.webResults)
      && typeof candidate.synthesis === "string"
      && (candidate.savedPath === null || typeof candidate.savedPath === "string")
      && (candidate.error === null || typeof candidate.error === "string")
      && typeof candidate.createdAt === "number"
  })
}

function isDisplayMessage(value: unknown): value is DisplayMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Partial<DisplayMessage>
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant" || message.role === "system") &&
    typeof message.content === "string" &&
    typeof message.timestamp === "number" &&
    Number.isFinite(message.timestamp) &&
    isSafeStorageId(message.conversationId)
  )
}

function isMessageArray(value: unknown, conversationId: string): value is DisplayMessage[] {
  return Array.isArray(value) && value.every(
    (message) => isDisplayMessage(message) && message.conversationId === conversationId,
  )
}

function isLegacyChatShape(
  value: unknown,
): value is DisplayMessage[] | Partial<PersistedChatData> {
  if (Array.isArray(value)) return true
  return Boolean(value && typeof value === "object")
}

function sanitizeLegacyMessages(value: unknown): DisplayMessage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return []
    const message = candidate as Partial<DisplayMessage>
    if (
      typeof message.id !== "string" ||
      (message.role !== "user" && message.role !== "assistant" && message.role !== "system") ||
      typeof message.content !== "string" ||
      typeof message.timestamp !== "number" ||
      !Number.isFinite(message.timestamp)
    ) {
      return []
    }
    return [{ ...message, conversationId: "default" } as DisplayMessage]
  })
}
