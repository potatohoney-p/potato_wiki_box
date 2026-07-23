export const BRAND_NAME = "potato box"
export const PRODUCT_SLUG = "potato-box"
export const MODIFICATION_COPYRIGHT = "Copyright (C) 2026 potato box contributors"
export const UPSTREAM_COPYRIGHT = "LLM Wiki Copyright (C) 2024-2026 Yong Su"

const configuredRepository = (import.meta.env.VITE_POTATO_BOX_RELEASE_REPOSITORY ?? "").trim()

/** GitHub owner/repository used for update checks. Empty in unconfigured local builds. */
export const RELEASE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configuredRepository)
  ? configuredRepository
  : null

export const REPOSITORY_URL = RELEASE_REPOSITORY
  ? `https://github.com/${RELEASE_REPOSITORY}`
  : null
