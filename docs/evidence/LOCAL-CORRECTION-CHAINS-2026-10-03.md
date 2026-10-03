# Local settled correction chain receipt — 2026-10-03

Tested parent `403f778564412a378d48cbe266bb60190ca4beee`, branch `codex/local-distributor-checkpoint`, Node 24.16.0 on macOS arm64. The [machine receipt](LOCAL-CORRECTION-CHAINS-2026-10-03.json) binds 574 tested source/test/configuration inputs, 290 production runtime inputs and privately retained evidence hashes. Input hashes were captured during the final native run after source/test changes and verified unchanged after checks. Direct workstation checks use disposable synthetic stores and intercepted provider boundaries.

| Check | Actual outcome |
| --- | --- |
| Focused correction chains and recovery | 30/30; zero failures/skips/cancellations; 3,763.693792 ms |
| Full native `npm test` | 2,453/2,453; zero failures/skips/cancellations; 91,907.395792 ms |
| TypeScript, format and production build | Pass |
| Isolated production runtime | Pass CA/US; 290 matching copied inputs, 69 development-only packages absent, 41 command outcomes including expected refusals |
| Existing first-correction browser journeys | 2/2; production Chromium; 20.9 seconds reported |

Public native/API checks cover posted CA/US successor corrections, separate review and competing drafts, exact receipt replay, predecessor write/retry fences, unresolved and cancelled outcomes, cancelled replacement without reversal, later posted replacements, changed policy, native pending/posting evidence agreement, strict HTTP fields/session/CSRF, complete retained ancestry integrity, restart and encrypted isolated restore. Restored history remains held; an intentionally damaged ancestor refuses download. Frozen historical schemas 1–14 are explicitly upgraded to version 15 in both regions and report profiles; old authenticated archives are not accepted implicitly.

The first full native run passed 2,441/2,452. Eleven recovery fixtures still assumed the old current version/index; those fixtures were repaired and the final complete suite passed. The expanded recovery check initially compared against an unheld cursor; the restored hold was correct, and the expected result was repaired. Earlier missing-guard and fixture failures remain retained. Initial browser launch lacked the npm binary path; the next startup timed out while checks ran concurrently. The final sequential run passed with the same browser configuration. These failures and narrower results are retained privately alongside final receipts.

The isolated runtime installs locked production dependencies without development tools, starts each regional server twice, generates PDF/ZPL and performs encrypted backup/restore. No actual provider network or production records are used. Dependency, license and frontend component bytes are unchanged; schema is now 15. Dedicated browser preparation for subsequent corrections remains pending. No fresh complete browser suite or clean whole-project static diagnostic result is claimed.

The frontend and backend remain running on loopback 5173/3000. Explicit fresh-file upgrade copied the private synthetic CA preview to schema 15 and preserved the schema-14 source. Frontend/direct/proxied health checks return HTTP 200/CA. Providers/carriers/browser authorization remain disabled. Private sign-in remains mode 0600; its contents were not read or published.

Further valuation/quantity corrections, durable restored-store activation/writer fencing/routing/reconciliation/rollback and actual provider/device/residency/security/load/recovery/operator/release qualification remain open. All 44 tasks/ten gates remain NOT VERIFIED; full system incomplete. No CI runner/workflow, new delegated/cloud session, live provider IO, PR, merge or deployment was used. Raw logs, runtime copies, synthetic stores, generated assets and preview credentials remain excluded from publication. Planning structure/local links are checked separately; this proves structure only.
