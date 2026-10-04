# Native offline Canada Post member import — 2026-10-03

This implements the fixed internal owner operation for D-013/D-025/D-039. It does not enable an application route, qualify provider evidence, release a recovery hold, transmit a manifest, or supply the external authority/fencing interlock through COMMIT. All product gates remain NOT VERIFIED.

## Baseline, ownership and execution

- Exact excluded public baseline: `f756569ba00118c6ebc17efe69616e3805d03a48`, SJS1001/Distributor, `codex/local-distributor-checkpoint`. Native HTTPS fetch succeeded; no API hydration was needed.
- Tested source commit: `a8c3b33342f05a62dafe7754c4c73c5a2bfd8978`. The closing commit adds only this report; the transfer manifest records its exact hash.
- Isolated branch: `codex/cloud-canada-post-import`, `/workspace/Distributor-canada-post-import`. Previous commits/worktrees/artifacts are preserved.
- Five changed paths: existing `src/server/carrier-bookings.ts`, existing `src/server/restore-offline-canada-post-private-evidence.ts`, new `src/server/integration-offline-canada-post-member.ts`, new `tests/integration-offline-canada-post-member.test.ts`, and this report. The existing native join is unchanged. No schema, Database, Platform, Application, shared parser, dependency, old test/report, or concurrent owner's file changed.
- Linux x64, Node v24.19.0, SQLite 3.53.3. Existing locked dependencies were reused from `/workspace/Distributor/node_modules` through a temporary symlink removed before delivery. No dependency installation or lockfile update was necessary.
- Astra/high was requested. Effective model/effort and launcher selection are **unverified**; no runtime control exposes them here. The local canonical rule `/Users/stevensmith/.codex/rules/delegation-model-selection.md` is unavailable in this cloud checkout. No nested delegation occurred.
- README, AGENTS, PLAN, DECISIONS, latest HANDOFF and actual carrier/private/native/phase/storage/recovery APIs were inspected. No PR, merge, push, CI/runner, provider request, credential, account, deployment or background automation was used.

## Fixed API and exact ordering

Trusted root composition constructs:

```ts
new IntegrationOfflineCanadaPostMember(
  actualDatabase,
  actualIdentity,
  actualPlatform,
  actualFulfillment,
  actualCarrierBookings,
);
```

`read(envelopeInput, manifestInput)` delegates to the existing fixed private profile: task owner `integration`, name `integration.canada-post-member.import`, version `1`. This is structural selection, never registration or permission. There is one canonical JSON file, the unchanged 16,000,000-byte private cap, exact evidence item/hash/set binding and the same pinned capture lifecycle. It yields the existing handle; call `complete()` before application. No payload/PDF getter, operator callback, parser registry, raw-file reread or provider client is added.

`applyInTransaction(actorLocator, handle)` requires the actual caller-held outer Database writer. `actorLocator` contains only `id` and `orgId`; signed external identities do not create native IAM actors. The wrapper recognizes its own handle through a private WeakMap before traversing actor data. Fake, foreign-reader, disposed, pending and replayed captures cannot issue an owner operation. Wrapper reentry poisons the outer attempt. Refusal, including refusal before a writer exists, disposes that reader's capture without invoking a caller-supplied `dispose` property.

The private handle then:

1. Parses only the completed captured bytes, with the existing fatal UTF-8/canonical JSON/duplicate-key/strict bounded data checks. It verifies the unchanged payload domain/hash.
2. Runs the unchanged complete native join: actual current scoped IAM; raw hold; pinned complete candidate and envelope dev/ino; complete Carrier unknown-member and proposed-reference views; every member's Platform and Fulfillment projections; exact current original facts and candidate consistency.
3. Runs `RestoreOfflineNativePhase.reviewInTransaction` inside that same writer. The current retained session must be OPEN with exact revision/lineage/generation, and complete native/retained release history must be empty. No terminal release is filtered away.
4. Issues a private, synchronous owner capture tied to the exact CarrierBookings instance, envelope, parsed input, native join and active lifetime. The fixed bridge is an identity-only boolean; it cannot return bytes or manufacture a capture. A private CarrierBookings field also rejects prototype-copied owners. Own method replacements are refused before owner invocation.
5. Calls `CarrierBookings.applyOfflineCanadaPostMemberInTransaction(token, envelope, input, joined)`. Publicly copied comparator inputs, hashes, booleans or reflected object properties cannot satisfy this identity binding.
6. Always destroys its registry entry and zeros captured byte buffers. The native validator's decoded PDF and copied PDF buffer are erased in `finally`; parsed JavaScript strings become unreachable, but JavaScript does not offer physical string-memory erasure.

The owner independently requires current native finance **and** existing carrier warehouse permissions, password policy, staff account, raw hold and target site. Original native provider gates remain intact. The offline owner has a separate private check requiring isolation, ordinary packed custody, unchanged snapshot, current customer finance status and existing provider choice; it never invokes or relaxes `assertProviderAccess`.

**Current role limitation:** IAM has one role per principal. Existing warehouse readers accept warehouse/admin, while finance accepts finance/admin. Therefore the intersection supported by this implementation is the current native admin role. Finance-only and warehouse-only principals are refused. The code neither invents an ambient administrator nor elevates a supplied actor. Root must explicitly qualify the native executor/person mapping, and any future separation into distinct native owner actors needs deliberate scoped composition and review; it is not implemented here.

## Native effects and conservation

Supported input remains the existing comparator's CA region, CAD or USD, ordinary untransmitted group, one unknown unclaimed target and created siblings. US, replacement shipments, another unknown sibling, transmission, retained claim, changed configuration, insufficient source/account evidence, or inconsistent original history are refused.

The operation repeats the actual native `validateCanadaPostCreation` validation on the already compared captured target. Provider shipment/tracking conflicts across same-configuration retained members are checked again by the owner; the unchanged fresh proposed-reference reader has already checked ordinary/promoted bookings and other configurations conservatively in the same writer. Different configuration hashes never establish different real provider accounts.

Expected successful delta:

- Append native reconciliation claim audit `carrier.canada-post.member.claimed` with `send:false`, matching the existing provenance reader's reconciliation grammar. This is a local recorded operation, not a provider request. No claim token/start survives.
- CAS only the target from unknown/unclaimed to created, with exact provider shipment ID, tracking, label bytes/hash and cleared token/start.
- Append the existing `carrier.canada-post.member.created` event with the exact native booking/review/provider shipment tuple.
- Derive group state from **all** retained siblings; the supported profile resolves to `closed`. CAS the original unknown/untransmitted group.
- Append the matching member-created audit with `reconciled:true`, group state and label hash.
- Compare the complete expected group/member rows, including every original sibling/PDF descriptor, and every original pending booking in native chronological sequence. All current custody hashes must still equal their captured originals.
- Freshly read every member's complete Platform provenance through its owner and complete Fulfillment custody. Return detached frozen hash/identity facts only.

All ordinary booking rows remain byte-for-byte pending. There is no manifest transmission or promotion to booked, no inventory handover or financial write, no carrier retry/lookup/provider call. The test fixture's earlier synthetic guarded creates establish history only.

The bounded owner result covers all three owning carrier tables, across the retained database, using a complete purpose-bound result and scope hash. Per table: at most 512 rows; aggregate at most 1,024 rows; non-BLOB fields at most 65,536 bytes; PDF/manifest fields at most 1 MiB; aggregate retained bytes at most 16 MiB. Fixed SQL count/type/length/safe-integer/NUL preflights precede row reads; non-BLOB byte encodings are checked against SQLite hex bytes before hashing. No partial page or caller completeness assertion is accepted. This deliberately conservative scope can refuse recovery after an unrelated retained carrier change; it does not expose unrelated rows or references.

## One Platform receipt and exact recovery

The Integration wrapper makes no foreign-table writes. After the owning operation, it forms a frozen small record binding:

- Original envelope binding, evidence set hash and task payload hash;
- Unchanged captured comparison input hash, comparison hash and native-join hash;
- Actual original native actor locator;
- Exact native result scope, target/group/site identifiers and every member's custody and Platform facts hashes.

The record is bounded to 65,536 canonical bytes. Its SHA256 is the `resultHash` in exactly one `platform.offline.transitionInTransaction(..., {kind:"record-task", receipt}, [])`, using the retained exact revision/hash anchor and original OPEN session lineage. The receipt binds fixed task, org, request, envelope, payload and before-candidate hash. Current complete release history must still be empty.

The wrapper then invokes the actual `RestoreOfflineCommitRecoveryReader` to verify the retained journal/generation/session/task relation and current pinned candidate/raw hold, rechecks the complete owning result, refreshes current IAM, and refuses reentry. Any late owner, audit, event, Platform receipt, candidate, lifetime or permission error **must escape the caller's entire outer transaction**. The wrapper does not start a transaction or hide an error behind a nested savepoint. Caller code must not catch an error inside the writer and commit partial work.

The result status is `native-owner-application-only`. It is returned **before** the caller's outer COMMIT and must never be described as a committed outcome until that actual COMMIT is known.

`recoverInTransaction(actorLocator, originalEnvelopeInput, originalApplicationResultInput)` is a read-only consistency operation on the actual existing writer. It requires an independently retained original envelope and exact original application result record. The detached strict original record must hash to the journal's recorded `resultHash`; envelope/evidence/payload bindings must match. Fresh native finance/carrier/site/password access, raw hold, complete durable journal and pinned candidate are required. Every member's current custody, current complete Platform audit/event provenance, and complete carrier scope must equal the original result. No obsolete pre-commit logical hash or current session revision is incorrectly reapplied. It returns `native-commit-recovery-consistency-only`, without writes or evidence reopening.

**Durable recovery limitation:** the existing Platform schema durably retains the exact task/result hashes, not this entire original application record or raw envelope. Root/qualified host must durably retain those independently before losing the attempt. A process restart with that original record is supported and tested, as is a lost response where the original record was retained. A crash losing the original record cannot recover it by reconstructing original proof from current rows, importing again, or reopening private evidence. Missing original proof is an explicit refusal/blocker. No new durable record table/schema or invented Platform reader is introduced under this ownership.

Current authorization to read that historical receipt is distinct from qualified current execution or release authority. A native result hash and private byte match do not supply independent provider truth, account equivalence, evidence exhaustiveness, source cutoff/fence, signatures, current external trust/revocation, preparer/executor/operations separation, separate finance/security signatures, or an independently qualified source/candidate COMMIT interlock. Root owns that static default-disabled composition. The external host must also classify post-COMMIT failures honestly; this synchronous owner helper cannot roll back an already committed transaction.

## Verification and retained failures

The original final regression at source `663baff88071e4a307a6358ada989144ba3e04d4` passed 597/597, full TypeScript and formatting. A final three-line cleanup also erases native SQLite member label copies in the owning operation’s `finally`; this is the tested source named above. The same complete affected regression and TypeScript were rerun after that cleanup. No full native or browser/product qualification is claimed.

The dedicated tests use actual file-backed Application/Database/Platform/Carrier/Fulfillment/IAM owners and private 0700/0600 filesystem fixtures. Coverage includes CA CAD/USD and both eventReports profiles; successful exact native delta and single receipt; complete business-owner row conservation; immutable redacted results; restart recovery; independent original proof refusal; no evidence reopening; buffer erasure on success/rollback; fake/proxy/accessor/prototype/disposed/foreign captures; reentry; stale claims/state/siblings/references/candidate/hold; current IAM/site/finance/password/active guards; bounded retained bytes; file identity replacement; non-OPEN/no-writer refusal; and late owner/event/audit/Platform/candidate failures with whole-transaction rollback. Fault tests assert that the intended late fault actually executed, rather than passing on an earlier refusal. Existing assertions and test files are unchanged.

Historical attempts remain in private `/workspace/distributor-canada-post-import-audit`:

- `initial.log`, `focused-2.log`: fixture setup refused non-SHA instance ID, then SQLite-prototype organization rows. Corrected to the actual generation contract's digest and detached ordinary records.
- `focused-3.log`, `diagnostic.log`: the draft called ordinary provider readiness during a recovery hold; actual native `RECOVERY_HOLD` exposed the wrong helper. The separate required-hold offline check preserves ordinary guards. The same run exposed the test's wrong raw-hold table name.
- `focused-4.log`: first dedicated 23/23 pass. Initial mock-own-method faults were strengthened to actual prototype-level synthetic faults plus explicit reached assertions.
- `focused-5.log`, `diagnostic-conservation.log`: adding full conservation exposed the draft's booking comparison ordered by member identity rather than native chronological sequence. Corrected the new comparison's ordering without dropping any row/field.
- `focused-6.log`: 30/30 pass, including owned allocation erasure.
- `focused-7.log`: one test-file transform failure from a missing closing brace; no executed test passing claim.
- `focused-8.log`: 34/35 pass; password-drift fixture omitted mandatory `updated_at`. Fixed that fixture field; refusal assertion retained.
- `typecheck-2.log`: test operation argument was unknown; an explicit test-only discriminant type corrected the compilation error. Later complete typechecks passed.
- `affected-1.log`: 596/596 pass, before the final lifecycle regression.
- `red-refusal-lifetime.log`: meaningful red against this draft, 0/1, showing the wrapper's early no-writer refusal left a completed private capture reusable. Fixed through an identity-only private cleanup in wrapper `finally`. `refusal-lifetime-fixed.log`: 1/1 pass. No caller cleanup method is invoked; foreign readers' captures are preserved.

None of these draft failures is represented as a proven defect in the excluded baseline or as provider/product qualification. Synthetic fault hooks are test-only and never accepted from operator input.

### Final foreground receipt

Against `a8c3b33342f05a62dafe7754c4c73c5a2bfd8978`:

```sh
node --import tsx --test \
  tests/integration-offline-canada-post-member.test.ts \
  tests/restore-offline-canada-post-private-native.test.ts \
  tests/canada-post-offline-member-evidence.test.ts \
  tests/carrier-offline-member-review.test.ts \
  tests/carrier-offline-proposed-reference-review.test.ts \
  tests/platform-offline-carrier-review.test.ts \
  tests/fulfillment-offline-carrier-custody.test.ts \
  tests/restore-private-evidence.test.ts \
  tests/restore-offline-private-evidence.test.ts \
  tests/restore-offline-private-original-parser.test.ts \
  tests/carrier-bookings.test.ts \
  tests/canada-post-groups.test.ts \
  tests/canada-post-creation.test.ts \
  tests/canada-post-manifest.test.ts \
  tests/restore-offline-commit-recovery.test.ts
npm run typecheck
node_modules/.bin/prettier --check \
  src/server/carrier-bookings.ts \
  src/server/restore-offline-canada-post-private-evidence.ts \
  src/server/integration-offline-canada-post-member.ts \
  tests/integration-offline-canada-post-member.test.ts \
  docs/INTEGRATION-OFFLINE-CANADA-POST-MEMBER-2026-10-03.md
git diff --check f756569ba00118c6ebc17efe69616e3805d03a48
```

- Affected native regression: **597/597 passed**, including **36 new tests**, zero failed/cancelled/skipped/todo, exit 0; duration 51,661.184752 ms. Final log: `affected-erasure-final.log`.
- Complete TypeScript: exit 0 (`typecheck-erasure-final.log`). Assigned formatting and whitespace checks: exit 0. Tests finished in the foreground; no process or job is left running.
- Source and old assertions are unchanged after this tested source except for this final report. Root is responsible for combined integration/replay and any authorized publication. There is no remote branch push from this isolated checkout.
- The exact five-path binary diff excludes the public baseline and all concurrent paths. Deterministic gzip, complete independently encoded chunks, per-file lengths/SHA256 and raw/gzip/chunk lengths/SHA256 are emitted in the transfer manifest/tool outputs. Retained local artifacts: `/workspace/distributor-canada-post-import-audit`.
