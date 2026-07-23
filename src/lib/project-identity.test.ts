import { beforeEach, describe, expect, it, vi } from "vitest"

const { fileExists, readFile, writeFileAtomic } = vi.hoisted(() => ({
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({ fileExists, readFile, writeFileAtomic }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }))

import { ensureProjectId } from "./project-identity"

describe("project identity", () => {
  beforeEach(() => {
    fileExists.mockReset()
    readFile.mockReset()
    writeFileAtomic.mockReset()
    fileExists.mockResolvedValue(true)
  })

  it("reuses a valid persisted UUID", async () => {
    const id = "8ca1af44-0aac-4df6-8a15-3fb516eb2c58"
    readFile.mockResolvedValue(JSON.stringify({ id, createdAt: 1 }))

    await expect(ensureProjectId("/project/existing")).resolves.toBe(id)
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })

  it("blocks an invalid identity without replacing it", async () => {
    readFile.mockResolvedValue(JSON.stringify({ id: "not-a-uuid", createdAt: 1 }))

    await expect(ensureProjectId("/project/corrupt")).rejects.toThrow("invalid UUID")

    expect(writeFileAtomic).not.toHaveBeenCalled()
  })

  it("blocks malformed JSON without replacing it", async () => {
    readFile.mockResolvedValue('{"id":')

    await expect(ensureProjectId("/project/truncated")).rejects.toThrow("malformed")
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })

  it("does not return an unstable UUID when persistence fails", async () => {
    fileExists.mockResolvedValue(false)
    writeFileAtomic.mockRejectedValue(new Error("read only"))

    await expect(ensureProjectId("/project/read-only")).rejects.toThrow("read only")
  })

  it("deduplicates concurrent identity creation in one app process", async () => {
    fileExists.mockResolvedValue(false)
    let releaseWrite!: () => void
    writeFileAtomic.mockImplementation(
      () => new Promise<void>((resolve) => { releaseWrite = resolve }),
    )

    const first = ensureProjectId("/project/concurrent")
    const second = ensureProjectId("/project/concurrent")
    await vi.waitFor(() => expect(writeFileAtomic).toHaveBeenCalledOnce())
    releaseWrite()

    await expect(Promise.all([first, second])).resolves.toSatisfy(
      ([left, right]: string[]) => left === right && UUID_RE_FOR_TEST.test(left),
    )
  })
})

const UUID_RE_FOR_TEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
