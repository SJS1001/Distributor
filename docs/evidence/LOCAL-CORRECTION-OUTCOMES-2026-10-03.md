# Local correction ledger observation verification — 2026-10-03

Parent `c099996864863f35bd60fca5641571ee705e283a`, branch `codex/local-distributor-checkpoint`. Direct workstation checks on macOS arm64, Node 24.16.0 and production headless Chromium with disposable synthetic stores. The [machine receipt](LOCAL-CORRECTION-OUTCOMES-2026-10-03.json) binds tested source/configuration, browser assets and hashes of retained private evidence. No CI runner, workflow, delegated/cloud session, provider IO, PR, merge or deployment.

## Implemented scope

[Approved corrections](../ACCOUNTING-CORRECTIONS.md) now retain append-only operator ledger observations for each actual reversal/replacement leg. Evidence binds the immutable approved artifact, receiver/region/currency, intended balanced journal totals, approved posting date and previous observation revision. Unknown outcomes preserve the same request identity. Posted and cancelled/unposted outcomes are immutable; replacement posting evidence requires prior posted reversal evidence when a reversal exists. Permanent reference reservations prevent reuse by another leg or original cost acceptance, including after cancellation. Reads and cached writes require fresh finance authority; recovery holds refuse writes while retaining read access. Original stock, quantities, valuation, native balances, movement cutoff and approved files remain unchanged.

Billing exposes latest history, uncertainty resolution and partial posting outcomes. Exact active retries survive a lost reply, and closing/navigation discards abandoned responses. Reopening/reloading can recover committed evidence from the store. Uncommitted forms have no durable browser dossier. These are operator attestations, not independently verified receiver balances or journal transport. Evidence hashes detect inconsistent records within the tested application boundary; they do not prevent a privileged database administrator rewriting records and hashes together.

Schema 9 adds observation/reference storage. Independent version-eight DDL/fingerprints were captured from actual fresh stores at the published parent before edits. Version-one through version-eight fresh-file upgrades preserve existing rows; version-eight fixtures include nonempty approved corrections and policies. Current clones and encrypted isolated restores preserve unknown/resolved history, permanent references, approved file bytes and a preexisting hold in CA/US with both reporting profiles. A schema clone preserves an existing hold; it does not independently create one. Exact older encrypted archives remain refused.

## Verification history

Initial focused checks exposed a version-seven fixture variable-scope error and version-eight source/destination filename collision (six failures). A subsequent run exposed nested read transactions in the new history reader (seven failures); the reader now uses a private approved-file operation within a single transaction. Four later fixture failures incorrectly expected a schema clone to introduce a hold. The corrected fixtures isolate the source first and verify preservation. Earlier failed logs remain private and separately hashed. No timeout, refusal or test assertion was relaxed to obtain a pass.

## Fresh outcomes

- Full native suite: **2,029/2,029 passed**, zero failures/skips/cancellations, 81.5 seconds.
- Focused native/schema/recovery/accounting/restore review: **115/115 passed**, 6.6 seconds.
- Focused production Chromium: **2/2 passed**, including exact lost-reply retry, partial posting, immutable cancellation and committed evidence recovery after Close/reload.
- Complete production Chromium: **238/238 passed**, 4.0 minutes, with no timeout/configuration relaxation.
- Isolated production runtime checks pass for synthetic CA/US stores: two startup cycles each, authenticated PDF/ZPL-8/ZPL-12 outputs and encrypted backup/isolated restore. This is packaging evidence, not physical printing or production recovery qualification.
- Planning structure/link checks pass: 218 Markdown files and 1,209 local links; structure only.
- TypeScript, production build and formatting pass. The existing large-bundle warning remains.
- Fresh schema fingerprints match supported version 9 for both reporting profiles.
- React Doctor's requested `--diff` scan fell back to a full scan: **52/100, 43 errors, 207 warnings** across 475 scanned files. New-component `no-impure-state-updater` findings mistake ordinary async `run` callbacks for React setter callbacks; the loading-reset finding points to an owner-guarded reset inside `finally`. These reviewed false positives are not suppressed. Existing component complexity/size findings remain maintainability work; no clean static baseline is claimed.

Self-review covers fresh authority before cached writes, organization isolation, strict HTTP/CSRF validation, approved identity/hash/date/amount binding, reference permanence and collisions, optimistic revisions, terminal immutability, reversal ordering, retry, stock/cost/cursor conservation, current-schema upgrade and recovery hold preservation. Browser checks cover lost replies, partial history, cancellation, phone width, reload and abandoned responses. Private raw logs, stores and diagnostic artifacts are excluded from publication; dependencies/licenses and workflow configuration are unchanged.

The [coding inventory](../CODING-REMAINDER.md) retains dependent transport, further correction chains/new attempts after cancellation, valuation/quantity error treatment, restored-store activation/fencing and current authorized Purolator contract implementation. Actual finance evidence, operating policy, provider/device/residency/security/load/recovery/operator qualification and release acceptance remain unresolved. All 44 tasks and ten gates remain NOT VERIFIED. Full-system completion is not claimed.

## Publication

Publication review and normal authorized branch push remain pending. A companion documentation record will identify the published source commit and fresh remote/workflow checks.
