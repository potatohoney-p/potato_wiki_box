/** Hide Markdown HTML comments while preserving literal code examples. */
export function stripHtmlComments(markdown: string): string {
  if (!markdown.includes("<!--")) return markdown

  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []
  let fence: { marker: "`" | "~"; length: number } | null = null
  let inlineTicks = 0
  let inComment = false
  let output = ""

  for (const line of lines) {
    const lineText = line.endsWith("\n")
      ? line.slice(0, -1).replace(/\r$/, "")
      : line

    if (fence) {
      output += line
      const closing = lineText.match(/^ {0,3}(`+|~+)[ \t]*$/)
      if (
        closing &&
        closing[1][0] === fence.marker &&
        closing[1].length >= fence.length
      ) {
        fence = null
      }
      continue
    }

    if (!inComment && inlineTicks === 0) {
      const opening = lineText.match(/^ {0,3}(`{3,}|~{3,})/)
      if (opening) {
        fence = {
          marker: opening[1][0] === "~" ? "~" : "`",
          length: opening[1].length,
        }
        output += line
        continue
      }

      // Preserve indented code examples so literal comments remain visible.
      if (/^(?: {4}|\t)/.test(lineText)) {
        output += line
        continue
      }
    }

    for (let index = 0; index < line.length;) {
      if (inComment) {
        if (line.startsWith("-->", index)) {
          inComment = false
          index += 3
        } else if (line.startsWith("\r\n", index)) {
          output += "\r\n"
          index += 2
        } else if (line[index] === "\n") {
          output += "\n"
          index += 1
        } else {
          index += 1
        }
        continue
      }

      if (inlineTicks === 0 && line.startsWith("<!--", index)) {
        inComment = true
        index += 4
        continue
      }

      if (line[index] === "`") {
        let end = index + 1
        while (line[end] === "`") end += 1
        const runLength = end - index
        output += line.slice(index, end)
        if (inlineTicks === 0) inlineTicks = runLength
        else if (inlineTicks === runLength) inlineTicks = 0
        index = end
        continue
      }

      output += line[index]
      index += 1
    }
  }

  return output
}

/**
 * Convert Obsidian image embeds into CommonMark images for display.
 * Run this before `transformWikilinks` so the generic link pass cannot
 * turn an image target into a fragment link.
 */
export function transformImageEmbeds(body: string): string {
  if (!body.includes("![[")) return body

  const parts = body.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part, idx) =>
      idx % 2 === 1 ? part : transformImageEmbedsOutsideCode(part),
    )
    .join("")
}

const IMAGE_EMBED_RE = /!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g

function transformImageEmbedsOutsideCode(text: string): string {
  if (!text.includes("![[")) return text
  const parts = text.split(/(`[^`\n]+`)/g)
  return parts
    .map((part, idx) => (idx % 2 === 1 ? part : replaceImageEmbeds(part)))
    .join("")
}

function replaceImageEmbeds(text: string): string {
  return text.replace(
    IMAGE_EMBED_RE,
    (_match, rawTarget: string, rawAlias?: string) => {
      const target = rawTarget.trim()
      const alias = rawAlias?.trim() ?? ""
      // Sanitize alt text so `]` doesn't terminate the markdown image
      // alt bracket early.
      const alt = alias.replace(/]/g, ")")
      // Wrap the URL in <…> so spaces / parens / non-ASCII in the
      // path don't break the CommonMark image parser. The resolver
      // strips no angle brackets — react-markdown removes them while
      // parsing, so `src` arrives clean.
      return `![${alt}](<${target}>)`
    },
  )
}

/**
 * Convert Obsidian-style wiki links into in-app fragment links while
 * preserving fenced and inline code examples.
 */
export function transformWikilinks(body: string): string {
  if (!body.includes("[[")) return body

  // Split on triple-backtick fences. The capturing group keeps
  // the fence content in the output. Odd indices are inside a
  // fence and must pass through untouched.
  const parts = body.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part, idx) => (idx % 2 === 1 ? part : transformOutsideCode(part)))
    .join("")
}

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g

function transformOutsideCode(text: string): string {
  if (!text.includes("[[")) return text

  // Split on inline-code spans so backticked content is preserved.
  const parts = text.split(/(`[^`\n]+`)/g)
  return parts
    .map((part, idx) => (idx % 2 === 1 ? part : replaceWikilinks(part)))
    .join("")
}

function replaceWikilinks(text: string): string {
  return text.replace(WIKILINK_RE, (_match, rawTarget: string, rawAlias?: string) => {
    const target = rawTarget.trim()
    const alias = rawAlias?.trim() ?? ""
    const label = alias.length > 0 ? alias : target
    // Encode the target so spaces / parens / hashes don't break the
    // markdown link parser. encodeURIComponent is overkill for a
    // fragment but it's the safe default.
    const href = `#${encodeURIComponent(target)}`
    // Escape backslashes before brackets so input cannot consume an escape
    // sequence that protects the generated Markdown label.
    const escapedLabel = label.replace(/[\\[\]]/g, "\\$&")
    return `[${escapedLabel}](${href})`
  })
}
