# Customer record backend verification — 2026-10-05

Workstation evidence against the uncommitted customer-record backend changes based on `11aabaf967671b7bf78a37d8e753beccaba0e6a8`, schema 29. This receipt covers backend contracts and migration, not a deployment, UI acceptance, live data qualification or a passed product gate.

## Implemented contracts

IAM owns durable contact records. `GET /api/accounts/:accountId/contacts` returns `{items,canManage}`. `POST /api/commands/account.contact.save` uses the normal authenticated command/CSRF gate and required idempotency key. Shared payload and result types are in `src/shared/customer-record.ts`.

Administrators, commercial, finance and support staff can create, edit, archive and restore contacts. Warehouse and warranty staff can read contacts. Buyers cannot read or write contacts. Current authority and account custody are checked before cached results are returned. The server records creator, creation time, latest editor and latest edit time. Every successful edit records the old and new contact in the existing audit owner. Contact records do not provision users or grant account access.

Create requires expected revision zero; subsequent edits require the current revision. Empty optional title/email/phone fields are allowed. Name is required (maximum 200 characters), title maximum 200, email maximum 254 with basic email shape validation, and phone maximum 80. Archive is reversible; there is no delete operation. The pilot cap is 100 total contacts per customer, including archived records. Reaching it returns an explicit conflict while allowing existing records to be edited.

Orders, invoice and cash-payment page operations accept an optional exact `accountId`. They validate current customer custody before querying and filter before the page limit. Cursors must belong to the requested customer. Invoice cursors additionally encode the selected account and state. Existing organization, buyer, warehouse-site and financial-role gates remain in effect. Cash-payment history remains restricted to administrators, finance and support; the new filter does not expand its audience.

Payment terms continue to use the existing Billing profile operation and versioned profile command. No payment terms or transaction history are synthesized by the new contacts module.

## Verification

- `npm run typecheck`: passed.
- Focused customer record, historical schema and recovery suite: **231 tests passed**, zero failures. Command covered `customer-record.test.ts`, `schema29-customer-contacts.test.ts`, `schema28-record-notes.test.ts`, `schema22-offline-owners.test.ts`, `schema23-incoming-supply.test.ts`, `schema-upgrade.test.ts`, `payment-history.test.ts`, `order-pages.test.ts`, `restore-activation.test.ts`, `integration-offline-refund-provenance.test.ts`, and `recovery-profiles.test.ts`.
- Existing invoice queue suite: **9 tests passed**, zero failures.
- New regressions prove contact durability/replay after restart, payload mismatch refusal, stale revision refusal, archive/restore with old/new audit facts, cap enforcement, strict input/server identity boundaries, session/CSRF requirements, all six staff/buyer role boundaries, lost authority on exact HTTP replay, buyer cross-account refusal, unknown/foreign account refusal, warehouse site filtering and account-bound continuation.
- Frozen schema-28 profiles independently reconstruct the old schema and seed orders, shipments, invoices, MSRP and an independently verified note. Explicit clone upgrade preserves every preexisting table row, source bytes, original initialization time and note append-only protections. The new contacts table starts empty, and a new contact works after opening the upgraded target. Startup refuses an implicit upgrade.
- Historical fixture builders now remove the new contact table before asserting older frozen hashes; no existing frozen manifest or production schema fingerprint was weakened. Initial fixture/test failures (incorrect synthetic SQL columns/uniqueness, then a schema23 test owner mapping missing IAM) were corrected before the final green run. Self-review also found padded account identifiers could validate a trimmed account but store a different identifier; exact-ID validation and regression now reject them.

Local raw logs are excluded from publication: `local-evidence/customer-record-20261005/backend-focused.log`, `invoice-queue.log`, and `typecheck.log`.

## Schema identity

Schema 29 with reports disabled: `436fbc3aa06ecc262dd24c7331cce92bf788d953eccdcf399d66b2ef6add4975`.

Schema 29 with reports enabled: `5593a454c0963d61d717eb07c41e3fb008602656833dd1fb07a438c0defa62e6`.

Release needs the existing explicit clone-upgrade procedure and coordinated runtime switch. No deployment, CI job, provider call or live write was performed in this lane. Full integrated verification and browser recovery/isolation evidence belong to the coordinating and frontend lanes.
