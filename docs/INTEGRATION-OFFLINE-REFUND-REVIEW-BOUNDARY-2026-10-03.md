# Integration offline refund review: independent boundary tests

Current continuation: the full-row resource preflight repair against exact
`27a81cc0ed8dc7266895c4e313f8a049af459db4` is recorded at the end of this report.
Eight new resource-boundary reds were reproduced and repaired unchanged;
76 focused and 191 affected checks pass. Earlier semantic red/repair receipts
below remain historical evidence.

## Repair continuation — 2026-10-03

Exact excluded incremental baseline: `0c916ca8c9f4bcd2b1dabb7da2ed51f54ddeffe3`. Only `src/server/integration-offline-refund-review.ts`, this report and its existing boundary test are changed. The original adversarial receipt below and its red logs remain retained. **All six original failing assertions now pass unchanged.** The original boundary test bodies were compared byte-for-byte with the excluded commit; only fixture helper currency configuration changed, and five new test cases were appended. Requested `gpt-6-astra/high`; effective settings remain unexposed/unverified. No nested session or delegation.

The native read-only repair:

- Selects checkout callbacks by retained selected-checkout session references as well as effect IDs, through the same bounded SQL reader. Cross-scope/orphan/mismatched subject links refuse. If a selected session maps to multiple selected checkout effects, its callback refuses ambiguous attribution. Unrelated unattributed inbox rows are still excluded with their existing blocker; callback raw-event and inbox settlement hash domains remain separate.
- Requires checkout observation amount to be a positive safe integer equal to its immutable native intent amount. Snapshot currency equals the actual configured organization currency, and intent currency equals its native lower-case representation. This does not infer currency from country: Canadian USD remains supported.
- Validates and compares the common immutable invoice ID/number/total/currency subset between QuickBooks credit/payment descendants and their completed invoice parent. Parent full invoice objects and descendant summaries intentionally have different shapes. No foreign Billing SQL or new Billing API is used.
- Binds retained balance results to native completed invoice/reference/total/currency and their own requested timestamp. Nonnegative monetary components, bounded provider balance and safe signed native balance/difference are required. Exact integer arithmetic checks both historical native balance and provider-minus-native difference, using BigInt only for comparison after safe-integer validation. Old balances are not compared with today's Billing totals, and no external outcome is inferred from agreement between copies.
- Rejects negative/non-safe refund retry timestamps while preserving valid exact token/start/retry data and all existing claim blockers. No claim is retired, corrected or settled.

The API, returned fact shape/hash domain, all three permanent completeness blockers, current native authority checks, writer requirement, hold behavior and foreign-module ownership remain unchanged. Additional rows newly discovered through retained sessions can change a review hash or exceed existing bounds, correctly requiring refusal/fresh review. The stricter consistency checks may reject corrupt historical copies previously returned successfully; they never rewrite them. No schema change, transport, import, new authority grant, session wiring or provider qualification is introduced. These repairs do not make the review a complete shape validator for every historical owner record or replace independently evidenced source completeness.

Final foreground verification on Linux/x64, Node `v24.19.0`, using the existing native SQLite fixtures and repository dependencies:

```text
node --import tsx --test tests/integration-offline-refund-review-boundary.test.ts tests/integration-offline-refund-review.test.ts tests/refunds.test.ts tests/refund-callbacks.test.ts tests/accounting-payments.test.ts tests/accounting-credits.test.ts tests/accounting-refunds.test.ts tests/accounting-balances.test.ts tests/checkout-observations.test.ts tests/checkout-history-proof.test.ts tests/integration-restore-dispositions.test.ts
```

Result: **186/186 pass**, zero failures/cancellations/skips/todo, exit 0, 10,662.372836 ms. Complete `tsc --noEmit`, Prettier for the three owned files, local report links and staged whitespace checks pass. Existing dependencies were reused through a temporary local symlink, removed before commit; no dependency/lockfile changes. No native test or production file outside ownership changed.

New cases verify cross-scope retained-session detection and overflow refusal before callback materialization, CA/USD checkout/accounting history, preservation of historical observations after a later native payment, every common accounting summary field, and balance copy type/binding/arithmetic refusals including exact arithmetic near safe-integer limits.

Repair logs retained outside the repository in `/workspace/scratch/ffbb94708048/`:

| Log                                             | Observed result                                                                             | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `integration-refund-review-repair-first.log`    | Original two suites, 49/49 pass                                                             | `f87b0e74035c8b854eab48b627dafa2b75b0ebecaa3240f9e32def66ea10ec80` |
| `integration-refund-review-repair-expanded.log` | 53 pass/1 fail; newly added arithmetic fixture accidentally described consistent arithmetic | `47afca2fa4eae50cd378697291fa44ff734749c36a275a2cad314df36320e23a` |
| `integration-refund-review-repair-final.log`    | Final affected native regression, 186/186 pass                                              | `10769a774853777135d5c508282c6e79b96a6c592a099a7f04741eb11e93a90c` |

The new arithmetic fixture was corrected to an actual one-cent contradiction caused by floating-point intermediate rounding; production arithmetic and all six original assertions remained unchanged. Original failure logs and the exact earlier two-file delivery are preserved. Root's newer combined checkout, Billing/Platform/storage/phase repairs and coordinator were not fetched or evaluated. No product/recovery gate is verified. This incremental delivery ends the assignment without background tests, monitoring or reminders.

## Original adversarial receipt (preserved)

Date: 2026-10-03. Exact excluded source commit: `9ae4fce4fbd520a48483e976b2834e81f2b36526`. This delivery changes only this new report and [the new boundary test](../tests/integration-offline-refund-review-boundary.test.ts). Production, the original review tests/document, Billing, Platform, schema and tracking files remain unchanged. No newer root checkpoint was fetched or applied.

**Result: six meaningful red tests remain, representing five local consistency gaps (checkout amount and currency have separate cases).** The 23 new cases finish 17 pass/6 fail. Combined with the unchanged original review suite, 49 cases finish 43 pass/6 fail, zero skipped/cancelled/todo. These tests do not implement or qualify offline import. Every failure is `AssertionError: Missing expected exception` against `OFFLINE_REFUND_REVIEW`, not a fixture setup, timeout, provider or SQLite error. Root owns production repairs.

The owner's supplied canonical delegated model rule was read: architecture/security/adversarial work requests `gpt-6-astra/high`. This runtime exposes neither effective model/effort nor a root model-selection control; effective configuration is unverified. No nested agent/session was launched. AGENTS, README, PLAN, DECISIONS and current HANDOFF instructions were inspected. The narrower assignment's no-push/no-provider/no-background restrictions govern this delivery.

## Reproduced gaps and narrow repair directions

Line references below are at the exact excluded commit. The implementation is [integration-offline-refund-review.ts](../src/server/integration-offline-refund-review.ts); the existing scope/limitations are in [its original report](INTEGRATION-OFFLINE-REFUND-REVIEW-2026-10-03.md).

### 1. High priority: recoverably linked checkout callback disappears

Test: `boundary: refuses copied callback subject`.

The fixture natively creates and completes a checkout, captures its callback and records settlement/inbox history. Change only `integration_callbacks.effect_id` to `orphan`. The native `session_id`, org, event ID and checkout's `external_ref` remain intact. Review returns successfully instead of rejecting the contradiction. Selection uses only the effect-ID list at lines 246–248. Inbox selection then derives only from the selected callbacks at lines 297–313, so the retained callback and its linked receipt both disappear from this review despite the unchanged session binding.

This differs from an inbox receipt stripped of every attribution link: the already-selected owning checkout still has the exact session reference. Recommended repair: bounded selection by selected native checkout session references as well as effect IDs, followed by the existing scoped-subject consistency check and duplicate-event checks. Refuse a callback whose session identifies one selected effect while its effect ID identifies none or a different effect. Preserve all original rows and receipt hash domains. Do not assign unrelated orphan inbox rows to this refund or remove the unattributed-history blocker.

### 2. Medium priority: resealed checkout observations contradict native amount/currency

Tests: `boundary GAP: resealed checkout snapshot amount contradicting immutable intent is refused` and the corresponding `currency` case.

Native fixture observation is 11,300 CAD. Change only its snapshot amount to 1, or currency to USD, and recompute the ordinary SHA-256 snapshot hash. The exported review succeeds. Lines 513–525 bind IDs and the hash, but omit native financial identity. [integration-checkouts.ts](../src/server/integration-checkouts.ts):67–85 originally records amount from the immutable checkout payload and currency from the invoice. Both are already available to the review; the currency comparison must respect native lower-case payload versus upper-case snapshot conventions without silently treating different currencies as equivalent.

Recommended repair: reject snapshot amount/currency inconsistent with that observation's owning immutable checkout intent and the available native invoice identity; validate the native observation shape before trusting fields. Retain valid historical observations. Do not compare old provider status with a newer current status or infer authentic provider evidence from a matching hash. This is a missing local contradiction check; the original report promises snapshot subjects/hashes but does not claim full external result qualification.

### 3. Medium priority: accounting parent/descendant immutable invoice copies disagree

Test: `boundary GAP: copied accounting parent payload contradicting its descendant snapshot is refused`.

Create and complete a native QuickBooks invoice and payment descendant. Assert both saved invoice totals equal 22,600, then change the parent payload's `invoice.total` to 1. The payment descendant still contains 22,600. Review succeeds. Lines 378–386 check completed parent/reference and invoice ID only. The descendant invoice summary is deliberately smaller than the parent's full invoice object, so comparing full JSON objects is incorrect; compare the shared immutable ID/number/total/currency fields and any other native common bindings. Native construction is [integration.ts](../src/server/integration.ts):950–988, 1025–1032 and 1107–1114.

Recommended repair: compare those immutable common fields across selected native parent/descendant snapshots, with appropriate shape/money checks. Preserve native ordering and completed references. This is internal disagreement, detectable without provider contact or foreign SQL. Broader current Billing conservation and source completeness remain separate owning prerequisites; do not substitute today's balance for historical immutable totals.

### 4. Medium priority: two matching balance copies can contain impossible arithmetic

Test: `boundary GAP: consistent copies of a contradictory balance arithmetic result are refused`.

Create a native accounting balance observation, first assert its `difference === providerBalance - nativeBalance`, then change `difference` to 999 in both `integration_balance_reads.result` and `integration_balance_observations.result`. Review accepts both copies because lines 533–554 check identity, sequence and equality of the copies, not their internal arithmetic. Native creation at [integration-accounting-balances.ts](../src/server/integration-accounting-balances.ts):245–280 validates invoice/reference/currency/total and constructs that exact difference.

Recommended repair: validate the historical result's own safe-integer fields and arithmetic; bind immutable invoice/reference/currency/total as available. Matching copies are not independent evidence. Do not require old observed balances to equal today's native balance, infer external finality or expand Integration into foreign balance-table inspection. The original report explicitly leaves full financial settlement validation to owners; this red isolates the smaller deterministic contradiction that can be rejected locally.

### 5. Lower priority: negative refund retry timestamp passes

Test: `boundary GAP: a negative retained refund retry time is refused`.

Set the existing poll's `retry_at` to -1. Lines 227–233 validate its claim token/start tuple and effect kind, but do not validate retry time. The native poll registers zero and ordinarily writes nonnegative epoch retry times in [integration-refunds.ts](../src/server/integration-refunds.ts). Callback retry timestamps already receive a nonnegative check in the review at lines 265–266.

Recommended repair: require a safe nonnegative native retry timestamp, retaining its exact value. Do not clear or age out any claim. No observed scheduling/transport bypass is claimed: this API is a read-only projection, with blockers, and performs no scheduling. This is a malformed native timing field accepted into the hash.

## Passing boundaries and deliberate limits

The suite uses real synthetic native SQLite stores and existing writer transactions. Setup creates shipped invoices, verified payments, credits, refunds and effects through native operations. A guarded in-memory adapter produces one lost-response unknown refund; checkout/accounting/balance fixtures also use native task APIs with fixed synthetic adapter results, never a provider network call. Only deliberately corrupt retained fixtures use owner-scoped SQL. Setup vocabulary is shared with the earlier test; the new assertions independently call the public owner review and do not import or execute tests from the earlier file.

Passing checks cover:

- Stale actor snapshots cannot override current role, active status, buyer-account restriction, organization binding or forced password change. A Store spy verifies rejection occurs before Integration row materialization. Missing writer transaction refuses. The unchanged suite additionally exercises all configured CA/US and CAD/USD combinations.
- Before `SELECT *`, 65 matching callback rows refuse and a 65,538-byte UTF-8 effect error refuses. The spy delegates real SQLite reads and records their SQL; it is test-only and introduces no production callback port. These checks cover the specific promised row and large-field preflights, not SQLite's internal query memory, all aggregate-byte paths or production volume qualification. Other fetched string limits and the final 2 MiB bound are post-fetch checks by design; no stronger pre-materialization claim is made.
- Selected cross-org/account observations, malformed snapshot JSON, cross-org callbacks, incompatible inbox provider, payment mapping amount/org contradictions, cross-org accounting effects, malformed/missing balance observation copies, missing/foreign polls and partial/negative-start claims refuse.
- A current exact generic lease on a completed accounting effect remains present, with exact token/time and blocker. Terminal checkout observations/inbox remain visible under the synthetic recovery hold; review does not clear hold or alter `total_changes()`. Nested results are frozen, mutation throws, prior results remain detached from later writer changes, rollback restores the prior hash and application restart reproduces the same held result.
- Native same-org manual proof is visible only through existing Billing `accountingFact`, with complete-Billing and retained-outcome blockers. A malformed foreign manual-proof row is not pulled across tenants. Integration does not claim it reviewed full Billing proof history. Unattributed inbox is excluded with its explicit blocker. Platform receipts remain an explicit missing owner dependency.

Passing IAM checks do not authenticate a request session or external maintenance authority. This internal API accepts an actor identity and re-derives native authority; caller/session wiring belongs to root. Copied hashes, statuses, signatures or SQL facts cannot establish issuer, exhaustive source interval, source fencing, provider outcome truth, current approval or non-transmission. The newer Billing/Platform/phase implementations are not present at this tested commit; their interfaces are neither guessed nor evaluated here. Full restored-candidate activation, coordinated source review and imports are outside scope.

## Exact verification receipt

Environment: Linux/x64, Node `v24.19.0`; repository's existing dependencies reused through a temporary local `node_modules` symlink, removed before commit. No dependency/lockfile changes. The native fixture uses Node SQLite and the existing Database ownership/writer guards unchanged.

Foreground commands on the final test source:

- `node --import tsx --test tests/integration-offline-refund-review-boundary.test.ts tests/integration-offline-refund-review.test.ts`: **43 pass / 6 fail / 49 total**, zero cancelled/skipped/todo, 3,394.497192 ms (runner exit 1). All six failures are the retained boundary assertions described above. The unchanged original suite passes all 26 cases.
- `node_modules/.bin/tsc --noEmit`: complete repository typecheck passes, including the new test.
- Assigned Prettier checks, local report links and `git diff --check`: pass. No production repair, assertion weakening, skip/todo conversion, timeout adjustment or native guard change.

Original logs remain outside the repository in `/workspace/scratch/ffbb94708048/`:

| Log                                            | Outcome                                 | SHA-256                                                            |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `integration-refund-boundary-original-red.log` | Initial 15 new cases: 10 pass/5 fail    | `32a6aac86c8a6a8e4ed3dfb72cae39b2113dfabc92e5aa3d63db85620c2bc426` |
| `integration-refund-boundary-expanded-red.log` | Combined 49 cases: 43 pass/6 fail       | `ae7ca3e647bef09f219ef4ed71f29ac8ac6a10d9ac8faf9ad89a6f84598dfbdc` |
| `integration-refund-boundary-final-red.log`    | Final combined 49 cases: 43 pass/6 fail | `744ffa0d87dc86519acc4fe13ebca28c13af6970e1841fbd959a863d86351bbc` |

Delivery log `integration-refund-boundary-delivery-red.log` preserves the final replay, SHA-256 `ccc14c7c94cde27a6d164297dd9151aedb0b5386112a08d6a9ddfaca028961ae` (43 pass/6 fail). The earlier final-named log is retained unchanged.

Final assertions add explicit original-value/arithmetic checks to the red fixtures; they do not relax the expected refusal. Root should repair within its production ownership and replay these unchanged assertions, then broaden verification as appropriate. No product or recovery gate is verified. This delivery ends the bounded assignment; no background process, runner, provider IO, publication, reminder or recheck routine is created.

## Full-row resource preflight continuation — 2026-10-03

Exact excluded base: `27a81cc0ed8dc7266895c4e313f8a049af459db4`. Only the owned
Integration review module, this existing boundary test and this report change.
All 725 original boundary test lines are preserved byte-for-byte as the expanded
file's prefix. The published semantic repair remains intact. Previous Billing
work at `0192f2b295b1434851a83c396554c67fa0ed1228` remains in its original clean
worktree and is excluded from this delta.

Direct shell GitHub fetch was blocked by network policy. Read-only GitHub Git
object retrieval for SJS1001/Distributor supplied the missing public blobs and
trees. Every blob/tree identity and the exact commit object SHA were verified
before creating the separate `codex/integration-full-row-byte` worktree. No remote
write, unrelated repository fetch or newer owner delta was included.

### Reproduced original failure

The existing `rows()` preflight covered selected payload/result/error/reason
columns. Other columns were subject to the same 64-KiB bound only after
`SELECT *` returned them. Likewise, the complete cumulative byte check happened
after materialization. The eight appended red tests use native unknown-refund
and native callback fixtures, followed by explicit owner-scoped corruption under
rollback. Call-through Database/JSON probes retain actual SQL results/errors and
record only synthetic byte counts; no production response is mocked.

Original run: **62 tests, 54 pass, 8 fail**, exit 1, zero skipped/cancelled/todo,
4,786.265769 ms. All existing 54 focused cases passed. Every new refusal still
returned the native `OFFLINE_REFUND_REVIEW_LIMIT`, but retained text had already
left SQLite:

| Omitted field or complete set                                   | Marked UTF-8 bytes fetched before refusal |
| --------------------------------------------------------------- | ----------------------------------------: |
| Target effect reference                                         |                                    66,019 |
| Target effect account ID                                        |                                    66,020 |
| Target effect external reference                                |                                    66,022 |
| Target effect kind                                              |                                    66,014 |
| Target creation timestamp, including embedded NUL               |                                    66,021 |
| Poll claim token                                                |                                    66,014 |
| Native callback binding, including embedded NUL                 |                                    66,019 |
| 36 native callbacks with individually sub-64-KiB binding fields |                                 2,160,684 |

All original probes saw **zero parsed/serialized marked bytes**: the old post-fetch
limit prevented that later work. The demonstrated defect is the earlier
SQLite-to-JavaScript materialization boundary, not successful acceptance of an
invalid review, provider truth or a released reservation. Tests do not attempt
process exhaustion or claim to measure SQLite's internal query workspace.

Original red log `/tmp/integration-byte-boundary-red.log` is retained unchanged,
SHA256 `744a3077a8ca463d7fbbf8ec035d91f3b064269753e42a7e1353f111f486e474`.

### Owning repair

The fixed table descriptors now enumerate every retained column of all fourteen
Integration-owned sets: effects, refund polls, refund callbacks, checkout
callbacks, inbox, operation leases, payment allocations, accounting refunds,
credit applications, credit cancellations, checkout renewals, checkout
observations, balance reads and balance observations. They are literal owning
code, not runtime reflection/PRAGMA or caller-selected SQL.

The existing **64 rows per set / 512 total rows** check runs first. Numeric SQL
metadata then checks each field's UTF-8 bytes, largest full row and complete set
sum before fetching any row in that set. `length(CAST(column AS BLOB))` counts
multibyte text and bytes after embedded NUL. Null contributes zero; numeric
retained values also contribute their textual byte length to the full-row sum.
The field ceiling remains **65,536 bytes**, including variable JSON fields.
Complete row/set sums must fit the remaining **2,097,152-byte cumulative budget**.
Repeated target/alias reads retain their existing cumulative accounting rather
than obtaining a new budget. No truncated collection is returned.

Metadata returns only numbers; it does not construct/parse JSON to measure
values. Actual ordered complete reads follow only after the preflight passes,
inside the existing native writer transaction. The subsequent scalar type/string
checks, JSON depth/node/64-KiB guards and final exact canonical-body limit remain.
The final canonical check also covers escaping, keys and projection overhead;
these limits are not an exact whole-process memory cap.

The target effect already goes through `rows()` and now receives the same full
preflight before its reference/account are used. Other direct Integration scalar
reads in this method are numeric `total_changes()` metadata. Existing task-shaped
IAM/Billing interfaces are unchanged, with no foreign SQL, new authority port,
foreign writes, schema/API/Application edits or provider transport. The account
scope and copied-lineage predicates, semantic validations, current authority,
read-only guard, detachment and all completeness blockers are unchanged.

### Added coverage and final receipt

The eight original red assertions are retained unchanged. Additional native
checkout, ledger payment/credit/refund, cancellation and unsent-renewal fixtures
exercise omitted fields in every remaining returned Integration history table.
Each tested table must contain actual native history before corruption. Rollback
restores the original full review. Exact 64-row and 64-KiB field boundaries still
return complete facts with all permanent completeness blockers. Repeated
callback-alias queries share the 2-MiB cumulative fetch budget and refuse before
fetching the set that would cross it. No historical authentication, provider
qualification or first-slice eligibility is inferred from these facts.

Environment: Linux/x64, Node `v24.19.0`, UID 0, existing isolated dependencies
through a temporary symlink removed before commit. Repository instructions were
read; the external canonical model-rule path was unavailable. Requested
Astra/High; effective runtime model/reasoning remains unexposed and unverified.

Final foreground commands:

```sh
node --import tsx --test tests/integration-offline-refund-review-boundary.test.ts tests/integration-offline-refund-review.test.ts
node --import tsx --test tests/integration.test.ts tests/integration-authority.test.ts tests/integration-operations.test.ts tests/refunds.test.ts tests/refund-callbacks.test.ts tests/accounting-refunds.test.ts tests/accounting-credit-applications.test.ts tests/accounting-balances.test.ts tests/checkout-renewal.test.ts tests/checkout-observations.test.ts tests/integration-offline-refund-evidence.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/integration-offline-refund-review.ts tests/integration-offline-refund-review-boundary.test.ts docs/INTEGRATION-OFFLINE-REFUND-REVIEW-BOUNDARY-2026-10-03.md
git diff --check
```

- Focused tests: **76/76 pass**, exit 0, 8,234.071518 ms; zero
  failed/skipped/cancelled/todo. All eight red probes now report zero marked bytes
  fetched/parsed/serialized. Log `/tmp/integration-byte-boundary-final.log`, SHA256
  `a7dd0ee591a63dbba5744bcdf9e4ceeb81ba22a170a43a23717ecb5b67d6af50`.
- Affected regressions: **191/191 pass**, exit 0, 14,214.404873 ms, same zero
  failure/skip/cancellation/todo counts. Log `/tmp/integration-byte-regressions.log`,
  SHA256 `490f0173ec989c2ccba0c451d306069813ff2c8de536ffa2f990284fd2119996`.
- Complete TypeScript, assigned formatting and whitespace checks: **pass**.
- First green run: **62/62 pass**, log `/tmp/integration-byte-boundary-green.log`,
  SHA256 `c7de672114bda2d9fda238add5dd6cd50cad055e66d24c64001815852dea134b`.
- Expanded fixture run retained: **75 pass / 1 fail / 76 total**,
  `/tmp/integration-byte-boundary-expanded.log`, SHA256
  `81331bdbb0a616135b5905ec73dd3a48493cab8f0f11a04ae176076d54721589`.
  The new renewal fixture mistakenly read `view.balance`; native validation and
  TypeScript TS2339 both refused it. Corrected only that new fixture to the actual
  `view.currentBalance`. No assertion, timeout, native guard or production
  semantic check was weakened.

Source bytes: baseline production SHA256
`d3f3f66b1abcabaae8dceaa3f15649088301027b752d236983d903287944f5a7`;
final production SHA256
`3d119665674da36732e09183e2d797533858bc1d988df29335585a4618826111`.
Baseline boundary-test SHA256
`139f32d1f1a941955b4b6bd316f7b550f6dedf69c5714472b307706b8ab6d525`;
final expanded boundary-test SHA256
`c6ac7e9e033a6bd81bed8aed4b020553581ef420850e7e90a35a50820d383fee`.

These synthetic same-writer native checks qualify neither actual provider/source
truth nor restored-candidate WAL capture, infrastructure, customers, operators
or product gates. No dependency/lock changes, CI/runners/workflows, PR/push,
remote merge, deployment, provider IO, nested session, reminder or background
routine. Fixture applications close through existing test cleanup. This bounded
assignment ends with its local commit and exact incremental patch transfer.
