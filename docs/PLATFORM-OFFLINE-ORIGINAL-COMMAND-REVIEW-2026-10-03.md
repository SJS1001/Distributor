# Original stock-journal command provenance — 2026-10-03 assignment

Implemented and verified on the isolated public baseline `e5d8bd73028438a67b0b8b202d61fccfe0a1f68e` (tree `56b28aacc7baab68df934c7d953e60f282209b37`). This is a read-only prerequisite for D-024/D-039, not completed restore composition or external provenance qualification. No Application, schema, existing reader, existing test or tracking document changed. Verification completed across the UTC date boundary into 2026-10-04.

## Internal API and authority

[PlatformOfflineOriginalCommandReviewReader](../src/server/platform-offline-original-command-review.ts) takes actual `Database`, `Identity` and `StockJournalDelivery` objects from trusted native composition. `getInTransaction(actor, journalId)` requires the caller's existing writer. It refreshes current native finance/admin staff authority, rejects customer-account scope and password-change restrictions, and invokes the actual journal owner's [readOfflineOriginalInTransaction](../src/server/stock-journal-delivery.ts). That owner independently rechecks current authority and the actual raw restored-store hold, immutable source, policies, native references, plans and complete supported original lineage. No nested owner mutation/transaction, provider lookup, route or restore release is introduced.

Construction and each read check exact owner prototypes, data-descriptor database/Identity/Platform links, the IntegrationCosts/journal back-reference, owning Store/database/module bindings and absence of per-instance method replacements. The reader's retained Platform Store must still belong to its Database. These are internal composition checks, not a new public owner-registration or arbitrary-adapter interface. Native module prototypes and application composition remain trusted. No caller callback, SQL, source, grant, clock or completeness flag is accepted.

Only the caller's own primitive `id`/`orgId` descriptors are used. Proxy/revoked-proxy locators, accessors, inherited locators, object-valued IDs and coercion objects refuse before executing hooks. Supplied role/site/account fields are ignored; current IAM decides authority. Additional ignored caller properties are not enumerated or evaluated. The selected journal identity must be a bounded primitive native ID.

The result is a detached, recursively frozen consistency projection with:

- Purpose `distributor-platform-offline-original-commands-v1`, region/currency/org/journal binding and the freshly recaptured native owner's `nativeHash`.
- Complete organization Platform command/audit counts and deterministic history hash under `distributor-platform-original-command-history-v1`; selected and other-source command counts are explicit. Unrelated command result bodies never appear in the returned projection.
- Every selected source attempt's preparation, independent decision where present, every retained original-cancellation evidence command, final cancellation where present, and corresponding original observation audits. Ready, rejected and other-date pending obligations remain visible.
- Exact immutable native receipt views, Platform request hash/key/author/time and paired durable audit ID/sequence/time. `factsHash` commits the complete returned body.

`total_changes()` must remain unchanged. A returned frozen object/hash is historical consistency, never reusable current authority. Root must freshly compose the matching native, private-source, qualification, current external authority and commit-fence reviews in its actual writer. No permission is inferred from the absence of a blocker.

## What can actually be recovered

[Platform.command](../src/server/platform.ts) retains the request hash and serialized result, not a separate full request payload. This implementation does not invert that hash or accept a copied receipt as its preimage.

| Operation             | Independently retained native material and exact check                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial preparation   | `StockJournalDelivery.plan` retains the exact `input` in its immutable plan. The reader compares the complete ready receipt view with that native plan/row, and requires SHA256(canonical(plan.input)) to match the Platform request hash. This recovery comes from the owning plan, not a claim that Platform stores a separate request.                                                                                                                                                                          |
| Approve/reject        | The native row retains journal/review identity, final decision and **trimmed** decision reason. A fixed candidate payload is returned only if its canonical hash equals the retained request hash. Otherwise the receipt/native/audit join remains visible with `DECISION_REQUEST_PREIMAGE_NOT_RETAINED`; no guessed payload is returned. The real owner accepts extra decision fields and trims the reason, so this blocker is reproduced with an actual native request containing whitespace and an extra field. |
| Original retry        | Reconstruct the owner's fixed historical retry dossier from the fully validated cancelled predecessor, complete history/evidence/cancellation, immutable successor plan and owner's fixed review reason. Bind its digest plus predecessor ID and successor's retained raw reason to the exact retry request hash. A mismatch refuses. No live permission lookup or retry command is executed during hold.                                                                                                          |
| Cancellation evidence | The complete input and its reviewed snapshot survive in the immutable native observation. Compare the exact evidence receipt and hash this retained input; require the original evidence author and sequence. Every retained evidence revision is joined, including superseded evidence.                                                                                                                                                                                                                           |
| Final cancellation    | Reconstruct the exact four-field request from native journal identity and the final cancellation observation's request reference/evidence hash/reason. The owner validator requires this exact input shape and retains the unnormalized body. Compare the entire final cancellation receipt, author, evidence/history and payload hash.                                                                                                                                                                            |

Each retained attempt requires exactly one preparation and, where applicable, one decision/final cancellation. Extra or missing matched receipts, orphan IDs within the selected source, changed source/plan/reference/state/result fields, wrong preimage hashes, missing/duplicate audits and reversed durable order refuse. Independent decision authors must agree with the actual owner-validated row/history. Cancellation evidence/observation/audit precedes its cancellation; cancellation precedes retry preparation. Complete native observation joins reuse the existing [Platform observation reader](../src/server/platform-offline-original-observation-review.ts), whose purpose and hash remain unchanged.

Other source receipts are bounded, paired and committed in the organization history hash, but their native owners are not joined by this selected-source operation. `OTHER_SOURCE_RECEIPTS_NOT_OWNER_JOINED` makes that limit explicit. This is not a whole-organization native ledger certification. Related unsupported journal commands (including future/permission profiles whose result mentions this source/attempt) refuse rather than disappearing from the review.

## Completeness and resource boundary

All SQL is fixed and Platform-owned. There is no direct IAM/Integration/Inventory/Billing table query. Actual task operations supply native facts.

Before any organization command/audit text enters JS or any result/detail JSON is parsed, numeric SQL preflights cover every fixed returned column, its SQLite storage type, the complete row count, maximum UTF-8 BLOB row length and summed bytes. Embedded NUL contributes its actual bytes. Limits are 1,000 organization commands, 4,000 organization audits, 65,536 raw bytes per row and 8 MiB combined raw bytes. There is no truncation. Audit order organization/sequence integrity and global clock coverage are checked before materialization. Complete local rows carry same-read hexadecimal BLOB witnesses; decoding must round-trip exactly, so malformed UTF-8 cannot silently become replacement characters. Witnesses are discarded, not returned.

Selected command/audit JSON is bounded to depth 48 and 16,384 nodes by iterative traversal before recursive canonicalization. Command JSON must round-trip to the actual `JSON.stringify` serialization, and request-hash audit detail must equal canonical serialization. Duplicate keys, alternative serialization, extra result fields and malformed hashes refuse. The actual journal and observation owners retain their additional, unchanged limits (including the journal owner's bounded complete global Integration tables and the observation reader's 1,000-observation-audit profile). Raw byte ceilings are input/materialization budgets, not a claim that expanded in-memory or hash serialization uses only 8 MiB.

Reverse-scope checks return numeric refusals only. They independently preflight the **complete foreign Platform command set** to at most 1,000 rows with the same row ceiling, contributing its raw bytes to the same 8 MiB aggregate. Foreign and unsupported local journal results must pass bounded scalar `json_valid`. Any literal Unicode escape in those collision-only result profiles refuses before local materialization. Native IDs are bounded ASCII; after this refusal, literal occurrence checks cover all ID/source occurrences, including duplicate JSON keys. A foreign result containing a selected journal **or source** ID refuses, and a foreign audit using a selected command's actor/name/key refuses. Other-tenant rows/values never enter JS or the returned result. A separate native organization with independent real command receipts remains readable without being returned or joined.

The Unicode-escape refusal is deliberate conservative incompleteness: even unrelated foreign results containing such escapes require another owning contract. The scalar inspection does not certify foreign UTF-8, foreign owner state or provider truth. The native authorizer prohibits `json_tree`/`json_each`; it is unchanged. No reflection, PRAGMA, foreign-table access, generic SQL port or permissive error remap bypasses it.

## Supported scope and unresolved inputs

Supported fixtures use actual native owners, before isolation, to prepare/approve, become transport-uncertain, record cancellation evidence, independently cancel and prepare/approve retry chains. CA/CAD and US/USD, zero/two cancelled ancestors, multiple evidence revisions, rejected attempts and independent ready/pending dates are covered. No provider call occurs; native `beforeWrite` only marks the synthetic native lease as dispatched before `unresolved` records uncertainty.

Existing CA/USD original QuickBooks preparation still refuses `JOURNAL_SOURCE`; this reader does not manufacture an unknown original to bypass it. Bounded embedded NUL in a native decision remains the journal owner's explicit `OFFLINE_ORIGINAL_REVIEW` profile refusal. Oversized complete history, unsupported owner state, pending lease, foreign identity ambiguity and unsupported related command profiles likewise stay refused.

Always-retained blockers state that historical receipts are not external provenance, source completeness is unqualified, current external authority is required and the recovery hold remains. A valid native cancellation receipt does not newly authenticate a provider's final non-posting claim. Missing exact approval request bytes require the responsible source/provenance owner to supply a separately designed retained-preimage contract; this reader cannot recover them from a hash. Root owns further composition and actual source/candidate/qualification/fencing-through-COMMIT work. All product gates remain unverified.

## Foreground verification and preserved failures

Environment: Linux x64, UID 0, Node v24.19.0, SQLite 3.53.3, OpenSSL 3.5.7, TypeScript 7.0.2, Prettier 3.9.9. Used the existing installed dependency directory through a temporary symlink; no package/lock change. Requested Astra/high per the supplied owner boundary rule; launcher controls/effective settings were not exposed and are **unverified**. The macOS canonical rule path was unavailable in this Linux workspace; the supplied rule was used. No nested executor, CI, provider I/O, private/customer data, push, PR, merge or background job.

Normal HTTPS fetch was blocked by network policy. Authorized public GitHub commit/tree/blob reads supplied 19 missing blobs; every blob size/SHA1, every tree and the exact commit SHA were verified before isolated checkout. Previous worktrees were preserved. The later parent checkpoint was not imported.

[Test file](../tests/platform-offline-original-command-review.test.ts) contains **96 dedicated tests**. Final ten-file run: **345/345 pass**, zero failures/cancellations/skips/todos, exit 0, **17,541.394305 ms**. This includes the 96 new cases and 249 unchanged affected cases. Exact command:

```sh
node --import tsx --test \
  tests/platform-offline-original-command-review.test.ts \
  tests/stock-journal-offline-original-review.test.ts \
  tests/stock-journal-offline-original-evidence.test.ts \
  tests/restore-offline-original-native-join.test.ts \
  tests/stock-journal-original-retry.test.ts \
  tests/stock-journal-original-cancellation.test.ts \
  tests/stock-journal-delivery.test.ts \
  tests/platform-offline-refund-review.test.ts \
  tests/platform-offline-refund-review-boundary.test.ts \
  tests/platform-offline-carrier-review.test.ts
npm run typecheck
node_modules/.bin/prettier --check \
  src/server/platform-offline-original-command-review.ts \
  tests/platform-offline-original-command-review.test.ts \
  docs/PLATFORM-OFFLINE-ORIGINAL-COMMAND-REVIEW-2026-10-03.md
git diff --check
```

Full TypeScript and dedicated formatting pass. Synthetic tests assert actual same-writer uncommitted damage visibility, exact native snapshots/total_changes, rollback, reopen, fresh revocation/password/account/org authority, proxy/accessor non-execution, complete count/aggregate/UTF-8/NUL refusal before row materialization, malformed UTF-8 refusal, exact hashes, duplicate/orphan/copied history, escaped/duplicate-key reverse closure, detachment/deep freeze and no returned foreign/private error text. No full-suite, actual infrastructure/provider, external authority, operator or product acceptance is claimed. No candidate filesystem/WAL qualification was exercised; root-only WAL metadata failure handling was neither altered nor bypassed.

Historical failures remain in the foreground receipts and are not overwritten:

1. Initial TypeScript: two errors from assuming `source.packetId`; corrected to the actual native packet identity. Initial native run: 6/6 pass.
2. Expanded native run: 46/47 pass. The account-scope fixture treated the actual customer ID string as an object; SQLite refused an undefined bound parameter and TypeScript caught the incorrect field. Corrected to the actual ID, retaining the authority refusal assertion.
3. Resource run: 80/81 pass. A purported success fixture included embedded NUL in the native decision; the existing journal owner deliberately refuses it. The multibyte success case now uses supported text, while a separate actual-native NUL test explicitly asserts the unchanged owner refusal. No production owner restriction was relaxed.
4. Dedicated run: 89/89 pass; first affected run: 338/338 pass. Later adversarial exploration exposed the initial literal-only foreign/unsupported collision gap (0/2 pass). The first escaped-fixture construction also escaped JSON numeric syntax, so its initial attempted-repair 2/2 result was not sufficient evidence; the final fixture asserts that the escaped JSON parses to exactly the original native receipt.
5. An attempted decoded collision traversal used prohibited `json_tree.fullkey`: 280/345 affected cases passed, 65 new cases failed with the native authorizer error. Replaced that approach with the documented scalar, escape-refused collision profile. No authorizer/shared file was changed and no assertions were dropped. Dedicated scalar run: 96/96 pass (16,565.072052 ms).
6. TypeScript then reported two SQL parameter errors because the native packet is typed as a general frozen row. Added a real primitive-ID check/narrowing before the SQL binding. Final complete TypeScript and 345/345 affected run above pass.

Local scratch receipts are under `original-command-evidence/`: `typecheck-initial.log`, `first-native.log`, `expanded-native.log`, `boundary-native.log`, `final-native.log`, `final-affected.log`, `escaped-closure-red.log`, `escaped-closure-green.log`, `final-closure-affected.log`, `scalar-closure-native.log`, `typecheck-scalar-final.log`, `typecheck-completed.log`, and `completed-affected.log`. Early standalone compiler output is also retained in tool output. These are execution receipts, not external/private-evidence qualifications.

Exact tested source: 26,809 bytes, SHA256 `04d01250172b259629617e7bd2a85623dd7932ea2d217a53ec51750a4539b18d`. Exact tested new test: 33,848 bytes, SHA256 `4e04248f77bce34c71608117e88ad5c0e4ce89c2fe6536116e1384c25ceecfbb`. The closing three-file commit and raw/gzip/chunk/file hashes are supplied in the transfer manifest; its source/test bytes must match these tested bytes. Original baseline files are independently rehashed unchanged before delivery. This assignment ends after exact local patch transfer.
