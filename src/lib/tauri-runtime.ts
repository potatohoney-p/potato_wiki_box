export function isTauriRuntime(scope: object = globalThis): boolean {
  return "__TAURI_INTERNALS__" in scope || "__TAURI__" in scope
}
