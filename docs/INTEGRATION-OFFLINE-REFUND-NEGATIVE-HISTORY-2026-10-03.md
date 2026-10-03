# Integration failed-refund negative native history

Date: 2026-10-03. Internal read-only prerequisite for accepted D-008/D-010/D-024/D-039 work. No Application wiring, import, provider qualification or product gate is implemented or verified.

## Version and ownership

Excluded public baseline: `e8829bb778e4fe9a9b0ee9752afa5e0d0fae7c40`, tree `e6e52003b48e4019982a06c43f30b2f35c4d5eed`. A fresh detached worktree uses that exact Git object/HEAD. Direct HTTPS Git fetch was blocked by the runtime network policy; authorized public GitHub connector reads supplied the commit, tree and missing blobs. Every downloaded blob, the recursively constructed tree and the reconstructed unsigned commit matched its public Git SHA before checkout. Prior worktrees were preserved. No private runtime artifacts were copied into this checkout.

Owned delta is only [the new reader](../src/server/integration-offline-refund-negative-history.ts), [its new tests](../tests/integration-offline-refund-negative-history.test.ts) and this report. All existing source, tests, schema, tracking and prior reports remain byte-identical to baseline. No source from another active assignment is assumed. Requested model/effort: Astra/high; effective runtime settings are not exposed and remain unverified. No nested delegation.

The transfer manifest identifies the final local commit containing these exact tested source bytes:

- Source SHA-256: `6b9e947168597f45858d395d4100cb4ced0647e129b0958c87fc4dfc0a863c0b`.
- Test SHA-256: `a47f0b321cc3c419886c63c39a960196de0494f4c7bbf5096e9980d27e98230c`.

## Internal contract

Construct `IntegrationOfflineRefundNegativeHistory(database, identity, billing)` using the same actual native instances. Call `getInTransaction(actor, effectId, proposedReference)` in the caller's already active Database writer transaction. The module does not open a transaction, perform writes, accept executable ports or query foreign owners' tables. Database/Identity/Billing construction is trusted internal composition; the class does not authenticate arbitrary replacements for these instances.

The two subject inputs are primitive ASCII strings of 1–160 bytes. Effect ID accepts letters, numbers, underscore and hyphen; proposed reference must match native `re_[A-Za-z0-9_]+`. Whitespace, NUL, wrappers, objects, functions, symbols, coercible objects, accessors, ordinary proxies and revoked proxies are rejected. `types.isProxy` and primitive type checks precede reflection/property access/coercion; there is no input object schema to traverse. Actor is the existing internal locator type: fresh `Identity.workerActor(orgId,id)` resolves active current staff, finance/admin permission, no account scope, current regional organization and no forced password change. Supplied roles/sites/account assertions confer no permission. No recovered identity or external finance authority is created.

Only after all complete Integration preflights and global negative checks does the reader fetch the exact `org_id/id` target using explicit columns. It requires Stripe/refund, unknown state, null `external_ref` and null `result`. Billing is read only through `Billing.refunds.reviewOfflineFailedRefundInTransaction`, under the same writer. That bounded owning task must find the same organization, account, unknown refund and canonical immutable native intent. The original native Integration payload is preserved, not normalized to match Billing. Billing's returned facts hash binds the same-writer invoice/payment/refund/capacity review without foreign SQL.

The exported `IntegrationOfflineRefundNegativeHistoryFacts` return type is deeply readonly; the actual output is deeply frozen and detached from mutable native rows. It contains version/purpose/profile, org/account/region/currency, target/proposed identities, the exact target effect tuple, copied native intent, Billing review hash and the fixed negative-history summary. The hash is SHA-256 of `canonical(facts)` excluding only the final `hash` property. Purpose is `distributor-integration-offline-refund-negative-history-v1`. No timestamp, authority, eligibility, approval or qualification flag is invented. A `total_changes()` assertion confirms the reader and its owning-task composition did not write.

## Complete native scope and conservative refusal

Before target filtering, scan the fixed complete sets:

| Integration-owned set                | Supported negative result                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `integration_effects`                | All rows are bounded and checked for the proposed reference; only the exact scoped target is materialized. |
| `integration_inbox`                  | Must be globally empty, including non-Stripe/unknown provider rows.                                        |
| `integration_refund_callbacks`       | Must be globally empty, including terminal, orphan, unrelated and other-org rows.                          |
| `integration_callbacks`              | Must be globally empty, including terminal or unlinked checkout callbacks.                                 |
| `integration_offline_failed_refunds` | Must be globally empty; no guessed versioned record contract or attribution is accepted.                   |

This is intentionally stronger than trying to classify unrelated Stripe histories. No orphan tenancy is inferred. A copied other-org import record is refused even when its effect foreign key exists. Actual foreign-key-orphan provenance cannot be inserted through the native active foreign-key guard; that guard is unchanged. The complete table scan would also refuse any such retained row. There is no last-row selection, pagination or “newest receipt” rule.

Reference collision checks include every Integration effect, regardless of organization/provider/kind: exact `external_ref`, exact native `reference`, and quoted proposed-reference strings anywhere in valid unescaped payload/result JSON, including keys. Such a JSON match is conservatively refused without claiming it is a semantically authentic provider reference. Any nonempty callback/import set is already refused, so their retained proposed references cannot be silently omitted. Only numeric SQL aggregates cross the boundary before the exact authorized target is selected; no other tenants' rows, identities, payloads or result text are materialized or returned. The output reports only total scanned effect count, not per-tenant counts.

SQLite's native owner authorizer forbids `json_tree`/`json_each` virtual-table reads. The implementation preserves that guard. It uses scalar SQL only and explicitly refuses any backslash-bearing JSON, including otherwise legitimate escaped descriptions or Unicode escape spellings of the proposed reference. This narrow initial profile has no partial escape decoder. A future wider profile needs an independently reviewed bounded owning implementation; no caller option can disable the refusal. Unknown JSON shapes in other effects are not declared semantically valid; negative reference matching never qualifies those effects.

Fixed redacted consistency error: `OFFLINE_REFUND_NEGATIVE_HISTORY` / “Native negative history cannot be established.” Resource overflow uses `OFFLINE_REFUND_NEGATIVE_HISTORY_LIMIT`; malformed primitive inputs use `OFFLINE_REFUND_NEGATIVE_HISTORY_INPUT`. Existing native authorization/Billing errors remain native. Errors contain no other tenants' identities or rows.

## Resource boundary

The fixed-column lists include every retained column of the five tables at schema19. For each table, a count capped at 257 detects overflow; any accepted count is exact, never a truncated collection. Bounds are 256 rows/table and 512 rows across the complete profile. Every column is measured using `length(CAST(column AS BLOB))`, with maximum field, maximum row and total byte aggregates, before any variable data is fetched or JSON inspected. Bytes after embedded NUL and multibyte UTF-8 count. SQL also rejects BLOB/REAL values and embedded NUL; strict table constraints still apply.

Bounds are 65,536 bytes/field, 131,072 bytes/row and 2,097,152 bytes across all five sets. All five sets pass before effect JSON checks or target materialization. SQL scalar JSON validity checks therefore operate only on already bounded documents. A conservative punctuation count (one plus commas, colons, opening arrays/objects, including punctuation inside strings) bounds JSON value nodes above: at most 4,096/document and 16,384 total. It can overcount; it never drops JSON members. No JavaScript `JSON.parse` of global effects or provenance is used. Recursion over returned facts covers only native fixed structures, not arbitrary stored JSON. Existing complete Billing review supplies its independent owner preflights.

Tests instrument the real `Database.execute` path with a call-through observer: oversized/count/JSON refusals and all four nonempty-history refusals return **zero Integration string bytes** from SQLite. No mocked SQL result replaces native behavior. Resource refusal is tested for UTF-8 fields, hidden NUL suffixes, row/aggregate bytes, table/aggregate counts, JSON document/aggregate nodes, malformed JSON, checkout fields and import metadata.

## What this does not discharge

The old [Integration review](../src/server/integration-offline-refund-review.ts) still returns `BILLING_COMPLETE_HISTORY_REQUIRED`, `PLATFORM_RECEIPT_HISTORY_REQUIRED` and `INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE`. Its original [gap reproductions](../tests/integration-offline-failed-refund-application.test.ts) remain unchanged and passing. This module never invokes that review to filter a blocker, replaces a blocker list, or claims its local empty-set result qualifies a source.

Root must compose the original complete Integration lineage review, complete Billing and Platform owning reads, independently qualified private bytes and original-native comparison, actual source interval/candidate generation, current external/native authority and separate approvals under its commit-spanning guard. Polls, leases, accounting descendants, checkout observations/renewals and balance lineage are outside this new negative-history projection; their existing owner checks/blockers remain mandatory. The Billing hash here is consistency, not a waiver of those checks or proof of a first observed provider outcome.

Empty native history cannot prove external non-transmission, finality, complete provider enumeration, source completeness or the absence of events not captured in this database. Neither a caller reference nor a hash authenticates a provider. No recovery hold is queried/released here; native held provider access remains refused in fixtures. This read-only primitive can run under an ordinary writer or a held store and gives neither a mutation grant nor a transport permit. Root owns Application wiring and any approved import order. No writer/retry/replay/release operation, schema change, HTTP route, provider SDK, credential access or environment switch is added.

## Foreground verification and retained failures

Runtime: Node `v24.19.0`, Linux x64, SQLite `3.53.3`. File-backed synthetic Application fixtures cover CA/CAD, CA/USD and US/USD. Native queue/execute setup uses a guarded synthetic transport that throws a lost-response error; no provider is called. Tests isolate the store, review under actual writers, roll back mutations and reopen the same file. Existing source guards are exercised unchanged.

Final focused command:

```sh
node --import tsx --test tests/integration-offline-refund-negative-history.test.ts tests/integration-offline-failed-refund-application.test.ts tests/integration-offline-refund-review.test.ts tests/integration-offline-refund-review-boundary.test.ts tests/billing-offline-refund-review.test.ts
```

Final result: **150/150 pass**, zero failures/cancellations/skips/todos, exit0, 8,131.876685ms; includes all **44** new cases. Complete `tsc --noEmit` exits0. Owned-path Prettier and `git diff --check` pass. Native existing gap assertions remain unchanged. Final test log SHA-256: `804a61113678e783e8497bea3c07e466c3c2e92792abbc6f94556b4d3e63d4f9`.

Retained scratch failure receipts, not erased or published as provider evidence:

1. Initial dedicated run: 12/40 pass, 28 fail, exit1, 7,192.042669ms. Native ownership denied the attempted `json_tree.type` read. Repaired production to bounded scalar SQL and explicit escape refusal; no Database guard change. Original log SHA-256 `8ae8ec81e0b95761846a9a0751c13db76255ce4308836accaf1e75e27baba269`.
2. Dedicated rerun: 39/40 pass, one fail, exit1, 7,449.458947ms. The test helper's default parameter replaced deliberately supplied `undefined` with a valid identity. Repaired the fixture to call the actual method directly with `undefined`, retaining the strict refusal and zero-trap assertions. Production also explicitly rejects trailing whitespace instead of relying on JavaScript regex `$` semantics. Log SHA-256 `3779b61d806ea9163fd04901260ea077ad8560ffc93a79fe1e4995dd9960aaa2`.
3. Intermediate focused replay: 146/146 pass, exit0, 8,358.158977ms; log SHA-256 `78fd2bafb18f6ad340252d188e521f8e21987c0919e3c720853ccf63f25c42ea` is superseded by the exact final receipt above.
4. Added same-writer probes initially gave 147/150 pass, three fail, exit1, 8,321.277863ms: their helper attempted a nested native transaction. Repaired only test invocation to use the existing outer writer; original refusal/zero-materialization assertions remain. Log SHA-256 `dc753c93d51d1b429a8f13a8b1547350ac1498ebc56836a3ac16872ffd26eb57`.

No full product suite, gate acceptance, production traffic, external source qualification or provider qualification is claimed. No CI, runner, workflow, push, PR, deployment, background test, automation or reminder was started. Delivery ends this assignment; root handles composition and publication.
