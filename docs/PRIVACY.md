# Privacy

potato box is local-first, not offline-only.

## Stored Locally

- imported sources and generated Markdown;
- chat history, review items, ingest queues, caches, and vector indexes;
- provider configuration and local integration settings;
- browser clips after capture;
- backups and diagnostics at destinations selected by the user.

Project-scoped operational state lives under `.potato-box`. Some application-wide preferences live in the operating system's Tauri application-data directory.

## Data That May Leave the Device

Depending on enabled features, requests may be sent to:

- the selected LLM provider;
- the selected embedding endpoint;
- configured Tavily, SerpApi, SearXNG, or other search service;
- optional MinerU or another document parsing service;
- the configured release repository for update checks.

Request content can include source excerpts, wiki pages, project purpose/schema, chat messages, search queries, images, and provider-specific metadata. Review provider retention and training policies before using sensitive material.

## Local Integrations

- API and clipper listeners bind to loopback.
- API and MCP access require a token.
- The browser clipper stores its token, project UUID, and an unfinished request's content fingerprint/idempotency key in extension storage. The source body is not stored in that retry record.
- MCP receives whatever the connected client asks the authenticated API to retrieve.

## Diagnostics

Knowledge Health diagnostics redact recognized token/secret fields and omit source bodies by default. Always inspect a diagnostic export before sharing it because filenames, provider names, project metadata, and error messages may still be sensitive.

## Deletion and Portability

Project content is portable as a folder. Deleting the project folder removes project-local content and state. Application-wide preferences and browser extension storage must be removed separately through the operating system/browser. Backups are independent copies and are not deleted with the source project.

## Recommended Practices

- Use least-privilege provider keys and rotate exposed tokens.
- Keep backups outside synchronized public folders.
- Do not enable integrations you do not use.
- Use local providers for data that must not leave the device.
- Review generated pages and diagnostics before publishing them.
