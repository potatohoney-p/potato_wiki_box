import { describe, expect, it } from "vitest"
import { isSafeStorageId, requireSafeStorageId } from "./safe-storage-id"

describe("safe storage ids", () => {
  it("accepts generated and legacy conversation ids", () => {
    expect(isSafeStorageId("conv_1712345678_ab12cd")).toBe(true)
    expect(isSafeStorageId("default")).toBe(true)
  })

  it.each(["../secret", "a/b", "a\\b", ".hidden", "", "a".repeat(129)])(
    "rejects path-capable id %s",
    (value) => expect(isSafeStorageId(value)).toBe(false),
  )

  it("throws before unsafe ids reach a filesystem path", () => {
    expect(() => requireSafeStorageId("../../app-state", "conversation id")).toThrow(
      "Invalid conversation id",
    )
  })
})
