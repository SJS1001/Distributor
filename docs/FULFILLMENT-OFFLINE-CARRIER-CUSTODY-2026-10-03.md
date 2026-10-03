# Bounded native packed carrier custody review

Date: 2026-10-03. Excluded public baseline:
`48f94e6ff1b31d02a5ed74483eb11df2c36859e7`, tree
`c6df538587e04839c78a2534e0c4d3b0015d5142`.
Only [Fulfillment](../src/server/fulfillment.ts), the new
[native tests](../tests/fulfillment-offline-carrier-custody.test.ts) and this
report belong to this assignment. The earlier carrier/Platform delivery remains
separate; it is not resent or required in this baseline. Root owns composition.

Requested model/effort: gpt-6-astra/high under the owner’s delegated model rule.
The runtime exposes no effective model/effort setting, so neither is verified.
Read AGENTS, README, PLAN, DECISIONS and the current HANDOFF guidance. No nested
agents, provider calls, CI, workflow, publication or runtime integration occurred.

## Implemented task and exact result

`Fulfillment.reviewPackedCarrierCustodyInTransaction(actor, shipmentId)` requires
an existing native Database writer transaction. It neither starts a transaction
nor performs a command. It refreshes the actor with Identity.currentActor,
requires native warehouse permission (admin retains the existing override),
checks the current password-change restriction and organization, and checks the
persisted shipment’s current site with the native site function. Cached roles,
sites and caller-supplied organization changes do not supply authority.

The new `PackedCarrierCustodyReview` type contains:

- `version: "fulfillment-packed-carrier-custody/v1"`.
- `shipment`: the exact 15-column native `Shipment` tuple, preserving all strings,
  nulls, packed line order and original compact JSON bytes.
- `allocations`: ordered, detached `{ allocationId, quantity }` records.
- `history`: exact zero counts for coverage, compatibility delivery and delivery
  observations in this accepted subtype.
- `custodyHash`: lowercase SHA-256 of core.canonical over the preceding four
  fields, excluding the hash itself. The version participates in the digest.

The result, shipment, allocation array, each allocation and history are frozen.
There are no Buffers, dates, stores, executable ports, callbacks or mutable owner
objects in the result. The method accepts no evidence, snapshots or SQL. All SQL
identifiers are fixed in Fulfillment. A later changed native row yields changed
facts/hash; an earlier result stays detached. A caller must use the same writer
transaction when comparing other owners’ facts. This hash is not a durable
reservation, proof of provenance, transport permit or approval.

## Bounds before materialization

The new method is at fulfillment.ts:173; its type is at :49. It uses only the
existing Fulfillment-owned store and existing Identity task operations. No DDL,
schema version, migrations or constructor initialization behavior changes. The
existing Database constructor argument is retained as a private field solely to
call requireTransaction.

| Data                                    | SQL preflight before fetch/parse                                                                                               | Accepted bound                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Target shipment                         | `count(*)`, sum of type/width violations, `sum` and `max` of all 15 UTF-8 column widths; selection by exact id and current org | Exactly one row                                              |
| Lines and units                         | `length(CAST(column AS BLOB))`, text required                                                                                  | Each at most 32,768 bytes                                    |
| Address                                 | Same UTF-8/BLOB width check, text required                                                                                     | At most 8,000 bytes, then native 2,000 JavaScript characters |
| Other shipment scalars                  | Explicit text or nullable-text type and UTF-8 width checks for every returned column                                           | Each at most 4,096 bytes                                     |
| Entire selected tuple                   | SQL per-row maximum and aggregate sum of all widths                                                                            | At most 49,152 bytes                                         |
| Coverage, delivery and delivery history | Three complete `count(*)` subqueries by shipment id, with no org/state/revision/latest filter                                  | Each count must be zero; no history payload is ever fetched  |
| Parsed allocations                      | Parse only after byte preflight; inspect exact fields and shape before any reserialization/canonical hash                      | 1–100 unique allocations; safe integer quantity 1–100,000    |
| Units                                   | Exact native empty JSON bytes checked after SQL byte preflight                                                                 | Exactly `[]`; no unit materialization or parsing             |

Identifiers are nonblank, trimmed, NUL-free strings of at most 160 characters.
The creation time must be a finite, exact millisecond UTC ISO timestamp with a
four-digit year. No time inference or wall-clock dependency is added.

The byte budget precedes JSON.parse, JSON.stringify and canonical hashing; it is
not a limit measured only on a completed output. JSON input nesting and field
content cannot reach recursive hashing unchecked: the accepted line shape has
only a string and an integer. Duplicate keys, extra fields, exponential number
encodings, whitespace-reformatted JSON and other noncompact encodings refuse
rather than being normalized. Native input object property order is retained
and accepted; allocation order is never sorted. The parsed array count is
checked after the bounded parse, not claimed to be a SQL JSON-element preflight.

History is an absence-only assertion. Any linked history row refuses, including
cross-org, malformed, oversized or nonterminal observations. Therefore no byte
or type inspection of those payloads is necessary or attempted: none can be
returned, parsed or serialized. Counts inspect all matching rows, never a page
or truncated latest subset. Unrelated shipment history is not represented as
history of the target. The SQL scan/lock cost itself is not a constant-time or
qualified large-store performance guarantee. Existing Identity internals are
unchanged; this implementation does not claim to preflight their internal reads.

## Native constraints and deliberate refusals

Baseline Fulfillment.pack (then :584, now :801) persists ordinary packed
shipments with no invoice, tracking, carrier or shipped time and default empty
units. It already limits packing to 1–100 unique picked allocation references
and quantities up to 100,000. This reader validates retained shapes and values;
it does not call the Inventory allocation reader or re-establish stock existence,
availability, credit, pricing or actual physical packing.

Baseline commit (then :666, now :883) atomically changes state, carrier/tracking,
units, invoice and shipped time, inserts coverage, and emits Platform handover
history. Baseline recordDelivery (then :931, now :1148) creates observations and,
for delivered outcomes, a compatibility delivery row. The review refuses any
of these retained Fulfillment artifacts, even an empty tracking string or a
forged packed header alongside retained coverage. Native void (now :1005),
collection, shipped and replacement custody are unsupported by this method.
The method does not relax or invoke ordinary pack, handover, void or transport
behavior. Those existing method bodies and frozen schema DDL remain unchanged.

`CUSTODY_BOUNDS` signals scalar/type/aggregate refusal, `CUSTODY_HISTORY` any
linked coverage/delivery fact, `CUSTODY_STATE` unsupported or contradictory
shipment fields, and `CUSTODY_LINES` malformed/non-native allocations. Existing
TRANSACTION, VALIDATION, NOT_FOUND, FORBIDDEN and PASSWORD_CHANGE_REQUIRED
vocabularies handle their respective boundaries. Refusal has no business writes,
receipt append, audit write, allocation repair or history deletion.

## What this result cannot establish

This is current retained native custody only, available both on an ordinary
store and while the restored-store hold remains active. It does not read,
require or release that hold. Root’s separately composed Platform/carrier review
must bind the raw hold, immutable carrier intent, current candidate/source,
account configuration and complete Integration/Platform provenance. No new
Application wiring is included here.

Platform owns command, audit and event handover records, so this method cannot
exclude a copied/erased native handover solely from the absence of Fulfillment
rows. Likewise it cannot detect deleted history or foreign-key identities changed
in every retained copy. Source completeness, immutable original preparation,
provider enumeration, external outcome truth, current independent approval and
fencing remain separate required inputs. The preserved order/account/allocation
identifiers are native references, not fresh foreign-owner validation. A validly
shaped changed order/account/line tuple is returned with a different digest for
root to compare to the immutable intent; it is never silently accepted as that
original intent. Currency/region are not Shipment columns and are not invented
in this result. CA/US and CAD/USD tests establish fixture compatibility only.

There is no external evidence authenticity, recovered identity qualification,
physical-custody attestation, finance truth, transport permission, import,
mutation or product gate verified by this change.

## Foreground verification and preserved receipts

Environment: Node v24.19.0, Linux x64, SQLite 3.53.3. Source setup used a fresh
isolated local clone plus read-only approved public GitHub commit/tree/blob
retrieval. Reconstructed object hashes and exact excluded HEAD were verified
before analysis. Prior checkouts and receipts are preserved.

Initial dedicated run: 18/18 passed, exit 0, 2,816.004551 ms.
`custody-first.log` SHA-256:
`a9747d0d628f685bd768959fa6c02ee27f7f633e19b187b64fa918bb87e261d8`.
Expanded dedicated/affected run: 142/142 passed, exit 0, 9,724.698878 ms.
`custody-regression.log` SHA-256:
`2db69af0152eff078e48abbe8c4b50a8e006f4cd81e14d3bc59bfb43ebe691c6`.

The first complete typecheck passed before three additional tests. The subsequent
complete typecheck failed, exit 1, because a heterogeneous tuple loop did not
satisfy node:test’s overloaded mock.method types (TS2769). The four explicit
mock registrations repair typing without changing any refusal assertions.
The failed `custody-typecheck-final.log` is preserved, SHA-256
`0ce1fa17504ff06f25f2d7526d9596936b7491f99f5f7fce2809a9e0163b086c`.
The repaired complete typecheck passes, exit 0. No test failure, timeout,
suppression, skip or weakened assertion is concealed by that repair.

Final source verification: **142/142 passed**, exit 0, 10,159.635288 ms; no
failures, cancellations, skips or todos. This includes 21 new native tests.
`custody-final-source.log` SHA-256:
`fa9273e02db9fbe62a9dd4d8373c25814a1a9b545f1b99ed112271aea64fd0a0`.

```sh
node --import tsx --test tests/fulfillment-offline-carrier-custody.test.ts tests/fulfillment.test.ts tests/fulfillment-authority.test.ts tests/fulfillment-delivery.test.ts tests/shipment-coverage.test.ts tests/coverage-policy.test.ts tests/carrier-bookings.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/prettier --check src/server/fulfillment.ts tests/fulfillment-offline-carrier-custody.test.ts docs/FULFILLMENT-OFFLINE-CARRIER-CUSTODY-2026-10-03.md
```

Complete TypeScript, assigned formatting, report link targets and diff whitespace
checks pass. A source comparison verifies all pre-existing Fulfillment behavior
and constructor DDL byte-for-byte, apart from retaining the unchanged Database
argument as a field. No dependencies, schemas or unowned files enter the delta.
All logs remain outside tracked source; only this report is delivered with the
owned code/tests. Existing tests that spawn native SQLite contention fixtures
remain foreground regressions; no background executor or runner was started.

## Root integration continuation

Root verified the exact three-owned-file delivery and replayed it against the current Application composition. The [separate local receipt](evidence/LOCAL-FULFILLMENT-OFFLINE-CUSTODY-2026-10-03.md) records100 selected and199 wider affected passes, complete TypeScript and formatting. These overlap and are not added to the historical cloud counts above. Current native custody remains consistency only; no mutation or external qualification is claimed.
