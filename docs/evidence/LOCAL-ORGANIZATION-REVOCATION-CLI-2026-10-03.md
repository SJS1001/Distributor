# Local protected organization revocation receipt — 2026-10-03

Tested parent `a6d83e63881a02cc7b79f7a38f2c3aa01656fdef`, branch `codex/local-distributor-checkpoint`, Node 24.16.0 on macOS arm64. The [machine receipt](LOCAL-ORGANIZATION-REVOCATION-CLI-2026-10-03.json) binds 564 tested source/test/configuration inputs, 286 production runtime inputs and privately retained evidence hashes. Direct workstation verification uses synthetic disposable CA/US stores and intercepts every provider request.

| Command | Actual outcome |
| --- | --- |
| Focused protected revocation commands | 6/6, zero failures/skips/cancellations |
| Full native `npm test` | 2,422/2,422, zero failures/skips/cancellations; 89,219.017791 ms |
| TypeScript and format | Pass |
| Isolated production runtime | Pass CA/US; 286 copied inputs matched, 69 development-only packages absent; 35 retained command outcomes including expected refusals |

Child-process checks cover one-shot revocation and exact no-resend replay in both regions; uncertain responses, withdrawal and restore holds; keyless offline status/review; exact review recovery and conflicting evidence; malformed UTF-8, excessive input, surplus fields/arguments and absent configuration before store creation; stale credential/permission/company stamps; binding isolation and redacted output. A preload intercepts every fetch and verifies URL, method, redirect policy, authorization, token body and exact request count. The runtime independently installs production dependencies, checks the default-disabled command boundaries, starts both regional configurations, produces PDF/ZPL profiles and performs encrypted isolated restore. Expected refusal commands exit 1; the overall harness passes their asserted outcomes.

The initial missing-module failure and earlier narrower green remain under ignored private `local-evidence/organization-revocation-cli-2026-10-03`; no historical evidence was overwritten. Raw logs, stores, generated private artifacts and preview credentials remain excluded from publication. Schema 14, browser and dependency/license bytes are unchanged. No fresh browser suite or clean full-project static diagnostic result is claimed.

The owner-requested frontend and backend remain running at loopback ports 5173 and 3000. Fresh frontend/direct/proxied health checks return HTTP 200/CA; the private sign-in remains mode 0600. Provider/carrier and browser authorization flags remain disabled.

HTTP/browser revocation exposure, actual vendor outcomes and grant-wide semantics, external evidence truth, infrastructure/key custody, residency, devices, security, load/recovery, operator and release qualification remain open. All 44 tasks/ten gates remain NOT VERIFIED; the full system is incomplete. No CI runner/workflow, new delegated session, PR, merge or deployment was used.

Planning structure and local links pass: 44 tasks, ten gates, 259 Markdown files and 1,473 local links. This checks document structure only; product gates remain NOT VERIFIED.
