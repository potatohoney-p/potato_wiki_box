import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  listDirectory: vi.fn(),
  mergeDuplicateGroup: vi.fn(),
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  deleteFile: mocks.deleteFile,
  listDirectory: mocks.listDirectory,
  readFile: mocks.readFile,
  writeFileAtomic: mocks.writeFileAtomic,
}))
vi.mock("./dedup", () => ({
  detectDuplicateGroups: vi.fn(),
  extractEntitySummary: vi.fn(),
  mergeDuplicateGroup: mocks.mergeDuplicateGroup,
  rewriteIndexMd: (content: string) => content,
}))
vi.mock("./llm-client", () => ({ streamChat: vi.fn() }))
vi.mock("@/lib/project-store", () => ({ loadEmbeddingConfig: vi.fn() }))
vi.mock("./dedup-storage", () => ({ loadNotDuplicates: vi.fn() }))
vi.mock("@/lib/dedup_embedding", () => ({
  candidatePairs: vi.fn(),
  clusterByPairs: vi.fn(),
  DuplicatePrefilterCancelledError: class DuplicatePrefilterCancelledError extends Error {},
}))

import { executeMerge } from "./dedup-runner"

describe("executeMerge transaction", () => {
  const projectPath = "/project"
  const original = new Map<string, string>([
    ["/project/wiki/entities/a.md", "a-old"],
    ["/project/wiki/entities/b.md", "b-old"],
    ["/project/wiki/concepts/ref.md", "ref-old"],
    ["/project/wiki/index.md", "index-old"],
  ])
  let disk: Map<string, string>

  beforeEach(() => {
    vi.clearAllMocks()
    disk = new Map(original)
    mocks.listDirectory.mockResolvedValue(
      [...original.keys()].map((path) => ({
        name: path.split("/").pop() ?? "page.md",
        path,
        is_dir: false,
        children: [],
      })),
    )
    mocks.readFile.mockImplementation(async (path: string) => {
      const content = disk.get(path)
      if (content === undefined) throw new Error("missing")
      return content
    })
    mocks.deleteFile.mockImplementation(async (path: string) => {
      disk.delete(path)
    })
    mocks.mergeDuplicateGroup.mockResolvedValue({
      canonicalContent: "a-merged",
      canonicalPath: "wiki/entities/a.md",
      rewrites: [{ path: "wiki/concepts/ref.md", newContent: "ref-new" }],
      pagesToDelete: ["wiki/entities/b.md"],
      backup: [
        { path: "wiki/entities/a.md", content: "a-old" },
        { path: "wiki/entities/b.md", content: "b-old" },
        { path: "wiki/concepts/ref.md", content: "ref-old" },
      ],
    })
  })

  it("restores every earlier page when a later atomic write fails", async () => {
    let failed = false
    mocks.writeFileAtomic.mockImplementation(async (path: string, content: string) => {
      if (path === "/project/wiki/concepts/ref.md" && content === "ref-new" && !failed) {
        failed = true
        throw new Error("disk full")
      }
      disk.set(path, content)
    })

    await expect(
      executeMerge(
        projectPath,
        { slugs: ["a", "b"], confidence: "high", reason: "same" },
        "a",
        { provider: "openai", apiKey: "key", model: "model" } as never,
      ),
    ).rejects.toThrow("disk full")

    for (const [path, content] of original) {
      expect(disk.get(path)).toBe(content)
    }
  })
})
