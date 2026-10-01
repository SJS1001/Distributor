# Local recovery engineering receipt

Local date 2026-09-30; reviewer: Codex automated engineering checks. The bounded checks below passed. Every product task/gate remains NOT VERIFIED; full-system implementation is incomplete and its goal remains active. The [machine receipt](LOCAL-RECOVERY-2026-09-30.json) identifies exact uncommitted content and environment. There is no Git HEAD. Historical receipts remain unchanged.

## Scope and behavior

D-036/D-039 engineering work provides an operator CLI for encrypted, consistent regional SQLite backups and isolated restoration to a fresh destination. Read the [recovery runbook](../RECOVERY.md) before use. The CLI accepts a separately supplied 32-byte key through protected stdin, authenticates the archive manifest and ciphertext, validates actual schema/integrity/foreign keys/organization region, then invokes owning platform and identity operations in one transaction before publication. Restored sessions are removed and a durable provider hold persists across application reopen. No release/activation command exists.

The restore preserves historical command/effect/callback identities and states. Provider intent creation, sending, reconciliation, settlement lookup, callback claiming and the foreground worker reject before provider IO. Provider results/payment links are hidden in recovered workspace responses, and the UI displays the hold. A named customer residency exception cannot override it. Native operations remain available for isolated rehearsal; this does not establish safe production authority or automatically reconcile transactions after the snapshot.

## Reproduction and outcomes

- `npm run typecheck`: PASS, exit 0.
- `npx tsx --test tests/recovery.test.ts`: PASS, six tests, zero failures/skips; 724.38625 ms at the targeted run.
- `npm test`: PASS, exit 0; 53 tests, zero failures/skips; 1133.354625 ms at the final full run.
- `npm run test:e2e`: PASS, exit 0; production build and seven existing Chromium journeys, 9.9 seconds. Restore isolation is exercised by domain/process and HTTP tests; these browser journeys cover existing ordering, transfer, count, return and residency flows.
- `npm run format:check` and `python3 scripts/verify_plan.py`: final outcomes are recorded in the machine receipt. Structural validation is not product acceptance.

Six recovery tests exercise an open WAL source, cutoff quantity/value/money expectations, preserved retry identities, session invalidation, runtime/provider isolation, tampering/wrong keys, schema/region/path rejection, authenticated SQLite corruption, actual CLI processes racing publication and HTTP denial after restore. Adapter calls are synthetic; no actual provider request occurs.

## Independent expectations

The live source begins with three serialized units at 6,000 cents each, 18,000 cents. One handover produces an issued invoice of 11,300 cents; a manual payment of 4,000 cents leaves 7,300 outstanding. Backup occurs while the committed source WAL exists and is nonempty. Subsequent source payment of 2,000 cents and a second shipment must remain outside this snapshot.

The recovered store has two held units valued at 12,000 cents, one sold serial, one order, the original 11,300-cent invoice, 4,000 paid and 7,300 outstanding. Replaying the original cash command adds no payment. The original source retains its later second order, 6,000 paid and working original session; the copied session rejects with 401. A new recovered-store login succeeds, its dashboard exposes the hold and a checkout command returns 503/RECOVERY_HOLD without creating an intent. Close/reopen retains the hold.

A separate fixture contains a completed checkout with a payment URL, a pending QuickBooks effect and a pending callback at backup. QuickBooks execution completes on the original source after the backup. The recovered effect remains pending with its original identity; execution, reconciliation, settlement retrieval, callback claim, new intent and worker reject with RECOVERY_HOLD and zero adapter calls. Checkout results are suppressed and recovered cash remains zero. This demonstrates why a snapshot must not resend apparently pending effects without external reconciliation.

Wrong key, modified header/ciphertext/tag, truncation, region mismatch, altered schema and authenticated malformed SQLite publish no recovered database. Existing files, archive destinations and database sidecars remain untouched. Two independent restore CLI processes competing for the same fresh destination yield one successful publisher; the winner opens as an isolated store. Archives and restored files use mode 0600. Normal/error paths leave no staging directories. This does not test abrupt process death or power loss.

## Preserved failures and limits

Initial fixture assertions used nonexistent stock `unit_cost` (TS2339 and NaN versus 12,000), stock `condition` instead of lifecycle `state`, and invoice amount fields in a totals response containing only credited/paid/refunded/balance. Corrected the assertions to the public response fields and independently checked invoice total. An initial edit missed the totals assertion because of indentation; the intermediate full run passed 51 of 52 checks with that same remaining fixture failure. After correcting it and adding HTTP recovery isolation coverage, the targeted and full suites passed. No historical failure or receipt was removed.

The archive bound is a 2 GiB snapshot plus bounded header/tag; only the current exact schema is accepted. Operator filesystem authority, ancestor directories, key custody/rotation, qualified encrypted storage, crash cleanup, cancellation/capacity and sync-after-publication failure handling remain deployment concerns documented in the runbook. A region field cannot prove physical data location. No retention/scheduling/offsite infrastructure, source cutoff/import procedure, release/reconciliation process, production RPO/RTO, stale-grant review, production-sized load/restore, human operator acceptance or product gate is qualified.

Repository read-only inspection confirmed SJS1001 access to public, active SJS1001/Distributor with pull/push/admin/maintain/triage permissions, Actions enabled/all allowed/no required SHA pinning, zero workflows and a successful empty remote ref listing. Future PR/merge identity sjsmithbot and hosted runner OS/capability/usage-cost qualification remain pending. Distributor requires GitHub-hosted runners.

All files remain local/uncommitted/unpublished. No push, PR, remote mutation, workflow, runner registration, account, live-data ingestion, actual provider request, deployment or OPUS/UB integration occurred. See [implementation status](../IMPLEMENTATION.md) and [handoff](../HANDOFF.md) for remaining work.
