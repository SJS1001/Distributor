# Local supplier finance follow-up — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-008/D-014/D-034 engineering relevant to CH-07/08. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete. Reviewer: Codex source review and workstation checks, without independent supplier/operator/finance acceptance.

Parent local commit `0a2fe41`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-SUPPLIER-FOLLOWUPS-2026-10-01.json) binds candidate, documents, available workstation logs and unchanged historical evidence. It excludes its own bytes from circular hashing; the subsequent actual local commit identifies the deliverable.

## Observed behavior and oracle

Procurement records immutable supplier credit observations, received replacement links, void evidence and reviewed closure/reopening. Actual current active identity, grants, organization and password rules precede cached commands and scoped history cursors. Warehouse history is limited to the original return handover site; finance/admin may record outcomes. Exact HTTP commands require session/CSRF; history accepts an existing scoped positive revision cursor and returns at most 20 descending observations without private hashes/cached results.

The synthetic phone fixture returns two bulk units at CAD 1,000 cents each (original cost 2,000), records a CAD 2,500 credit independently and links one separately received unit costing 1,200. Review rejects no-remedy with active outcomes, accepts reconciled closure, reopens and voids the original credit without deleting it. Twenty-one further one-cent credits produce active credit 21, replacement quantity one and revision 26. History continuation failure retains 20 rows; retry yields all 26. Original purchase orders, stock, invoices and customer credits are compared before/after and remain byte/value equivalent. Warehouse sign-in permits history but no finance controls. No cash or provider operation is inferred.

Backend fixtures also cover US/USD versus CA/CAD, wrong supplier/product/original PO rejection, active delivery allocation across returns, freeing capacity by void, wrong-return correction, stale revisions, permanent reference conflicts, restart, real restricted/forged/inactive identities and forced password changes. Separate processes prove one competing revision winner, stable identical-reference receipt across different command keys, and exactly one replacement allocation across two returns. A late audit fault rolls observation/event/command receipt back. Physical handover tests remain in the focused regression.

## Final checks

| Command | Actual outcome |
| --- | --- |
| `npx tsx --test tests/supplier-followups.test.ts tests/supplier-returns.test.ts` | PASS 15/15, zero fail/cancel/skip/todo, 2537.944375 ms, exit 0 |
| `npm test` | PASS 417/417, zero fail/cancel/skip/todo, 21761.168958 ms, exit 0 |
| `npm run build` + `npx playwright test --grep 'supplier finance'` | PASS 1/1, 5.2 s; new journey 2.2 s, exit 0 |
| `npm run test:e2e` | PASS 36/36, reported 1.2 minutes, exit 0; build PASS 294 ms |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |

No source/test/configuration edits follow these final passing checks. Planning/link validation, whitespace and independent hashes are recorded in the companion after document creation; planning structure proves no business or product gate. Temporary logs/copied traces are not a durable production archive.

Preserved failures: initial HTTP test lacked required options/await; the next fixture used the wrong session cookie; closure resolution assertions exposed an inconsistent error code, corrected to RESOLUTION. Initial browser navigation relied on stale pre-setup purchase data; reloading after synthetic setup corrected it. A later exact assertion expected `$25.00`, while the correct retained CAD history displayed `CA$25.00`; the assertion was corrected. The initial companion writer used an incorrect prior-receipt field name (`documentsSha256` instead of `documentationSha256`), so the first planning check failed its missing companion link; the writer was corrected and the final check passed. Copied failed traces/logs remain hashed alongside passes, and no failure counts as a pass. An earlier commentary suspected focus, but the failure snapshot demonstrated currency formatting; final source needed no focus correction for that assertion.

Self-review covers procurement ownership, current authority before cache, normalization/retained evidence, revision and global quantity contention, atomic late rollback, explicit closure/correction state, regional integer money, private projection, bounded/scoped continuation, retries and native-fact conservation. Dependencies, lockfile and license notices are unchanged; no third-party implementation was copied.

## Remaining qualification

No actual supplier credit note, replacement physical custody, accounting posting, cash settlement or finance sign-off is qualified. Recording a credit may exceed original stock cost and needs independent reconciliation; linking a delivery makes no current availability claim and never receives stock again. The app supplies text references without an attachment archive or supplier ledger. Approval/duties, original supplier records, production migrations, indexes/load/locking/clock/retention/tamper evidence/security/recovery/residency and independent human acceptance remain open. History bounds returned rows, but current return collections and aggregates are unqualified at production volume. Stop old writers before upgrade; mixed-version operation is unqualified.

Work remains direct workstation checks/local commits only: no CI jobs/runners, workflows/registrations, push/PR, actual provider account/request, live data, deployment/purchase, publication/settings changes or OPUS/UB integration. Future Distributor CI remains GitHub-hosted after separate authorization and qualification. No fresh remote-access claim is made.
