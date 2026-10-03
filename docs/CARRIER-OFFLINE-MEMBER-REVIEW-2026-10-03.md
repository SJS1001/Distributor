# Native Canada Post unknown-member review

2026-10-03. Exact excluded base: `1207c8193fc56b79408ebb232b38580f6f3b3db8`, tree `6bdcdf97b65911178177d69b8d32ea760653a3fc`. This is a bounded read-only prerequisite for the [carrier reconciliation design](CARRIER-OFFLINE-RECONCILIATION-DESIGN-2026-10-03.md), not an importer, authority grant, provider qualification or product gate. Root owns composition and subsequent integration.

Owned changes are exactly [the new carrier reader](../src/server/carrier-offline-member-review.ts), [its new native tests](../tests/carrier-offline-member-review.test.ts), this new report, and the one added `Platform.rawRecoveryHoldInTransaction()` accessor in [platform.ts](../src/server/platform.ts). CarrierBookings, ordinary cancellation, transport/activation gates, Database, IAM, Fulfillment, schema, dependencies, prior tests/reports and concurrent files are untouched. The earlier Integration repair `b2a198ec845b8bb636deb142f226ad84a64a0b99` and its receipts remain in their separate checkout.

The owner's supplied canonical delegated rule requests `gpt-6-astra/high` for this authority boundary. Effective model/effort and root model-selection controls are unexposed, so no effective setting is claimed. Required repo instructions/current README, PLAN, DECISIONS, HANDOFF and the carrier design were inspected. No nested delegation, provider IO, CI, publication or background routine was used.

## API and current native authority

```ts
const reader = new CarrierOfflineMemberReview(database, identity, platform);
const facts = database.transaction(() =>
  reader.reviewUnknownMemberInTransaction(actor, groupId, bookingId),
);
```

Root must supply the actual existing Database, Identity and Platform instances. There is no evidence object, transport adapter, SQL string, callback port, mutable coordinator, filesystem handle or caller-selected query in the operation. The constructor does no migration or write. There is no Application/HTTP/CLI/runtime registration in this delivery.

The method requires the existing native writer transaction, refreshes the actor through `Identity.currentActor`, checks the native warehouse role (including existing admin policy), current forced-password-change state, organization configuration and current site scope for every connected group/preparation. It derives these permissions from `CarrierBookings.principal` (`carrier-bookings.ts:286–298`) and the group/site read (`:599–649`). It does not substitute finance or a provider-consent grant. Like historical carrier reads, it does not authorize transport or claim that provider choice, credit, customer authority or externally supplied approval is current. An actor identity is not an authenticated request/session; root must compose that boundary separately.

The target must be an active `unknown` member of an ordinary-shipment Canada Post group. Return facts contain exact native IDs, configured region/currency, the raw hold, connected ordered group/member/booking history, immutable preparations, labels, duplicate-scope commitments, permanent blockers and a deterministic `reviewHash`. The version-1 purpose is `carrier-offline-unknown-member-native-review`; the hash is the existing canonical JSON/SHA-256 of every returned fact except the hash itself. Deeply readonly types and recursive runtime freezing protect detached data. Labels are immutable `{encoding:"base64",bytes,sha256,data}` values because typed-array bytes cannot be deeply frozen. No allowed/eligible/qualified boolean is returned.

## Fixed raw-hold prerequisite

The original assignment was blocked because the baseline's Database candidate capture hashes the entire store without these pre-materialization limits, while `Platform.recoveryHold()` filters through `restore.permits()`. The owner explicitly expanded this lane's Platform ownership for the missing fixed reader. Existing APIs remain unchanged.

`Platform.rawRecoveryHoldInTransaction()` (`platform.ts:65–104` in this delivery) requires the existing writer transaction. Platform-owned SQL counts **all** rows, checks the singleton ID, text types and each UTF-8 byte length, and aggregates the total before fetching any variable-width field. Maximum is one exact row: lowercase 64-hex snapshot hash and two 24-byte canonical finite UTC ISO timestamps, total 112 text bytes. Empty table returns null; malformed or oversized tuples throw `RAW_RECOVERY_HOLD`. No unrelated table or candidate serializer is called. A successful result is a detached frozen exact `{id,snapshot_hash,restored_at,source_completed_at}` tuple.

The carrier operation requires this tuple (`RECOVERY_HOLD_REQUIRED` when absent). The accessor deliberately never invokes `restore.permits()`. A retained raw hold can coexist with later release permission; its presence is historical isolation metadata, not a new revocation/release decision or proof that actual writers/routes remain fenced. The test drives the historical permission branch with a controlled `permits=true` stub on the actual Platform instance and proves raw visibility and immutability; it does not claim a qualified external activation was exercised. Ordinary provider/command gates remain authoritative and unchanged.

## Complete bounded native reads

All SQL in the carrier module addresses only the three Integration-owned carrier tables. Before any row collection is materialized, JSON parsed or result serialized, fixed SQL count/type/per-column UTF-8/blob/per-row/aggregate preflights run over the **whole retained table**, before subject filtering:

| Table                             | Whole-store row bound | Ordered read          |
| --------------------------------- | --------------------: | --------------------- |
| `integration_carrier_bookings`    |                   512 | `sequence`            |
| `integration_canada_post_groups`  |                   128 | `id`                  |
| `integration_canada_post_members` |                   512 | `group_id,booking_id` |

Individual intent/observation text is at most 256 KiB; other scalars are at most 4 KiB; label/manifest blobs at most 1 MiB. Each cell contributes a conservative expansion cost: 32 times its text/numeric byte length or four times its blob length, plus 256 bytes per fixed column. Both per-row and accumulated whole-inventory cost must stay within a 16 MiB budget. This accounts for escaped JSON, detached parsed preparations, base64 and field overhead before those operations; it is not a measurement of SQLite process memory. JSON additionally refuses beyond depth 20 or 20,000 nodes after the bounded text fetch. Overflow throws `CARRIER_OFFLINE_REVIEW_LIMIT`, never a successful truncated page.

This initial bounded profile deliberately trades availability for inspectability: unrelated or foreign retained carrier inventory can exhaust the whole-store bound, and malformed unrelated booking JSON is refused during complete discovery. It does not expose those tenants' rows. Native IAM reads retain their existing owning implementations; this delivery does not add foreign IAM SQL/preflights or claim to bound all authentication internals. These are engineering limits, not qualified workload capacity.

After preflight, discovery follows complete group membership, every booking for connected shipment identities, all predecessor bookings, and their associated groups/siblings until the connected set is closed. It also follows retained intent/native-snapshot shipment IDs, preventing copied SQL subject columns from hiding a still-linked record. Referenced missing groups/bookings, contradictory org/site, repeated active links and incompatible ordinary states refuse. Group members are not filtered by `active` or org before completeness checks. The original sorted booking/review set is recomputed into the exact native group commitment (`carrier-bookings.ts:569–582,633–648`). Missing, extra or reordered committed membership fails. A jointly rewritten set plus recomputed hashes still requires the unavailable independent preparation receipts; no hash authenticates its source.

Connected booking preparations must be exact canonical native intent bytes with valid review hashes and ordinary packed-shipment snapshots, origin/destination/parcel/service fields, account/order/site identities, original lines/empty pre-handover units and predecessor ordering. Each predecessor must be canceled before its successor, with its retained canceled-group membership still visible. For this narrow profile all connected booking attempts are pending or canceled and unclaimed, without provider/label/error artifacts. Transmitted or replacement histories and manifest claims/artifacts are refused, not reclassified.

Active groups must retain pending ordinary bookings; canceled groups retain inactive pending members. Unknown-member claims remain exact token/start tuples with `RETAINED_MEMBER_CLAIM`, never cleared by age. Pending and creating member tuples are checked against native states. Created siblings require native provider-ID/tracking shape, exact retained PDF bytes/hash and no member claim. The existing exported `validateCarrierLabel` checks the 1 MiB limit/file signature; it does not authenticate or inspect full PDF semantics. Group aggregates must agree with the complete native member states. The operation changes no group, booking, claim or outcome.

If native display configuration exists, its bounded allowlist and exact group hash/service/whole-group consistency are checked using `captureCarrierConfiguration`. Legacy runtime preparations can legitimately omit this display snapshot; those retain `NATIVE_DISPLAY_CONFIGURATION_ABSENT`. The actual Canada Post account preimage is not present in these native tables. Generic display metadata and an opaque hash are never converted into a customer number/contract/company/shipping-point/service-map assertion.

Native duplicate scope searches all retained groups/members for the target org/configuration, including inactive and other-group rows, validates created artifacts and refuses provider-ID or tracking collisions. Ordinary Canada Post booking artifacts are also searched across the org, accepting the same member's native manifest-promoted copy only when reference/tracking/label identity agrees; ambiguous other-booking collisions refuse. Hash commitments bind those duplicate scopes without exposing other-site rows. Unknown account equivalence across configuration hashes remains blocked; neither this search nor the hash is exhaustive provider enumeration or a permanent account reservation.

## Permanent dependencies and limits

Every successful review includes:

- `PLATFORM_CARRIER_PROVENANCE_REQUIRED`: Integration tables retain mutable claims/outcomes and earlier booking/group memberships, not the complete preparation/cancel/claim/release command, audit and event sequence. This class does not read Platform foreign tables or invent an in-progress receipt-reader interface. Root must obtain the exact bounded provenance through its owning operation before an import can be considered.
- `CURRENT_FULFILLMENT_STATE_REQUIRED`: captured immutable shipment/account/order/lines/site are checked internally, but this constructor has no authorized current Fulfillment task reader. It does not query foreign shipment/customer tables or claim the snapshot equals today's physical custody. Root must add that owning review at composition.
- `PROVIDER_ACCOUNT_PREIMAGE_AND_QUALIFICATION_REQUIRED`: actual non-secret carrier account binding and account-equivalence coverage cannot be reconstructed from a configuration hash/display hint. The existing pure Canada Post helpers can compare a later verified descriptor; this native reader takes none.
- `EXHAUSTIVE_EXTERNAL_OUTCOME_EVIDENCE_REQUIRED`: copied labels/statuses and unknown/native enumeration do not prove creation, non-creation, latest transmission status or exhaustive external membership.
- `SOURCE_FENCE_AND_CURRENT_INDEPENDENT_APPROVAL_REQUIRED`: raw restore metadata is not source cutoff/interval truth, fencing, candidate generation admission or current independent approval.

These blockers are not erased on apparently clean state. Retained member claims add a separate blocker. Historical native bytes and hashes support comparison only; they grant no import, resend, label purchase, manifest send, claim retirement, dispatch, stock/money mutation or activation. No new schema, receipt, provider-account reservation or provenance is manufactured. Canceled historical disposition and native cancellation remain byte-for-byte unchanged. Root's concurrent Database/Billing/Platform receipt/storage implementations were not fetched or assumed to exist beyond the exact baseline.

## Verification and preserved failures

Fresh isolated checkout was verified at the exact commit before analysis. Direct Git network fetch was blocked; the authorized public GitHub connector supplied the commit/tree and 33 missing blobs. Git blob/tree hashes and exact commit bytes were reconstructed and verified (author/committer timezone `-0400`). Earlier work and concurrent untracked Integration boundary files in this checkout were preserved and excluded from this commit.

Environment: Linux/x64, Node `v24.19.0`, SQLite `3.53.3`; existing local repository dependencies reused through a temporary symlink, removed before commit. Complete TypeScript passes. Assigned formatting, local report links, staged whitespace and four-file-only scope checks pass.

Final foreground command:

```text
node --import tsx --test tests/carrier-offline-member-review.test.ts tests/carrier-restore-dispositions.test.ts tests/canada-post-groups.test.ts tests/canada-post-creation.test.ts tests/canada-post-manifest.test.ts tests/carrier-claim-review.test.ts tests/carrier-bookings.test.ts tests/canada-post-evidence.test.ts
```

**467/467 pass**, exit 0, zero failures/cancellations/skips/todo, 9,563.627982 ms. The 28 new cases use native pick/pack/book/group/cancel/create APIs, a guarded synthetic successful creation plus lost response, actual SQLite transactions, CA/US residency and configured CAD/USD, display configuration present/absent, reporting variants, and encrypted backup/restore in both regions. No real provider calls. Restored reads preserve native stock/orders/invoices/rows and raw hold. Current same-writer role/site/password/org loss, rollback, immutable prior results, byte/count-before-fetch spies, 1 MiB PDF, omitted/reordered/extra/foreign members, malformed lineage/artifacts and other-group provider/tracking collisions are exercised. No WAL/schema/runtime guard was changed.

Logs are retained outside the repository at `/workspace/scratch/ffbb94708048/`:

| Log                                       | Actual outcome                                                                                                      | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `carrier-offline-review-first.log`        | Initial 20/20 pass                                                                                                  | `3cd7d4160b6f100d42fe7079765b9eef6daeee2a7150007d8f9b9d8daed0c5ef` |
| `carrier-offline-review-copied-red.log`   | Actual copied-subject gap, 0 pass/1 fail; unchanged assertion passes after intent-link discovery repair             | `ebdc8916b7ea1903521adc69f6fbbadd3a7d297d24fd950ffacdf3ec84127cf7` |
| `carrier-offline-review-extra.log`        | 23/26 pass; two corrupt fixtures hit foreign-key constraints, one tried a pragma denied by the native authorizer    | `9eff91a5fdcc92d95718780ac9edcc3e074956d7311838c748907a60292c06c7` |
| `carrier-offline-review-extra-fixed.log`  | 26/28 pass; one revised corrupt predecessor hit the native active-booking unique index, pragma fixture still denied | `58415184c231213928aa435f0656919e882e346479672884e12e1d0d4ff10397` |
| `carrier-offline-review-final.log`        | 466/467 pass; remaining denied-pragma fixture                                                                       | `7a876c00a0e5dec403e7916e5eec53022f151631a05a2592d4e6c4d4c5c77f`   |
| `carrier-offline-review-final-source.log` | Final-source 467/467 pass                                                                                           | `482d9aa10b33548df5f637b7e7edc6932b513d3427f9b606671722e31707435a` |

Fixture repairs retained expected reader refusals: corrupt an earlier intent instead of violating the active index, supply an existing copied booking before extra membership, and seed the impossible singleton row on a separate raw SQLite fixture connection. The application's constraint/authorizer guards stayed unchanged. This is synthetic engineering evidence, not external/provider/source/product qualification. Delivery ends this bounded assignment; no monitoring, reminder or follow-up routine is created.
