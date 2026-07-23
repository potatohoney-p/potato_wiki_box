import { describe, expect, it } from "vitest"
import { isTauriRuntime } from "./tauri-runtime"

describe("isTauriRuntime", () => {
  it("rejects a normal browser-like global", () => {
    expect(isTauriRuntime({})).toBe(false)
  })

  it("recognizes current Tauri runtimes", () => {
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true)
  })

  it("recognizes legacy-compatible Tauri runtimes", () => {
    expect(isTauriRuntime({ __TAURI__: {} })).toBe(true)
  })
})
