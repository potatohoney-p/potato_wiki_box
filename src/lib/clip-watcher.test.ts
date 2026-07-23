import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDeferred } from "@/test-helpers/deferred"

const mocks = vi.hoisted(() => ({
  acknowledgeClips: vi.fn(),
  enqueueIngest: vi.fn(),
  getPendingClips: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  acknowledgeClips: mocks.acknowledgeClips,
  getPendingClips: mocks.getPendingClips,
  listDirectory: mocks.listDirectory,
}))
vi.mock("./ingest-queue", () => ({ enqueueIngest: mocks.enqueueIngest }))

import { startClipWatcher, stopClipWatcher } from "./clip-watcher"
import { useWikiStore } from "@/stores/wiki-store"

async function flushPromises(count = 12): Promise<void> {
  for (let index = 0; index < count; index++) await Promise.resolve()
}

describe("clip watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.acknowledgeClips.mockResolvedValue(undefined)
    mocks.enqueueIngest.mockResolvedValue("task")
    mocks.listDirectory.mockResolvedValue([])
    useWikiStore.setState({
      project: { id: "project-a", name: "A", path: "/project-a" },
      fileTree: [],
      llmConfig: {
        provider: "openai",
        apiKey: "key",
        model: "model",
      } as never,
    })
  })

  afterEach(() => {
    stopClipWatcher()
    vi.useRealTimers()
    useWikiStore.setState({ project: null, fileTree: [] })
  })

  it("keeps polling single-flight while a previous request is unresolved", async () => {
    const pending = createDeferred<never[]>()
    mocks.getPendingClips.mockReturnValue(pending.promise)
    startClipWatcher()

    await vi.advanceTimersByTimeAsync(3_000)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(mocks.getPendingClips).toHaveBeenCalledOnce()

    pending.resolve([])
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mocks.getPendingClips).toHaveBeenCalledTimes(2)
  })

  it("does not install an old project's tree after a project switch", async () => {
    const pending = createDeferred<Array<{
      id: string
      projectId: string
      filePath: string
      createdAt: number
    }>>()
    mocks.getPendingClips.mockReturnValue(pending.promise)
    startClipWatcher()
    await vi.advanceTimersByTimeAsync(3_000)

    useWikiStore.setState({
      project: { id: "project-b", name: "B", path: "/project-b" },
    })
    pending.resolve([
      {
        id: "clip-a",
        projectId: "project-a",
        filePath: "/project-a/raw/sources/a.md",
        createdAt: 1,
      },
    ])
    await flushPromises()

    expect(mocks.listDirectory).not.toHaveBeenCalled()
    expect(mocks.enqueueIngest).not.toHaveBeenCalled()
    expect(mocks.acknowledgeClips).not.toHaveBeenCalled()
  })

  it("keeps the durable marker when queue persistence fails", async () => {
    mocks.getPendingClips.mockResolvedValue([
      {
        id: "clip-a",
        projectId: "project-a",
        filePath: "/project-a/raw/sources/a.md",
        createdAt: 1,
      },
    ])
    mocks.enqueueIngest.mockRejectedValue(new Error("disk full"))
    startClipWatcher()

    await vi.advanceTimersByTimeAsync(3_000)
    await flushPromises()

    expect(mocks.enqueueIngest).toHaveBeenCalledOnce()
    expect(mocks.acknowledgeClips).not.toHaveBeenCalled()
  })
})
