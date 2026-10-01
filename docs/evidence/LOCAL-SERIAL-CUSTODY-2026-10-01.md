# Local serialized custody review and recovery — 2026-10-01

Status: **PASS for the bounded synthetic workstation checks below**. Partial D-015/D-026/D-029 engineering evidence relevant to G2/G5; all 44 tasks and 10 product gates remain **NOT VERIFIED**. Full-system work remains incomplete. Reviewer: Codex automated checks and source review, without independent human warehouse/finance acceptance.

Parent: `b0eb55a841dc5c4d286a9ddeec3a486024f2ce65`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-SERIAL-CUSTODY-2026-10-01.json) binds candidate source/tests/configuration, documentation, workstation logs and unchanged historical evidence. It excludes its own bytes to avoid a circular hash. The eventual local commit identifies these exact files; no commit hash is inferred from an intended command.

## Behavior and independent reconciliation

Warehouse staff with current site access can report an unreserved quarantined serial as missing using its expected identity, current revision, unique review reference and search evidence. Reporting preserves one expected book unit and original cost; it does not assert physical custody. An administrator's approval requires the unchanged original stock snapshot and no order/replacement reservations. Approval removes one book unit/value, retains the original serial/unit/procurement identity as zero-quantity quarantine and records a negative original-cost movement. Rejection retains evidence without changing quantity/value.

A warehouse recovery scans the exact originally lost serial, supplies a unique recovery reference, current revision, recovered bin and reason. It restores the same unit at the original site/cost to quarantine with a positive original-cost movement. Inspection is required before availability. Inspection and return disposition refuse absent stock. Neither observation, approval nor recovery changes orders, invoices, credits, cash, customer exposure or external accounting facts; cost movements are available to the separate reviewed accounting handoff.

The backend fixture starts with 18,000 cents of stock cost. Serialized short-pick/quarantine and missing observation retain 18,000 cents. Approval of the 6,000-cent unit reduces it to 12,000; scanned recovery restores 18,000. Trace contains exactly one `serial.loss` of −1 and one `serial.recovery` of +1, both at 6,000 cents referencing the same review. Original unit ID, serial, purchase origin, site and unit cost survive. Recovered quarantine has no availability until explicit inspection and later allocation. Repeated custody cycles retain separate permanent reviews and references.

Current identity, active status, roles, sites and password requirements precede cached command results and history. Exact request retries and normalized business-reference retries under new keys return saved results; altered evidence conflicts. Review/unit/movement sequence/audit/event/receipt mutations share the platform transaction. History filters current sites before timestamp/ID pagination, returns up to 20 rows, excludes receipt hashes, rejects foreign-site cursors and returns an empty page for an empty grant.

## Workstation verification

Environment: macOS arm64, Node 24.16.0, npm 11.13.0, SQLite 3.53.0; disposable synthetic databases and loopback headless Chromium. Logs remain under `/tmp/distributor-serial-custody`; the machine companion records their hashes. Temporary workstation logs are not a durable production evidence archive.

| Command / scope | Actual outcome |
| --- | --- |
| `npm run typecheck` | Final PASS, `type-self-review.log`. |
| `npm exec -- tsx --test tests/serial-custody.test.ts tests/short-picks.test.ts tests/fulfillment.test.ts` | Earlier focused PASS 27/27, 1707.139541 ms, `focused-final.log`; before the additional absent-stock disposition guard. |
| `npm test` | Final PASS 332/332, 22461.966208 ms, zero failed/canceled/skipped/todo, `node-self-review.log`; includes the final absent-stock guard. |
| `npm run format:check` | Final PASS, `format-self-review.log`. |
| `npm run test:e2e -- --grep 'browser: serial loss'` | Earlier focused PASS 1/1, 4.4 s; journey 1.4 s, `browser-initial.log`. |
| `npm run test:e2e` | Final build PASS, 113 ms; 26/26 journeys PASS, 55.4 s; new custody journey 1.5 s, `browser-self-review.log`. |

Browser execution uses the repository's `node_modules/.bin` in PATH for its local web server. Planning/link and whitespace checks are performed after writing this receipt and recorded separately in the companion. They establish documentation consistency, not gate acceptance. No source/test/configuration changes follow these final checks in this checkpoint.

Eleven new backend scenarios cover observation/approval/recovery reconciliation, restarted exact and new-key retries, repeated reviews/reference conflicts, stale stock and conflicting reservations, changed original cost/identity, current restrictions before cached operations, tied-timestamp and site-scoped pages, strict HTTP/origin/CSRF/schema controls, three late-audit rollback paths, and two actual child processes racing different recovery references. The race permits one recovery and one conflict, one positive movement and one restored unit. Audit fault injection demonstrates transaction rollback; it is not a process-kill or storage-failure rehearsal.

The browser creates one 6,000-cent serial in quarantine and 24 rejected historical observations, then submits the 25th through the UI. An interrupted next-page read retains the first 20 rows; retry loads 25. Administrator approval sets book quantity to zero. Recovery deliberately loses an already committed response; the retry uses the same key and restores one unit to the entered bin in quarantine. Original orders/invoices remain identical. History shows recovery evidence; narrow-screen overflow, Escape dismissal and JavaScript page errors are checked. Synthetic scanning is typed input, without a qualified physical device.

## Preserved failures and self-review

Initial typing incorrectly read revision from an order-accept result containing only its ID; the fixture now reads the owning order. A later empty-site assertion edit referred to an out-of-scope variable; corrected its loop binding. Both failed type logs remain. The initial focused run used `json_each`, whose virtual table access was rejected by the module authorizer. Replaced it with bound site placeholders without relaxing ownership. The subsequent run passed 26/27: an empty-site history should return no rows, while mutations remain forbidden; corrected that assertion. The final focused/full checks pass.

The first planning check failed because fulfillment documentation linked this receipt before it existed; `plan-final.log` remains as failed historical evidence. A previous chat response claimed commit `c826635`, although no commit had been made. Current git inspection established HEAD `b0eb55a`; the status response corrected that claim. This receipt and the subsequent local commit close the unfinished checkpoint; no fabricated commit is treated as evidence.

Source self-review checked original cost/identity retention, quantity-versus-physical-custody wording, stale snapshot rules, current authority before receipts, reservation protection, strict HTTP, module ownership, transaction rollback, sequence reconciliation, tuple pagination and browser retries. It found the return-disposition path also needed to refuse zero-quantity serials; added the guard and all three disposition rejection assertions, then reran full backend/type/format/browser checks. Dependencies, lockfile and third-party notices remain unchanged; no third-party implementation was copied. Historical evidence is independently compared with parent git objects. The instructed global predecessor HANDOVER.md remains unavailable at its path.

## Limits and continuation

Physical search/loss/recovery evidence, real operators and warehouse/finance approval policies remain unqualified. An administrator can observe and decide their own review under the provisional policy; configurable duties, attachments, disputes, corrections/reversals and cross-site recovery remain open. Observation does not freeze stock; later changes require rejection and fresh evidence. History pages bound server rows, while loaded browser text accumulates. Clock ordering, indexes/load, synchronous SQLite locks, migration/retention/archive/termination/restore/security and actual regional residency require production evidence. Real carriers/devices/providers and all product gates remain open.

Continue other fulfillment exceptions, accounting/import identities and provider/operator boundaries, individual carrier/device support and production/human acceptance. Execution remains direct workstation verification and local commits only. No CI runner/job, workflow/registration, push/PR, deployment/purchase, provider account/actual provider request, live data, publication/settings change or OPUS/UB integration occurred. Future Distributor CI remains GitHub-hosted after separate authorization and qualification; no fresh remote-access claim is made.
