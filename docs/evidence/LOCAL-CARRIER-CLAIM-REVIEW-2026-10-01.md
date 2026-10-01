# Reviewed interrupted carrier claim release — 2026-10-01

**PASS within captured local regression scope. Full system incomplete; all 44 tasks/10 gates NOT VERIFIED.** Partial D-027/D-036, REQ-03/REQ-16/REQ-19 and CH-05/CH-07/CH-08/CH-09. Codex self-review; independent operator/provider/security acceptance outstanding.

Parent `c63fb7e48253465e31acc3c829b7ca049ae8444a` on `codex/local-distributor-checkpoint`. Candidate captured 2026-10-01T22:55:53.531528+00:00. The [companion](LOCAL-CARRIER-CLAIM-REVIEW-2026-10-01.json) binds 260 application/configuration/test inputs, 181 unchanged historical evidence files, 170 unchanged dependency license/notice files and private commands/logs. No schema/dependency/license change. Procedure: [carrier claim release](../CARRIER-BOOKINGS.md#reviewed-release-of-an-interrupted-carrier-claim).

Environment: direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0; disposable SQLite and Chromium. Original synthetic native shipments, injected paused send/creation/transmission/lookup callbacks and original synthetic PDF bytes. Tests deliberately age selected retained claims and replace selected tokens through disposable fixture writes. No actual provider or stopped production process.

| Check | Observed result |
| --- | --- |
| `npm test` | PASS 1228/1228, exit 0; 14 new reviewed-claim tests |
| Focused reviewed-claim tests | PASS 14/14, exit 0 |
| `npm run test:e2e` | PASS 55/55 plus production build, exit 0; existing browser regression, no new release UI |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |

Expected and observed: one currently active administrator can review an exact ordinary booking, Canada Post member or manifest claim. Review leaves every database row unchanged and returns state/start/selected age/earliest release/hash without its raw token. The selected minimum age has no automatic default. Too-young claims, replaced tokens, malformed age/hash/reason, changed payload under the same key, foreign records, tampered group hashes, inconsistent phases and unsafe stored times refuse release. Fresh active-role/password authority precedes reads and cached retries after successful release.

Actual paused native creation and manifest callbacks are released to unknown and then resumed. Late completion is refused; identities and all existing member/label facts remain retained. Member release leaves its pending sibling unchanged. Native stock/orders/shipments/invoices remain equal before and after release. A separate explicit read-only lookup recovers the exact existing effect without a second creation/transmission. An actual paused ordinary send and then paused lookup each lose claim ownership after exact review/release; a later read-only recovery confirms one original purchase and the older lookup cannot overwrite it. Ordinary uncertainty survives database restart. No resend becomes available.

Exact release results replay without additional rows/audits; audit faults roll back both the claim and command receipt. Tests verify all three authenticated no-store GET routes and the CSRF/idempotent durable command with carrier runtime processing disabled. Missing login, malformed/duplicate query values, unsupported extra fields and invalid CSRF are refused. HTTP manifest release also fences an actual paused native transmission. Provider disablement is not bypassed by release and native handover remains separate.

Preserved failures: initial focused run passed 5/7; a fixture expected CARRIER_MISMATCH instead of the existing exact-field CARRIER_RESULT error, and a GET query schema incorrectly expected an integer despite disabled HTTP coercion. Corrected the error expectation and strict canonical string query parsing. Expanded fixtures incorrectly added a nonexistent booking field to the native snapshot, widened a PDF media type, and updated a password-security row absent from bootstrap. Corrected native equality/explicit booking reads, typed media value and inserted the test security row. A combined ordinary/manifest HTTP fixture lost its TypeScript narrowing, then an incomplete edit left an undeclared local; corrected its explicit optional manifest fixture. These are retained intermediate logs, not hidden successful runs. All final assertions remain meaningful native/claim/HTTP checks.

Self-review inspected exact task-shaped targets, current actor/password/record ownership and immutable review checks before cached replay, transactional age/hash/phase/time enforcement, integration-only writes, unknown-only outcomes, retained manifest/member data, human audit/receipt rollback, and late callback guards. This evidence is synthetic local engineering, not actual provider/process/operator acceptance.

Remaining: browser claim-release controls; qualified process termination and deadlines/clock policy/monitoring; external account writers; actual carrier credentials/account/protocol/service/fees/terms/residency, physical devices, regional infrastructure, independent security/load/retention/recovery and human acceptance. FedEx synchronous lost-response lookup remains unsupported. Private temporary logs have no archival guarantee. Direct workstation/local commits only; no CI/cloud/delegation/provider request/push/PR/deployment/publication/purchase/live data or OPUS/UB integration. All product gates remain NOT VERIFIED.
