import { create } from "zustand"
import type { ChatMessage, ContentBlock } from "@/lib/llm-client"
import i18n from "@/i18n"

/**
 * An image attached to a user message. Field names mirror the
 * `image` variant of `ContentBlock` (see llm-providers.ts) so
 * converting a DisplayMessage into a wire ContentBlock is a no-op
 * spread — no remapping, no `data:` framing here (the provider
 * translators own that).
 */
export interface MessageImage {
  mediaType: string
  dataBase64: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface MessageReference {
  title: string
  path: string
  kind?: "wiki" | "external"
  source?: string
  url?: string
  snippet?: string
}

export interface DisplayMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  conversationId: string
  references?: MessageReference[]  // pages cited in this response, saved at creation time
  images?: MessageImage[]  // images attached to a user message (vision input)
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: DisplayMessage[]
  isStreaming: boolean
  streamingContent: string
  streamingConversationId: string | null
  mode: "chat" | "ingest"
  ingestSource: string | null
  maxHistoryMessages: number

  // Conversation management
  createConversation: () => string
  deleteConversation: (id: string) => void
  setActiveConversation: (id: string | null) => void
  renameConversation: (id: string, title: string) => void

  // Message management
  addMessage: (role: DisplayMessage["role"], content: string, images?: MessageImage[], conversationId?: string) => void
  setMessages: (messages: DisplayMessage[]) => void
  setConversations: (conversations: Conversation[]) => void
  setStreaming: (streaming: boolean, conversationId?: string) => void
  appendStreamToken: (token: string, conversationId?: string) => void
  finalizeStream: (content: string, references?: MessageReference[], conversationId?: string) => void
  setMode: (mode: ChatState["mode"]) => void
  setIngestSource: (path: string | null) => void
  clearMessages: () => void
  setMaxHistoryMessages: (n: number) => void
  removeLastAssistantMessage: () => void  // for regenerate: remove last assistant reply

  // Helpers
  getActiveMessages: () => DisplayMessage[]
}

function nextId(): string {
  return `msg_${crypto.randomUUID()}`
}

function generateConversationId(): string {
  return `conv_${crypto.randomUUID()}`
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: "",
  streamingConversationId: null,
  mode: "chat",
  ingestSource: null,
  maxHistoryMessages: 10,

  createConversation: () => {
    const id = generateConversationId()
    const now = Date.now()
    const newConversation: Conversation = {
      id,
      title: i18n.t("chat.newConversation"),
      createdAt: now,
      updatedAt: now,
    }
    set((state) => ({
      conversations: [newConversation, ...state.conversations],
      activeConversationId: id,
    }))
    return id
  },

  deleteConversation: (id) =>
    set((state) => {
      const remaining = state.conversations.filter((c) => c.id !== id)
      const newActiveId =
        state.activeConversationId === id
          ? (remaining[0]?.id ?? null)
          : state.activeConversationId
      return {
        conversations: remaining,
        messages: state.messages.filter((m) => m.conversationId !== id),
        activeConversationId: newActiveId,
        ...(state.streamingConversationId === id
          ? { isStreaming: false, streamingContent: "", streamingConversationId: null }
          : {}),
      }
    }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  renameConversation: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
      ),
    })),

  addMessage: (role, content, images, conversationId) =>
    set((state) => {
      const targetConversationId = conversationId ?? state.activeConversationId
      const { conversations } = state
      if (!targetConversationId || !conversations.some((conversation) => conversation.id === targetConversationId)) return state

      const newMessage: DisplayMessage = {
        id: nextId(),
        role,
        content,
        timestamp: Date.now(),
        conversationId: targetConversationId,
        ...(images && images.length > 0 ? { images } : {}),
      }

      // Auto-set title from first user message (first 50 chars)
      const convMessages = state.messages.filter(
        (m) => m.conversationId === targetConversationId && m.role === "user"
      )
      const updatedConversations =
        role === "user" && convMessages.length === 0
          ? conversations.map((c) =>
              c.id === targetConversationId
                ? {
                    ...c,
                    // Image-only first message has empty text; fall
                    // back to a generic title so the sidebar entry
                    // isn't blank.
                    title: content.slice(0, 50) || (images && images.length > 0 ? i18n.t("chat.imageMessage") : c.title),
                    updatedAt: Date.now(),
                  }
                : c
            )
          : conversations.map((c) =>
              c.id === targetConversationId
                ? { ...c, updatedAt: Date.now() }
                : c
            )

      return {
        messages: [...state.messages, newMessage],
        conversations: updatedConversations,
      }
    }),

  setMessages: (messages) => set({ messages }),

  setConversations: (conversations) => set({ conversations }),

  setStreaming: (isStreaming, conversationId) =>
    set((state) => {
      if (isStreaming) {
        const target = conversationId ?? state.activeConversationId
        if (!target || !state.conversations.some((conversation) => conversation.id === target)) {
          return { isStreaming: false, streamingContent: "", streamingConversationId: null }
        }
        return { isStreaming: true, streamingContent: "", streamingConversationId: target }
      }
      if (conversationId && state.streamingConversationId !== conversationId) return state
      return { isStreaming: false, streamingContent: "", streamingConversationId: null }
    }),

  appendStreamToken: (token, conversationId) =>
    set((state) => {
      const target = conversationId ?? state.streamingConversationId
      if (!state.isStreaming || !target || state.streamingConversationId !== target) return state
      return { streamingContent: state.streamingContent + token }
    }),

  finalizeStream: (content, references, conversationId) =>
    set((state) => {
      const targetConversationId = conversationId ?? state.streamingConversationId
      const { conversations } = state
      if (
        !targetConversationId ||
        state.streamingConversationId !== targetConversationId ||
        !conversations.some((conversation) => conversation.id === targetConversationId)
      ) {
        return {
          ...(state.streamingConversationId === targetConversationId
            ? { isStreaming: false, streamingContent: "", streamingConversationId: null }
            : {}),
        }
      }

      const newMessage: DisplayMessage = {
        id: nextId(),
        role: "assistant" as const,
        content,
        timestamp: Date.now(),
        conversationId: targetConversationId,
        references,
      }

      return {
        isStreaming: false,
        streamingContent: "",
        streamingConversationId: null,
        messages: [...state.messages, newMessage],
        conversations: conversations.map((c) =>
          c.id === targetConversationId
            ? { ...c, updatedAt: Date.now() }
            : c
        ),
      }
    }),

  setMode: (mode) => set({ mode }),

  setIngestSource: (ingestSource) => set({ ingestSource }),

  clearMessages: () =>
    set((state) => ({
      messages: state.messages.filter(
        (m) => m.conversationId !== state.activeConversationId
      ),
    })),

  setMaxHistoryMessages: (maxHistoryMessages) => set({ maxHistoryMessages }),

  removeLastAssistantMessage: () =>
    set((state) => {
      const activeId = state.activeConversationId
      if (!activeId) return state
      const activeMessages = state.messages.filter((m) => m.conversationId === activeId)
      // Find last assistant message
      const lastAssistantIdx = [...activeMessages].reverse().findIndex((m) => m.role === "assistant")
      if (lastAssistantIdx === -1) return state
      const msgToRemove = activeMessages[activeMessages.length - 1 - lastAssistantIdx]
      return {
        messages: state.messages.filter(
          (message) =>
            message.conversationId !== activeId || message.id !== msgToRemove.id,
        ),
      }
    }),

  getActiveMessages: () => {
    const { messages, activeConversationId } = get()
    if (!activeConversationId) return []
    return messages.filter((m) => m.conversationId === activeConversationId)
  },
}))

export function chatMessagesToLLM(messages: DisplayMessage[]): ChatMessage[] {
  return messages.map((m) => {
    // No images → keep the legacy string shape. Providers and the
    // single-string fast paths in the translators stay unchanged,
    // and existing tests that assert `content: "..."` keep passing.
    if (!m.images || m.images.length === 0) {
      return { role: m.role, content: m.content }
    }
    // Images present → emit a ContentBlock[]. Text first (so the
    // model reads the prompt before the images), then one image
    // block per attachment. An empty text (image-only message)
    // still gets a text block — harmless, and keeps the shape
    // uniform.
    const blocks: ContentBlock[] = [
      { type: "text", text: m.content },
      ...m.images.map((img): ContentBlock => ({
        type: "image",
        mediaType: img.mediaType,
        dataBase64: img.dataBase64,
      })),
    ]
    return { role: m.role, content: blocks }
  })
}
