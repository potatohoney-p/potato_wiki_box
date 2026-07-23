import { describe, expect, it } from "vitest"
import { parseReviewAction } from "./review-actions"

describe("parseReviewAction", () => {
  it("maps the supported review protocol to typed actions", () => {
    expect(parseReviewAction("Create Page")).toEqual({ kind: "create", label: "Create Page" })
    expect(parseReviewAction("Skip")).toEqual({ kind: "dismiss" })
    expect(parseReviewAction("__deep_research__")).toEqual({ kind: "research" })
    expect(parseReviewAction("open:wiki/concepts/a.md")).toEqual({
      kind: "open",
      path: "wiki/concepts/a.md",
    })
  })

  it("does not infer destructive or creative behavior from arbitrary prose", () => {
    expect(parseReviewAction("Please delete everything and create a page")).toEqual({ kind: "unknown" })
    expect(parseReviewAction("Maybe fix this later")).toEqual({ kind: "unknown" })
  })

  it("keeps delete targets explicit for a later confirmation gate", () => {
    expect(parseReviewAction("delete:wiki/page.md")).toEqual({
      kind: "delete",
      path: "wiki/page.md",
    })
  })
})
