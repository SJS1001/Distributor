# Canceled Canada Post member disposition

Date: 2026-10-03. Independent carrier-only implementation on Distributor baseline `c006b554351ad4280f6329a1ec872717962f839d`, following preserved investigation commit `7985e73fb05d0892e8519e77c3e7a3d80c580612`. Requested Astra/High; effective runtime model/effort is not exposed and is not claimed.

## Capability

`CarrierBookings.reviewCanceledCanadaPostMember(actor, groupId, bookingId)` opens a native synchronous transaction and returns a bounded, recursively frozen, versioned disposition with `disposition: "canceled-unused-membership"` and `evidenceHash = sha256(canonical(body))`.

`CarrierBookings.canceledCanadaPostMemberDispositionInTransaction(actor, groupId, bookingId)` provides the same read for a future native consumer already holding the writer transaction. It refuses calls without that transaction. Both methods re-resolve the current actor, warehouse role/admin authority, password-change restriction and site access before returning evidence. They accept no caller-supplied evidence, SQL, provider outcome, adapter or transport. No HTTP route or actor-free maintenance entry point is added.

The result binds the requested organization/group/member, warehouse, provider group/configuration and complete sorted member set. Each member retains its native customer identity and hashes of immutable native snapshot, intent, configuration snapshot and current member/booking rows. Preparation/cancellation command evidence includes actor, key, request hash, receipt hash, audit hash and durable audit sequence. Group/entity/event evidence is separately hashed. Raw addresses, labels, secrets and cancellation reason text are not returned. Maximum native membership is 100; malformed larger sets fail before the ordinary group validator reads them. Receipt, audit and event lookups cap matches and reject duplicates.

This is a projection of retained local cancellation history. It does not qualify external non-creation/non-transmission, prove source inactivity after backup cutoff, settle a pending booking, grant restore approval or open the recovery hold. Root owns any future restore consumer and the binding of this evidence to its candidate generation/dossier. There is no automatic registration or restore-eligibility change.

## Evidence checked

The projection reuses the existing group/booking/intent, address, parcel and carrier-configuration validators. It additionally requires:

- Exact canceled group, deterministic provider group identity, no group claim/timestamp/manifest/observation, complete inactive pending membership and unchanged member review hashes.
- Retained group preparation result matching the complete reconstructed review hash, its original command audit, exactly one native group cancellation audit and exactly one cancellation command receipt. Cancellation payload is reconstructed from exact group/review/reason and checked against the retained request hash. Durable audit sequence establishes preparation before cancellation evidence before command completion.
- Exact preparation/cancellation event payloads, counts, versions and identity. Missing, duplicate or unexpected carrier entity history fails closed. Generic command audit records are distinguished from entity history even when a valid idempotency key equals a group or booking ID.
- Every member booking is pending or independently canceled with no claim, started timestamp, provider reference/tracking/label or error. A canceled booking additionally requires its own exact cancellation command/audit/events after group cancellation. A pending booking is explicitly returned with `canceled: null`; that booking remains a separate unresolved queue obligation.
- Retained Canada Post configuration in every booking, the same exact configuration snapshot and group hash, selected service, one identical Canadian origin and Canadian destinations. A legacy opaque group configuration hash without retained booking account configuration is unresolved; the projection cannot infer a carrier account.
- Current owning shipment/replacement reads agree with native organization/customer/site identity. Ordinary shipment immutable contents (order, address, mode, lines, units and creation identity) still match the reviewed snapshot, while later mutable handover status is not mistaken for an altered original. Replacement snapshots require exact current equality. The original booking's immediate predecessor must match retained sequence/target lineage and be canceled if present. This does not qualify another predecessor's independent recovery obligations.

Historical actors are retained evidence, not current approval authority; a newly authorized scoped reader can inspect the same receipt. Current external source fencing and post-cutoff truth must still come from the separately qualified dossier/operations authority. Locally consistent hashes are not cryptographic proof against a filesystem administrator who rewrites all underlying history coherently.

There is no broad inactive-member exception. Unknown/active members, provider artifacts, unsupported history and inconsistent receipts refuse projection. `CARRIER_DISPOSITION_UNRESOLVED` denotes the new evidence checks; existing native authority/integrity errors remain available. No original row, command receipt, audit, event, reservation, stock or invoice is rewritten.

## Verification

All commands were foreground cloud-local checks using synthetic data; no provider request, credential, runner, CI, push, deployment or product gate qualification.

The red-first native check used actual fixture APIs to create orders, pick/pack shipments, prepare configured Canada Post bookings, prepare/cancel their group and separately cancel bookings. Native cancellation semantics passed; both desired CA reporting-mode projection tests failed because the method was absent: **1 passed / 2 expected failures**. This is distinct from the earlier investigation's SQL predicate demonstrations.

Final dedicated checks: **52/52 passed**, zero skipped/canceled, 5,760.866297 ms. Coverage includes whole-database row conservation for successful and refused reads; reporting enabled/disabled; active recovery hold and restart; actual encrypted backup/restore in both modes; native pending booking distinction; current actor/site and required transaction; independent connection freshness; malformed/altered/missing command/audit/event evidence; configuration mismatch from actual native preparation; legacy configuration refusal; member-set/org/account/snapshot differences; active/unknown membership; group/member/booking claims and every retained provider artifact field; unexpected transmission history; bounded historical receipt metadata; and an uncalled network transport spy.

Affected existing regressions: **248/248 passed**, zero skipped/canceled, 35,199.709358 ms, covering `carrier-bookings`, `carrier-claim-review`, `carrier-configuration`, `replacement-carrier`, `canada-post-groups`, `canada-post-creation`, `canada-post-manifest`, and `canada-post-candidates`. Command form: `node --import tsx --test --test-concurrency=1` followed by those eight existing test files. TypeScript `tsc --noEmit` passed. Assigned Prettier and whitespace checks passed. No complete repository or browser suite is claimed.

Initial TSX CLI startup failed on a sandbox IPC socket (`EPERM`); `node --import tsx` ran the actual native tests without that CLI socket. Initial implementation run was 22/23: the missing-audit corruption fixture violated the audit-order foreign key before reaching the projection. The fixture now removes its dependent synthetic audit-order row first; later 23/23, 30/30 51/51 and final 52/52 checks passed. These earlier failures are retained in private scratch logs and are not described as production defects. No WAL guard prevented the encrypted restore tests; none was changed.

Byte comparison against the preserved parent proved every pre-existing carrier source byte unchanged after excluding the new projection and the added validator import. In particular:

| Existing native operation | Unchanged bytes | SHA-256                                                            |
| ------------------------- | --------------: | ------------------------------------------------------------------ |
| `cancelCanadaPostGroup`   |           2,577 | `f8d04094cd168ced489ba42cf60b88d33f49642852224a93a9d4963a036efd62` |
| `cancel`                  |           1,364 | `9f44f9210fc860be0f3a784a9085c7dd03bca30d6fb7eb23eff650c05120083e` |

Only the carrier source, dedicated new test and this new document belong to this increment. Restore/platform/application/integration-effect/HTTP/schema/dependency files, shared tracking, earlier investigation documents and other sessions' work remain outside it. Final receipt verification and activation wiring belong to root. Actual providers, regional operations, source fencing, financial reconciliation and product gates remain unqualified.
