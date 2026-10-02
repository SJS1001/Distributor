# Stock bin moves — local engineering receipt

Partial D-013 engineering, 2026-10-02. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system remains incomplete.

## Candidate and environment

Parent `2a3903a0ff8eee1fb5247dfef32720ecd522ad60` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-BIN-MOVES-2026-10-02.json) binds 422 final source/test/configuration inputs, three production assets and retained private command artifacts. Checks run directly on a macOS arm64 workstation with Node v24.16.0, npm 11.13.0, synthetic CA/US SQLite stores and the CA bin-move browser fixture on port 3144. Chromium uses the production React/Vite build. No CI runner, cloud session, actual provider or physical device is used.

## Verified behavior

The [procedure](../BIN-RELOCATION.md) describes review of the complete stock record. Native checks verify original cost, identity, serial, condition, warehouse, quantity and purchase lineage conservation; zero-quantity movement/cost control; exact saved receipt/audit; restart and updated supplier receipt candidates. An intact six-unit quarantined lot retains original cost and zero usable availability. A move invalidates earlier stock-count revisions.

Wrong source or serial, unchanged destination, stale revision, malformed evidence, sales/replacement reservations and a submitted missing-serial review refuse without native effects. Current forged/revoked site, password restrictions, deactivated identity, wrong role and hidden stock checks govern new/cached access. A late audit fault rolls back bin/revision, movement, cost sequence, event and receipt together. HTTP checks require origin/session/CSRF and exact fields. Independent processes race moves against another move or transfer; one wins while quantity, cost and identity remain conserved.

The two production browser journeys exercise phone-width staff controls, incorrect serial refusal, a committed response lost in transport followed by identical key/payload recovery with one native movement, stale concurrent inspection review, cancel/focus restoration and whole-lot quarantine movement. They assert retained quantity, cost, condition and warehouse, updated bin/revision, bounded screen width and no browser errors. These checks use typed synthetic scan inputs and establish no physical device qualification.

## Verification

Complete native suite: **1,924/1,924 pass**. Complete production Chromium: **125/125 pass**. Focused native checks: **9/9 pass**; focused browser checks: **2/2 pass**. Final TypeScript and formatting exit zero. Production build exits zero inside the full browser command, retaining the existing large-chunk warning. Explicit changed-file React scans six files, exits zero and reports one existing App complexity warning. The deprecated diff invocation instead scans 410 files and exits one with 39 errors and 179 warnings; those broader findings remain unresolved. No fresh isolated runtime installation or clean full-project React qualification is claimed.

Initial TypeScript/fixture checks failed on owner typing; initial native checks passed four of nine with SQLite row-prototype assertions, an incorrect password-restriction fixture table and missing HTTP origin. Corrected fixtures/assertions pass in separate subsequent logs. Historical failed logs are preserved, not overwritten. Private logs/diagnostics stay under `/tmp/distributor-bin-relocation-checkpoint`; published evidence contains metadata and hashes only.

## Review and limits

Self-review checks inventory ownership, fresh authority before cached replies, revision/source/serial guards, reservation and missing-review holds, transactional rollback, race conservation, zero original-cost effects, strict HTTP fields and browser exact retry/focus. No schema, dependency, workflow or third-party/private code change; existing notices remain. Staged-byte and selected credential-pattern review precede publication; private runtime data, dependencies, dist, credentials and raw verification artifacts remain excluded.

The owner authorized the current original Distributor source/tests/docs snapshot for SJS1001/Distributor. Read-only GitHub checks and exact remote verification accompany publication; no PR, merge, deployment, repository setting, provider activation or CI runner job is started. Publishing an engineering snapshot does not verify business acceptance.

Bins are trimmed text without a warehouse directory/capacity contract. Bulk lots move intact; partial moves and physical stock-location/label procedures remain unqualified. Exact native receipts survive restart, but the generic browser dialog does not restore the submitted review after reload/sign-out/storage loss. A historical receipt cannot assert current physical custody. Broader UI diagnostics, actual infrastructure residency, providers, devices, production load/operations and human acceptance remain outstanding.
