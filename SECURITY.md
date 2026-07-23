# Security Policy

## Supported Versions

Security fixes are applied to the latest released version and the default branch. Older releases may not receive backports.

## Reporting a Vulnerability

Do not open a public issue for an unpatched vulnerability. Use the repository's GitHub Security Advisory "Report a vulnerability" flow. Include affected versions, prerequisites, impact, reproduction steps, and any proposed mitigation.

If private reporting is not enabled yet, open a public issue containing no exploit details and ask a maintainer to establish a private channel.

Maintainers should acknowledge a report within seven days, provide a status update after triage, and coordinate disclosure after a fix is available. Timelines can vary with severity and dependency ownership.

## Scope

Reports are especially useful for:

- project-root escape or arbitrary file read/write/delete;
- localhost API, MCP, or clipper authentication bypass;
- token leakage through URLs, logs, diagnostics, or process arguments;
- unsafe archive extraction or backup replacement;
- command execution beyond the fixed CLI transports;
- stored or rendered content that escapes Markdown/Mermaid safety boundaries;
- update or CI supply-chain compromise;
- cross-project data contamination or destructive migration.

Provider availability, model quality, and prompt-only output disagreements are usually product issues unless they cross a trust boundary or cause an unauthorized side effect.
