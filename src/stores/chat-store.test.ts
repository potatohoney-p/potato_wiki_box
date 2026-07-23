import { beforeEach, describe, expect, it } from "vitest"
import { useChatStore } from "./chat-store"

beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    messages: [],
    isStreaming: false,
    streamingContent: "",
    streamingConversationId: null,
  })
})

describe("chat stream ownership", () => {
  it("finalizes into the conversation that started the request", () => {
    const first = useChatStore.getState().createConversation()
    const second = useChatStore.getState().createConversation()
    useChatStore.getState().setActiveConversation(first)
    useChatStore.getState().setStreaming(true, first)
    useChatStore.getState().appendStreamToken("answer", first)
    useChatStore.getState().setActiveConversation(second)
    useChatStore.getState().finalizeStream("answer", undefined, first)

    const assistant = useChatStore.getState().messages.find((message) => message.role === "assistant")
    expect(assistant?.conversationId).toBe(first)
    expect(useChatStore.getState().isStreaming).toBe(false)
  })

  it("ignores stale callbacks after a stream is cancelled", () => {
    const conversationId = useChatStore.getState().createConversation()
    useChatStore.getState().setStreaming(true, conversationId)
    useChatStore.getState().setStreaming(false, conversationId)
    useChatStore.getState().appendStreamToken("late", conversationId)
    useChatStore.getState().finalizeStream("late", undefined, conversationId)

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().streamingContent).toBe("")
  })

  it("clears a stream when its conversation is deleted", () => {
    const conversationId = useChatStore.getState().createConversation()
    useChatStore.getState().setStreaming(true, conversationId)
    useChatStore.getState().deleteConversation(conversationId)
    expect(useChatStore.getState().streamingConversationId).toBeNull()
    expect(useChatStore.getState().isStreaming).toBe(false)
  })
})

describe("chat message identity", () => {
  it("does not reuse restored numeric message IDs", () => {
    const conversationId = useChatStore.getState().createConversation()
    useChatStore.getState().setMessages([{
      id: "1",
      role: "user",
      content: "restored",
      timestamp: 1,
      conversationId,
    }])

    useChatStore.getState().addMessage("user", "new", undefined, conversationId)

    const ids = useChatStore.getState().messages.map((message) => message.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[1]).toMatch(/^msg_[0-9a-f-]{36}$/)
  })

  it("regenerate removal is scoped to the active conversation", () => {
    const first = useChatStore.getState().createConversation()
    const second = useChatStore.getState().createConversation()
    useChatStore.getState().setMessages([
      { id: "duplicate", role: "assistant", content: "first", timestamp: 1, conversationId: first },
      { id: "duplicate", role: "assistant", content: "second", timestamp: 2, conversationId: second },
    ])
    useChatStore.getState().setActiveConversation(first)

    useChatStore.getState().removeLastAssistantMessage()

    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ content: "second", conversationId: second }),
    ])
  })
})
