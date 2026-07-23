# Changelog

Notable user-facing changes are recorded here. The project follows semantic versioning for released artifacts.

## Unreleased

### Added

- Knowledge Health dashboard with provenance, orphan, collision, failed-task, pending-clip, and service checks.
- Project ZIP backup, SHA-256 reporting, and guarded restore into a new directory.
- Authenticated browser clipper queue with durable acknowledgements.
- Public architecture, privacy, threat model, governance, security, and release documentation.

### Changed

- Rebranded product, runtime state, API/MCP, extension, updater, and release surfaces as potato box.
- Project state now writes to `.potato-box`; compatible `.llm-wiki` state migrates on open.
- Major workspace views load as separate production chunks.
- Local API projects use UUIDs and omit filesystem paths.

### Fixed

- Folder browse actions now open the native system picker in the desktop app and report a clear runtime error instead of failing silently in a browser preview.

### Security

- Removed unauthenticated API mode, query-string tokens, and path-based project IDs.
- Restricted Tauri asset access to directories the user actually opens.
- Added bounded archive extraction, path containment, local image-scheme blocking, atomic saves, and closed review actions.
- Prevented stale chat streams, late document writes, and ingest-runner overlap from contaminating current state.
