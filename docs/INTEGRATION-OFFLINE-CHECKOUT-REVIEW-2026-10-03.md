# Bounded native checkout recovery review — 2026-10-03

This prerequisite adds an internal, read-only Integration projection for an UNKNOWN Stripe checkout and its complete retained invoice checkout lineage within a deliberately narrow profile. It preserves current obligations and refuses unsupported history. It grants no provider access, first-slice eligibility, source completeness, import authority or restore release permission. All product gates remain NOT VERIFIED.

## Version and ownership

Excluded public baseline: `6a7096ea79ad39cd14195bf5cf3697ab838d9fc7`; exact tree `7bc54b6635f89419c05498e116fa5d8167c9dd5d`. A normal HTTPS fetch was blocked by network policy. The read-only public GitHub connector supplied the commit/tree and twelve missing blobs; their sizes/object hashes, complete reconstructed tree and exact unsigned commit identity were checked before creating isolated `codex/offline-checkout-review`. Previous worktrees remain preserved.

Tested source/test commit: **`1eeeb654979c60cffba09c691f99aac3c25fb25e`**. The closing documentation commit changes only this report. Exact tested files:

| File                                                | Bytes | SHA256                                                             |
| --------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `src/server/integration-offline-checkout-review.ts` | 24298 | `cd2e7f9aff25c066447a1b23e0529b92e015ea615bff64d6a19491d0a9150b38` |
| `tests/integration-offline-checkout-review.test.ts` | 26865 | `eb87e3fef0c94132fbae1a8e02adbc9b10114aacf4be91653c54e76a6a5e04bc` |

Only those two NEW files and this NEW report are contributed. Existing Application, owners, schema, tests, reports and tracking remain unchanged. The six existing checkout/refund test files in the final command are byte-identical to the excluded baseline. Root retains coordinator/composition/result recovery; the other assigned refund-history and security owners are not duplicated.

AGENTS, README, PLAN, DECISIONS, latest HANDOFF and the accepted-requirement audit were read. Requested model/effort: Astra/high. Effective runtime controls/settings are not exposed for verification; the supplied delegated-model rule was followed and its macOS filesystem path is unavailable here. No nested session was launched.

## API and exact admitted scope

[IntegrationOfflineCheckoutReview](../src/server/integration-offline-checkout-review.ts) is constructed from the actual `Database`, `Identity`, `Billing` and `IntegrationCheckouts` of one trusted application composition. `getInTransaction(actor, effectId)` requires the caller's existing native writer transaction. It does not open a transaction, supply a reader callback, migrate, mutate, call a provider or wire any route. The constructor is an internal trusted composition boundary; foreign application instances must not be substituted for those owners.

Input effect ID is a primitive, trimmed, bounded non-control string. Actor proxy/accessor/coercion callbacks are rejected without invocation; only own data descriptors for org/user identity are captured. `Identity.workerActor` freshly resolves active native finance/admin staff, organization, no account scope and password-change requirements. Stale caller role/account fields do not grant authority. Provider consent and recovery hold are not changed or interpreted as permission; local review works while transport remains held.

The first profile requires a native invoice with positive total and zero current credited/paid/refunded aggregates, one rooted checkout renewal chain ending at the selected UNKNOWN effect, and no other provider-kind effects for that account. It supports:

- Original unknown sends, complete `not_found` lookup histories and retained actual in-flight lookup claims.
- Multiple native unsent supersessions, preserving each blocked predecessor and the current unknown leaf.
- An unchanged completed/expired/unpaid predecessor whose original review hash and full observations still match, followed by a native renewal and unknown successor.
- A checkout made unknown by a later null refresh, with the latest non-`not_found` observation bound to its retained result. An older matching observation cannot excuse a later contradictory proof.
- Pending/processing/waiting/blocked/failed callbacks as retained obligations, including callbacks received before the unknown effect obtains an external reference. Their received-body hashes are opaque retained facts, not recomputed signature/provider proofs.

Existing `invoiceId`, `assertIdentity`, `current` and `successor` owner methods are reused after the fixed preflight. Renewal review hashes are reconstructed with their actual pre-renewal state and null successor: unsent pending becomes the exact retained blocked disposition; completed expiry retains its original result. No paged history read is used. Observation records require exact keys, canonical bytes, native row/snapshot identities, SHA256, amount/currency/reference/status linkage and complete selected sequence order. Global observation sequence gaps are legitimate; this reader does not invent a contiguous per-invoice sequence or prove that an earlier deleted record never existed.

An unknown predecessor with a pending successor, changed predecessor proof, ambiguous roots/cycles, copied scope collisions, local orphan records, unsupported financial/provider descendants, or refund-import provenance attached to checkout refuses. It does not suppress the successor, clear a claim, cancel a booking or mark any queue terminal. Conservative collisions include foreign organization rows carrying the selected account, invoice, effect or known external session identity. Errors are fixed and expose no foreign row contents.

Returned detached, recursively frozen plain facts include purpose `integration-offline-unknown-checkout-native-review/v1`, org/region/actual currency, account, invoice/current totals, target/current identity, ordered chain, raw selected effects, complete renewals/observations, and named collection arrays for leases, callbacks, allocations and related Integration histories. Empty arrays represent the admitted selected Integration sets. `factsHash = SHA256(canonical(facts without factsHash))`; it is deterministic historical consistency, not a signature or reusable authorization. Raw payload/result/error strings stay internal to this projection and must not be exposed as a public summary.

## Explicit owning-history gaps and bounds

Two fixed refusals are reproduced using real native workflows:

1. **`OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED`:** a native manual payment on the unknown checkout invoice makes current `Billing.totals` nonzero. `Billing.paymentHistory.list/page` open their own transactions and cannot be called under this writer; `Billing.recordedPayment` resolves a known ID but cannot enumerate complete settlement history. Totals do not recover original payment/credit/refund provenance. The test also proves an uncommitted actual Billing payment is visible and rolled back with refusal. A future Billing-owned, bounded same-writer invoice settlement-history operation is needed before expanding this profile. It must supply complete payments, credits/refunds/reservations/opening facts, orphan/collision checks and pre-materialization bounds through a task-shaped public API. No foreign Billing SQL or dummy payment rows are used here.
2. **`OFFLINE_CHECKOUT_INBOX_HISTORY_REQUIRED`:** an actual native settlement on another invoice creates a global Stripe inbox row. The current inbox retains only provider/event/hash/time, without org/effect/payment attribution or the event/payment hash preimage. The reader refuses any retained Stripe inbox, including unrelated-looking rows, before presenting an empty selected inbox. A qualified owning attribution/source-history contract is required; absence of a callback match cannot prove absence of a checkout settlement.

`billingScope` explicitly says `current-native-invoice-and-zero-settlement-totals`. `allocationPayments: []` describes the admitted empty Integration allocation set, not exhaustive Billing history. The projection makes no claim that zero aggregates authenticate all Billing history or detect arbitrary coordinated corruption of foreign-owned tables. Billing's existing public invoice/totals operations retain their own materialization behavior; the new SQL preflights below cover Integration-owned tables only. Broader historical qualification remains blocked on the owning contract rather than fabricated completeness. Platform original command/audit provenance likewise remains Platform-owned and is not reconstructed from effect rows.

All fifteen fixed Integration sets are preflighted over the whole store before any Integration text row is materialized or any payload is parsed. This is deliberately more conservative than the returned target scope: unrelated retained volume can refuse a review. There are no SQL/column/profile arguments or schema reflection/PRAGMAs under the authorizer.

- At most 64 rows per fixed table and 512 rows in aggregate; overflow refuses without truncation.
- Each fixed column uses `length(CAST(column AS BLOB))`, including identity/reference/status/timestamps, so UTF-8 and bytes after NUL count. Maximum field size is 64 KiB and maximum raw row sum is 256 KiB. SQL also rejects unsupported scalar storage types and integers outside the JavaScript safe range before row conversion.
- Complete aggregate budget is 2 MiB using six times retained byte size plus fixed per-field overhead. This conservatively budgets escaping and record keys before serialization; the final canonical fact size is checked too. Larger legitimate stores require a separately reviewed bounded profile, not silent pagination.
- JSON is at most 64 KiB, 16 levels, 4,096 visited nodes and 128 children per container. Iterative shape/number checks precede recursive canonicalization. Duplicate keys, noncanonical serialization and malformed structures refuse.
- `total_changes()` must remain unchanged. Actual same-connection uncommitted Integration/Billing facts are observed; rollback restores original state. A second SQLite writer cannot acquire the lock during review. Later reopen produces the same facts/hash. The reader neither rereads through another connection nor changes any owner data.

These native checks cannot establish original receipt authenticity, provider-account identity, external event completeness, historical source fencing, physical residency or current external maintenance authority. The future coordinator must separately bind complete native/source/provider facts, candidate generation, private bytes, independently qualified trust/operations, duties and exact command receipts. This prerequisite supplies none of that authority.

## Foreground verification and preserved failures

Environment: Linux/x64, UID 0, Node **24.19.0**, OpenSSL **3.5.7**, SQLite **3.53.3**. Existing isolated dependencies were reused by a temporary worktree symlink; no package/lock/config change. All adapters in fixture creation are synchronous-controlled synthetic test adapters, not vendor SDK/network calls. Tests exercise actual `Application`, native commands, SQLite stores, Billing and checkout owner methods. A held native recovery tuple is used to check transport refusal; no filesystem candidate/WAL qualification or setuid workaround was attempted.

Final command, exit **0**, **168/168 pass**, zero failure/cancellation/skip/todo, **9,405.090068 ms**: **60 new tests plus 108 existing checks**.

```sh
node --import tsx --test \
  tests/integration-offline-checkout-review.test.ts \
  tests/checkout-history-proof.test.ts tests/checkout-current.test.ts \
  tests/checkout-renewal.test.ts tests/checkout-observations.test.ts \
  tests/checkout-access.test.ts tests/refunds.test.ts
npm run typecheck
prettier --check src/server/integration-offline-checkout-review.ts \
  tests/integration-offline-checkout-review.test.ts \
  docs/INTEGRATION-OFFLINE-CHECKOUT-REVIEW-2026-10-03.md
git diff --check
```

Complete TypeScript and assigned formatting pass. No full-suite, browser, provider, infrastructure, production restore or product acceptance claim is made. Root must independently replay/integrate the new internal class. No source guard was relaxed to accommodate Linux/root filesystem behavior.

Preserved initial runs and repairs, with logs retained outside the contribution:

| Log                      | Outcome and repair                                                                                                                                                                                                                                                                                                                                             | SHA256                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `focused-initial.log`    | 44 tests: 40 pass, 4 fail. Reopen fixture copied rather than shared the cleanup holder; bootstrap lacked the security row targeted by UPDATE; external corruption connection still enforced FK; global inbox refusal occurred after an unrelated observation mismatch. Fixed setup/lifecycle and moved the named inbox refusal before retained-row processing. | `8a2b302938dafd8b7b4e291ce1c084e2553d165c86fc5f689df497f8446a1d97` |
| `focused-repair.log`     | 44/44 pass after those repairs.                                                                                                                                                                                                                                                                                                                                | `73fd54862083739881fc5bd1a58e1a0f83eb5a671d7ed3294f717ebcdf0eb302` |
| `expanded-red.log`       | 54 tests: 53 pass, 1 fail. Reader accepted an older matching observation despite a later contradictory verified record. Bound retained result to latest non-not-found observation; original assertion retained.                                                                                                                                                | `8a7a029aa575afa54f35d2db55761b6b2966fdbcdd10bb5e22daf06bc8ac40b7` |
| `numeric-red.log`        | 58 tests: 57 pass, 1 fail. SQLite unsafe integer reached row conversion and leaked its value in a RangeError. Added fixed numeric/type SQL preflight before materialization; original assertion retained.                                                                                                                                                      | `3e0cd8cbade2e9702f0afbfd56af3a5e1b40ec29e9360e44cebed262d2222850` |
| `typecheck-tests.log`    | Failed on missing test instrumentation `this: Store` annotation; repaired.                                                                                                                                                                                                                                                                                     | `c1cdf89812cd7b932aeb9a305ccf89262cd7cc8464c50dec322ef57fda55d249` |
| `typecheck-final.log`    | Failed on broad `Row.id` including undefined in a test SQL argument; explicit string extraction fixed the test typing.                                                                                                                                                                                                                                         | `658067368b5f3cb5867337e55af1cccf6323929fab0f86a2a1f23648be215569` |
| `affected-final-v3.log`  | Final 168/168; includes later provenance-scope and preflight cases.                                                                                                                                                                                                                                                                                            | `16a5932b099e0140e5027b344774367f308d28b2d82fb7d47f6469aca6abdc47` |
| `typecheck-final-v3.log` | Complete TypeScript exit 0. npm emits its pre-existing unknown `http-proxy` environment warning.                                                                                                                                                                                                                                                               | `561e0b64da9c027206b026047fea097e70b4e9f9488a41f2a7de084bcdd29e2b` |

Intermediate 162/162 and 166/166 affected runs are retained too; counts overlap and are not added. No assertions were skipped or weakened. Final artifact manifest supplies the exact three-file delta, tested file hashes, closing commit and independently encoded transfer chunks. There are no active fixture servers, provider processes or background test jobs after delivery.
