# Releasing

Only maintainers with repository release permission should publish a release.

## Preconditions

1. Default-branch CI is green.
2. Security advisories targeted for the release are resolved or explicitly deferred.
3. `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, extension manifest, and MCP package versions agree.
4. `CHANGELOG.md` has a dated release section.
5. Documentation matches current settings, API, migration, and backup behavior.

## Local Gate

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
npm --prefix mcp-server audit --audit-level=high
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Test at least one clean install, one upgrade with legacy state, one project backup/restore, API/MCP authentication, and extension capture.

## Publish

1. Merge the release pull request.
2. Create and push a signed `vX.Y.Z` tag from the release commit.
3. Let `.github/workflows/build.yml` build platform artifacts and attach the extension archive.
4. Verify artifact names, signatures where configured, bundled MCP files, checksums, and install/launch behavior.
5. Publish release notes from the changelog. Do not claim a platform was verified if its artifact was not exercised.

The updater is configured at build time from `VITE_POTATO_BOX_RELEASE_REPOSITORY`; release builds must point to the repository publishing the artifacts.

## Rollback

Do not rewrite or replace an already consumed release tag. Mark a broken release, publish a fixed patch version, and document migration or rollback constraints. If data integrity is at risk, disable affected downloads and publish an advisory immediately.
