# Original running journal Platform command and lease audit review

Excluded baseline: `c33ae17acf852e0034309da88831617871f676b8`, tree `2ae40b8b9f5dd0609b40dd602a2df4092ac60a1b`, from the previously verified public Distributor copied-lease delivery. The initial `3b000a8` checkout was replaced following the owner's explicit base correction, before implementation. A switch encountered a missing ancestor object after updating the isolated index/worktree; both were verified exactly against `c33ae17` before setting its detached HEAD. Prior completed worktrees remain preserved. The transfer manifest identifies the closing commit and exact tested source/test bytes; no baseline changes are included.

Read AGENTS, README, PLAN, DECISIONS, current HANDOFF, T4's original retirement report and actual native contracts. The canonical model rule supplied by the delegation requests **gpt-6-astra/high** for this boundary. The workstation rule file is unavailable here and effective model/effort settings are not exposed; they remain **unverified**. No additional agent or session was launched. This is an internal read-only D-024/D-025/D-039 prerequisite, not release, transport, provider or product qualification.

## Concrete API and hashes

The only production addition is [PlatformOfflineOriginalLeaseCommandReviewReader](../src/server/platform-offline-original-lease-command-review.ts):

```ts
new PlatformOfflineOriginalLeaseCommandReviewReader(
  database: Database,
  identity: Identity,
  journals: StockJournalDelivery,
).getInTransaction(actor: Actor, journalId: string)
```

The actual Platform and IntegrationCosts children are obtained through data descriptors on the actual StockJournalDelivery graph. Exact prototypes, same Database/Identity/Platform references, reciprocal Costs/Journal references, owner Store identities and absence of instance method overrides are checked before native hooks and again at exit. No caller SQL, projection, source callback, parser, grant or generic port is accepted. Actor input is captured as inert ID/org locators after rejecting normal/revoked proxies, accessors, hidden/symbol/extra properties, custom prototypes and malformed/sparse site arrays without executing traps. Journal ID must be a bounded primitive native identifier.

An existing actual SQLite writer is mandatory; the operation opens no transaction or savepoint. Current native Identity finance/admin staff, no account scope and no forced password change are required. The actual raw Platform hold must exist before scanning retained Platform text. The actual `StockJournalDelivery.readOfflineLeaseRetirementInTransaction` is used, never the older unknown-only reader or a supplied native hash. This removes the anticipated `running-native-owner-projection-required` blocker on this corrected base.

The detached deeply frozen exported `PlatformOfflineOriginalLeaseCommandReview` includes:

| Field                                      | Exact meaning                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`, `purpose`                       | `1`, `distributor-platform-offline-original-lease-command-review-v1`                                                                                                   |
| `orgId`, `region`, `currency`, `journalId` | Current actual native target scope                                                                                                                                     |
| `nativeReviewHash`                         | Exact actual running owner projection hash, including current source/plan/permissions/lease/reference/history                                                          |
| `hold`                                     | Exact retained raw Platform recovery tuple                                                                                                                             |
| `scopeHash`                                | Purpose-separated hash of all bounded current-org Platform commands/audits/events/order rows scanned                                                                   |
| `history`                                  | Complete current-org counts, selected/other-source command counts and distinct history/observation hashes                                                              |
| `attempts`                                 | Every native scoped original attempt's exact reconstructed command results/preimages, permission receipts, observations, claim/dispatch audits and current lease tuple |
| `factsHash`                                | SHA-256 of canonical complete receipt body excluding only `factsHash`                                                                                                  |
| `blockers`                                 | Explicit unsupported or externally unqualified obligations; never permission flags                                                                                     |

The current lease includes exact ID, actor, native millisecond start, mode, dispatch marker, permanent request reference and matched claim audit identity/sequence/time. Every capture rereads current IAM, raw hold, the complete native owner projection and Platform scope; changed hashes or `total_changes()` refuse. Reentry refuses. Returned hashes identify current retained consistency and do not certify an earlier source snapshot.

## Exact native joins

The ordinary implementations remain byte-identical: `StockJournalDelivery.prepare` at baseline line 832, `decide` 884, running reader 1021, permission preparation/decision 2393/2456, `claim` 2599 and `beforeWrite` 2750. Existing ordinary Platform request hashing is SHA-256 over `canonical(payload)`, while stored command results use `JSON.stringify(result)` and audit detail uses canonical JSON. The new reader preserves these distinctions.

For every native attempt, initial preparation is reconstructed from the complete immutable native plan input and original ready view. Decisions reconstruct the approved/rejected view, original reviewer/reason and request tuple. Separately prepared retries reconstruct the actual cancelled predecessor dossier, complete observation hashes, source plan and retry reason; retained original cancellation evidence and cancellation command receipts must match exact native evidence/snapshot/body/author/order. Permission preparation and decision use actual retained immutable permission inputs and observation results; their command audits must follow their native observation and precede the next native lease/observation boundary.

Claim and dispatch are **audits, not Platform commands**. The reader does not invent command keys or request hashes for them. An ordered native state walk requires the initial write claim, at most one dispatch owned by that active write lease, exact unknown observations retiring that lease, and only subsequent lookup claims. The current active claim must match the one actual running native lease. Duplicate lease IDs across Platform claim histories refuse. All observation revisions/hashes/authors join exact native observations and strictly ordered audits. Dispatch presence must equal the native retained marker, including lookup leases retaining an earlier write dispatch. Completed ancestors have no active lease. Permanent references and exact current source/plan/date/accounting identities are established by the owning native reader.

Two specific limitations are explicit:

- `CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT`: ordinary claim audit retains lease ID, mode and review hash, but not native `lease_started`. The current start is bound exactly by `nativeReviewHash` and the result; audit time is checked not to precede it. This is **not** independent proof of the historical start value. A plausible earlier copied start cannot be distinguished from original start using these audits alone. Root must retain/qualify the complete source/native projection rather than silently treating an audit timestamp as the missing value.
- `DECISION_REQUEST_PREIMAGE_NOT_RETAINED`: if the reconstructed normalized decision request does not match the stored request hash, the exact original preimage is unavailable. Ordinary decision normalization can discard original whitespace. Matching command/audit hashes do not repair that loss. The receipt stays blocked; other required exact preimage mismatches refuse outright.

Unknown commands touching selected native identities, other-source commands, unjoined journal audits and journal events receive explicit blockers. StockJournalDelivery has no ordinary journal event emitter at this baseline; no event payload is invented. Foreign journal history, foreign selected-identity occurrences or escaped unclassified foreign JSON conservatively refuse without returning another tenant's rows. Unknown tenancy is not guessed. No actual source/provider/COMMIT qualification is inferred from local absence or self hashes.

## Complete bounds before materialization

Fixed **Platform-owned SELECTs only** preflight the complete global command, audit, event and audit-order sets. Counts, storage types, NUL, per-row UTF-8/blob byte totals and aggregate bytes are checked before returning variable fields. Global audit-order orphan/scope/clock closure is checked. SQL punctuation and container counts precede JSON validity and JavaScript parsing; punctuation inside strings intentionally counts conservatively. Selected text is fetched as blobs and decoded with fatal UTF-8 plus round-trip checks. Parsed strings reject NUL and lone surrogates; malformed/duplicate/noncanonical JSON refuses. Foreign checks return numeric existence only.

| Bound                                                |                         Value |
| ---------------------------------------------------- | ----------------------------: |
| Global commands / audits / events / audit-order rows | 1,000 / 4,000 / 2,000 / 4,000 |
| Per Platform row / aggregate bytes                   |            65,536 / 8,388,608 |
| Conservative JSON nodes / containers / depth         |             16,384 / 512 / 48 |
| Canonical output bytes                               |                    16,777,216 |

The existing native owner's eight-table complete preflight, immutable source byte bounds, balanced dates, sole posting ownership, permission chain, closed-period and source reservation rules are unchanged. No unbounded foreign source reader or foreign table query is introduced. No pagination or target-only LIMIT is used to assert completeness. Overflow fails closed.

The native reader still refuses correction journals, CA/USD original QuickBooks journals, write leases with permission observation history and expiry-only lookup histories lacking its exact-request unknown proof. Those are existing unsupported profiles, not transport permission. The test suite retains the CA/USD refusal. CA/CAD and US/USD have actual file-backed native fixtures for dispatched/undispatched write and lookup, with reporting enabled and disabled.

## Remaining composition responsibilities

`SOURCE_PROVIDER_AND_CURRENT_COMMIT_AUTHORITY_NOT_QUALIFIED` is always present, alongside explicit historical/source/authority/hold limitations. Root must separately qualify stopped-source and candidate identity/generation/interval, complete provider truth, current external/native approvals and fencing through actual COMMIT. This reader performs no retirement, retry, posting, cancellation, settlement, task receipt, source release, transport, schema or Application mutation. No blocker may be removed merely because a caller supplies a hash or Boolean. A changed output is not authorization to use an older review.

## Verification and retained failures

Linux x64; Node `v24.19.0`, SQLite `3.53.3`, TypeScript `7.0.2`, Prettier `3.9.9`. Synthetic real file-backed Application/SQLite only, no provider calls. Existing source/tests/docs remain unchanged. Native fixture setup was copied into the owned test solely to parameterize the actual reporting mode; no mock owner port is used.

Initial foreground receipts are preserved outside the patch:

1. First new-test run: 53 tests, 0 pass/53 fail, exit 1. A copied fixture import named `setup` collided with the local setup function, causing recursion and `t.after` failures. Renamed only the imported fixture helper. No assertions weakened.
2. Initial test TypeScript exit 1 recorded that collision plus two test/output typing errors. The audit receipt now has explicit named fields and test instrumentation retains Store's generic return type.
3. Second native run: 53 tests, 50 pass/3 fail, exit 1. Deleting audits hit SQLite's FK guard before the intended reader assertions. Corruption fixtures now explicitly disable foreign keys on their separate synthetic corruption connection, preserving the missing-history assertions and testing orphan-order refusal.
4. Expanded dedicated run: 63/63 pass, exit 0, no skips/cancellations/todos. Additional native CA/USD, permanent reference and late-hold cases were then added without altering historical assertions.

Final commands and outcomes are recorded with exact tested/closing identities in the transfer manifest:

```sh
node --import tsx --test --test-reporter=tap --test-concurrency=1 \
  tests/platform-offline-original-lease-command-review.test.ts \
  tests/platform-offline-original-command-review.test.ts \
  tests/platform-offline-original-observation-review.test.ts \
  tests/stock-journal-offline-lease-retirement.test.ts \
  tests/stock-journal-delivery.test.ts \
  tests/stock-journal-original-retry.test.ts \
  tests/stock-journal-permissions.test.ts \
  tests/stock-journal-reconciliation.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check \
  src/server/platform-offline-original-lease-command-review.ts \
  tests/platform-offline-original-lease-command-review.test.ts \
  docs/PLATFORM-OFFLINE-ORIGINAL-LEASE-COMMAND-REVIEW-2026-10-04.md
git diff --check
```

Final affected run: **312/312 pass**, including **66 new cases**, zero failures/skips/cancellations/todos, exit 0, 65,890.029209 ms. Complete TypeScript passes (exit 0). Owned formatting, relative Markdown link targets and whitespace checks pass. The exact final source/test bytes were used in that run; only this report was completed afterward. Root independently reviews, applies and replays the exact three-file delta. No product gate or external qualification is claimed.
