# Local separately approved correction retry verification — 2026-10-03

Parent `0ac28129f6e6a4032c40a51e5ff54026bbcbbc62`, branch `codex/local-distributor-checkpoint`. Direct workstation checks on macOS arm64, Node 24.16.0 and production headless Chromium with disposable synthetic stores. The [machine receipt](LOCAL-CORRECTION-RETRIES-2026-10-03.json) binds tested source/configuration, browser assets and hashes of retained private evidence. No CI runner, workflow, new delegated/cloud session, provider IO, PR, merge or deployment.

## Implemented scope

[Approved correction retries](../ACCOUNTING-CORRECTIONS.md) require final cancellation/non-posting evidence for the current attempt, a fresh request reference and a different current finance reviewer. Approval recomputes the frozen review against the exact current cancellation and unchanged policy. Journal bytes, date, amounts, receiver, region and currency remain exact. Unknown or posted outcomes, obsolete evidence, closed dates, changed policies, reused references and competing approvals refuse. Each approved attempt reserves its reference permanently and retains a separate append-only observation history; initial observations remain intact. Replacement posting evidence still requires current posted reversal evidence.

Native finance authority and recovery holds are checked before cached command receipts. Earlier exact receipts remain historical; a fresh observation for an earlier attempt refuses. HTTP contracts reject unknown fields and enforce session/origin/CSRF and organization scope. The Billing review supports two users, committed review recovery after reload, exact active lost-reply retries and read-only reserved references at phone width. Unsaved forms have no durable browser dossier. Cancellation of response handling never reverses a committed native operation.

Schema 10 adds retry review/reference/observation storage and a unique approved child per predecessor. Independent schema-nine DDL/fingerprints were captured from actual fresh stores at the published parent before edits. Fresh-file upgrades from exact versions 1–9 preserve prior facts and initial observations/reservations. Current held clones and encrypted isolated restores preserve retry chains in CA/US with both reporting profiles. A clone preserves an existing hold; it does not create one. Exact older encrypted archives remain refused.

These are approvals and operator evidence records. There is no journal transport, independent receiver verification, recalculation, changed-journal correction chain or protection against a privileged administrator rewriting database records and hashes together.

## Verification history

Initial TypeScript checking found two schema fixture variable-scope errors. Initial focused runs then found nine failures from obsolete version expectations and source/destination filename collisions, followed by four fixture foreign-key setup failures. Fixtures now use the independent frozen version-nine schema, distinct destinations and dependency-safe insertion. The initial focused browser run timed out on an ambiguous nested label association; explicit label/input associations corrected it. A one-off schema fingerprint helper imported a nonexistent inspection export; the corrected helper compares actual fresh inspected stores. Failed logs and the browser trace/error context remain private and separately hashed. Assertions, timeouts and refusal rules were not relaxed.

## Fresh outcomes

- Full native suite: **2,044/2,044 passed**, zero failures/skips/cancellations, 81.1 seconds.
- Focused native/schema/recovery/correction suite: **106/106 passed**, 7.3 seconds. Additional reference-namespace assertions pass **10/10**, 1.3 seconds; the full native suite includes them.
- Focused production Chromium: **1/1 passed**, 11.2 seconds including build/startup, before explicit button-type additions. The complete browser suite covers the final button markup.
- Complete production Chromium: **238/238 passed**, 4.1 minutes, covering the final source and button markup.
- Isolated production runtime checks pass for synthetic CA/US stores: two startup cycles each, authenticated PDF/ZPL-8/ZPL-12 outputs and encrypted backup/isolated restore. This is packaging evidence, not physical printing or production recovery qualification.
- TypeScript, production build and formatting pass; the existing large-bundle warning remains.
- Fresh version-ten fingerprints match supported profiles with optional reporting disabled/enabled.
- Planning structure/link check passes: 219 Markdown files and 1,217 local links; structure only.
- React Doctor's requested `--diff` scan fell back to a full scan: **52/100, 43 errors, 208 warnings** across 478 scanned files. Two new button-type warnings were fixed before the final scan. The ordinary async `run` callbacks and owner-guarded reset inside `finally` remain reviewed false positives in the observation component. The server JSON dereference uses retry input already checked against the frozen plan/hash and organization/leg; malformed input fails closed. Existing complexity/size and broader diagnostics remain open; no suppression or clean static baseline is claimed.

Self-review covers fresh authority before cached writes, organization isolation, strict HTTP/CSRF validation, exact approved journal and current cancellation binding, permanent reference namespaces, optimistic revisions, independent approval, terminal immutability, reversal ordering, stock/cost/cursor conservation and current-schema recovery holds. Browser evidence covers exact active lost replies, self-approval refusal, separate approval, reload, preserved initial history and phone width. There is no dedicated multi-process retry contention/load test or new retry-specific abandonment fault test; existing operation boundaries were reviewed. Private raw logs, stores, traces and diagnostic artifacts are excluded. Dependencies/licenses and workflows are unchanged.

The [coding inventory](../CODING-REMAINDER.md) retains actual ledger transport, changed-journal correction chains, valuation/quantity error treatment, restored-store activation/fencing and current authorized Purolator contract implementation. Actual finance/provider/device/residency/security/load/recovery/operator qualification and release acceptance remain unresolved. All 44 tasks and ten gates remain NOT VERIFIED. Full-system completion is not claimed.
