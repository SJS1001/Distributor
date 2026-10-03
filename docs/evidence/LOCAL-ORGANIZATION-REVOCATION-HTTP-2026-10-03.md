# Local authenticated organization revocation HTTP receipt — 2026-10-03

Tested parent `ea323e74dd8f6bbc9911cf6504ab6d368b15755c`, branch `codex/local-distributor-checkpoint`, Node 24.16.0 on macOS arm64. The [machine receipt](LOCAL-ORGANIZATION-REVOCATION-HTTP-2026-10-03.json) binds 565 tested source/test/configuration inputs, 286 production runtime inputs and privately retained evidence hashes. Direct workstation checks use synthetic disposable CA/US stores and intercept every provider request.

| Command | Actual outcome |
| --- | --- |
| Focused native/browser-seam/HTTP checks | 68/68, including ten new HTTP checks; zero failures/skips/cancellations; 4,762.303042 ms |
| Full native `npm test` | 2,432/2,432; zero failures/skips/cancellations; 90,070.702458 ms |
| TypeScript and format | Pass |
| Isolated production runtime | Pass CA/US; all 286 copied inputs matched; 69 development-only packages absent; 35 retained command outcomes including expected refusals |

The new HTTP checks independently exercise CA/US disable-before-send, exactly one explicit request and no-resend recovery; uncertain outcomes and keyless offline history/review after withdrawal and restore hold; default-disabled configuration, current finance scope, Origin/CSRF, strict bounded payloads/query fields and company stamps; logout, role change or password reset during a pending request; password-change/MFA enrollment requirements through HTTP and native browser seams; exact disabled revision, nonempty evidence, conflicting review and actual-user auditing. All outbound requests are intercepted synthetic fetches. The isolated runtime installs production dependencies, checks disabled boundaries, starts both regional configurations, produces PDF/ZPL profiles and performs encrypted isolated restore. Expected refusal commands exit 1; the overall harness verifies these outcomes.

Initial absent-write and absent-offline-route failures and narrower green results remain under ignored `local-evidence/organization-revocation-http-2026-10-03`. Raw logs, stores, generated artifacts and preview credentials remain excluded from publication. No historical evidence was overwritten. Schema 14, browser component/test and dependency/license bytes are unchanged. No fresh browser suite or clean whole-project static diagnostic result is claimed.

The owner-requested frontend remains running at `http://127.0.0.1:5173/` (session 35082). Backend session 83189 stopped cleanly and session 69896 now runs the checked source at `http://127.0.0.1:3000/api/health`, retaining the separate private synthetic schema-14 CA store. The first restart command used a nonexistent script and exited; the existing `npm start` corrected it. Fresh frontend/direct/proxied health checks return HTTP 200/CA; private sign-in remains mode 0600 and its contents were not read. Providers, carriers and browser authorization remain disabled. Both servers remain running.

Dedicated browser revocation presentation, actual vendor outcomes and grant-wide semantics, external evidence truth, infrastructure/key custody, residency, devices, security, load/recovery, operator and release qualification remain open. All 44 tasks/ten gates remain NOT VERIFIED; the full system is incomplete. No CI runner/workflow, new delegated session, PR, merge or deployment was used.

Planning structure/local links pass: 44 tasks, ten gates, 260 Markdown files and 1,478 local links. This checks document structure only.
