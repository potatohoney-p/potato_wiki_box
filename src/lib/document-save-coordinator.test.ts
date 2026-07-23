import { describe, expect, it, vi } from "vitest"
import {
  DocumentSaveCoordinator,
  flushAllDocumentSaves,
  registerDocumentSaveCoordinator,
} from "./document-save-coordinator"

describe("DocumentSaveCoordinator", () => {
  it("keeps writes ordered across document switches", async () => {
    const writes: string[] = []
    const coordinator = new DocumentSaveCoordinator(async (path, contents) => {
      await Promise.resolve()
      writes.push(`${path}:${contents}`)
    })

    coordinator.stage("/project/a.md", "A2")
    const first = coordinator.flush("/project/a.md")
    coordinator.stage("/project/b.md", "B2")
    const second = coordinator.flush("/project/b.md")
    await Promise.all([first, second])

    expect(writes).toEqual(["/project/a.md:A2", "/project/b.md:B2"])
  })

  it("skips a queued snapshot superseded before its write starts", async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const writer = vi.fn(async (path: string) => {
      if (path === "/project/slow.md") await firstGate
    })
    const coordinator = new DocumentSaveCoordinator(writer)

    coordinator.stage("/project/slow.md", "slow")
    const slow = coordinator.flush("/project/slow.md")
    coordinator.stage("/project/page.md", "old")
    const stale = coordinator.flush("/project/page.md")
    coordinator.stage("/project/page.md", "new")
    const latest = coordinator.flush("/project/page.md")
    releaseFirst()
    await Promise.all([slow, stale, latest])

    expect(writer).toHaveBeenCalledWith("/project/slow.md", "slow")
    expect(writer).not.toHaveBeenCalledWith("/project/page.md", "old")
    expect(writer).toHaveBeenCalledWith("/project/page.md", "new")
  })

  it("retains failed contents for an explicit retry", async () => {
    const writer = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined)
    const coordinator = new DocumentSaveCoordinator(writer)
    coordinator.stage("/project/page.md", "draft")

    await expect(coordinator.flush("/project/page.md")).rejects.toThrow("disk full")
    expect(coordinator.hasPending("/project/page.md")).toBe(true)
    await expect(coordinator.flush("/project/page.md")).resolves.toBeUndefined()
    expect(coordinator.hasPending("/project/page.md")).toBe(false)
  })

  it("keeps an unmounted coordinator's in-flight save in the global quit barrier", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const coordinator = new DocumentSaveCoordinator(async () => gate)
    const unregister = registerDocumentSaveCoordinator(coordinator)
    coordinator.stage("/project/page.md", "draft")

    const save = coordinator.flush("/project/page.md")
    unregister()
    let barrierFinished = false
    const barrier = flushAllDocumentSaves().then(() => {
      barrierFinished = true
    })
    await Promise.resolve()
    expect(barrierFinished).toBe(false)

    release()
    await Promise.all([save, barrier])
    expect(barrierFinished).toBe(true)
  })
})
