# Stock movement history — local engineering receipt

Partial D-013 engineering, 2026-10-02. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system remains incomplete.

## Candidate and environment

Parent `58435ecf50b039b840406e31e36b60d62ceb3604` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-STOCK-HISTORY-2026-10-02.json) binds 427 final source/test/configuration inputs, three production assets and retained private artifacts. Checks run directly on macOS arm64 with Node v24.16.0, npm 11.13.0, synthetic CA/US SQLite and a CA stock-history browser fixture on port 3145. Chromium uses the production React/Vite build. No CI runners, cloud sessions, delegated agents, actual providers or physical devices are used.

## Verified behavior

The [procedure](../STOCK-HISTORY.md) describes exact stock/serial selection, twenty-row live pages and current positions. Native checks cover equal timestamps, insertion order, restart, intervening movements, original serial/bulk quantity and costs, zero-value relocation records and conservation of persisted business facts. Current identity, password, role and warehouse access govern reads, including revoked/forged authority, hidden current stock, foreign organization/site rows and forged hidden cursor anchors. Strict HTTP checks reject ambiguous, unknown, blank or malformed fields and unauthenticated requests.

Two production browser journeys cover phone width with long references, twenty-row pages, failed older-page reads followed by identical-cursor retry, newer navigation, serial lookup, focus restoration and abandoned responses during close, navigation and sign-out. Native facts remain unchanged; browser journeys report no JavaScript errors. These synthetic observations establish no physical custody or device qualification.

## Verification

Complete native suite: **1,929/1,929 pass**. Complete production Chromium: **127/127 pass**. Focused native: **5/5 pass**; focused browser: **2/2 pass** before the final formatter memoization, which the complete browser run includes. Final TypeScript and formatting exit zero. The production build exits zero inside the full browser command, retaining the existing large-chunk warning.

Final changed-file React scans ten files and exits one with one error and three warnings. Inspection identifies the ordinary async `run` helper misclassified as a React state updater and a guarded loading reset already inside `finally`; existing App complexity and a small constant title-array lookup also remain. Memoizing the currency formatter resolves its earlier construction warning. No rules are suppressed and no clean full-project React or fresh isolated installation qualification is claimed.

Initial native checks failed on missing implementation/fixture options, missing HTTP Origin and SQLite row-prototype comparisons; corrected checks pass in later logs. Initial browser checks used the pre-feature build and failed; an overlapping launch refused an occupied fixture port, and one red trace could not be retained. Those failed logs remain separate. Private logs/diagnostics and available browser artifacts stay under `/tmp/distributor-stock-history-checkpoint`; published evidence contains metadata and hashes only.

## Review and limits

Self-review checks inventory ownership, fresh authority before selection/cursors, current warehouse custody and historical row visibility, scoped anchor resolution, SQL row limits and insertion order, current-position consistency, strict HTTP fields, business-fact conservation and browser retry/cancellation/focus/phone behavior. No schema, dependency, workflow, license or copied third-party/private code change. Staged-byte and selected credential-pattern review precede publication; runtime data, credentials, raw artifacts, dependencies and generated assets remain excluded.

The owner authorized publishing the current original Distributor source/tests/docs snapshot to SJS1001/Distributor. Read-only GitHub checks confirm push access, zero workflows and zero Actions runs; normal branch push and exact remote commit verification follow. No PR, merge, deployment, repository-setting change, provider activation or CI runner job is started.

History is per stock record: split bulk records remain separate, references remain text and complete cross-module serial lineage is unqualified. The compatibility serial endpoint remains unbounded. SQLite reads reserve the writer; row limits do not qualify scans, indexes, contention or production latency. Actual infrastructure residency, providers, devices, physical custody, production operations and human acceptance remain outstanding.
