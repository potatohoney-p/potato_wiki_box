import { describe, expect, it } from "vitest"
import { resolveWikiPageId, vectorPageIdFromPath, wikiPageIdFromPath } from "./wiki-page-id"

describe("wiki page identity", () => {
  it("uses the wiki-relative path so duplicate basenames remain distinct", () => {
    expect(wikiPageIdFromPath("C:/project/wiki/concepts/foo.md", "C:/project/wiki"))
      .toBe("concepts/foo")
    expect(wikiPageIdFromPath("C:/project/wiki/entities/foo.md", "C:/project/wiki"))
      .toBe("entities/foo")
  })

  it("resolves an explicit relative path", () => {
    expect(resolveWikiPageId("wiki/entities/foo.md", ["concepts/foo", "entities/foo"]))
      .toBe("entities/foo")
  })

  it("rejects an ambiguous basename-only wikilink", () => {
    expect(resolveWikiPageId("foo", ["concepts/foo", "entities/foo"])).toBeNull()
  })

  it("encodes separators without colliding with literal percent escapes", () => {
    expect(vectorPageIdFromPath("wiki/concepts/foo.md", "wiki")).toBe("concepts%2Ffoo")
    expect(vectorPageIdFromPath("wiki/concepts%2Ffoo.md", "wiki")).toBe("concepts%252Ffoo")
  })
})
