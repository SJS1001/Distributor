# Operations health — local engineering receipt

Partial D-036 engineering, 2026-10-02. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system remains incomplete.

## Candidate and environment

Parent `a842877b61b2e07d329baebb77f7151a38c52d77` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-OPERATIONS-HEALTH-2026-10-02.json) binds 413 final source/test/configuration inputs, three production assets, command outcomes and retained private artifact hashes. Direct macOS arm64 workstation checks use Node v24.16.0, npm 11.13.0, synthetic native CA/US SQLite stores and a CA phone browser fixture on local port 3150. Production Chromium exercises the actual React/Vite build. No CI runner, cloud session, real provider or physical device is used.

## Verified behavior

The [operations health procedure](../OPERATIONS-HEALTH.md) describes eleven fixed organization-wide queue observations. Native checks cover 34 pending Stripe effects beyond ordinary twenty-item pages, one unknown effect, completed but unsettled refund outcomes, locally due versus future callbacks, unknown native refunds/carrier groups/bookings, active Canada Post membership and retained event delivery states. Foreign organization effects do not affect local counts or creation age. Consumer-disabled history, an expired lease and retained completion survive restart in both regions.

Persisted support authority applies before empty results. Cached/forged role claims, removed roles, deactivation and required password change are refused. The application and each owning module recheck access. Whole persisted-table row dumps remain equal before and after native reads and restart. HTTP verification checks unauthenticated refusal, authenticated success, no-store headers, a boolean recovery hold, consumer registration and row conservation. Private customer/provider/address/error/claim/recovery markers do not appear in the response.

The new phone browser journey checks full queue counts, creation time, operator-review labels, unsettled refunds, disabled-consumer history, recovery hold, redaction, real no-store API reads and phone-width fit. A refused refresh removes the previous report; retry restores it. Held responses released after navigation or sign-out do not reopen the screen or expose their result. Source review additionally checks the newer-request and application-refresh cancellation fences; no independent same-screen supersession or global-refresh browser fault is claimed by this new journey.

## Verification and preserved failures

Complete native suite: **1,911/1,911 pass**. Corrected focused native checks: **4/4 pass**. Complete production Chromium: **122/122 pass**, including the new phone journey. Corrected focused phone journey: **1/1 pass**. Final TypeScript and formatting exit zero. Production build exits zero and retains its existing large-chunk warning. Native implementation and native test inputs did not change after the full native run; final button/help text and browser import/route-cleanup corrections followed it and were exercised in the final complete production-browser run.

Changed React diagnostics exit zero, with two warnings and no reported errors: existing App complexity, and a loading-flag diagnostic on the new screen. Source review finds the loading reset inside `finally`, guarded by the active request identity so an abandoned request cannot clear its successor's loading state. This warning remains recorded without suppression. No clean full-project React or fresh isolated production-only runtime qualification is claimed.

Original failures remain private under `/tmp/distributor-operations-health-checkpoint`. The initial native run failed two null-prototype versus ordinary-object deep assertions; normalized assertion rows corrected that fixture comparison. The next focused run expected an event completion but its fixture supplied too few events; four explicit synthetic events corrected the setup. The final focused/full outcomes are separate. Initial TypeScript rejected a three-argument Playwright `unroute` call; the browser cleanup now uses typed `unrouteAll({ behavior: "wait" })`, with corrected focused and full browser runs. No original log is overwritten or represented as passing.

## Review, publication and limits

Self-review checked owning-table boundaries, current organization/role/password authority, one consistent native transaction, fixed small response aggregates, JSON validity guards, local due-time semantics, private-field omission, persisted-row conservation, cancellation and separate financial authority. No schema, dependency or license change; no third-party/private code was copied. Selected credential-pattern review finds no matches in changed files. Private runtime data, dependencies, dist, logs/traces and credentials remain excluded from git.

The owner authorized committing and pushing the current original Distributor source/tests/docs snapshot to SJS1001/Distributor. Read-only access checks confirm push permission, zero workflows and zero Actions runs before publication. No PR, merge, deployment, settings change, provider activation or runner job is started. Final structure, whitespace, input-byte and publication checks are recorded separately from business acceptance.

Creation age is not time in a state; serving-process registration is not a worker heartbeat. Historical and overlapping queues are not unique outstanding business transactions. Due counts do not authorize transport or establish external outcomes. Full scans, JSON checks and the existing writer-reserving transaction require production load/lock qualification. Physical/bank/provider agreement, actual infrastructure residency, monitoring thresholds/alerts, incident deadlines, devices and human acceptance remain outstanding.
