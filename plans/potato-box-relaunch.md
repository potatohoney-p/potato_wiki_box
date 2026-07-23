# potato box Relaunch Plan

Status: HISTORICAL DESIGN RECORD
Branch: codex/potato-box-relaunch
Target: first independently governed potato box release

This document records the design review that guided the relaunch. It is not a
claim that every proposed item shipped. Current behavior is defined by the code,
tests, changelog, and user documentation; unimplemented items remain candidates
for future issues.

## Product Outcome

potato box will be a local-first, source-grounded AI knowledge workspace for one
person. It should turn changing local documents into durable Markdown knowledge,
make every automated change inspectable, and remain useful even when every cloud
service is disabled.

The relaunch is complete only when a new contributor can clone, build, test,
understand, and release the project without relying on the former project's
repository, package names, update endpoints, or undocumented maintainer knowledge.

## Legal Boundary

- Product branding, package identifiers, update endpoints, documentation, assets,
  API names, extension names, and internal symbols become potato box owned.
- GPLv3 remains the license for the covered work.
- The original copyright notice remains in LICENSE and NOTICE as required by GPLv3.
- Modified versions are identified as potato box and dated in NOTICE.
- Runtime UI provides a convenient license and no-warranty notice in About.
- No original project URL is used for updates, downloads, telemetry, or product
  promotion. A legal provenance URL may remain in NOTICE only.

## Confirmed Premises

1. The primary user is a technically comfortable solo researcher, analyst, writer,
   or developer with a growing local document corpus.
2. The core job is not generic chat. It is maintaining source-backed, portable,
   inspectable knowledge over time.
3. Local Markdown is the durable source of truth. Search indexes and caches are
   disposable derivatives.
4. Cloud LLM calls are optional and must be disclosed before source content leaves
   the device.
5. Trust, recovery, and operability take priority over adding more model providers.
6. Hosted accounts, team collaboration, and a plugin marketplace are not required
   for the independent relaunch.

## Implementation Alternatives

### Approach A: Cosmetic Fork

Summary: Rename visible strings and ship the existing architecture.
Effort: S
Risk: High
Pros: Small diff, quick visual result.
Cons: Keeps upstream release coupling, insecure clipper, silent errors, broken clean
build, old state paths, and weak contributor ownership.
Reuses: Everything unchanged.

### Approach B: Trust-Centered Relaunch

Summary: Preserve proven ingestion and knowledge logic while replacing identity,
security boundaries, migration, operability, onboarding, and release ownership.
Effort: L
Risk: Medium
Pros: Independent, reversible, testable, and aligned with the real user job.
Cons: Broad cross-module work and migration testing are required.
Reuses: Existing ingest, search, graph, review, lint, research, and project flows.

### Approach C: Full Rewrite

Summary: Replace the React/Tauri application and storage model from scratch.
Effort: XL
Risk: Very High
Pros: Maximum architectural freedom.
Cons: Discards years of tested domain behavior and creates an unbounded parity task.
Reuses: Product concepts only.

Recommendation: Approach B. It fixes the trust contract without discarding the
domain engine that already differentiates the product.

## Scope

### A. Independent Identity And Migration

- Central brand configuration for display name, package name, repository URL,
  support URL, API header, ports, and update channel.
- Replace all product-facing and internal `llm_wiki` symbols with potato box names.
- Replace original logo, app icons, extension icons, and architecture graphics.
- Rename project metadata directory from `.llm-wiki` to `.potato-box`.
- Add idempotent project-state migration with backup, conflict detection, and a
  readable migration report.
- Add global app-data migration from the former Tauri identifier to
  `com.potatobox.app` without deleting the legacy copy.
- Make release repository configuration derive from the current GitHub repository.
- Rename original git remote to `upstream`; leave `origin` free for the owner's repo.

### B. Trust And Security

- Require authentication for the browser clipper.
- Validate clip targets against the registered project list, not caller paths.
- Restrict extension origins, request methods, content type, and body size.
- Add rate limiting and explicit security responses for local HTTP servers.
- Redact tokens, paths, source text, prompts, and provider payloads from diagnostics.
- Add a per-project data-egress policy: local only, confirm external calls, or allow
  configured remote providers.
- Show the selected provider and egress destination before first ingest.
- Never persist secrets in exported projects, backups, logs, or support bundles.
- Move provider credentials behind a credential-store adapter. Use the OS keychain
  when available and retain an explicit, warned compatibility fallback.

### C. Reliability And Build Quality

- Repair clean dependency installation and missing declaration files.
- Make `npm run build` run strict typecheck and Vite build successfully.
- Make deterministic tests the default; real-provider tests require an explicit flag.
- Add root scripts for frontend, MCP, Rust, formatting, and full verification.
- Run deterministic frontend, MCP, and Rust tests in CI on supported platforms.
- Add dependency audit, lockfile validation, and generated artifact checks.
- Remove swallowed startup failures. Record structured, user-visible diagnostics.
- Preserve project state on failed migration, failed ingest, and app shutdown.
- Validate conversation and task identifiers before any path construction.
- Replace truncate-write JSON persistence with validated atomic writes,
  last-known-good backups, and corruption quarantine.
- Introduce versioned editor sessions so stale reads and delayed writes cannot affect
  a newly selected document.
- Scope every chat run to a captured conversation and job ID. Create cancellation
  before retrieval and finalize in `finally` against the captured conversation.
- Make ingest cancellation wait for the active runner to settle before another runner
  starts, and keep cleanup checkpoints as writes occur.
- Treat malformed or incomplete model output as a retryable failure. Do not cache a
  fallback page as successful ingestion.
- Replace immediate source-delete cascades with tombstones, a grace period, a deletion
  plan, and trash/undo for generated pages.
- Replace basename page identity with canonical project-relative IDs across search,
  graph, review, and vector storage.
- Replace string-inferred Review actions with a typed action union. Destructive actions
  require diff preview, confirmation, backup, result state, and undo.

### D. Product UX And Accessibility

- Replace the welcome screen with a readiness-oriented first-run flow.
- Add Korean UI support and retain English and Chinese parity checks.
- Add a command palette for navigation and safe common actions.
- Add a global operation status surface for autosave, queue, indexing, and errors.
- Add a deterministic Knowledge Health view that separates structural failures from
  AI suggestions.
- Add explicit loading, empty, error, partial, success, and recovery states to every
  primary workflow.
- Add visible keyboard focus, landmarks, skip navigation, 44 px touch targets where
  appropriate, reduced-motion behavior, and accessible icon labels.
- Make narrow-window layouts intentional for welcome, settings, search, review,
  source management, and the command palette.

### E. Administration And Recovery

- Add a System Health settings section with provider, parser, watcher, API, MCP,
  vector index, queue, storage, and migration checks.
- Add a project registry manager: reveal, relink, rename display label, unregister,
  verify, backup, and rebuild derived indexes.
- Add sanitized support-bundle export with version, platform, checks, and recent
  structured errors only.
- Add verified project backup with a manifest and checksums.
- Exclude credentials and regenerable vector indexes from backups by default.
- Add restore preflight and restore into a new directory before any replace option.

### F. Provenance And API Productization

- Add a source manifest with source hash, parser, ingest time, provider/model,
  generated pages, and evidence locators when available.
- Surface stale provenance when a source changes after a page was generated.
- Generate an OpenAPI document from the API route contract.
- Remove or clearly mark unimplemented API routes.
- Add capabilities and version endpoints for extension and MCP compatibility.
- Publish or bundle the MCP server with a stable potato box command name.
- Add one-click copy and connection verification in Settings.
- Remove query-string authentication and enforce client capabilities server-side.
- Block remote Markdown images by default or fetch them through an explicit privacy
  control so reading a page cannot silently reveal the user's IP and unique URL.
- Upgrade Mermaid and sanitize rendered SVG in an isolated rendering boundary.

### G. Open Source Ownership

- Rewrite README content around potato box's actual user and trust model.
- Add ARCHITECTURE, CONTRIBUTING, SECURITY, GOVERNANCE, SUPPORT, CODE_OF_CONDUCT,
  CHANGELOG, ROADMAP, and NOTICE documents.
- Add issue and pull request templates, contributor setup, test commands, release
  checklist, and security reporting policy.
- Document compatibility and migrations instead of hiding fork history.

## Not In Scope

- Hosted potato box accounts: conflicts with the local-first relaunch goal.
- Team RBAC and real-time collaboration: requires a server data model and a separate
  product decision.
- Plugin marketplace: stabilize the API and extension contract first.
- More LLM providers: provider breadth is already ahead of trust and onboarding.
- Full-project encryption: keychain and backup boundaries must be proven first.
- Database replacement for Markdown: would compromise portability and create a
  rewrite-sized migration.

## Existing Capabilities To Reuse

| Need | Existing implementation | Decision |
|---|---|---|
| Source ingestion | `src/lib/ingest.ts` and source lifecycle modules | Refactor boundaries, do not rewrite |
| Local project files | Tauri fs and project commands | Add migration and validation |
| Search | lexical, vector, RRF, AnyTXT integrations | Expose health and capability status |
| Knowledge quality | lint, review, dedup, graph insights | Aggregate into Knowledge Health |
| Long operations | activity, ingest, research, dedup stores | Add unified operation status |
| Provider support | provider presets and connection tests | Add egress disclosure and secret adapter |
| Browser clipping | extension plus local clip server | Preserve UX, replace trust model |
| API/MCP | local API and MCP server | Generate contract and harden auth |
| Persistence | `.llm-wiki` JSON state | Migrate to `.potato-box` safely |

## Target Architecture

```text
                         +-----------------------+
                         | potato box Desktop UI |
                         +-----------+-----------+
                                     |
                    typed commands + events
                                     |
          +--------------------------+--------------------------+
          |                          |                          |
  +-------v--------+        +--------v---------+       +--------v---------+
  | Project Domain |        | Operations/Health|       | Credential/Egress|
  | files, ingest, |        | queues, logs,     |       | policy + keychain|
  | provenance    |        | diagnostics       |       | adapter          |
  +-------+--------+        +--------+---------+       +--------+---------+
          |                          |                          |
          +--------------------------+--------------------------+
                                     |
                         +-----------v------------+
                         | Tauri command boundary |
                         | path validation, IO,   |
                         | local HTTP services    |
                         +----+--------------+----+
                              |              |
                  +-----------v--+       +---v----------------+
                  | Project folder|       | Authenticated local|
                  | Markdown +    |       | API / clip / MCP   |
                  | .potato-box   |       +--------------------+
                  +---------------+
```

Indexes, caches, and generated API artifacts are downstream of typed source data.
No UI component constructs hidden project paths or independently defines brand,
security, API, or update constants.

## Core User Journeys

### First Run

```text
Welcome -> New/Open project -> Data location -> Privacy mode -> Provider test
        -> First source -> Ingest progress -> First generated page -> Health summary
```

The user can defer provider setup and still browse/edit local Markdown. Ingest actions
remain disabled with a direct setup action and an explanation, never a silent no-op.

### Source To Knowledge

```text
Select source -> Validate -> Copy/snapshot -> Parse -> Egress gate -> Generate
              -> Validate output -> Persist atomically -> Index -> Review -> Health
                    | failures remain visible and retryable |
```

### Recovery

```text
Detect issue -> System Health -> Explain failing check -> Safe action
             -> Verify -> Export redacted support bundle if unresolved
```

## UI Direction

Classification: desktop app UI, not a landing page.

- Typography: Geist Variable for UI, a readable serif only for long-form wiki content.
- Surface hierarchy: warm white/near-black base, cool neutral chrome, potato yellow as
  a sparse focus/accent, green for healthy, amber for attention, red for destructive.
- Cards only for repeated project or issue items. Settings sections remain unframed.
- 4 px spacing base, 6 px maximum component radius, 1 px borders, minimal shadows.
- Sidebar remains icon-led but gains a product mark, active label/tooltip, and keyboard
  focus. Primary content owns the visual weight.
- Motion is limited to state changes and progress. Respect reduced motion.

### Screen Hierarchy

```text
Application
|- Product rail: project switcher, Health, Wiki, Sources, Search, Graph, Review, Lint
|- Context panel: tree, filters, task list, or section navigation
|- Primary workspace: current task
|- Operation bar: save/index/queue state and recoverable errors
`- Command palette: global navigation and safe actions
```

### Interaction State Coverage

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Welcome | recent projects skeleton | guided new/open actions | app-state recovery | recent projects | invalid recents separated |
| Ingest | named stages + cancel | first-source CTA | reason + retry + logs | page links + summary | completed/failed counts |
| Search | stable result skeleton | query guidance | retry + mode fallback | ranked results | vector unavailable badge |
| Health | check progress | no-project guidance | failed check action | healthy summary | warnings grouped by owner |
| Backup | progress + destination | N/A | no source mutation | manifest summary | skipped files listed |
| Restore | preflight | N/A | target untouched | open restored copy | conflicts require choice |
| API/MCP | connection test | setup command | exact auth/port issue | capability summary | unsupported features hidden |

## Accessibility Contract

- Every icon-only control has an accessible name and tooltip.
- Keyboard navigation reaches all primary workflows in logical order.
- Focus is never removed without a visible replacement.
- Dialog focus is trapped and restored to the trigger.
- Status changes use polite live regions; destructive confirmations are explicit.
- Text and controls meet WCAG AA contrast.
- Zoom from 80% through 150% does not hide actions or overlap content.
- Narrow windows use drawers or sequential panels, not squeezed three-column layouts.

## Error And Rescue Registry

| Codepath | Failure | Rescue | User sees | Test |
|---|---|---|---|---|
| app-state migration | source missing | no-op | nothing | unit |
| app-state migration | target conflict | preserve both, report | migration warning | integration |
| project migration | rename/copy fails | rollback from backup | retry + paths | integration |
| credential lookup | keychain unavailable | warned compatibility fallback | security warning | unit |
| clip request | missing/invalid token | reject 401 | extension setup action | Rust + extension |
| clip request | unregistered path | reject 403 | relink project | Rust |
| clip request | oversized body | reject 413 | size limit | Rust |
| external LLM call | policy blocks egress | no request sent | choose local/allow | unit |
| external LLM call | timeout/rate limit | bounded retry | retry state | unit/integration |
| output persist | partial write | atomic temp + replace | original preserved | integration |
| backup | unreadable file | abort or explicit skip | skipped list | Rust |
| restore | checksum mismatch | abort before write | damaged backup | Rust |
| update check | repo unset/offline | disable/degrade | manual configuration | unit |
| diagnostics export | secret-like field | redact | redaction summary | property test |

## Failure Modes Registry

| Flow | Failure mode | Rescued | Tested | User visible | Logged |
|---|---|---:|---:|---:|---:|
| First run | provider not configured | yes | yes | yes | yes |
| Ingest | user double-submits | yes | yes | yes | yes |
| Ingest | app closes mid-write | yes | yes | yes | yes |
| Project switch | outgoing autosave races reset | existing guard | yes | no data loss | yes |
| Clipper | hostile local web page posts content | yes | yes | yes | yes |
| Migration | both legacy and new state exist | yes | yes | yes | yes |
| Backup | credentials accidentally included | yes | yes | yes | yes |
| Search | vector index corrupt/unavailable | yes | yes | yes | yes |
| API | stale MCP client version | yes | yes | yes | yes |
| Editor | late read targets newly selected file | yes | yes | yes | yes |
| Editor | pending save lost on navigation | yes | yes | yes | yes |
| Chat | preflight error leaves streaming state | yes | yes | yes | yes |
| Chat | completion lands in another conversation | yes | yes | yes | yes |
| Review | localized/unknown action deletes or creates content | yes | yes | yes | yes |
| Ingest | cancelled runner commits after replacement starts | yes | yes | yes | yes |
| Ingest | malformed output cached as success | yes | yes | yes | yes |
| Persistence | corrupt JSON interpreted as empty and overwritten | yes | yes | yes | yes |
| Source watch | transient delete cascades to wiki deletion | yes | yes | yes | yes |
| Identity | duplicate basenames collide across schema folders | yes | yes | yes | yes |

## Test Strategy

```text
CODE PATHS
|- Brand/update configuration: unit tests
|- State migration: Rust unit + temp-directory integration tests
|- Clipper auth/origin/path/body/rate limits: Rust integration tests
|- Egress policy and credential redaction: unit + property tests
|- Health aggregation: pure-function unit tests
|- Backup manifest/checksum/restore preflight: Rust integration tests
|- API capability/OpenAPI contract: snapshot + MCP contract tests
`- i18n: parity tests for en/zh/ko

USER FLOWS
|- First launch and deferred provider setup: component tests + E2E
|- Project create/open/migrate: desktop integration smoke test
|- Import with success, partial failure, cancel, retry: integration tests
|- Command palette keyboard flow: component + E2E
|- Health issue to repair action: component + E2E
|- Backup and restore copy: desktop integration test
`- Extension configure, auth failure, clip success: extension integration test
```

Quality gates:

1. Clean `npm ci` from an empty dependency directory.
2. Strict TypeScript typecheck with zero errors.
3. Frontend deterministic tests pass with no provider credentials.
4. MCP build and tests pass.
5. Rust formatting, clippy, and tests pass on CI-supported toolchains.
6. Vite and Tauri release builds pass on Windows, macOS, and Linux CI.
7. Browser QA covers desktop and narrow-window layouts with no console errors.
8. Security review has no unresolved high-severity finding.
9. Branding scan finds no product-facing or internal legacy identifiers outside the
   compatibility and legal allowlist.

## Rollout And Rollback

- Migrations are copy-first and leave legacy data untouched until verification.
- A migration marker records source, target, date, app version, and result.
- New project state is written only to `.potato-box`; legacy state remains read-only
  compatibility input for one major release.
- If migration fails, the project opens in compatibility mode or stays unopened with
  explicit recovery instructions. It never creates a half-migrated writable state.
- Release artifacts include checksums and a migration note.
- Rollback means reinstalling the previous binary and opening the preserved legacy
  copy. No destructive down-migration is required.

## Workstreams

| Lane | Modules | Depends on |
|---|---|---|
| A | brand config, docs, release metadata, assets | legal boundary |
| B | Tauri migration, path constants, backups | storage contract |
| C | clip/API/MCP security and contract | brand constants |
| D | design system, onboarding, command palette, health UI | typed health model |
| E | credentials, egress policy, diagnostics | security model |
| F | tests, CI, contributor docs | all contracts |

Lanes A and initial test repair can start first. Storage and security contracts land
before UI features that consume them. Final QA and review run only after all lanes merge.

## Decision Audit Trail

| # | Phase | Decision | Principle | Rationale | Rejected |
|---|---|---|---|---|---|
| 1 | CEO | Trust-centered relaunch | completeness | Fixes identity and user trust without a rewrite | cosmetic fork, full rewrite |
| 2 | Legal | Preserve GPL notices in legal surfaces | correctness | Independent branding does not erase upstream copyright | deleting attribution |
| 3 | Product | Stay local-first and single-user | focus | Matches existing data model and strongest user value | hosted/team scope |
| 4 | Eng | Copy-first state migration | reversibility | A failed release cannot destroy a valued project | in-place destructive rename |
| 5 | Design | Operational workspace, not marketing UI | hierarchy | Users repeat dense knowledge work | hero/card redesign |
| 6 | Security | Authenticate and register clip targets | explicit | Localhost is not an authorization boundary | unauthenticated compatibility |
| 7 | Quality | Repair clean installs before typing around errors | root cause | Missing package declarations caused cascading errors | adding local `any` types |
| 8 | Reliability | Data-integrity P0 precedes new UX | blast radius | Current editor, chat, review, and ingest flows can lose or misapply data | feature-first sequencing |
| 9 | Review | Typed actions plus preview/undo | explicit | Localized strings cannot be an execution protocol | heuristic action parsing |
| 10 | Storage | Canonical relative page identity | correctness | Basenames collide across schema directories | keeping display slug as identity |

## Autoplan Review Report

### Phase 1: CEO Review

Mode: SELECTIVE EXPANSION

#### Premise Challenge

| Premise | Assessment | Decision |
|---|---|---|
| Users need more feature breadth | Rejected. Existing breadth is already high. | Prioritize trust, recovery, and coherent workflows. |
| A full rewrite creates ownership | Rejected. Ownership comes from governance, identity, and maintainability. | Preserve proven domain behavior and replace unsafe boundaries. |
| Localhost is a security boundary | Rejected. Browser origins and local processes can reach loopback. | Pair/authenticate every mutating local endpoint. |
| Plain Markdown alone guarantees portability | Partly false. Queues, chats, reviews, identity, and indexes also matter. | Ship manifest-backed backup and documented derived state. |
| Renaming the app is enough to be independent | Rejected. Updater, assets, package metadata, CI, releases, docs, and migrations remain coupled. | Centralize all project identity and release authority. |
| Completeness means adding everything | Rejected. Unfocused breadth weakens the core trust promise. | Complete the single-user local-first workflow and defer adjacent products. |

The user explicitly requested an independent, meticulous relaunch and asked the agent
to add overlooked improvements. The corrected premises above are accepted for execution.
GPL obligations remain a non-negotiable constraint rather than a taste decision.

#### Existing Code Leverage

The ingestion, search, graph, lint, review, research, provider, project, and MCP systems
already implement the differentiating knowledge workflow. The plan reuses them but moves
filesystem mutation, project identity, job ownership, and contracts behind typed,
validated boundaries. Parallel replacement implementations are rejected.

#### Dream State

```text
CURRENT
feature-rich local app with fragmented trust and operations
    |
    v
THIS PLAN
independent identity + secure boundaries + recoverable state + coherent UX
    |
    v
12-MONTH IDEAL
the dependable reference tool for source-grounded, portable personal knowledge,
with stable extension/API contracts and a contributor community that can ship safely
```

Dream-state delta after this plan: product trust, independent releases, data recovery,
extension/API stability, and contributor operations are established. Team collaboration,
hosted sync, and a plugin marketplace remain intentionally outside the product wedge.

#### Scope Decisions

Accepted expansions:

- Data-egress policy and secret-storage adapter, because privacy is part of the core job.
- Knowledge Health and operation center, because fragmented status creates silent failure.
- Verified backup/restore and project administration, because user-owned files must be
  recoverable rather than merely visible.
- Canonical page identity and transactional writes, because the existing behavior can
  silently corrupt or lose valued knowledge.
- Generated API contract and MCP packaging, because undocumented integration is not a
  usable open-source surface.

Deferred expansions:

- Full encryption, hosted sync, team access, marketplace, and additional providers.
- Source revision timeline beyond the provenance manifest and current/previous backup.
- Real-time collaboration and mobile clients.

#### Temporal Interrogation

| Stage | Decision resolved now |
|---|---|
| Foundations | GPL boundary, dynamic repository identity, canonical state paths, migration and rollback |
| Core logic | project-scoped IDs, transaction semantics, job IDs, egress policy, typed actions |
| Integration | extension pairing, API capabilities, secret redaction, app-data migration |
| Polish/tests | state matrix, accessibility contract, clean-install gate, release provenance |

#### CEO Dual Voices

Codex CLI was installed as an app alias but could not execute in this environment due
to an OS access denial. A fresh subagent attempt then hit the account usage limit. The
review therefore uses two already completed independent audits: product/JTBD and
architecture/security. This is degraded dual-voice mode, not cross-model consensus.

```text
CEO DUAL VOICES - CONSENSUS TABLE
===============================================================
Dimension                              Product   Arch/Sec  Result
1. Premises valid?                     mixed     mixed     CONFIRMED gaps
2. Right problem to solve?             yes       yes       CONFIRMED
3. Scope calibration correct?          narrow    narrow    CONFIRMED
4. Alternatives sufficiently explored? yes       yes       CONFIRMED
5. Competitive/adoption risks covered? mixed     n/a       SINGLE VOICE
6. Six-month trajectory sound?         yes*      yes*      CONFIRMED if P0 first
===============================================================
```

The shared high-confidence signal is that feature breadth is not the bottleneck. Trust,
operability, and state ownership are. A release that adds UI while leaving these defects
would be strategically worse than delaying the new UI.

#### CEO Sections 1-11

1. Architecture: current frontend orchestration and unrestricted generic filesystem
   commands create split ownership. Fix with project sessions and typed domain commands.
2. Errors: swallowed startup, autosave, import, and persistence failures violate the
   zero-silent-failure rule. Every failure enters diagnostics and a recovery state.
3. Security: clip ingress, conversation path construction, unauthenticated API mode,
   plaintext credentials, broad Tauri scopes, remote images, and dependency advisories
   are release blockers.
4. Data/interaction: cancellation, stale reads, double actions, partial ingest, source
   delete, and project switching need explicit state machines and idempotency.
5. Code quality: identity, graph, queue, and persistence contracts are duplicated.
   Consolidate contracts without a wholesale rewrite.
6. Tests: clean-install typecheck passes, but no mounted UI/E2E gate exists. Add focused
   regression tests for every P0 and contract test for extension/API/MCP.
7. Performance: repeated full wiki scans and eager primary views need indexing and lazy
   loading, but only after correctness.
8. Observability: introduce structured local errors, operation state, health checks, and
   redacted support bundles. No external telemetry is required.
9. Deployment: releases need version/tag validation, protected signing, checksums,
   attestations, SBOM, and migration notes.
10. Long term: canonical IDs and project sessions improve reversibility. Hosted/team
    features would push the architecture away from its strongest local-first property.
11. Design: the app needs operational hierarchy, first-run readiness, explicit states,
    responsive panels, and keyboard-accessible alternatives to graph-only information.

Phase 1 result: 24 concerns incorporated, 0 open premise decisions, 0 intentional
critical gaps. Proceed to design review.

### Phase 2: Design Review

No repository DESIGN.md existed. This plan now defines the initial design contract.
The optional gstack mockup binary was unavailable, so the review used source, existing
screenshots, DOM inspection of the welcome screen, and explicit text wireframes.

| Pass | Before | After plan fixes | Remaining work |
|---|---:|---:|---|
| Information architecture | 5 | 9 | Validate rendered navigation density |
| Interaction states | 3 | 9 | Implement all state rows |
| User journey | 4 | 9 | Runtime QA first-run and recovery |
| AI slop risk | 6 | 9 | Replace legacy assets and inspect screenshots |
| Design system | 3 | 8 | Create DESIGN.md and new brand assets |
| Responsive/accessibility | 2 | 9 | Browser and desktop automation |
| Unresolved decisions | 3 | 9 | Owner repository URL remains runtime-configured |

#### Design Litmus

```text
DESIGN LITMUS SCORECARD
===============================================================
1. Brand unmistakable in first screen?       PLAN YES / CURRENT PARTIAL
2. One strong visual anchor?                 PLAN YES / CURRENT WEAK
3. Scannable by headings/status?             PLAN YES / CURRENT MIXED
4. Each section has one job?                 PLAN YES / SETTINGS NO
5. Cards actually necessary?                 PLAN YES / CURRENT MIXED
6. Motion improves hierarchy?                PLAN YES / CURRENT UNSPECIFIED
7. Premium without decorative shadows?       PLAN YES / CURRENT YES
Hard rejections: nested decorative frontmatter card, fixed multi-panel squeeze
===============================================================
```

Specific fixes added to implementation:

- Product rail, contextual panel, primary workspace, and operation bar have separate jobs.
- Settings groups global and project scopes and uses atomic Apply/Revert feedback.
- Graph gains a synchronized semantic table and named controls.
- Trees gain tree semantics and arrow navigation; separators gain keyboard resizing.
- Dialogs trap and restore focus; reduced motion is a design-system primitive.
- Narrow windows collapse context and secondary panels instead of squeezing content.
- Korean becomes a first-class UI language with document `lang` synchronization.

Phase 2 result: design completeness raised from 4/10 to 9/10 in the plan. Visual QA is
required after implementation because mockup generation was unavailable.

### Phase 3: Engineering Review

#### Architecture Findings

```text
INPUTS
files | watcher | scheduler | extension | API/MCP
  |
  v
PROJECT SESSION
canonical project ID | path policy | job manager | repository
  |
  +--> staged ingest plan --> validated transaction --> files/index/review
  +--> versioned editor session ---------------------> files/index
  +--> typed review action --> preview/confirm ------> transaction + undo
  `--> health events --------------------------------> operation center
```

Ten architecture risks are accepted into scope: unauthenticated clip writes,
cancel-without-join, malformed-output success, corrupt-state overwrite, non-portable
replace semantics, destructive source deletion, basename identity collisions,
unversioned editor operations, split project authority, and API/graph contract drift.

#### Code Quality Findings

- The local dependency directory is corrupt; a clean `npm ci` from the same lockfile
  typechecks. Fix installation reproducibility instead of adding `any` annotations.
- `ingest.ts`, `graph-view.tsx`, Rust filesystem/file-sync/API modules are large, but
  extraction occurs only behind regression tests and existing domain boundaries.
- Fifty-two empty catches and twenty-nine silent Promise rejections require triage.
  Persistence, project switching, and user-triggered operations are fixed first.
- Duplicate graph, queue, renderer, and file-flattening logic moves behind shared typed
  contracts when touched by the scoped work.

#### Test Coverage Diagram

```text
P0 SECURITY AND DATA INTEGRITY
|- [GAP -> REQUIRED] clip auth, origin, UUID, body cap, rate limit, durable ack
|- [GAP -> REQUIRED] conversation ID traversal and corrupt persisted records
|- [GAP -> REQUIRED] editor late read, reordered save, navigation flush, write error
|- [GAP -> REQUIRED] chat preflight error, cancel, conversation switch, late completion
|- [GAP -> REQUIRED] typed review action, delete confirmation, backup, undo, failed action
|- [GAP -> REQUIRED] ingest cancel-and-join and late runner completion
|- [GAP -> REQUIRED] malformed model output cannot save cache or complete queue
|- [GAP -> REQUIRED] atomic write/backup/corruption quarantine on Windows semantics
|- [GAP -> REQUIRED] transient source delete creates tombstone, not cascade
`- [GAP -> REQUIRED] duplicate basename identities remain distinct

RELAUNCH FLOWS
|- [COMPONENT + E2E] first run, deferred provider, egress disclosure, first source
|- [COMPONENT + E2E] command palette keyboard navigation
|- [UNIT + E2E] health checks and repair actions
|- [RUST INTEGRATION] backup manifest, checksum, restore preflight
|- [CONTRACT] OpenAPI, MCP capabilities/version compatibility
|- [PARITY] en/zh/ko keys and document language
`- [VISUAL/A11Y] desktop and narrow window, focus, dialogs, reduced motion

EXISTING BASELINE
|- 102 frontend test files / 1,494 tests pass on clean install
|- MCP build and 14 tests pass
|- Rust exposes 127 tests; local execution blocked by missing GNU dlltool
`- Vite builds, with chunk and mixed-import warnings to remove or budget
```

#### Performance

Correctness comes first. Then lazy-load major views, remove ineffective mixed imports,
add a bundle budget, maintain an incremental content/graph index, and bound embedding
concurrency. Full-scan replacement is accepted only when regression parity is measured.

#### Failure Mode Assessment

The plan registry now names all critical failures, rescue behavior, user-visible state,
and required tests. Any P0 row without a passing regression test blocks release. There
are no accepted silent failures.

#### Engineering Consensus

```text
ENG CONSENSUS TABLE
===============================================================
Dimension                              Quality   Arch/Sec  Result
1. Architecture sound?                 no        no        CONFIRMED gaps
2. Test coverage sufficient?           no        no        CONFIRMED gaps
3. Performance risks addressed?        partial   partial   CONFIRMED plan
4. Security threats covered?           no        no        CONFIRMED blockers
5. Error paths handled?                 no        no        CONFIRMED blockers
6. Deployment risk manageable?         no        no        CONFIRMED blockers
===============================================================
```

Phase 3 result: 31 engineering findings incorporated, all high-severity findings have a
planned owner and test. Implementation must proceed P0 integrity, then trust/migration,
then UX/admin, then release/community.

### Cross-Phase Themes

1. Trust is the product, not a compliance appendix.
2. A single project session and canonical IDs remove security, race, and UX ambiguity.
3. Every long operation needs durable ownership, visible state, cancellation, and retry.
4. Independent open source ownership requires reproducible releases and contributor
   operations as much as new branding.

### Review Completion Summary

| Review | Status | Findings | Resolution |
|---|---|---:|---|
| CEO scope/strategy | CLEAR | 24 | Incorporated |
| Design plan | CLEAR WITH RUNTIME QA | 15 | Specifications added |
| Engineering plan | CLEAR FOR IMPLEMENTATION | 31 | P0-first sequence |
| Legal/license | CLEAR WITH GPL CONSTRAINT | 1 non-negotiable | Preserve legal notice |
| Outside voice | DEGRADED | Codex unavailable, subagent limit | Independent audits used |

No taste decision remains that blocks implementation. The user approved continued
execution after the audit findings were reported.

## Completion Definition

The work is complete when every scoped feature is implemented, documented, and tested;
all review findings are fixed or explicitly accepted with rationale; clean installation
and release builds are reproducible; migrated user data remains recoverable; and a
new contributor can operate the project without knowledge of the former repository.
