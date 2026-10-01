# Reviewed reservation deadlines — local engineering evidence

Parent commit `8ea55a078f9a1a2dd7a52586612b81b3c222de0d`, branch `codex/local-distributor-checkpoint`. This is partial engineering against D-016/D-019/D-021 and G3. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system remains incomplete. The [machine companion](LOCAL-RESERVATIONS-2026-10-01.json) binds the candidate, documentation, preserved historical evidence and available workstation logs.

Commercial/admin staff can explicitly set, renew or clear an open order's deadline using its current revision and a buyer-visible reason. There is no default timeout. Due deadlines block new allocations, positive quantity amendments and reserved-to-picked transitions. Reviewed expiry releases only unpicked units to backorder through Inventory; picked/packed units and accepted order money, credit exposure, invoices, physical stock and costs remain intact. History, revision, release, audit, event and command receipt commit together. Current actual grants precede reads and cached retries. Scoped history pages contain 20 rows; the phone interface retains records after continuation failure and cancels reads on navigation, Refresh or sign-out.

Independent review found that a backward server clock could permit new allocation after an explicitly committed expiry. The correction derives the persistent block from the latest immutable reservation action. Only an explicit deadline renewal or clearing resets it. A regression exercises clock rollback, restart, unpick/repeated expiry, renewal and unchanged financial facts.

| Final direct workstation check | Actual result |
| --- | --- |
| Full backend | 486/486 passed; zero fail/cancel/skip/todo; 18580.027875 ms |
| Full Chromium | 39/39 journeys passed; reported 1.3 minutes; production build 362 ms |
| TypeScript and source/test formatting | Passed |
| Planning structure and local links | Passed; confirms document structure only |
| Whitespace and historical evidence preservation | Passed |

All source/test/configuration changes preceded these final checks. The backend and browser terminal logs contain completed passing summaries and their processes ended; the host tool omitted their session/exit metadata. No numeric exit code is inferred for those two runs. Documentation, receipt and link/hash checks followed. Environment: macOS arm64, Node v24.16.0, npm 11.13.0, SQLite 3.53.0; synthetic isolated data and loopback Chromium.

The test worker's final focused run passed 19/19 in 3248.497 ms, including four real OS-process scenarios: expiry versus exact retry, cancellation, reserved picking and already-picked repeat. The parent clock regression passed 1/1; the corrected independent reproduction passed 5/5. The UI worker's final phone journey passed 1/1 in 5.9 seconds. These checks do not prove production timing, process termination recovery or customer/operator acceptance.

Three bounded local Codex app-server sessions completed: GPT-6.1 Sol / Medium for tests and UI, GPT-6 Astra / High for independent review. The launcher verified returned model/effort settings before work. Parent integration uses GPT-6.1 Sol / High. These are coding sessions on the workstation; no cloud repository checkout, CI job, local/self-hosted runner, GitHub-hosted runner, push or PR was started. Future Distributor CI remains GitHub-hosted after separate authorization and qualification.

Preserved evidence includes the initial narrower 466-test backend run, two parent TypeScript projection failures, the independent clock regression failure, and worker fixture/assertion mistakes involving SQLite's numeric hold flag, competing cancellation error codes and an accidental unrelated test replacement. The browser worker initially selected no tests and then a saved-cart row; its failed trace was copied before subsequent runs. Logs and worker events are retained under `/tmp/distributor-reservation-expiry`, `/tmp/distributor-expiry-workers` and `/tmp/distributor-reservation-ui-failures`; the independent reproduction files are also hashed in the companion. These temporary files are available on this workstation and may be removed externally; the committed companion records their hashes without publishing their content.

Dependencies, lockfile and license notices are unchanged; no third-party implementation was copied. Historical receipts remain byte-identical to the parent commit. No actual provider account/transaction, deployment, purchase, live-data ingestion, publication, repository settings change or OPUS/UB integration is authorized or performed by this checkpoint.

Remaining limits include approved expiry/renewal duties, automatic scheduling and notification delivery; actual providers/carriers/devices, customer/warehouse/finance acceptance and infrastructure residency; production clock monitoring, security, scale, locking, retention, tamper resistance, upgrades and recovery. Stop old writers before upgrade; mixed versions remain unqualified. Before an explicit committed expiry, due status uses wall-clock comparison. Releasing reservations preserves financial exposure and does not cancel the order.

Reproduce the local checks with `node --import tsx --test tests/reservation-expiry.test.ts tests/reservation-clock.test.ts`, `npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run format:check`, `npm run verify:plan` and `git diff --check`. The independent review harness lives outside the repository and is hashed in the companion.
