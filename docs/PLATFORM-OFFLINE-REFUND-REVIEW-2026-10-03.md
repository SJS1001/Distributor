# Platform offline refund receipt review — 2026-10-03

This prerequisite adds only [a trusted internal read-only class](../src/server/platform-offline-refund-review.ts), [its native tests](../tests/platform-offline-refund-review.test.ts) and this report. **The cloud delivery added no composition, database schema, native mutation, source qualification, import or release authority. Root now composes the fixed reader as `Application.platformOfflineRefundReview`; all task/product gates remain NOT VERIFIED.** Other owning-module reviews and the qualified coordinator remain separate prerequisites.

Exact excluded public `SJS1001/Distributor` checkpoint: `0a89dfc435767c7737cdb693200f80c6aaa9f842`, branch `codex/local-distributor-checkpoint`, tree `643d2d75beaa2faa86a804564474d00997fbff5c`. An isolated checkout was reconstructed with read-only Git-data retrieval and existing local objects; fetched sizes/blob hashes and the complete tree/commit hashes were checked. Earlier review commits and transfers remain untouched. AGENTS, README, PLAN, DECISIONS, current HANDOFF and the current Billing/native receipt reports were inspected; the owner's canonical rule requests Astra/High for this authority boundary. Effective model/effort remains **unverified** because runtime controls/settings are not exposed. No nested session was launched.

## API and authority

Root can construct the class with the **same existing application Database and Identity**:

```ts
const reader = new PlatformOfflineRefundReviewReader(
  app.database,
  app.identity,
);
const historical = app.database.transaction(() =>
  reader.getInTransaction(actor, refundId, effectId),
);
```

`getInTransaction` requires an already-open native writer transaction and rejects invocation inside a Store SQL callback. It does not begin a transaction itself. Every call uses IAM `currentActor`, which re-reads active user and organization/region, then enforces finance/admin, no customer account association and no required password change through the existing Identity API. Captured roles/account grants are not trusted. Historical receipt authors remain unchanged even if they are no longer active; they are not substituted with the reader.

Constructor composition is trusted: root must pass the Identity belonging to this Database. There is no new callback, SQL argument, connection factory, evidence port, tenant route or caller-controlled query. Direct SQL is fixed Platform-owned SELECT only. IAM is consulted through its owning API; Billing and Integration tables are never read by this class.

This historical read works both before and during a raw recovery hold. It neither calls provider access nor clears/replaces the hold, and does not require or qualify a hold as proof of authority. A future offline coordinator must independently enforce raw/effective generation, isolation, current external maintenance identity and exact owning-module consistency. The method is not a provider queue/read permission or durable grant.

## Actual writer facts and linkage

The baseline [Billing refund request](../src/server/billing.ts) invokes `Platform.command` as `billing.refund.request` and returns exactly `{id:refundId,state:"pending"}`. Its original invoice/payment/amount/reference/reason payload is **not stored by Platform**. We retain the stored request hash and do not reconstruct it from guesses. Root's comparator must separately receive and validate the exact reviewed original request.

The baseline [Integration refund](../src/server/integration.ts) invokes `stripe.refund` with exactly `{refundId}`. It returns `{id:effectId,state}` from `queue()`. A repeated new key can find the existing effect and return its then-current state: pending, running, unknown, completed, rejected or blocked. We preserve these native state spellings; no terminal receipt is rewritten into pending. The known queue payload permits a check against `digest(canonical({refundId}))`. A receipt with the requested effect ID but a conflicting request hash, or the requested refund hash but a different effect ID, refuses instead of disappearing from the selected result.

For both commands, [Platform.command](../src/server/platform.ts) stores `JSON.stringify(result)` plus its payload hash, then calls `audit(actor,name,key,{requestHash:hash})` in the same transaction. `Platform.audit` retains canonical detail bytes and the native trigger writes `platform_audit_order`.

The reader enumerates **all** current-organization receipts for these two command names, then all audits for these two action names with their audit-order linkage. It validates every row before selection. A malformed unrelated result cannot hide behind SQL JSON filtering or result-ID selection. Command identity/author/key, lowercase request hash, exact UTC millisecond time and exact result JSON are checked. Unknown result fields, duplicate JSON keys, malformed JSON, unrecognized states, noncanonical JSON bytes and invalid timestamps refuse with a bounded `RESTORE_RECEIPT_INTEGRITY` error that includes no retained body.

Every relevant command must have exactly one relevant audit with matching organization, original actor, action, request-key reference and request hash. Every relevant audit must map back to a command. Missing/duplicate/orphan or cross-organization links fail closed. The audit-order row must exist, have the same organization and a positive safe sequence. We do not invent a time equality/order rule: command and audit timestamps are separate `now()` calls. We neither scan nor qualify the entire global audit clock/sequence history; these are the retained per-audit native links.

## Complete bounded local scan

Exported frozen `platformOfflineRefundReviewLimits` is explicit implementation policy:

| Bound                                      | Value                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Relevant organization command rows         | 1,000 total across the two commands                                                                |
| Relevant organization audit rows           | 1,000 total across the two actions                                                                 |
| Selected text bytes per command/audit row  | 65,536 UTF-8 bytes                                                                                 |
| Combined selected command/audit text bytes | 8,388,608 UTF-8 bytes                                                                              |
| Identity / request-key lengths             | 160 / 128 JavaScript characters, exact nonempty strings without outer whitespace or ASCII controls |

SQLite computes COUNT, SUM and MAX of fixed `length(CAST(... AS BLOB))` expressions before either result set is materialized or retained JSON parsed. Command accounting includes organization, author, command name, key, hash, result and timestamp. Audit accounting includes ID, organization, author, action, reference, detail, timestamp and joined order organization. Sequence is a separately checked fixed numeric field. Both row counts and the **combined** byte budget must pass. IAM's own authorization parsing necessarily precedes this retained-history preflight.

There is no LIMIT, page, cache or secondary connection. Excess history refuses; it is never presented as a complete prefix. Native `BEGIN IMMEDIATE` pins both preflight and materialization on the existing writer connection. These limits bound materialized retained text/row counts; they do not claim a hard bound on SQL scan time, native query planning or total VM memory. Larger histories require a separately reviewed protocol, not truncation or a caller-raised limit.

## Returned facts and downstream obligations

`PlatformOfflineRefundReview` is detached and recursively frozen. Its fixed purpose is `distributor-platform-offline-refund-review-v1`; fields include version, organization, requested refund/effect IDs, history counts/hash, `requests`, `queues` and `factsHash`.

Every selected receipt retains original actor, command/key, request hash, `{id,state}`, exact `resultJson`, creation time and a linked audit containing original ID/actor/action/reference, request hash, exact `detailJson`, time and sequence. All matching attempts remain in deterministic native order. Nothing selects a preferred author/key or discards a repeated queue attempt. Missing subjects produce empty arrays plus the full local scanned counts/hash; this is **not proof of missing external effects, complete source intervals or permission to recreate a request**.

`history.hash` is SHA-256 of canonical `{purpose:"distributor-platform-refund-history-v1",commands,audits}` containing every scanned raw native row, including nonmatching rows. `factsHash` is SHA-256 of the canonical returned body excluding `factsHash` itself. The hashes bind supplied local bytes; they do not authenticate a copied database, signatures, historical actors or provider outcomes. A privileged self-consistent copy cannot be distinguished from authentic history by these hashes alone.

The [pure comparator](../src/server/integration-offline-refund-evidence.ts) currently expects exactly one original request and one **pending** queue receipt. This class deliberately returns arrays and preserves terminal/multiple attempts. Root must explicitly reject unsupported multiplicity/states or design and test their treatment before composition; it must not silently choose the first record or fabricate a pending result. Native owner reviews must separately bind refund/effect/account/currency and source/candidate facts. No Billing/Integration payload, source interval or full-dossier completeness is inferred here.

## Verification and preserved development failures

Direct foreground Linux/x64, Node v24.19.0, OpenSSL 3.5.7, native SQLite and existing dependencies. Fixtures originate through actual Billing refund requests and Integration queue commands in CA/CAD, CA/USD and US/USD; no real provider adapter is called. Controlled corruption/copy/budget fixtures use explicit owning stores and roll back after refusal. No production metadata guard is bypassed.

```sh
node --import tsx --test tests/platform-offline-refund-review.test.ts
node --import tsx --test tests/platform-offline-refund-review.test.ts tests/refunds.test.ts tests/billing-offline-refund-review.test.ts tests/integration-offline-refund-evidence.test.ts tests/platform-restore-disposition-receipts.test.ts
npm run typecheck
./node_modules/.bin/prettier --check src/server/platform-offline-refund-review.ts tests/platform-offline-refund-review.test.ts docs/PLATFORM-OFFLINE-REFUND-REVIEW-2026-10-03.md
git diff --cached --check
```

Final dedicated: **15/15 pass**, exit 0, 2839.15323 ms. Combined affected native/comparator/receipt suite: **96/96 pass**, zero failures/skips/cancellations/todo, exit 0, 5460.349689 ms. Complete TypeScript, assigned formatting, document links and patch whitespace pass at delivery.

Coverage includes current IAM changes within the same transaction, writer-only use, unchanged native hold/commands/audits/clock/refunds/effects, inactive historical authors, multiple pending/blocked queue receipts, exact known queue linkage, missing subjects, malformed unrelated result JSON, audit corruption/duplicates/orphans/cross-org links, scoped exclusions, UTF-8 row/aggregate and command/audit count preflight before retained parsing, exactly 1,000 complete command/audit pairs versus excess, uncommitted receipt/audit visibility with late rollback, restart, recursive immutability, deterministic hashes, and owner SQL fencing.

Original logs remain separate. First new-test run was **12/13**, and the next **13/14**, both failing only cleanup after restart: the helper spread the fixture, leaving its cleanup callback pointing to the already closed Application. `Object.assign` now preserves the fixture object's identity; no assertion was weakened. TypeScript initially rejected three negative test IDs because the helper inferred a UUID template type; its test parameters are explicitly strings to exercise the public string API. Source-only initial TypeScript had passed. These are development fixture/typing failures, not defects claimed against the baseline. The original failed logs and final combined log accompany the local transfer artifacts. Final combined log SHA-256: `ad23934c03398b99fd7990cdf0485f009445f68e0a1a95f272075eefd6e50804`.

No full browser/native-system verification, Mac replay, external authority/provider/source qualification, schema/coordinator or release/import integration is claimed. Only the three new assigned files are committed. No CI/runner, workflow, provider IO, PR/push/merge/deployment, secrets, background job or reminder. Root must independently verify/apply the exact owned delta and provide current qualified composition; this task ends at transfer.
