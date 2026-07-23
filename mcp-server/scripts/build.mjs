import { chmod } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = fileURLToPath(new URL("../", import.meta.url))
const outfile = fileURLToPath(new URL("../dist/index.js", import.meta.url))

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "bundle",
  sourcemap: false,
  legalComments: "none",
})

if (process.platform !== "win32") {
  await chmod(outfile, 0o755)
}
