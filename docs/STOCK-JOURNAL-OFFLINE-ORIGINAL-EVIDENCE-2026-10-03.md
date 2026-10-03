# Captured original-journal final nonposting assertions

This D-024/D-025/D-039 prerequisite compares one restored UNKNOWN ORIGINAL journal's exact current native facts with two supplied complete projections and one asserted final cancellation/nonposting outcome. It is read-only. A matching result supplies no provider authenticity, complete external enumeration, source qualification, current external authority, independent approval, retry, settlement, import or recovery-release permission.

Excluded public baseline: `73e6ac90b881b0351fe25c3d3d5d5a18f17a6ed3`, tree `9215f4d82ddd773bc8c7e555d7ea78b5dfd49fee`. Only the new [comparator](../src/server/stock-journal-offline-original-evidence.ts), [tests](../tests/stock-journal-offline-original-evidence.test.ts) and this document belong to this assignment. The prior [native projection](STOCK-JOURNAL-OFFLINE-ORIGINAL-REVIEW-2026-10-03.md), its failures/refusals, all existing modules/tests, digest domains, schema and Application wiring remain unchanged.

Requested model/effort: `gpt-6-astra/high` under the owner's delegated boundary rule. Effective model/effort is not exposed by this runtime and is unverified. No delegation or additional coding session was launched.

## Fixed internal interface

`new StockJournalOfflineOriginalEvidence(database, identity, journals)` takes the actual Database, Identity and StockJournalDelivery from the same trusted Application composition. It takes no executable reader/parser/authority ports. `captureInTransaction(actor, journalId, input)` requires the existing actual writer; it does not start or commit a transaction. Same-instance construction is a trusted composition obligation, not a capability conferred by a caller's structurally similar object.

The exported `OfflineOriginalEvidenceInput` has exactly `version: 1`, `source`, `candidate` and `providerClaims`. Both projections have the full actual `OfflineOriginalJournalReview` shape and hash. `providerClaims` contains exactly one `OfflineOriginalProviderClaim`:

- `profile`: `quickbooks-sandbox-original-final-cancellation-unposted-v1`.
- `outcome`: `cancelled-unposted`.
- `request`: exact native original-cancellation snapshot plus canonical immutable intent hash.
- `attestation`: the existing exact `OriginalCancellationEvidenceInput` fields. Its three true assertions remain assertions; no boolean manufactures proof.

The request snapshot contains version, organization, journal/review/source identities and hashes, posting date, realm, binding, permanent `DJ-` reference, region, currency, positive balanced per-date debit/credit and complete ordered observation hash. `intentHash` binds the entire actual native intent, including exact source bytes, closed-through date and ordered account mappings. External case reference and evidence text are nonempty, exact untrimmed strings bounded to 160 and 2,000 UTF-8 bytes respectively. No credential or arbitrary payload field exists.

The method strictly captures the actor locator and inert supplied fields, then refreshes actual IAM finance/admin staff authority, organization/account scope and password state. Supplied role/account/site assertions never authorize it. It calls the actual `readOfflineOriginalInTransaction` before producing any comparison result. That owner again refreshes IAM, requires the raw Platform hold, preflights complete retained Integration sets, and obtains immutable source/policy data through their actual owning operations. The comparator queries only Integration's `total_changes()` before/after; no foreign SQL or owner mutation is added.

Both supplied full projection hashes are independently recomputed and the complete canonical projections must each equal the freshly recaptured native projection, including raw hold, source bytes, raw plan, ordering, policies, permissions, cancelled ancestors, every attempt, permanent references and observations. Rehashing matching forgeries on both sides cannot replace native recapture. Canonical object-key order is immaterial; arrays and all retained raw strings remain exact. A source/candidate difference, even a later legitimate permission or observation, refuses this first profile instead of being normalized.

`CapturedOfflineOriginalEvidence` is detached and deeply frozen. It retains one full exact native projection (both asserted projections must equal it), their hashes, exact captured claim, cancellation snapshot, fixed capture profile, version, distinct purpose `distributor-stock-journal-offline-original-evidence-v1` and hash over every other output field. It exposes no qualification/grant flag. `assertCapturedOfflineOriginalEvidence(value)` checks only membership in the module's process-local WeakSet without traversing the supplied value. JSON/cloned/reconstructed/proxied copies fail that identity check. A capture can still pass identity after rollback, reopen or later native change; consumers must never treat identity as freshness or an authority token.

## Existing native contracts reused

At the excluded baseline, [stock-journal-delivery.ts](../src/server/stock-journal-delivery.ts) lines 882–1309 implement the bounded original reader. Its calls at 1223–1224 reuse `originalCancellationFacts` (2626 onward) and `originalCancelledProof` (2383 onward); native `originalLineage`, immutable intent reconstruction and `journalPermissions` remain the validators for independent approval, complete predecessor history, one leaf/date, exact references and historical permissions.

The comparator reconstructs the exact existing cancellation snapshot/history hash, independently tested against `originalCancellationEvidenceReview`. It calls [originalCancellationEvidenceInput](../src/server/stock-journal-original-cancellation.ts) at line 43 for the fixed attestation grammar. No private cancellation method is made public and no ordinary cancellation is performed. The full owner projection and exact intent hash additionally bind facts beyond that existing small snapshot.

CA/CAD and US/USD use actual native source/prepare/independent-approve/claim/beforeWrite/unresolved fixtures. CA/USD remains the existing [QuickBooks stock-journal](../src/server/quickbooks-stock-journal.ts) source-region/currency refusal at lines 163–168; the fixture reaches native source creation and asserts preparation refusal. No fabricated CA/USD journal bypasses it. The sandbox profile is explicit; no production QuickBooks qualification is implied.

## Bounded capture and conservative limits

`node:util.types.isProxy` precedes every reflection, array test or value access on untrusted values, including revoked proxies. Plain Object/null-prototype records and ordinary dense arrays only; all fields must be enumerable own data properties except the standard array length. Getters, setters, hidden/symbol fields, extra fields, custom prototypes, sparse arrays, cycles, functions, boxed primitives, undefined, NUL, malformed Unicode, nonfinite/noninteger/unsafe numbers and negative zero refuse. Nested ignored actor grants are validated before being discarded. No caller JSON is parsed; embedded source/plan bytes must match the independently validated native capture exactly.

| Bound                                 |      Fixed limit |
| ------------------------------------- | ---------------: |
| Actor canonical bytes                 |           16,384 |
| Each full projection canonical bytes  |        8,000,000 |
| Complete input capture accounting     | 16,016,384 bytes |
| Final canonical result including hash |  8,016,384 bytes |
| Individual string UTF-8 bytes         |        2,000,000 |
| Traversed nodes                       |        1,100,000 |
| Nesting depth                         |               64 |
| Array members                         |            8,192 |
| Object own fields                     |              128 |

Capture accounts for UTF-8 strings and JSON escape expansion before aggregate canonicalization. Primitive number accounting is conservative. Keys and child descriptors are checked before reading values; collection size is checked before descriptor/value traversal. There is no pagination or truncation. Deep/dense native shapes outside this additional comparator profile conservatively refuse even if the original reader would accept them. A real four-cancelled-ancestor/unknown-leaf fixture produces a native projection above 64KiB and passes; the smaller Stripe comparison ceiling was not copied.

The original SQL limits remain unchanged: 128 rows/table, 512 aggregate rows, 2MB/field, 4MB/row, 8MB total, bounded JSON punctuation/containers and separately bounded decoded embedded source before materialization/parsing. A comparator-path test spies on real Database execution and confirms zero Integration text bytes materialize before native oversized-plan refusal. No owner preflight is replaced with a post-serialization check.

## Qualification and composition still required

The sole admitted provider claim is exact-request final cancellation with asserted nonposting and prevention of future posting. Lookup miss, absence, pending, posted, generic cancelled status, nonfinal cancellation and future-posting possibility refuse. Multiple/missing claims refuse. Matching prose, labels, true flags, case references, hashes or locally retained cancellation history prove neither issuer nor finality. Authentic provider evidence may not be available for this contract; this implementation does not invent it.

Root must separately qualify private evidence bytes and their issuer/signature, complete source interval/provider enumeration, actual final cancellation/no-future-posting semantics, company/account/binding equivalence, current independently verified external/native approval authority, residency/provider-choice obligations, candidate/source generation and writer fencing. Existing historical permission never becomes a current provider grant. The actual hold tuple must match this first profile exactly; divergent source/end projections need a separately specified profile, not waived comparisons. Existing owner blockers remain in the returned native facts unchanged.

No private evidence parser, common approval/phase contract, owning mutation/provenance, commit-spanning guard, public route, runtime enablement or Application composition was added. This comparator performs no provider IO and cannot record cancellation, retry, settle, release a hold or authorize transport. Native cancelled ancestors remain historical evidence, with original reservations and source immutable. No product/task gate is verified.

## Foreground verification and retained failures

Environment: Linux x64, Node `v24.19.0`, SQLite `3.53.3`; existing installed repository dependencies used without lockfile/dependency edits. Direct HTTPS Git fetch was blocked by network policy. The public GitHub read connector supplied the exact commit/tree and missing blobs. Every imported blob, reconstructed full tree and unsigned commit object matched its public Git SHA before a fresh isolated detached worktree was created. Earlier checkouts/receipts were preserved. An initial reconstruction assertion compared the tree endpoint's echoed commit SHA with the tree SHA; using the commit's actual tree SHA fixed setup. The initial commit timezone assumption was corrected by matching the exact object hash, not by replacing the baseline.

Retained foreground outcomes:

1. Initial full TypeScript log had TS2775 (arrow assertion annotation) and TS2550 (`isWellFormed` outside the repository ES2023 library). Replaced the arrow wrapper with a declared assertion function and used bounded UTF-8 round-trip validation. No tsconfig change. The initial shell wrapper returned its final `cat` status; the compiler's separate numeric exit was not retained, so that wrapper is not a passing typecheck.
2. First new native suite: 61/61, exit 0, 10,996.159337ms.
3. Added ignored-caller-grant adversarial test: 0/1, exit 1, 1,011.888580ms. Nested proxy/sparse sites were previously ignored without rejection (not executed or trusted). Capturing all inert actor data before discarding grants fixed the production boundary; the exact refusal/zero-trap assertions remain.
4. Affected five-suite run: 175/175, exit 0, 11,932.819435ms. Separate original-cancellation regression: 14/14, exit 0, 4,940.083966ms. Complete TypeScript passed.
5. Added escaped aggregate-byte test: 0/1, exit 1, 1,043.221824ms. Raw UTF-8 accounting had omitted serialized escape expansion and reached the owner spy. Production now counts escapes before allocation/owner recapture; the assertion remains. Added a separate dense-node refusal.
6. Final six-suite run: **191/191**, including **66 new cases**, zero failures/cancellations/skips/todos, exit 0, **12,928.688197ms**. Complete TypeScript exit 0. Owned source/test formatting was applied before this final run; final owned formatting, report links and diff whitespace are checked before committing.

Final commands:

```sh
node --import tsx --test tests/stock-journal-offline-original-evidence.test.ts tests/stock-journal-offline-original-review.test.ts tests/stock-journal-original-retry.test.ts tests/stock-journal-reconciliation.test.ts tests/stock-journal-permissions.test.ts tests/stock-journal-original-cancellation.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/prettier/bin/prettier.cjs --check src/server/stock-journal-offline-original-evidence.ts tests/stock-journal-offline-original-evidence.test.ts docs/STOCK-JOURNAL-OFFLINE-ORIGINAL-EVIDENCE-2026-10-03.md
git diff --cached --check
```

Final tested runtime source SHA256: `290c0b25516576ab31ddda2f144d88573f6fafc1218a68b76a97ba56981e9179`; test SHA256: `983d58408442422d7b6f6e2c2cea952f15f73cc312bb401089ff0ef85053e5c7`. The final byte check verified both identities; the delivery manifest binds the actual committed bytes. The closing commit ID is supplied with that manifest; no circular self-hash is embedded here.

Failure logs remain outside the tracked repository: initial TypeScript SHA256 `8c60b9098322cd996fed1bed87ad3b4cb405cade2235392a36a5ece4c5a89d4b`; actor red `a8f16c42f361c2620cf67bd2db8f8b0b61356e58a7c0ab9e9fe5661d9ede2520`; escape red `66bcf8bcbc821e475fd1516f3b13f4fec6da3c9d02fe84fbd0dd9c853bc09d27`. Final native log SHA256 `da64b95333c58dc3353ec0cf82e2e00392e539a891cbcb4d2498345d0b214cd3`; final empty TypeScript log SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. No full-product suite, live provider qualification, CI, background test, push, PR, deployment or reminder was run.
