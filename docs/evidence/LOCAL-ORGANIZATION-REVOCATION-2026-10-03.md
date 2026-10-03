# Local native organization revocation receipt — 2026-10-03

Tested parent `0d0c91014f0565f4df4b31c82609a548dc75ba42`, branch `codex/local-distributor-checkpoint`, Node 24.16.0 on macOS arm64. The [machine receipt](LOCAL-ORGANIZATION-REVOCATION-2026-10-03.json) binds final source/test/configuration bytes, production runtime inputs and privately retained logs. Direct workstation engineering verification uses synthetic disposable CA/US stores and intercepted provider requests.

| Command | Actual outcome |
| --- | --- |
| Focused organization revocation | 30/30, zero failures/skips/cancellations |
| Full native `npm test` | 2,416/2,416, zero failures/skips/cancellations; 86,349.152875 ms |
| TypeScript and format | Pass |
| Isolated production runtime | Pass CA/US; 285 copied inputs matched, 69 development-only packages absent, 31 retained command outcomes including expected refusals |

The runtime builds and installs the isolated production application, starts each regional configuration, generates PDF/ZPL profiles and performs encrypted isolated restore. It does not contact providers or qualify physical hardware. Focused tests cover one exact revocation request after atomic local disable/callback cancellation, ambiguous and oversized responses, current-authority/revision fences, offline exact review, late responses, audit rollback, buyer isolation and interrupted-receipt restore. Independent published version-13 fixtures cover both regions/reporting profiles, nonempty organization OAuth history conservation and partial/lying-layout rejection across schema-14 upgrades. Current recovery refuses versions 1–13 encrypted archives.

Historical failures remain under ignored private `local-evidence/organization-revocation-2026-10-03`; hashes are in the machine receipt. Do not publish raw logs, runtime stores or preview credentials. No historical red or superseded receipt was overwritten. The first successful runtime check preceded a runtime documentation update and remains retained separately; the final runtime check matches all current runtime inputs. Both isolated runtime directories remain privately retained. No fresh browser suite or clean whole-project static diagnostic result is claimed; browser/dependency/license bytes are unchanged.

The owner-requested frontend and schema-14 backend remain running at loopback ports 5173 and 3000. A reviewed fresh-file clone preserved the old schema-13 synthetic preview store; frontend/direct/proxied health checks returned HTTP 200/CA, and the private sign-in file remains mode 0600. Live providers/carriers and both browser authorization flags remain disabled.

Protected CLI/HTTP/browser revocation exposure remains unimplemented. Actual provider outcomes and grant-wide semantics, external evidence truth, clock/memory/key custody, residency, devices, security, production load/recovery, operator and release qualification remain open. All 44 tasks/ten gates remain NOT VERIFIED; the full system is incomplete. No CI runner/workflow, new delegated session, PR, merge or deployment was used.

Final planning structure and local links pass: 44 tasks, ten gates, 258 Markdown files and 1,468 local links. This checks document structure only; all product gates remain NOT VERIFIED. The earlier receipt-link failure remains retained.
