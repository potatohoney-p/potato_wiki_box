import { normalizePath } from "@/lib/path-utils"

export function wikiPageIdFromPath(path: string, wikiRoot: string): string {
  const normalizedPath = normalizePath(path)
  const normalizedRoot = normalizePath(wikiRoot).replace(/\/+$/, "")
  const relative = normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath.split("/").pop() ?? normalizedPath
  return relative.replace(/\.md$/i, "")
}

export function vectorPageIdFromPath(path: string, wikiRoot: string): string {
  return wikiPageIdFromPath(path, wikiRoot)
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
}

export function resolveWikiPageId(
  rawTarget: string,
  ids: Iterable<string>,
): string | null {
  const values = [...ids]
  const normalizedRaw = normalizePath(rawTarget)
    .replace(/^\/+/, "")
    .replace(/^wiki\//i, "")
    .replace(/\.md$/i, "")
  const canonical = (value: string) => value.toLowerCase().replace(/\s+/g, "-")

  const exact = values.filter((id) => canonical(id) === canonical(normalizedRaw))
  if (exact.length === 1) return exact[0]

  const rawBase = normalizedRaw.split("/").pop() ?? normalizedRaw
  const basenameMatches = values.filter((id) => {
    const base = id.split("/").pop() ?? id
    return canonical(base) === canonical(rawBase)
  })
  return basenameMatches.length === 1 ? basenameMatches[0] : null
}
