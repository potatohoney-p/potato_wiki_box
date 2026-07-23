import { spawn } from "node:child_process"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const isolated = await mkdtemp(join(tmpdir(), "potato-box-mcp-smoke-"))
const entry = join(isolated, "index.js")
await copyFile(new URL("../dist/index.js", import.meta.url), entry)
await copyFile(new URL("../package.json", import.meta.url), join(isolated, "package.json"))

const child = spawn(process.execPath, [entry], {
  cwd: isolated,
  env: {
    ...process.env,
    POTATO_BOX_API_TOKEN: "smoke-test-token",
  },
  stdio: ["pipe", "pipe", "pipe"],
})

let stdout = ""
let stderr = ""
child.stdout.setEncoding("utf8")
child.stderr.setEncoding("utf8")
child.stdout.on("data", (chunk) => { stdout += chunk })
child.stderr.on("data", (chunk) => { stderr += chunk })

const request = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "potato-box-smoke", version: "1.0.0" },
  },
}
child.stdin.write(`${JSON.stringify(request)}\n`)

try {
  const deadline = Date.now() + 5_000
  while (!stdout.includes('"id":1') && Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`MCP bundle exited early (${child.exitCode}): ${stderr}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (!stdout.includes('"id":1') || !stdout.includes('"name":"potato-box"')) {
    throw new Error(`MCP bundle did not complete isolated initialization. stdout=${stdout} stderr=${stderr}`)
  }
} finally {
  child.stdin.end()
  if (child.exitCode === null) {
    child.kill()
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2_000)
      child.once("exit", () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  await rm(isolated, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}
