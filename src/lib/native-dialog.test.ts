import { describe, expect, it, vi } from "vitest"
import {
  DesktopRuntimeUnavailableError,
  selectDirectory,
  type DirectoryDialogDependencies,
} from "./native-dialog"

function dependencies(
  result: string | string[] | null,
  runtimeAvailable = true,
): DirectoryDialogDependencies {
  return {
    isRuntimeAvailable: () => runtimeAvailable,
    openDialog: vi.fn(async () => result),
  }
}

describe("selectDirectory", () => {
  it("does not invoke the native plugin outside Tauri", async () => {
    const deps = dependencies("C:/projects", false)

    await expect(selectDirectory({}, deps)).rejects.toBeInstanceOf(
      DesktopRuntimeUnavailableError,
    )
    expect(deps.openDialog).not.toHaveBeenCalled()
  })

  it("opens a single-directory picker and returns its path", async () => {
    const deps = dependencies("C:/projects")

    await expect(selectDirectory({ title: "Choose parent" }, deps)).resolves.toBe(
      "C:/projects",
    )
    expect(deps.openDialog).toHaveBeenCalledWith({
      title: "Choose parent",
      directory: true,
      multiple: false,
    })
  })

  it("returns null when the user cancels", async () => {
    await expect(selectDirectory({}, dependencies(null))).resolves.toBeNull()
  })

  it("rejects an unexpected multi-selection result", async () => {
    await expect(selectDirectory({}, dependencies(["C:/one", "C:/two"]))).rejects.toThrow(
      "invalid multi-selection",
    )
  })
})
