import JSZip from "jszip"
import type { MineruConfig } from "@/stores/wiki-store"
import { createDirectory, getFileSize, readFileAsBase64, writeFileBase64 } from "@/commands/fs"
import { getHttpFetch } from "@/lib/tauri-fetch"
import { getFileName, normalizePath } from "@/lib/path-utils"

const API_BASE = "https://mineru.net/api/v4"
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 300_000 // 5 minutes
const MAX_ACCURATE_PARSE_BYTES = 200 * 1024 * 1024
const MINERU_IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "tif",
  "tiff",
])

// ── Types ──

interface TaskResponse {
  code: number | string
  data: { task_id: string }
  msg: string
}

type MineruTaskState = "pending" | "running" | "converting" | "done" | "failed" | "waiting-file"

interface TaskStatus {
  code: number | string
  data: {
    task_id: string
    state: MineruTaskState
    full_zip_url?: string
    err_msg?: string
    extract_progress?: { extracted_pages: number; total_pages: number }
  }
  msg: string
}

interface BatchStatus {
  code: number | string
  data: {
    batch_id: string
    extract_result: Array<{
      file_name: string
      state: MineruTaskState
      full_zip_url?: string
      err_msg?: string
    }>
  }
  msg: string
}

interface UploadUrlResponse {
  code: number | string
  data: {
    batch_id: string
    file_urls: string[]
  }
  msg: string
}

interface MineruAssetOptions {
  projectPath: string
  sourceSummarySlug: string
}

// ── API calls ──

async function mineruHeaders(token: string): Promise<HeadersInit> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

function mineruApiErrorMessage(code: number | string | undefined, msg?: string): string {
  const key = String(code ?? "")
  const known: Record<string, string> = {
    A0202: "MinerU token is invalid. Check the API token in Settings.",
    A0211: "MinerU token has expired. Create a new API token and update Settings.",
    "-60005": "MinerU rejected the file because it is larger than 200 MB.",
    "-60006": "MinerU rejected the file because it exceeds the 200 page limit.",
    "-60018": "MinerU daily parsing quota has been reached.",
  }
  const knownMessage = known[key]
  if (knownMessage) return msg ? `${knownMessage} (${msg})` : knownMessage
  return msg ? `MinerU API error ${key || "unknown"}: ${msg}` : `MinerU API error ${key || "unknown"}`
}

function assertMineruSuccess(json: { code: number | string; msg?: string }): void {
  if (json.code !== 0 && json.code !== "0") {
    throw new Error(mineruApiErrorMessage(json.code, json.msg))
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("MinerU parsing cancelled")
  }
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  if (typeof atob !== "function") {
    throw new Error("Base64 decoding is not available in this runtime")
  }
  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

function bytesToUploadBody(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function safeMineruAssetSegment(segment: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })()
  const cleaned = decoded
    .replace(/[<>:"|?*\x00-\x1f]/g, "_")
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+$/, "_")
    .replace(/[. ]+$/g, "_")
  if (!cleaned) return "asset"
  if (cleaned.length <= 80) return cleaned

  const dot = cleaned.lastIndexOf(".")
  if (dot > 0 && dot < cleaned.length - 1) {
    const ext = cleaned.slice(dot).slice(0, 16)
    return `${cleaned.slice(0, Math.max(1, 80 - ext.length))}${ext}`
  }
  return cleaned.slice(0, 80)
}

function normalizeMineruZipPath(path: string): string {
  return normalizePath(path)
    .replace(/^\.\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
}

function decodeMineruPath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function isMineruImagePath(path: string): boolean {
  const ext = getFileName(path).split(".").pop()?.toLowerCase() ?? ""
  return MINERU_IMAGE_EXTS.has(ext)
}

function mineruAssetRelPath(sourceSummarySlug: string, zipPath: string): string {
  const safeParts = normalizeMineruZipPath(zipPath)
    .split("/")
    .map(safeMineruAssetSegment)
    .filter(Boolean)
  const safePath = safeParts.length > 0 ? safeParts.join("/") : "image.png"
  return `media/${sourceSummarySlug}/mineru/${safePath}`
}

function isExternalOrDataUrl(url: string): boolean {
  return /^(https?:|data:|blob:|file:|tauri:|asset:)/i.test(url)
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  }

  return text.replace(
    /&(?:amp|apos|gt|lt|nbsp|quot|#(?:\d+|x[0-9a-f]+));/gi,
    (entity) => {
      const named = namedEntities[entity.slice(1, -1).toLowerCase()]
      if (named !== undefined) return named

      const numeric = /^&#(x?)([0-9a-f]+);$/i.exec(entity)
      if (!numeric) return entity
      const radix = numeric[1] ? 16 : 10
      const codePoint = Number.parseInt(numeric[2], radix)
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return entity
      }
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        return entity
      }
    },
  )
}

function isAsciiLetter(char: string | undefined): boolean {
  if (!char) return false
  const code = char.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isHtmlNameChar(char: string | undefined): boolean {
  if (!char) return false
  const code = char.charCodeAt(0)
  return isAsciiLetter(char)
    || (code >= 48 && code <= 57)
    || char === "-"
    || char === "_"
    || char === ":"
}

function findHtmlTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null
  for (let index = start + 1; index < html.length; index += 1) {
    const char = html[index]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === ">") {
      return index
    }
  }
  return -1
}

interface ParsedHtmlTag {
  closing: boolean
  end: number
  name: string
  raw: string
}

function parseHtmlTagAt(html: string, start: number): ParsedHtmlTag | null {
  if (html[start] !== "<") return null

  const end = findHtmlTagEnd(html, start)
  if (end < 0) return null

  let cursor = start + 1
  let closing = false
  if (html[cursor] === "/") {
    closing = true
    cursor += 1
  }

  if (html[cursor] === "!" || html[cursor] === "?") {
    return { closing, end, name: "", raw: html.slice(start, end + 1) }
  }
  if (!isAsciiLetter(html[cursor])) return null

  const nameStart = cursor
  while (cursor < end && isHtmlNameChar(html[cursor])) cursor += 1
  return {
    closing,
    end,
    name: html.slice(nameStart, cursor).toLowerCase(),
    raw: html.slice(start, end + 1),
  }
}

function parseHtmlAttributes(rawTag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  let cursor = 1

  if (rawTag[cursor] === "/") cursor += 1
  while (cursor < rawTag.length && isHtmlNameChar(rawTag[cursor])) cursor += 1

  while (cursor < rawTag.length - 1) {
    while (cursor < rawTag.length && (/\s/.test(rawTag[cursor]) || rawTag[cursor] === "/")) {
      cursor += 1
    }
    if (cursor >= rawTag.length - 1) break

    const nameStart = cursor
    while (cursor < rawTag.length && isHtmlNameChar(rawTag[cursor])) cursor += 1
    if (cursor === nameStart) {
      cursor += 1
      continue
    }
    const name = rawTag.slice(nameStart, cursor).toLowerCase()

    while (cursor < rawTag.length && /\s/.test(rawTag[cursor])) cursor += 1
    let value = ""
    if (rawTag[cursor] === "=") {
      cursor += 1
      while (cursor < rawTag.length && /\s/.test(rawTag[cursor])) cursor += 1
      const quote = rawTag[cursor]
      if (quote === '"' || quote === "'") {
        cursor += 1
        const valueStart = cursor
        while (cursor < rawTag.length && rawTag[cursor] !== quote) cursor += 1
        value = rawTag.slice(valueStart, cursor)
        if (rawTag[cursor] === quote) cursor += 1
      } else {
        const valueStart = cursor
        while (
          cursor < rawTag.length
          && !/\s/.test(rawTag[cursor])
          && rawTag[cursor] !== ">"
        ) {
          cursor += 1
        }
        value = rawTag.slice(valueStart, cursor)
      }
    }
    if (!attributes.has(name)) attributes.set(name, value)
  }

  return attributes
}

function escapeMarkdownTableText(text: string): string {
  return decodeHtmlEntities(text).replace(/[\\[\]|<>]/g, (char) => {
    if (char === "<") return "&lt;"
    if (char === ">") return "&gt;"
    return `\\${char}`
  })
}

function isSafeMarkdownImageSource(source: string): boolean {
  try {
    const url = new URL(source, "https://potato-box.invalid/")
    const protocol = url.protocol.toLowerCase()
    if (protocol === "http:" || protocol === "https:") return true
    return protocol === "data:"
      && /^data:image\/(?:bmp|gif|jpe?g|png|tiff?|webp);base64,/i.test(source)
  } catch {
    return false
  }
}

function imageTagToMarkdown(rawTag: string): string {
  const attributes = parseHtmlAttributes(rawTag)
  const rawSrc = attributes.get("src")
  if (!rawSrc) return ""

  const decodedSrc = decodeHtmlEntities(rawSrc).trim()
  if (!decodedSrc || !isSafeMarkdownImageSource(decodedSrc)) return ""

  const src = decodedSrc
    .replace(/[\u0000-\u0020"'()<>\\\u007f]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
    )

  const alt = decodeHtmlEntities(attributes.get("alt") ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\[\]|<>]/g, (char) => {
      if (char === "<") return "&lt;"
      if (char === ">") return "&gt;"
      return `\\${char}`
    })
  return `![${alt}](${src})`
}

function htmlCellToMarkdown(cell: string): string {
  let markdown = ""
  let cursor = 0

  while (cursor < cell.length) {
    const tagStart = cell.indexOf("<", cursor)
    if (tagStart < 0) {
      markdown += escapeMarkdownTableText(cell.slice(cursor))
      break
    }

    markdown += escapeMarkdownTableText(cell.slice(cursor, tagStart))

    if (cell.startsWith("<!--", tagStart)) {
      const commentEnd = cell.indexOf("-->", tagStart + 4)
      if (commentEnd < 0) break
      cursor = commentEnd + 3
      continue
    }

    const tag = parseHtmlTagAt(cell, tagStart)
    if (!tag) {
      markdown += "&lt;"
      cursor = tagStart + 1
      continue
    }

    if (!tag.closing && tag.name === "img") {
      markdown += imageTagToMarkdown(tag.raw)
    } else if (tag.name === "br" || (tag.closing && tag.name === "p")) {
      markdown += " "
    }
    cursor = tag.end + 1
  }

  return markdown.replace(/\s+/g, " ").trim()
}

function convertHtmlTablesInSegment(segment: string): string {
  return segment.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rows: string[][] = []
    for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[1] ?? ""
      const cells: string[] = []
      for (const cellMatch of rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
        cells.push(htmlCellToMarkdown(cellMatch[1] ?? ""))
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length === 0) return tableHtml

    const width = Math.max(...rows.map((row) => row.length))
    const padded = rows.map((row) => {
      const out = [...row]
      while (out.length < width) out.push("")
      return out
    })
    const header = padded[0]
    const separator = Array.from({ length: width }, () => "---")
    const body = padded.slice(1)
    return [
      "",
      `| ${header.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...body.map((row) => `| ${row.join(" | ")} |`),
      "",
    ].join("\n")
  })
}

function convertHtmlTablesToMarkdown(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment) => (
      segment.startsWith("```") || segment.startsWith("~~~")
        ? segment
        : convertHtmlTablesInSegment(segment)
    ))
    .join("")
}

function encodeMarkdownImageUrl(relPath: string): string {
  return relPath
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/")
}

function rewriteMineruMarkdownImages(markdown: string, pathMap: Map<string, string>): string {
  const lookup = (rawUrl: string): string | null => {
    if (!rawUrl || isExternalOrDataUrl(rawUrl)) return null
    const cleaned = normalizeMineruZipPath(rawUrl.split("#")[0])
    if (!cleaned) return null
    const decoded = decodeMineruPath(cleaned)
    return pathMap.get(cleaned) ?? pathMap.get(decoded) ?? pathMap.get(getFileName(decoded)) ?? null
  }

  const withMarkdownImages = markdown.replace(
    /!\[([^\]]*)]\(((?:[^()]|\([^()]*\))*)\)/g,
    (full, alt: string, target: string) => {
      const trimmed = target.trim()
      const candidates: Array<{ url: string; suffix: string }> = []
      if (trimmed.startsWith("<") && trimmed.includes(">")) {
        const end = trimmed.indexOf(">")
        candidates.push({ url: trimmed.slice(1, end), suffix: trimmed.slice(end + 1) })
      } else {
        const titleMatch = trimmed.match(/^([\s\S]+?)(\s+["'][^"']*["']\s*)$/)
        if (titleMatch) candidates.push({ url: titleMatch[1].trim(), suffix: titleMatch[2] })
        candidates.push({ url: trimmed, suffix: "" })
        const tokenMatch = trimmed.match(/^(\S+)([\s\S]*)$/)
        if (tokenMatch) candidates.push({ url: tokenMatch[1], suffix: tokenMatch[2] })
      }

      for (const candidate of candidates) {
        const rel = lookup(candidate.url)
        if (!rel) continue
        const rewrittenTarget = `${encodeMarkdownImageUrl(rel)}${candidate.suffix}`
        return `![${alt}](${rewrittenTarget})`
      }
      return full
    },
  )

  return withMarkdownImages.replace(
    /<img\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/gi,
    (full, _quote: string, src: string) => {
      const rel = lookup(src)
      if (!rel) return full
      const alt = full.match(/\balt=(["'])([^"']*)\1/i)?.[2] ?? ""
      return `![${alt}](${encodeMarkdownImageUrl(rel)})`
    },
  )
}

async function submitUrlTask(
  token: string,
  url: string,
  modelVersion: string,
  signal?: AbortSignal,
): Promise<string> {
  const httpFetch = await getHttpFetch()
  throwIfAborted(signal)
  const res = await httpFetch(`${API_BASE}/extract/task`, {
    method: "POST",
    headers: await mineruHeaders(token),
    signal,
    body: JSON.stringify({ url, model_version: modelVersion }),
  })
  if (!res.ok) throw new Error(`MinerU submit failed: HTTP ${res.status}`)
  const json: TaskResponse = await res.json()
  assertMineruSuccess(json)
  return json.data.task_id
}

async function uploadFileForTask(
  token: string,
  fileName: string,
  fileBase64: string,
  modelVersion: string,
  signal?: AbortSignal,
): Promise<{ batchId: string; uploadUrl: string }> {
  const httpFetch = await getHttpFetch()
  const headers = await mineruHeaders(token)
  throwIfAborted(signal)

  // Step 1: Get upload URL
  const res = await httpFetch(`${API_BASE}/file-urls/batch`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      files: [{ name: fileName, data_id: fileName }],
      model_version: modelVersion,
    }),
  })
  if (!res.ok) throw new Error(`MinerU batch submit failed: HTTP ${res.status}`)
  const json: UploadUrlResponse = await res.json()
  assertMineruSuccess(json)

  const batchId = json.data.batch_id
  const uploadUrl = json.data.file_urls[0]
  if (!batchId || !uploadUrl) {
    throw new Error("MinerU did not return a file upload URL")
  }

  // Step 2: Upload file binary (convert base64 back to binary)
  const bytes = decodeBase64ToBytes(fileBase64)
  throwIfAborted(signal)

  const uploadRes = await httpFetch(uploadUrl, {
    method: "PUT",
    signal,
    body: bytesToUploadBody(bytes),
  })
  if (!uploadRes.ok && uploadRes.status !== 200 && uploadRes.status !== 201) {
    throw new Error(`MinerU file upload failed: HTTP ${uploadRes.status}`)
  }

  return { batchId, uploadUrl }
}

function waitForPollInterval(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, POLL_INTERVAL_MS)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error("MinerU parsing cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function pollTask(token: string, taskId: string, signal?: AbortSignal): Promise<string> {
  const httpFetch = await getHttpFetch()
  const headers = await mineruHeaders(token)
  const start = Date.now()

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    throwIfAborted(signal)
    const res = await httpFetch(`${API_BASE}/extract/task/${taskId}`, {
      headers,
      signal,
    })
    if (!res.ok) throw new Error(`MinerU poll failed: HTTP ${res.status}`)
    const json: TaskStatus = await res.json()
    assertMineruSuccess(json)

    if (json.data.state === "done" && json.data.full_zip_url) {
      return json.data.full_zip_url
    }
    if (json.data.state === "failed") {
      throw new Error(`MinerU parsing failed: ${json.data.err_msg ?? "unknown error"}`)
    }

    await waitForPollInterval(signal)
  }

  throw new Error("MinerU parsing timed out after 5 minutes")
}

async function pollBatchTask(
  token: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<string> {
  const httpFetch = await getHttpFetch()
  const headers = await mineruHeaders(token)
  const start = Date.now()

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    throwIfAborted(signal)
    const res = await httpFetch(
      `${API_BASE}/extract-results/batch/${batchId}`,
      { headers, signal },
    )
    if (!res.ok) throw new Error(`MinerU batch poll failed: HTTP ${res.status}`)
    const json: BatchStatus = await res.json()
    assertMineruSuccess(json)

    const result = json.data.extract_result[0]
    if (result?.state === "done" && result.full_zip_url) {
      return result.full_zip_url
    }
    if (result?.state === "failed") {
      throw new Error(`MinerU parsing failed: ${result.err_msg ?? "unknown error"}`)
    }

    await waitForPollInterval(signal)
  }

  throw new Error("MinerU parsing timed out after 5 minutes")
}

async function saveMineruZipImages(
  zip: JSZip,
  options: MineruAssetOptions,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const pp = normalizePath(options.projectPath)
  const rootDir = `${pp}/wiki/media/${options.sourceSummarySlug}/mineru`
  const pathMap = new Map<string, string>()
  const imageEntries: Array<[string, JSZip.JSZipObject]> = []
  const basenameCounts = new Map<string, number>()

  zip.forEach((relativePath, file) => {
    const normalized = normalizeMineruZipPath(relativePath)
    if (!file.dir && normalized && isMineruImagePath(normalized)) {
      imageEntries.push([normalized, file])
      const basename = getFileName(normalized)
      basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1)
    }
  })

  if (imageEntries.length === 0) return pathMap

  await createDirectory(rootDir)
  for (const [zipPath, file] of imageEntries) {
    throwIfAborted(signal)
    const relPath = mineruAssetRelPath(options.sourceSummarySlug, zipPath)
    const absPath = `${pp}/wiki/${relPath}`
    const bytes = await file.async("uint8array")
    await writeFileBase64(absPath, bytesToBase64(bytes))
    pathMap.set(zipPath, relPath)
    pathMap.set(decodeMineruPath(zipPath), relPath)
    const basename = getFileName(zipPath)
    if (basenameCounts.get(basename) === 1) {
      pathMap.set(basename, relPath)
      pathMap.set(decodeMineruPath(basename), relPath)
    }
  }

  return pathMap
}

async function downloadAndExtractMarkdown(
  zipUrl: string,
  signal?: AbortSignal,
  assetOptions?: MineruAssetOptions,
): Promise<string> {
  const httpFetch = await getHttpFetch()
  throwIfAborted(signal)
  const res = await httpFetch(zipUrl, { signal })
  if (!res.ok) throw new Error(`MinerU zip download failed: HTTP ${res.status}`)

  const buffer = await res.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)

  // Official MinerU result archives contain full.md. Prefer it; fall
  // back to another Markdown file only for compatibility with older or
  // unusual archives.
  const mdEntries: [string, JSZip.JSZipObject][] = []
  zip.forEach((relativePath, file) => {
    if (!file.dir && relativePath.endsWith(".md")) {
      mdEntries.push([relativePath, file])
    }
  })

  if (mdEntries.length === 0) {
    throw new Error("No Markdown file found in MinerU result zip")
  }

  const fullMd = mdEntries.find(([relativePath]) =>
    relativePath.split("/").pop()?.toLowerCase() === "full.md"
  )
  const markdown = await (fullMd ?? mdEntries[0])[1].async("string")
  const markdownWithTables = convertHtmlTablesToMarkdown(markdown)
  if (!assetOptions) return markdownWithTables

  try {
    const pathMap = await saveMineruZipImages(zip, assetOptions, signal)
    return pathMap.size > 0
      ? rewriteMineruMarkdownImages(markdownWithTables, pathMap)
      : markdownWithTables
  } catch (err) {
    if (signal?.aborted) throw err
    console.warn(
      "[MinerU] failed to save extracted images; keeping parsed Markdown text:",
      err instanceof Error ? err.message : err,
    )
    return markdownWithTables
  }
}

// ── Public API ──

/**
 * Parse a PDF file using MinerU cloud API.
 *
 * @param config MinerU configuration (token, model version)
 * @param sourcePath Local file path to the PDF
 * @param sourceUrl Optional URL if the PDF was fetched from the web — avoids re-upload
 * @param onProgress Optional progress callback
 * @returns Parsed Markdown content
 */
export async function parseWithMineru(
  config: MineruConfig,
  sourcePath: string,
  sourceUrl?: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
  assetOptions?: MineruAssetOptions,
): Promise<string> {
  throwIfAborted(signal)
  if (!config.token) throw new Error("MinerU API token not configured")
  if (config.modelVersion !== "pipeline" && config.modelVersion !== "vlm") {
    throw new Error("MinerU PDF parsing supports only pipeline or vlm model versions")
  }

  let zipUrl: string

  if (sourceUrl) {
    onProgress?.("Submitting URL to MinerU...")
    const taskId = await submitUrlTask(config.token, sourceUrl, config.modelVersion, signal)
    onProgress?.("Waiting for MinerU to finish...")
    zipUrl = await pollTask(config.token, taskId, signal)
  } else {
    onProgress?.("Uploading file to MinerU...")
    throwIfAborted(signal)
    const fileSize = await getFileSize(sourcePath)
    if (fileSize > MAX_ACCURATE_PARSE_BYTES) {
      throw new Error("MinerU accurate parsing supports files up to 200 MB")
    }

    // Read file as base64
    const fileName = sourcePath.split("/").pop() ?? "document.pdf"
    throwIfAborted(signal)
    const { base64 } = await readFileAsBase64(sourcePath)

    const { batchId } = await uploadFileForTask(
      config.token,
      fileName,
      base64,
      config.modelVersion,
      signal,
    )
    onProgress?.("Waiting for MinerU to finish...")
    zipUrl = await pollBatchTask(config.token, batchId, signal)
  }

  onProgress?.("Downloading parsed result...")
  const markdown = await downloadAndExtractMarkdown(zipUrl, signal, assetOptions)
  onProgress?.("Done")

  return markdown
}

/**
 * Test MinerU API connectivity by submitting a minimal task.
 * Returns true if the token is valid.
 */
export async function testMineruConnection(token: string): Promise<void> {
  const httpFetch = await getHttpFetch()
  const res = await httpFetch(`${API_BASE}/extract/task`, {
    method: "POST",
    headers: await mineruHeaders(token),
    body: JSON.stringify({
      url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
      model_version: "pipeline",
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  const json: TaskResponse = await res.json()
  assertMineruSuccess(json)
}

// Test-only hooks for MinerU's browser/Tauri boundary helpers.
export const __mineruTest = {
  downloadAndExtractMarkdown,
  mineruApiErrorMessage,
  decodeBase64ToBytes,
  rewriteMineruMarkdownImages,
  convertHtmlTablesToMarkdown,
  MAX_ACCURATE_PARSE_BYTES,
}
