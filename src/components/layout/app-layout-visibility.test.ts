import { describe, expect, it } from "vitest"
import { getAppLayoutVisibility } from "./app-layout-visibility"

describe("getAppLayoutVisibility", () => {
  it("keeps chat as a standalone view even when research panel is open", () => {
    expect(getAppLayoutVisibility("chat", true)).toEqual({
      showLeftPanel: false,
      hasRightPanel: false,
    })
  })

  it("keeps settings as a standalone view even when research panel is open", () => {
    expect(getAppLayoutVisibility("settings", true)).toEqual({
      showLeftPanel: false,
      hasRightPanel: false,
    })
  })

  it("keeps knowledge health as a standalone view", () => {
    expect(getAppLayoutVisibility("health", true)).toEqual({
      showLeftPanel: false,
      hasRightPanel: false,
    })
  })

  it("shows the project side panel and optional research panel in workspace views", () => {
    expect(getAppLayoutVisibility("wiki", false)).toEqual({
      showLeftPanel: true,
      hasRightPanel: false,
    })
    expect(getAppLayoutVisibility("search", true)).toEqual({
      showLeftPanel: true,
      hasRightPanel: true,
    })
  })
})
