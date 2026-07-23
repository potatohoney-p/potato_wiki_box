import { execFileSync } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit } from "unist-util-visit"

const root = process.cwd()
const output = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
  { cwd: root, encoding: "utf8" },
)
const markdownFiles = output.split(/\r?\n/).filter(Boolean)
const failures = []
let checkedLinks = 0

for (const relativeFile of markdownFiles) {
  const absoluteFile = path.resolve(root, relativeFile)
  const source = await readFile(absoluteFile, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null
    throw error
  })
  if (source === null) continue
  const tree = unified().use(remarkParse).parse(source)

  visit(tree, (node) => {
    if (!["link", "image", "definition"].includes(node.type) || typeof node.url !== "string") {
      return
    }
    const rawTarget = node.url.trim()
    if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) {
      return
    }

    let decodedTarget
    try {
      decodedTarget = decodeURIComponent(rawTarget.split("#", 1)[0].split("?", 1)[0])
    } catch {
      failures.push(`${relativeFile}:${node.position?.start.line ?? 1} invalid URL encoding: ${rawTarget}`)
      return
    }
    if (!decodedTarget) return

    checkedLinks += 1
    const resolved = path.resolve(path.dirname(absoluteFile), decodedTarget)
    const relativeResolved = path.relative(root, resolved)
    if (relativeResolved.startsWith("..") || path.isAbsolute(relativeResolved)) {
      failures.push(`${relativeFile}:${node.position?.start.line ?? 1} escapes repository: ${rawTarget}`)
      return
    }
    node.resolvedTarget = resolved
    node.sourceFile = relativeFile
  })

  const pending = []
  visit(tree, (node) => {
    if (typeof node.resolvedTarget !== "string") return
    pending.push(
      stat(node.resolvedTarget).catch(() => {
        failures.push(
          `${node.sourceFile}:${node.position?.start.line ?? 1} missing local target: ${node.url}`,
        )
      }),
    )
  })
  await Promise.all(pending)
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exitCode = 1
} else {
  console.log(`Checked ${checkedLinks} local links across ${markdownFiles.length} Markdown files.`)
}
