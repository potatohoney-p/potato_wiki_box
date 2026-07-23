const SAFE_STORAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isSafeStorageId(value: unknown): value is string {
  return typeof value === "string" && SAFE_STORAGE_ID.test(value)
}

export function requireSafeStorageId(value: unknown, label = "id"): string {
  if (!isSafeStorageId(value)) throw new Error(`Invalid ${label}`)
  return value
}
