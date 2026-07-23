import { describe, expect, it } from "vitest"
import { load } from "js-yaml"
import { quoteYamlString } from "./yaml-string"

describe("quoteYamlString", () => {
  it.each([
    "plain title",
    String.raw`folder\name "quoted"`,
    "line one\nline two",
    "colon: #hash [brackets]",
    "한글 제목",
  ])("round-trips through YAML without changing structure: %s", (value) => {
    expect(load(`title: ${quoteYamlString(value)}\n`)).toEqual({ title: value })
  })
})
