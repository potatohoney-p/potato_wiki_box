import {
  open,
  type OpenDialogOptions,
} from "@tauri-apps/plugin-dialog"
import { isTauriRuntime } from "./tauri-runtime"

export type DirectoryDialogOptions = Omit<OpenDialogOptions, "directory" | "multiple">

export interface DirectoryDialogDependencies {
  isRuntimeAvailable: () => boolean
  openDialog: (options: OpenDialogOptions) => Promise<string | string[] | null>
}

export class DesktopRuntimeUnavailableError extends Error {
  constructor() {
    super("Native filesystem dialogs require the potato box desktop runtime")
    this.name = "DesktopRuntimeUnavailableError"
  }
}

const defaultDependencies: DirectoryDialogDependencies = {
  isRuntimeAvailable: isTauriRuntime,
  openDialog: (options) => open(options),
}

export async function selectDirectory(
  options: DirectoryDialogOptions = {},
  dependencies: DirectoryDialogDependencies = defaultDependencies,
): Promise<string | null> {
  if (!dependencies.isRuntimeAvailable()) {
    throw new DesktopRuntimeUnavailableError()
  }

  const selected = await dependencies.openDialog({
    ...options,
    directory: true,
    multiple: false,
  })
  if (selected === null) return null
  if (typeof selected !== "string") {
    throw new Error("Directory picker returned an invalid multi-selection result")
  }
  return selected
}

export function isDesktopRuntimeUnavailable(
  error: unknown,
): error is DesktopRuntimeUnavailableError {
  return error instanceof DesktopRuntimeUnavailableError
}
