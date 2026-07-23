import { describe, it, expect, beforeEach, vi } from "vitest"
import { resetProjectState } from "./reset-project-state"
import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { useActivityStore } from "@/stores/activity-store"
import { useResearchStore } from "@/stores/research-store"
import { useWikiStore } from "@/stores/wiki-store"
import { pauseQueue, restoreQueue } from "./ingest-queue"
import {
  pauseQueue as pauseDedupQueue,
  restoreQueue as restoreDedupQueue,
} from "./dedup-queue"
import { startProjectFileSync, stopProjectFileSync } from "./project-file-sync"
import { startScheduledImport, stopScheduledImport } from "./scheduled-import"

// Dynamic-import mocks: resetProjectState uses `import("@/lib/ingest-queue")`
// and `import("@/lib/graph-relevance")` at runtime. vi.mock hoists these
// so the promise resolves to our stub immediately.
vi.mock("./ingest-queue", async () => {
  const actual = await vi.importActual<typeof import("./ingest-queue")>("./ingest-queue")
  return {
    ...actual,
    pauseQueue: vi.fn(async () => {}),
    restoreQueue: vi.fn(async () => {}),
  }
})
vi.mock("./dedup-queue", () => ({
  pauseQueue: vi.fn(async () => {}),
  restoreQueue: vi.fn(async () => {}),
}))

vi.mock("./project-file-sync", () => ({
  startProjectFileSync: vi.fn(async () => {}),
  stopProjectFileSync: vi.fn(async () => {}),
}))

vi.mock("./scheduled-import", () => ({
  startScheduledImport: vi.fn(),
  stopScheduledImport: vi.fn(),
}))

vi.mock("./graph-relevance", () => ({
  clearGraphCache: vi.fn(),
}))

import { clearGraphCache } from "./graph-relevance"

const mockPauseQueue = vi.mocked(pauseQueue)
const mockRestoreQueue = vi.mocked(restoreQueue)
const mockPauseDedupQueue = vi.mocked(pauseDedupQueue)
const mockRestoreDedupQueue = vi.mocked(restoreDedupQueue)
const mockStartProjectFileSync = vi.mocked(startProjectFileSync)
const mockStopProjectFileSync = vi.mocked(stopProjectFileSync)
const mockStartScheduledImport = vi.mocked(startScheduledImport)
const mockStopScheduledImport = vi.mocked(stopScheduledImport)
const mockClearGraphCache = vi.mocked(clearGraphCache)

beforeEach(() => {
  mockPauseQueue.mockReset()
  mockPauseQueue.mockImplementation(async () => {})
  mockRestoreQueue.mockReset()
  mockRestoreQueue.mockImplementation(async () => {})
  mockPauseDedupQueue.mockReset()
  mockPauseDedupQueue.mockImplementation(async () => {})
  mockRestoreDedupQueue.mockReset()
  mockRestoreDedupQueue.mockImplementation(async () => {})
  mockStartProjectFileSync.mockReset()
  mockStartProjectFileSync.mockImplementation(async () => {})
  mockStopProjectFileSync.mockReset()
  mockStopProjectFileSync.mockImplementation(async () => {})
  mockStartScheduledImport.mockReset()
  mockStopScheduledImport.mockReset()
  mockClearGraphCache.mockReset()
  useWikiStore.getState().setProject(null)
})

describe("resetProjectState — Zustand stores", () => {
  it("clears chat store conversations and messages", async () => {
    useChatStore.setState({
      conversations: [{ id: "c1", title: "x", createdAt: 0, updatedAt: 0 }],
      messages: [
        { id: "m1", role: "user", content: "hi", timestamp: 0, conversationId: "c1" },
      ],
      activeConversationId: "c1",
      isStreaming: true,
      streamingContent: "partial",
      mode: "ingest",
      ingestSource: "/some/file",
    })

    await resetProjectState()

    const chat = useChatStore.getState()
    expect(chat.conversations).toEqual([])
    expect(chat.messages).toEqual([])
    expect(chat.activeConversationId).toBeNull()
    expect(chat.isStreaming).toBe(false)
    expect(chat.streamingContent).toBe("")
    expect(chat.mode).toBe("chat")
    expect(chat.ingestSource).toBeNull()
  })

  it("clears review store items", async () => {
    useReviewStore.setState({
      items: [
        {
          id: "r1",
          type: "missing-page",
          title: "x",
          description: "",
          options: [],
          resolved: false,
          createdAt: 0,
        },
      ],
    })

    await resetProjectState()
    expect(useReviewStore.getState().items).toEqual([])
  })

  it("clears activity store items", async () => {
    useActivityStore.setState({
      items: [
        {
          id: "a1",
          type: "query",
          title: "t",
          status: "done",
          detail: "",
          filesWritten: [],
          createdAt: 0,
        },
      ],
    })

    await resetProjectState()
    expect(useActivityStore.getState().items).toEqual([])
  })

  it("clears research store tasks and closes panel", async () => {
    useResearchStore.setState({
      tasks: [
        {
          id: "t1",
          type: "gap",
          topic: "x",
          searchQueries: [],
          status: "pending",
          createdAt: 0,
        } as unknown as ReturnType<typeof useResearchStore.getState>["tasks"][number],
      ],
      panelOpen: true,
    })

    await resetProjectState()
    expect(useResearchStore.getState().tasks).toEqual([])
    expect(useResearchStore.getState().panelOpen).toBe(false)
  })
})

describe("resetProjectState — module-level caches are awaited", () => {
  it("calls pauseQueue before the returned promise resolves", async () => {
    await resetProjectState()
    expect(mockPauseQueue).toHaveBeenCalledOnce()
  })

  it("calls clearGraphCache before the returned promise resolves", async () => {
    await resetProjectState()
    expect(mockClearGraphCache).toHaveBeenCalledOnce()
  })

  it("ordering: when resolve() fires, BOTH module caches are already cleared", async () => {
    // This is the regression guard against fire-and-forget resets.
    // By the time the outer await returns, BOTH clears must be done.
    await resetProjectState()
    expect(mockPauseQueue).toHaveBeenCalledOnce()
    expect(mockClearGraphCache).toHaveBeenCalledOnce()
  })

  it("rejects and preserves stores when the ingest durability barrier fails", async () => {
    useChatStore.setState({
      conversations: [{ id: "keep", title: "keep", createdAt: 0, updatedAt: 0 }],
    })
    mockPauseQueue.mockImplementationOnce(async () => {
      throw new Error("disk full")
    })

    await expect(resetProjectState()).rejects.toThrow("disk full")
    expect(useChatStore.getState().conversations[0]?.id).toBe("keep")
    expect(mockPauseDedupQueue).not.toHaveBeenCalled()
    expect(mockClearGraphCache).not.toHaveBeenCalled()
  })

  it("restores a paused ingest queue when the dedup barrier fails", async () => {
    useWikiStore.getState().setProject({
      id: "project-id",
      name: "Project",
      path: "C:/project",
    })
    mockPauseDedupQueue.mockRejectedValueOnce(new Error("dedup disk full"))

    await expect(resetProjectState()).rejects.toThrow("dedup disk full")

    expect(mockRestoreQueue).toHaveBeenCalledWith("project-id", "C:/project")
    expect(mockRestoreDedupQueue).not.toHaveBeenCalled()
    expect(mockStopProjectFileSync).toHaveBeenCalledOnce()
    expect(mockStopScheduledImport).toHaveBeenCalledOnce()
  })

  it("does not throw when clearGraphCache itself throws", async () => {
    mockClearGraphCache.mockImplementationOnce(() => {
      throw new Error("boom")
    })
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(resetProjectState()).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe("resetProjectState — leaves unrelated store keys alone", () => {
  it("preserves maxHistoryMessages on chat store (config, not project data)", async () => {
    useChatStore.setState({ maxHistoryMessages: 42 })
    await resetProjectState()
    expect(useChatStore.getState().maxHistoryMessages).toBe(42)
  })
})
