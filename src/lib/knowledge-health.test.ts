import { describe, expect, it } from "vitest"
import {
  calculateHealthScore,
  calculateProvenanceCoverage,
  projectFileMetrics,
  redactDiagnosticValue,
} from "./knowledge-health"
import type { FileNode } from "@/types/wiki"

const tree: FileNode[] = [{
  name: "project",
  path: "/project",
  is_dir: true,
  children: [
    { name: "a.md", path: "/project/wiki/concepts/a.md", is_dir: false },
    { name: "a.md", path: "/project/wiki/entities/a.md", is_dir: false },
    { name: "overview.md", path: "/project/wiki/overview.md", is_dir: false },
    { name: "index.md", path: "/project/wiki/index.md", is_dir: false },
    { name: "source.pdf", path: "/project/raw/sources/source.pdf", is_dir: false },
  ],
}]

describe("knowledge health", () => {
  it("classifies project files and basename collisions", () => {
    expect(projectFileMetrics(tree)).toMatchObject({
      wikiPages: 3,
      sourceFiles: 1,
      duplicateBasenames: 1,
    })
  })

  it("calculates source provenance coverage", async () => {
    const pages = projectFileMetrics(tree).provenanceMarkdownFiles
    const coverage = await calculateProvenanceCoverage(pages, async (path) =>
      path.includes("concepts") ? "---\nsources: [source.pdf]\n---" : "---\nsources: []\n---",
    )
    expect(coverage).toBe(50)
  })

  it("scores critical failures more heavily than informational orphans", () => {
    const healthy = calculateHealthScore({
      brokenLinks: 0,
      duplicateBasenames: 0,
      failedTasks: 0,
      pendingClips: 0,
      orphanPages: 2,
      provenanceCoverage: 100,
      fileSyncError: false,
    })
    const failing = calculateHealthScore({
      brokenLinks: 2,
      duplicateBasenames: 1,
      failedTasks: 2,
      pendingClips: 1,
      orphanPages: 2,
      provenanceCoverage: 50,
      fileSyncError: true,
    })
    expect(healthy).toBe(98)
    expect(failing).toBeLessThan(50)
  })

  it("redacts secret fields, token-shaped strings, and selected filesystem paths", () => {
    expect(
      redactDiagnosticValue(
        {
          apiToken: "plain-token",
          nested: {
            detail: "failed at C:/Users/me/private with Bearer abc.def and token=secret-value",
            providerError: "key sk-exampletoken123456",
          },
        },
        ["C:/Users/me/private"],
      ),
    ).toEqual({
      apiToken: "[REDACTED]",
      nested: {
        detail: "failed at [REDACTED_PATH] with Bearer [REDACTED] and token=[REDACTED]",
        providerError: "key [REDACTED]",
      },
    })
  })
})
