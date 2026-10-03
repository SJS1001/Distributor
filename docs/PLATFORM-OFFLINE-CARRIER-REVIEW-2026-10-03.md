# Platform offline carrier provenance — 2026-10-03

This prerequisite adds a fixed, read-only Platform historical projection and native tests. **All task/product gates remain NOT VERIFIED.** It creates no Application wiring, import/release permit, current maintenance authority, database mutation, source qualification or provider truth.

Exact excluded public `SJS1001/Distributor`, branch `codex/local-distributor-checkpoint` baseline: `ea2f5790c0f1a62e20be7cf6dd00139868ea22e5`, tree `dd920da292d265223c9e34f44472ef37dba7ff35`. A fresh isolated checkout was reconstructed through read-only Git-data retrieval and existing objects; retrieved lengths/blob hashes, complete tree and exact commit were verified. Prior completed `7ae9f0f3c0697d29bcbf49f2a91e1450eba17941` and earlier implementation/transfers remain untouched and excluded from this delta.

Only these three NEW files belong to this delivery:

- [src/server/platform-offline-carrier-review.ts](../src/server/platform-offline-carrier-review.ts)
- [tests/platform-offline-carrier-review.test.ts](../tests/platform-offline-carrier-review.test.ts)
- This report.

AGENTS, README, PLAN, DECISIONS and current HANDOFF were read, along with actual carrier booking/group/claim writer paths and existing Platform/IAM/Database interfaces. The workstation rule path `/Users/stevensmith/.codex/rules/delegation-model-selection.md` was unavailable; the canonical rule supplied in the delegation requests **gpt-6-astra / High** for this security boundary. Effective model/effort is **unverified**: the launcher/runtime exposes no controls or effective settings. No nested session was launched.

## Fixed API and scope

Root can compose the existing matching Database and Identity without any new port or caller callback:

```ts
const provenance = new PlatformOfflineCarrierReviewReader(
  app.database,
  app.identity,
);
const historical = app.database.transaction(() =>
  provenance.getInTransaction(actor, groupId, bookingId),
);
```

The class has one task-shaped public read method. It requires the existing business writer transaction; it neither starts a transaction nor opens another connection. `Database.requireTransaction()` refuses calls outside a writer transaction or inside an owning SQL callback. Direct SQL consists exclusively of Platform-owned SELECTs through `database.owned("platform")`. IAM is refreshed through Identity, never through foreign SQL. There is no caller-supplied SQL, data/receipt/history object, generic reader, authorizer or provider callback.

Before retained-history allocation it refreshes current IAM user/organization, checks warehouse/admin role, rejects customer account association, checks current password-change requirement, requires the Canadian organization and exact distinct group/booking strings, then enforces the site boundary below. CA/CAD and CA/USD are accepted; currency is neither inferred nor rewritten. US is an explicit unsupported Canada Post provenance profile.

**Site-restricted warehouse users are currently refused with `CARRIER_PROVENANCE_SCOPE`, even if their current site list includes the supplied group's site.** The writer's group-prepared event stores warehouse and count, but no member allowlist. Booking-prepared events store shipment/replacement ID, provider and review hash, but no warehouse. An arbitrary supplied group ID cannot establish the booking's warehouse. Platform alone cannot safely authorize that booking read for a site-restricted actor. Current organization admins use native admin site semantics and can receive historical facts. This is an explicit default-closed limitation of this fixed two-ID interface, not a claim that a group event or hash supplies current site authority. Root must independently design any future warehouse access composition with a bounded owning-module association; no such callback, foreign reader or wiring is included here.

Historical reads work under the raw restore hold without clearing or replacing it. Reader authorization is independent from current native maintenance approval, provider execution permission and import/release authority. Trusted composition must supply Database and Identity from the same Application. The supplied native actor identity is rechecked against IAM; this class is not an HTTP authenticator.

## Durable facts actually inspected

The implementation enumerates complete current-organization `carrier.%` command, audit and event histories, including unrelated carrier records before result selection. The closed semantic allowlists are:

| Kind                                | Actual native names                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command receipts and command audits | `carrier.prepare`, `carrier.cancel`, `carrier.canada-post.group.prepare`, `carrier.canada-post.group.cancel`, `carrier.claim.release`                                                   |
| Booking domain audits               | `carrier.booking.canceled`, `.booked`, `.unknown`                                                                                                                                       |
| Group domain audit                  | `carrier.canada-post.group.canceled`                                                                                                                                                    |
| Member domain audits                | `carrier.canada-post.member.claimed`, `.created`, `.unconfirmed`, `.unknown`                                                                                                            |
| Manifest domain audits              | `carrier.canada-post.manifest.claimed`, `.transmitted`, `.unconfirmed`, `.unknown`                                                                                                      |
| Claim domain audit                  | `carrier.claim.released`                                                                                                                                                                |
| Events                              | `carrier.booking.prepared`, `.canceled`, `.booked`; `carrier.canada-post.group.prepared`, `.canceled`; `carrier.canada-post.member.created`; `carrier.canada-post.manifest.transmitted` |

An unknown carrier-prefixed name, malformed unrelated scoped row or unsupported shape refuses rather than disappearing from a supposedly complete selection. Other organization and non-carrier records do not supply provenance. Original actor IDs, command keys/request hashes, raw result/detail/payload JSON, timestamps, audit IDs/order sequences, and event IDs/versions are preserved. Preparations retain actual `{id,reviewHash}`, cancellations `{id}`, and claim releases `{target,state:"unknown",claimHash}`. Claim targets follow the existing booking/member/manifest union. No original payload is reconstructed from a review hash or guessed input.

Every command requires exactly one original actor/action/key audit whose request hash agrees; orphan command audits and missing/duplicate links refuse. Preparation identities are unique and require the matching prepared event. Cancellation requires the matching preparation, domain audit and event, with preparation command-audit sequence before cancellation domain audit before cancellation command-audit sequence, and the same canceling actor. Release results bind to their exact retained target/claimHash domain audit and its native sequence; claim hashes remain data.

Member/manifest outcomes require the preceding relevant claim audit, original actor/review hash and consistent send/reconcile mode. Member histories require Canada Post booking preparation. Booked/created/transmitted events must match their actual emitted audit shape. Native Canada Post manifest completion emits per-booking booked events **without** separate per-booking booked audits; the reader binds them to the corresponding group manifest audit and created-member events instead of inventing those audits. Transmitted groups require the recorded member count and complete created/booked event correspondence.

Audit sequences establish the native relationships available here: preparation precedes later entity observations; canceled groups and transmitted manifests cannot gain later entity actions; created members and canceled/booked bookings cannot acquire incompatible later actions. Multiple legitimate claim/unknown/recovery audits remain retained; they are not collapsed into one preferred attempt. Event timestamps/IDs are not used to invent an event sequence or event actor. Raw command/audit times come from separate writer calls and need not be equal. Hashes and human-readable timestamps are never fences.

## Bounds before materialization

Exported frozen implementation policy `platformOfflineCarrierReviewLimits`:

| Bound                                        | Value                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Scoped carrier commands                      | 1,000                                                                                             |
| Scoped carrier audits                        | 4,000                                                                                             |
| Scoped carrier events                        | 2,000                                                                                             |
| Selected variable text per row               | 65,536 UTF-8 bytes                                                                                |
| Combined selected text across all three sets | 8,388,608 UTF-8 bytes                                                                             |
| Parsed JSON depth / visited values per body  | 16 / 4,096                                                                                        |
| Group/booking IDs and keys/entity references | At most 128 exact JavaScript characters                                                           |
| Other retained identity strings              | At most 160 exact JavaScript characters unless the native field has its documented specific bound |

Three SQL COUNT/type/MAX/SUM preflights run before **any** retained set is fetched or retained JSON parsed/stringified. Each returned text column, including joined audit-order organization, has an SQL `typeof(...)=text` check and `length(CAST(... AS BLOB))` byte contribution. Embedded NUL and multi-byte Unicode cannot evade the bound. Audit sequence and event version require native integer storage, positive values and safe-JavaScript-integer bounds before retrieval. Missing/invalid order links refuse, and dangling order rows in the current organization refuse because their lost action cannot be attributed safely. After bounded retrieval, rows, canonical JSON, exact field sets, lowercase hashes, exact UTC millisecond dates, event version 1 and native relationships are validated.

There is no LIMIT, page, truncation, cache or secondary connection. The current writer snapshot contains any caller-uncommitted facts and rolls back with that caller. The fixed limits bound materialized retained rows/text and parsed traversal; they do not promise a host heap, SQL scan-time or full source-history bound. Current IAM's own reads/parsing necessarily precede retained-history preflight.

## Output and permanent completeness blockers

`PlatformOfflineCarrierReview` is detached and recursively frozen with purpose `distributor-platform-offline-carrier-review-v1`, version, org/group/booking IDs, selected normalized command/audit/event arrays, full scanned-history counts/hash, blockers and factsHash. Raw JSON bytes and historical actor IDs remain alongside parsed facts. Selected IDs must each have native preparation receipts; a missing preparation refuses with NOT_FOUND. A matching pair is **not asserted to be a membership relationship**.

`history.hash` binds the complete scoped raw command/audit/event projection with purpose `distributor-platform-carrier-history-v1`; `factsHash` binds the canonical returned body excluding that hash. They detect changes in this read projection, including unrelated scoped history, but do not authenticate copied data or original source intervals.

Every result explicitly retains all six blockers:

- `BOOKING_SITE_ACCOUNT_CONFIGURATION_NOT_RETAINED`
- `CLAIM_TOKEN_AND_COMPLETE_ATTEMPT_LINEAGE_NOT_RETAINED`
- `EVENT_DURABLE_ORDER_AND_ACTOR_NOT_RETAINED`
- `GROUP_MEMBERSHIP_ALLOWLIST_NOT_RETAINED`
- `ORIGINAL_COMMAND_PAYLOADS_NOT_RETAINED`
- `SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED`

These facts cannot prove current Integration membership/claim token, packed Fulfillment custody, actual account/configuration, complete stale-recovery history, trusted source authenticity, provider outcome, native maintenance approval or permitted writes. Some native stale-recovery transitions write no Platform audit. A fully self-consistent privileged copy cannot be authenticated by local hashes. All these limitations remain for separately owned bounded reviews/coordinator integration. No foreign reader is called, and none of these blockers is cleared by a historical observation.

## Verification and retained development failures

Environment: Linux x64, Node `v24.19.0`, OpenSSL `3.5.7`, native SQLite `3.53.3`, existing lockfile/dependencies. Dedicated fixtures exercise real ordinary packed-shipment booking/group commands in CA/CAD and CA/USD, cancellation, native exact claim release, synthetic unknown/reconcile creation and manifest completion, plus unrelated ordinary UPS unknown/booked provenance. Adapters are explicit foreground synthetic fixtures; no external provider request occurs. One deferred synthetic creation is always rejected and awaited in `finally`; no job survives the test.

```sh
node --import tsx --test tests/platform-offline-carrier-review.test.ts
node --import tsx --test tests/platform-offline-carrier-review.test.ts tests/carrier-bookings.test.ts tests/canada-post-groups.test.ts tests/canada-post-creation.test.ts tests/canada-post-manifest.test.ts tests/carrier-claim-review.test.ts tests/carrier-offline-member-review.test.ts tests/carrier-restore-dispositions.test.ts tests/platform-offline-refund-review.test.ts
npm run typecheck
./node_modules/.bin/prettier --check src/server/platform-offline-carrier-review.ts tests/platform-offline-carrier-review.test.ts docs/PLATFORM-OFFLINE-CARRIER-REVIEW-2026-10-03.md
git diff --cached --check
```

Final combined affected regression: **310/310 pass**, including all **16 new cases**, zero failed/cancelled/skipped/todo; exit 0, 10,534.552264 ms. Complete TypeScript passes, exit 0. Assigned formatting and patch whitespace pass. The last dedicated run before the final additional claim-mode assertions was 16/16; the final combined run includes those assertions and the finalized source. No Mac replay, browser/full-system qualification or root composition test is claimed.

The tests additionally cover current IAM and password/site refusal before allocation, writer/SQL-owner restrictions, complete same-writer observation, late native command rollback conservation, raw hold preservation, restart/detachment/freeze, malformed/orphan/duplicate/unknown histories, incorrect order and cross-org links, same-result copied commands, exact 1,000-command capacity, excess command/audit/event counts, aggregate bytes, oversized NUL/Unicode linkage and JSON fields, safe numeric storage bounds, excessive JSON depth and complete foreign-org exclusion. Tests use explicit owning-store mutations; authorizers are never disabled. Default spies call original Store/JSON implementations and measure fetch/parse boundaries. Existing test files/assertions remain untouched.

Retained local development evidence outside this three-file patch:

- Initial dedicated run: 12/12. Initial test TypeScript failed because raw test-row IDs were typed possibly undefined; the fixture now explicitly asserts their established presence. Log SHA-256 `eddb17d8674e34ac9438311b07f45f3f026934cf640ecda9f412dfeeb24c4eeb`.
- Extended ordering run: 13/14, **real missing refusal in this new reader's first implementation** for a synthetic member-claimed audit after actual native group cancellation. The unchanged failing assertion drove native terminal-order validation; subsequent member/manifest constraints and all earlier assertions pass. Red log SHA-256 `922812728ae0e7936185fb74a7f3ac6b9eb700dafeb5b3853cc3f5153b76182c`. This is not represented as a defect in excluded baseline source, which had no reader.
- Final 310/310 log SHA-256 `d5a700674e5180a627748dbe5de30d8940971c78a86259a16e930f90480fcea4`.
- Complete TypeScript log SHA-256 `561e0b64da9c027206b026047fea097e70b4e9f9488a41f2a7de084bcdd29e2b`.

No existing source edits, Application wiring, schema/DDL, dependency changes, generic port, filesystem/network/clock callbacks in the reader, provider IO, CI/runner/workflow, PR/push/merge/deployment, live account/secret access or background automation was introduced. Root owns review/composition and independent replay. Delivery ends with the exact three-file local commit and transfer.
