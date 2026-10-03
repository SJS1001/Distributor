# Local stock-journal transport receipt — 2026-10-03

Parent: `c4916be61f3c551b858e954c9fc4702aadd9e2b9`. Branch: `codex/local-distributor-checkpoint`. Environment: macOS arm64, Node 24.16.0; disposable synthetic CA/US stores and mocked network responses. Direct workstation commands only.

The [explicit transport](../STOCK-JOURNAL-TRANSPORT.md) connects issued native operations to scoped organization credentials and the sandbox adapter. It is disabled by default; no application route, CLI, startup or polling invokes it. Schema 12, dependencies and frontend are unchanged.

## Verification

Full native checks pass 2,202/2,202 in 83,854.800417 ms, with zero failures/skips/cancellations/todo. Focused transport/credential/protocol/queue checks pass 126/126 in 4,609.52075 ms. TypeScript and formatting pass. Planning structure/links pass: 230 Markdown files and 1,289 local links, structure only. All 511 tested inputs match the candidate. The [machine receipt](LOCAL-STOCK-JOURNAL-TRANSPORT-2026-10-03.json) binds those inputs and retained private artifacts.

Synthetic coverage includes CA/US exact original posting without source acceptance, disabled/buyer-only/wrong-binding refusal before claim, immutable configuration, atomic cached/refresh token receipts, expected-revision refusal, replacement during refresh and between guards/token/dispatch/retention, withdrawal/role/period/hold refusal, lost and changed receiver replies, explicit lookup-only reconciliation, misses and preexisting matches, preclaim/read/in-flight/post interruption, competing invocations, expired response versus successor, audit rollback, correction reversal order, restart without resend and refusal of asynchronous fences or a vault using a different database connection. Native queue process-race coverage remains in its historical receipt; the new competing-invocation test uses a mocked response barrier in one process.

Isolated production install/build/runtime passes: all 263 copied input hashes match and 69 development-only packages are absent. CA and US each pass two startup cycles, PDF/ZPL-8/ZPL-12 rendering and encrypted backup/restore with providers disabled. The existing production bundle warning remains. No fresh browser or static diagnostic qualification is claimed.

## Failures and self-review

Initial TypeScript checks exposed incorrect fixture policy spreading and nullable fixture typing. Initial transport checks expected a different reversal-order error than the native contract; corrected fixture checks pass. Failed and superseded logs remain separately retained privately. Self-review added same-transaction dispatch/result credential fences, an expected-revision token-access fence that distinguishes refresh from installation, refusal of a different database connection and asynchronous authority, and actual mocked in-flight abort coverage. Historical receipts remain unchanged.

Review checked immutable source/binding/lease authority, native ownership before every effect, one final dispatch, no automatic resend/lookup/cancellation, exact receiver validation, credential/key/consent/hold fences, stale result ownership, safe retained uncertainty and sanitized failures. Original repository modules and synthetic fixtures are used; no private source, new dependency or third-party code was copied. Raw logs, runtime data, keys, tokens and verification artifacts remain excluded.

## Limits and publication

Actual provider journal fields/terms, finance mappings/reconciliation, processor and infrastructure residency, devices, security, recovery and operators remain unqualified. Queue/history APIs and browser controls, explicit permission replacement, organization OAuth/company verification and remote revocation remain dependent coding. Original cancellation/fresh retry, multiple-date reconciliation, changed-journal/valuation corrections, durable restore activation and current Purolator contracts remain open. Transport interruption cannot recall provider processing already underway.

All 44 tasks and ten gates remain NOT VERIFIED; full-system work remains incomplete. No CI runner/job/workflow, live provider IO, account, delegated/cloud session, PR, merge or deployment is created. Fresh read-only GitHub checks confirm ADMIN/push permission, zero workflows and zero Actions runs. The current source/tests/docs snapshot is authorized for normal publication on the current branch; exact committed/remote verification follows.
