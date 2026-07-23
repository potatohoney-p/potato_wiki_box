import type { FileNode } from "@/types/wiki"
import type { LintResult } from "@/lib/lint"

export interface ProjectFileMetrics {
  wikiPages: number
  sourceFiles: number
  mediaFiles: number
  duplicateBasenames: number
  wikiMarkdownFiles: FileNode[]
  provenanceMarkdownFiles: FileNode[]
}

export interface HealthScoreInput {
  brokenLinks: number
  duplicateBasenames: number
  failedTasks: number
  pendingClips: number
  orphanPages: number
  provenanceCoverage: number
  fileSyncError: boolean
}

export function flattenProjectFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) files.push(...flattenProjectFiles(node.children ?? []))
    else files.push(node)
  }
  return files
}

export function projectFileMetrics(nodes: FileNode[]): ProjectFileMetrics {
  const files = flattenProjectFiles(nodes)
  const wikiMarkdownFiles = files.filter((file) => /[/\\]wiki[/\\].+\.md$/i.test(file.path))
  const visiblePages = wikiMarkdownFiles.filter(
    (file) => !/(?:^|[/\\])(index|log)\.md$/i.test(file.path),
  )
  const provenancePages = visiblePages.filter(
    (file) => !/(?:^|[/\\])overview\.md$/i.test(file.path),
  )
  const basenameCounts = new Map<string, number>()
  for (const page of visiblePages) {
    const basename = page.name.toLowerCase()
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1)
  }
  return {
    wikiPages: visiblePages.length,
    sourceFiles: files.filter((file) => /[/\\]raw[/\\]sources[/\\]/i.test(file.path)).length,
    mediaFiles: files.filter((file) => /[/\\]wiki[/\\]media[/\\]/i.test(file.path)).length,
    duplicateBasenames: [...basenameCounts.values()].filter((count) => count > 1).length,
    wikiMarkdownFiles: visiblePages,
    provenanceMarkdownFiles: provenancePages,
  }
}

export function lintMetrics(results: LintResult[]): { brokenLinks: number; orphanPages: number } {
  return {
    brokenLinks: results.filter((result) => result.type === "broken-link").length,
    orphanPages: results.filter((result) => result.type === "orphan").length,
  }
}

export async function calculateProvenanceCoverage(
  pages: FileNode[],
  read: (path: string) => Promise<string>,
): Promise<number> {
  if (pages.length === 0) return 100
  let withSources = 0
  const workers = Array.from({ length: Math.min(8, pages.length) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < pages.length; index += 8) {
      try {
        const content = await read(pages[index].path)
        const sources = /^sources:\s*(.+)$/im.exec(content)?.[1]?.trim()
        if (sources && sources !== "[]" && sources !== "null") withSources++
      } catch {
        // Unreadable pages lower coverage; the diagnostics report surfaces the
        // same condition through file-sync and lint findings.
      }
    }
  })
  await Promise.all(workers)
  return Math.round((withSources / pages.length) * 100)
}

export function calculateHealthScore(input: HealthScoreInput): number {
  const provenancePenalty = Math.round(Math.max(0, 80 - input.provenanceCoverage) * 0.35)
  const penalty =
    Math.min(30, input.brokenLinks * 5) +
    Math.min(15, input.duplicateBasenames * 5) +
    Math.min(25, input.failedTasks * 8) +
    Math.min(10, input.pendingClips * 2) +
    Math.min(10, input.orphanPages) +
    provenancePenalty +
    (input.fileSyncError ? 15 : 0)
  return Math.max(0, Math.min(100, 100 - penalty))
}

const SENSITIVE_KEY_RE = /(?:api.?key|authorization|cookie|password|secret|token)/i
const LABELED_SECRET_RE = /((?:api[_ -]?key|authorization|password|secret|token)\s*[=:]\s*)\S+/gi
const COMMON_TOKEN_RE = /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g

export function redactDiagnosticValue(value: unknown, sensitiveValues: string[] = []): unknown {
  if (typeof value === "string") {
    let redacted = value
    for (const sensitive of sensitiveValues.filter((candidate) => candidate.length >= 3)) {
      redacted = redacted.split(sensitive).join("[REDACTED_PATH]")
      redacted = redacted.split(sensitive.replace(/\\/g, "/")).join("[REDACTED_PATH]")
    }
    return redacted
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(LABELED_SECRET_RE, "$1[REDACTED]")
      .replace(COMMON_TOKEN_RE, "[REDACTED]")
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item, sensitiveValues))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : redactDiagnosticValue(item, sensitiveValues),
      ]),
    )
  }
  return value
}
