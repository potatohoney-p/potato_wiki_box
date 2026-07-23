# Contributing to potato box

Thank you for improving potato box. Contributions should preserve local-first behavior, inspectable data, explicit user authority, and secure defaults.

## Before You Start

- Search existing issues and pull requests.
- Use an issue for behavior changes with a non-trivial product or migration impact.
- Keep pull requests focused. Do not combine unrelated formatting or dependency churn.
- Never include real API keys, private documents, project backups, or `.potato-box` state.

## Development Setup

Requirements:

- Node.js 22+
- Rust stable with `rustfmt` and `clippy`
- `protoc`
- Tauri 2 operating-system prerequisites

```bash
npm ci
npm ci --prefix mcp-server
npm run typecheck
npm test
npm run tauri dev
```

### Windows Without Visual Studio Build Tools

The supported Windows setup is the MSVC Rust toolchain plus Visual C++ Build Tools. A user-local LLVM/xwin path is also available:

```powershell
winget install --exact --id MartinStorsjo.LLVM-MinGW.UCRT --scope user
winget install --exact --id Google.Protobuf --scope user
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal --component rustfmt,clippy
cargo install xwin --locked
xwin --accept-license --temp --arch x86_64 --variant desktop splat --output "$env:LOCALAPPDATA\potato-box\xwin-sdk"
./scripts/with-xwin.ps1 test
```

The helper sets process-local compiler, linker, CRT, SDK, resource compiler, and protobuf paths. It does not persist global compiler environment variables.

## Required Checks

```bash
npm run typecheck
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Run `npm run test:real` only when you intentionally want to use credentials from `.env.test.local`. Those tests can incur provider cost.

## Change Expectations

- Add a regression test for every bug fix where practical.
- Preserve backward-compatible reads for renamed on-disk formats; write only the current format.
- Use atomic replacement for durable JSON, Markdown, and queue state.
- Constrain filesystem operations to a canonical project root.
- Do not introduce unauthenticated localhost endpoints. Loopback is not an authentication boundary.
- Treat LLM output as untrusted input. Parse closed schemas and reject unknown actions.
- Add i18n keys for user-facing text instead of embedding copy in components.
- Check keyboard access, loading, empty, error, and reduced-width states for UI changes.

## Commit and Pull Request Notes

Use clear imperative commit subjects. A pull request should explain:

- the user problem and chosen behavior;
- data/security/migration impact;
- tests run;
- screenshots for visible changes;
- known limitations or follow-up work.

By contributing, you agree that your contribution is licensed under GPL-3.0-only and that you have the right to submit it.
