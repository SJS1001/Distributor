# Restored unknown original stock-journal projection

2026-10-03. Internal read-only D-024/D-025/D-039 prerequisite, not a provider qualification, posting/nonposting determination, import or product-gate result.

## Exact baseline and scope

Excluded baseline: `7578ba28e440eb03ee569094165512a8eb24531f`; Git tree `5a28aa147f745ea0005f05c2a16dc43b8ffbabb3`. Direct public HTTPS Git fetch was blocked by runtime network policy. The public GitHub connector supplied commit/tree/missing blobs; all downloaded blob hashes, the reconstructed tree and commit SHA were verified before creating the fresh isolated detached worktree. Prior checkouts were preserved. No private runtime artifacts were copied.

Only [stock-journal-delivery.ts](../src/server/stock-journal-delivery.ts), [the new tests](../tests/stock-journal-offline-original-review.test.ts) and this report change. Production diff consists exclusively of additions: existing methods, signatures, snapshot/digest construction and transport behavior remain byte-identical. Existing tests and shared files are unchanged. Requested `gpt-6-astra/high`; effective settings are not exposed and remain unverified. No nested delegation.

Final tested source SHA-256: `06f7f5e01cf86014b1c5eea9dd2362f45f83d5c80384cd98d4357c4f85dd7445`. Final tested new-test SHA-256: `efc284944880cd2c644ac3b1938f436d46b1f9049b3c39ad918c4818aaebdd76`. The delivery manifest identifies the exact local commit containing these bytes, file hashes, raw patch and compressed transfer identities.

## API and native ownership

`StockJournalDelivery.readOfflineOriginalInTransaction(actor, journalId)` requires the caller's actual existing Database writer transaction. It uses the class's existing actual Database/Identity/IntegrationCosts/Platform instances; there are no caller SQL, source/parser/authority ports, callbacks or provider inputs. Root owns eventual Application composition.

Journal ID and captured actor `id`/`orgId` must be exact primitive ASCII identities, 1–160 bytes. Proxy detection precedes reflection, including revoked proxies. The actor must be a plain data object with only native Actor field names and enumerable data descriptors. Getter/symbol/hidden/custom-prototype inputs fail without executing traps. Only primitive actor locators survive capture; supplied roles/sites/account claims are discarded. Existing `principal` refreshes current native finance/admin permission, active regional organization, no account scope and no forced password change. Identity rows are accessed through Identity methods only.

The existing bounded `Platform.rawRecoveryHoldInTransaction()` must return an actual retained tuple. Historical `restore.permits()` cannot hide that tuple from this method. No Platform table is queried directly. The method does not call the ordinary reconciliation wrapper's `recoveryHold()`/`restore.permits()` path and therefore does not invoke configured external maintenance observers. It never clears the hold or grants access.

The original source is Integration-owned, not a new Inventory reader. Fixed SQL preflights Integration's cost packet/policy tables before calling actual `IntegrationCosts.deliverySourceInTransaction` and `CostCorrections.deliveryPolicyInTransaction`; no foreign-table read or fake source port is needed. The existing source API validates original input/report/artifact controls, review identities and retained receipt linkage. This method requires the source to remain unaccepted and unsuperseded and includes its exact raw packet, artifact bytes/hash and task result.

Existing `checkedRow`, `originalLineage`, `originalCancelledProof`, `originalCancellationFacts`, `observation`, `stockJournalIntent` and `journalPermissions` validators are reused. The per-date balance and leaf checks from `originalReconciliationInTransaction` are applied in the separate projection; its existing public snapshot is not enlarged or rehashed. Baseline references: source API `integration-costs.ts:673–747`, original reconciliation baseline `stock-journal-delivery.ts:788–1055`, original protocol region/currency guard `quickbooks-stock-journal.ts:163–168`. New method starts at `stock-journal-delivery.ts:882` in the delivered version.

## Facts, ordering and refusal profile

The selected row must be an actual scoped original journal in `unknown`, with no current lease component or external posted ID. Complete source-scoped attempts include ready/rejected/pending/unknown/cancelled rows, their immutable raw plan plus parsed plan, all ordered raw/validated observations, permanent references, predecessor stamps and reduced permission review/decision history. Current raw policy history, source movement reservations, exact raw hold, source dates and totals are included. No paged history supplies completeness.

All original dates balance positively and exactly; summed dates match source debit/credit controls. Every attempt's source bytes/hash, leg/date, org, realm, binding, native intent and policy join exactly. The selected date has one non-rejected leaf and it is the selected unknown journal. Each non-leaf predecessor must be finally cancelled and satisfy the existing complete independent cancellation proof. Source movement reservations must match the journal's unique movement IDs exactly; missing or copied foreign-org reservations refuse.

Every observation hash and contiguous revision is checked. Unknown outcomes have a supported exact body shape and a unique retained lease identity. Earlier posted outcomes, repeated lease outcomes and unknown observation kinds refuse. Permission replacements use native exact-input, independent-decision and chained-authority validation. Every retained original cancellation-evidence entry is validated against its preceding history, and final cancellation can occur only at the last observation of a cancelled row. None of these historical permissions is presented as current external authority.

Global, numeric existence-only checks refuse orphan/cross-org journal observations, references and original-source associations, foreign-org corrections of the selected source, any selected-source receipt, and same-realm/request-reference collisions with another journal. Other tenants' raw rows are never returned. These checks follow complete global byte/count preflights, so hidden foreign/orphan fields cannot evade resource bounds by target filtering.

The first profile deliberately refuses running/posted sibling attempts, active leases, accepted/superseded sources, current policy drift, closed dates and changed inventory posting ownership. Other dates may have no attempt or a ready/pending/unknown/cancelled chain; their retained facts are explicit. Final expiry-only unknown observations without a request reference are refused by the existing cancellation-facts validator; this initial profile does not fabricate missing lineage. Earlier expiry/clock-rollback observations can be retained with their native three-field shape and distinct lease identity.

CA/CAD and US/USD native success paths are tested. **CA/USD remains unsupported by the existing QuickBooks journal intent validator**: a real native CA/USD cost packet exists, but native journal preparation refuses `JOURNAL_SOURCE`. The test preserves that boundary; it does not fabricate an unknown journal or broaden the protocol contract.

Return type `OfflineOriginalJournalReview` is deeply readonly and the actual detached result is deeply frozen. Purpose: `distributor-stock-journal-offline-original-review-v1`. SHA-256 is computed over `canonical(facts)` before adding the `hash` field. Included profile limits and exact raw captures distinguish this from existing review/plan hashes. `total_changes()` must be unchanged. No grant, `allowed`, `canConfirm` or qualification boolean is added. Explicit blockers remain external posting truth, source completeness, current external authority and the retained recovery hold.

## Before-materialization resource checks

Eight fixed Integration-owned sets are preflighted completely: journals, observations, references, cost packets, cost policies, cost corrections, cost receipts and cost movement reservations. Each fixed list includes every current schema column. SQL checks expected text/integer/null storage types, NUL presence, exact accepted row count, maximum field/row bytes and aggregate bytes. `length(CAST(column AS BLOB))` counts UTF-8 and bytes after NUL. Count sentinel129 rejects overflow; accepted counts are complete, never a truncated page.

Fixed profile: 128 rows/table, 512 total rows, 2,000,000 bytes/field, 4,000,000 bytes/row and 8,000,000 total stored bytes. These are conservative engineering limits, not measured production capacity. Scoped sources with more than128 movement reservations refuse even if ordinary protocol line limits would allow them. Returned canonical facts also have an 8,000,000-byte bound; stored-byte budgets are not a claim about total process-memory usage.

Scalar SQL bounds JSON punctuation at8192 and container characters at512 per document **before** JSON validity checks, materialization or JavaScript parsing. Counts intentionally include punctuation inside strings and can over-refuse. Global count/byte limits also bound aggregate parsing work. Native `json_tree`/`json_each` ownership restrictions are unchanged. Embedded `plan.intent.source.bytes` is separately decoded only inside SQLite after the outer JSON preflight; its decoded byte/complexity bounds are checked before native plan/source validators receive it. Escaped brackets cannot bypass the inner check.

Tests observe the real Database execution path without substituting SQL results and confirm zero Integration string bytes leave SQLite before overflow refusal. Coverage includes multibyte and hidden-NUL journal/source fields, source input/report/receipt/artifact, complete history count, aggregate bytes, JSON nodes and escaped embedded-source depth. The raw Platform hold and Identity authority remain their respective owners' tasks.

## Verification, failures and remaining work

Environment: Node v24.19.0, Linux x64, SQLite3.53.3. Real file-backed Application fixtures and actual writer transactions; native prepare/independent approve/claim/unresolved/cancel/retry/permission methods are exercised with synthetic local facts only. No transport client/provider request is used.

Final foreground command:

```sh
node --import tsx --test tests/stock-journal-offline-original-review.test.ts tests/stock-journal-original-retry.test.ts tests/stock-journal-reconciliation.test.ts tests/stock-journal-permissions.test.ts
```

**111/111 pass**, including **52 new cases**, zero failures/cancellations/skips/todos, exit0, 9,579.028468ms. Complete `tsc --noEmit` exits0. Owned Prettier/link/whitespace checks pass. Final log SHA-256: `8cfc9eb247c896168c09340171b0666a178b7e3c59921d236a78b545d44fda4e`. Existing affected retries, reconciliation and permission tests pass without edits; no full-suite/product-gate claim.

Retained failure receipts and repairs:

- First dedicated run44/45, exit1, 8,042.967019ms: reopen used default event reports instead of the fixture's disabled setting, changing Platform startup rows. Repaired the fixture's constructor configuration; conservation assertion unchanged. Log `ef8a6702b85e9588839698bccc16139941833a277dda82f9cce53f922762736e`.
- Expanded run105/107, exit1, 8,724.368538ms: the reopen failure remained because a guarded edit script stopped on a formatting-sensitive anchor; the new source-reservation assertion also reproduced a real omission. Added complete owning reservation preflight/exact membership and foreign/orphan checks; applied the reopen configuration fix. Log `39666a2a90832a96694e293d40c0845ffd175518fcd5727eddf33ff79e2a790f`. Next run107/107 passed, exit0, 8,745.387107ms, log `16adbc9f8ffa8012ceddb0196bf918664d363fdce0202c49d33a46a7ad58f8c4`.
- Adversarial history run48/51, exit1, 8,413.653686ms: valid hashes alone admitted duplicate-lease, prior-posted and unclassified observations. Added exact supported outcome shapes, distinct lease identities, final-cancellation ordering and complete cancellation-evidence validation only in the new method. Original three red assertions remain. Log `82396bc276ef05eef927bb57def039369cc85485dc19ad4ee70064dea991650b`. Next affected run110/110 passed, exit0, 8,987.339834ms, log `18779506aae3a6f1dabc3c4b3f5d03e607c5e22f09be1f01953bab2d04793013`.
- Embedded-source run51/52, exit1, 8,730.179951ms: escaped brackets hid inner source complexity from outer lexical preflight. Added decoded-source numeric SQL preflight; the original zero-materialization/limit assertion remains. Log `8621f0459ec615130091394825541d8dffad61a058ba780f1e3c0cf841c052bb`. Final111/111 supersedes this failure.

Logs remain in scratch; only synthetic test/report/source changes are delivered. No source/schema/owner guard was relaxed to fix an assertion. No CI, runners, workflow, provider IO, accounts, credentials, deployment, push, PR, nested session, reminder or automation was started.

Root must still join baseline/end generations, qualified source completeness and fencing, authentic independent QuickBooks realm/posting/nonposting evidence, current external authority and approvals. Local source reservations are not a revalidation of physical Inventory or an external ledger. Coherently rewritten/deleted history cannot be authenticated by its own recomputed hash. No import, retry, posting, settlement or recovery release is authorized by this projection. Application/coordinator integration and publication belong to root.
