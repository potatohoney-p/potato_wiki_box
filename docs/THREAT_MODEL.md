# Threat Model

## Protected Assets

- source documents and generated wiki pages;
- project and application credentials;
- chat history, review decisions, and research context;
- filesystem content outside the active project;
- integrity of backups, updates, releases, and indexes.

## Trust Boundaries

1. Untrusted imported documents and Markdown enter the renderer and LLM pipeline.
2. LLM output enters parsers that may propose files or review actions.
3. The webview invokes privileged Rust commands.
4. Local API, MCP, and browser extension clients cross a localhost boundary.
5. External LLM, embedding, search, and PDF services receive configured requests.
6. Backup archives and migrated state enter durable project storage.

## Primary Threats and Controls

| Threat | Control |
| --- | --- |
| Project-root escape | Canonical containment checks, project-relative allow-lists, safe storage IDs, no path IDs over HTTP |
| Arbitrary local asset read | Empty static asset scope; canonical project directory allowed only after open; local URL schemes rejected in Markdown |
| API/clipper CSRF or token theft | Loopback binding, mandatory header/Bearer token, extension-origin validation, no query tokens, no-store responses |
| Request abuse | Body caps, rate limits, bounded list sizes, URL validation, collision-safe file creation |
| LLM command injection | Closed action schema, unknown-action rejection, constrained file blocks, explicit destructive confirmation |
| ZIP slip or archive bomb | Enclosed normal paths only, symlink rejection, entry/count/expanded-size limits, create-new extraction |
| Crash/data loss | Atomic write replacement, serialized editor saves, durable queues, complete-cache markers |
| Cross-project contamination | Stream conversation IDs, project-switch flush/reset, active runner epoch, project-specific vector locks |
| Sensitive diagnostics | Token and credential redaction; diagnostics avoid source content by default |
| Supply-chain compromise | Lockfiles, dependency audits, protected release workflow, planned SHA-pinned actions and CodeQL |

## Residual Risks

- A compromised desktop account can read project files directly.
- Content sent to configured external providers is subject to those providers' policies.
- Projects explicitly opened during one app session remain in Tauri's in-memory asset allow-list until process exit.
- Remote web content can contain misleading instructions even when it cannot directly execute privileged actions.
- The application cannot prove that an LLM answer is factually correct; provenance and review reduce but do not remove this risk.
- Extension tokens live in browser extension storage and should be rotated after browser-profile compromise.

## Security Invariants

- No unauthenticated mutating localhost endpoint.
- No durable write outside an explicitly selected project or backup destination.
- No destructive action inferred from free-form LLM prose.
- No successful ingest cache record without validated generated files.
- No backup restore over an existing directory.

Update this document when a change introduces a new privileged command, network listener, provider, archive format, executable transport, or on-disk migration.
