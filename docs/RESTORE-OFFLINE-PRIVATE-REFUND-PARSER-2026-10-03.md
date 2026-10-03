# Fixed private failed-refund parser — 2026-10-03

This increment adds exactly one fixed consumer to the offline private-evidence handle: `compareFailedRefund(reference)`. It consumes the handle's retained allocation through the existing `compareOfflineFailedRefundEvidence` and returns its detached, deeply frozen `OfflineFailedRefundComparison`. The result describes consistency of supplied historical assertions. It establishes no authenticated provider outcome, source-history completeness, eligibility, execution authority, current trust or transport permission. Qualification remains explicitly unresolved.

Excluded exact base: `d0f96e9fdb00738d5270142c90d054bc0ba0ceb7`, preserving the completed private-reader wrapper. Owned delta is only [the existing handle implementation](../src/server/restore-offline-private-evidence.ts), [one new parser test file](../tests/restore-offline-private-refund-parser.test.ts), and this new report. Original [54-test private-evidence file](../tests/restore-offline-private-evidence.test.ts) and [historical report](RESTORE-OFFLINE-PRIVATE-EVIDENCE-2026-10-03.md) remain byte-for-byte unchanged. No shared reader, comparator, coordinator, Application, schema, Billing, Integration mutation, Platform or existing test/report is edited.

The canonical owner rule requests Astra/High for this boundary. Launcher selection controls and effective model/reasoning settings are unavailable; no runtime verification or optimality is claimed. Repository rules and the exact baseline's reader, envelope, comparator and reconciliation contracts were inspected. No nested session was launched.

## Method contract and lifetime

```ts
using evidence = readOfflinePrivateEvidence(envelope, privateManifest, {
  references: [refundReference],
  maxBytes: privateCaptureBudget,
});
const historicalByteSummary = evidence.complete();
const comparison = evidence.compareFailedRefund(refundReference);
// All captures are already erased, including unrelated selected captures.
// Root must independently recheck native facts, qualification and authority.
```

The method exists as a non-enumerable, non-writable, non-configurable property of the frozen handle. This preserves the original enumerable `complete`/`dispose` surface and `{}` serialization. It introduces no caller callback, parser registration, byte/text/map getter or arbitrary consumer port. `complete()` keeps its original single-use commitment, legacy set-hash ordering and identity revalidation; the original summary shape is unchanged.

Parsing requires a successful `complete()` on this same live handle. The detached envelope must have owner `integration`, task name `integration.stripe-refund-failed.import`, and task version `1`. The reference argument must be an exact primitive string belonging to the envelope's evidence items and to the actual selected capture map. No coercion, property read, descriptor reflection, accessor or proxy callback is performed on a non-string reference. Whitespace/NUL aliases and unselected references cannot match validated envelope items.

Every attempt calls the handle's existing disposal routine in `finally`, including success, wrong task/reference, parse-before-completion, invalid bytes, comparator refusal, replay and already-disposed use. All captured Buffer allocations are zeroed and released, not just the chosen report. A second parse or completion cannot be revived by a copied historical summary. Keep `using` or explicit `finally { evidence.dispose(); }` around the overall operation for abandoned reads and authority failures before parser entry.

The fatal UTF-8 decoder receives the **same Buffer object** captured from the shared reader's original stream. No new filesystem read, independent open or byte copy is introduced. Removing/replacing a source file after successful completion does not redirect parsing: the result still describes the retained historical bytes. This behavior is deliberately not evidence that a source file, candidate, maintenance fence or external authority remains current. Existing descriptor/ancestor/file checks still run through `complete()`; later currentness is root's separately qualified responsibility.

Buffer zeroing is observable and tested. JavaScript immutable decoded strings and normalized result fields cannot be actively overwritten; their ordinary runtime memory lifetime is not represented as secure erasure. No decoded text or parsing object is exposed by the handle. The only return is the comparator's existing fixed normalized comparison, including its required native facts. The comparator's accepted free-text facts are not a general secret-content scanner; unsupported secret fields are refused by its strict schema.

## Byte and structural bounds

The parser checks the selected Buffer's actual length is positive and at most **65,536 bytes before decoding or JSON materialization**. This is a narrower parser profile than the existing handle's selected-capture budgets; the latter remain unchanged. The check uses UTF-8 byte length, not JavaScript character count.

UTF-8 decoding is fatal. `ignoreBOM:true` intentionally retains a leading BOM so JSON parsing rejects it instead of silently stripping it. JSON is parsed without a reviver. An iterative structural walk then caps depth at 16, nodes at 4,096, arrays at 128 entries, records at 64 fields, keys at 128 characters, and string values at 8,192 characters. It rejects non-safe integers, negative zero, lone surrogates and prototype-special keys. The input is bounded `JSON.parse` output, not caller-supplied JavaScript objects. Wide/deep inputs refuse before recursive canonicalization or owner comparison.

Only after that walk does recursive canonicalization run. Exact equality between decoded input text and the fixed comparator's code-unit-key-order canonical JSON rejects duplicate keys (including escaped aliases), alternative key order, numeric spellings, escape spellings, whitespace and other normalization aliases. Fatal UTF-8 excludes overlong/invalid encodings. This comparator JSON domain does **not** change the original evidence-set domain, which retains core canonicalization and `localeCompare` with manifest tie ordering.

The existing fixed comparator remains the sole owner schema/consistency validator. It refuses unsupported/private fields, fabricated flags and mismatched native/source/provider/account/refund/payment/receipt/history facts. The method returns that comparator result directly, preserving body, body hash, outcome and input hash semantics. It does not interpret native task payloads, bind a task subject to current database rows, validate a qualified source interval or compare captured declarations to current owning stores. Root must perform those separate checks and all current qualification/authority checks before any native mutation; byte-valid captured declarations alone grant nothing.

Errors use only the existing fixed `RESTORE_OFFLINE_PRIVATE_EVIDENCE` code and `Offline private evidence binding did not complete.` message. Comparator/decoder/JSON exceptions and private filenames, references, source data and causes are not propagated. No provider/network/database IO, filesystem write, SDK, credentials or production runtime wiring is added.

## Foreground test receipt

Environment: Node `v24.19.0`, Linux/x64, UID 0, real synthetic 0700 private directories and 0600 files. Tests observe actual allocations, decoder buffer identity and synchronous file calls; they do not substitute shared-reader results or evidence contents. Existing dependencies are reused with a temporary uncommitted symlink, removed before commit.

Preserved sequence:

- Initial three regional tests: **0/3 passed**, all fail because the baseline handle has no `compareFailedRefund` method. Red log SHA256 `cecc2c34ed5372c8d6c7eb1990c6786736fa65034cdc7e932c64bc468323c99c`.
- Same three assertions after implementation: **3/3 passed**.
- Expanded dedicated run: **72/73 passed**. The replacement test's IO counter included its own `writeFileSync` open. The measurement was corrected to surround only the parser call, preserving the no-reread assertion. Original failed log SHA256 `19f176ec4cefd95a50e1b7e41289b7f2a80f7c4536ed788445166d11e70faffb`.
- Combined run after that fixture correction: **212/212 passed**, log SHA256 `ff5c2a26cb32bf21573aa2f91e9db551cbc54cdf581d64b16c8ab027c9a20a75`.
- Initial full TypeScript identified a test-helper default Buffer type narrower than the malformed-buffer fixture's declared return type. A first textual edit did not match that declaration and the second check retained the same failure. The helper now explicitly accepts `Buffer`; no cast, production change, assertion weakening or suppression was used for that correction. Both failed typecheck logs are retained separately.

Final run adds a valid multibyte/supplementary-Unicode comparison. Final focused run: **213/213 passed** (74 new parser tests, 139 unchanged regression tests), zero failures/cancellations/skips/todos. Full TypeScript, assigned formatting and whitespace checks passed. Commands:

```sh
node --import tsx --test tests/restore-offline-private-refund-parser.test.ts tests/restore-offline-private-evidence.test.ts tests/restore-private-evidence.test.ts tests/restore-offline-envelope.test.ts tests/restore-offline-approvals.test.ts tests/integration-offline-refund-evidence.test.ts
npm run typecheck
./node_modules/.bin/prettier --check src/server/restore-offline-private-evidence.ts tests/restore-offline-private-refund-parser.test.ts docs/RESTORE-OFFLINE-PRIVATE-REFUND-PARSER-2026-10-03.md
git diff --check
```

Actual-file cases cover CA/CAD, CA/USD, US/USD matching outcomes/body hashes/frozen copies; exact retained Buffer identity and no reread; file replacement/removal after completion; selected/unselected/unknown references; malformed UTF-8/JSON/BOM/duplicates/alternative serialization/trailing data; depth/node/width/field/string/UTF-8-byte bounds before recursive serialization; unsupported secret/qualification flags; native/source/provider/candidate-history inconsistency; exact owner/task/version; parse-before-complete/repeated/after-dispose/failed-completion; zeroing every capture on success/refusal; redacted errors; and callback-free proxy/accessor reference refusal. Original private-reader, envelope, approval and pure-comparator tests remain unchanged.

Local synthetic tests do not qualify actual provider truth, production infrastructure, maintenance authority, source completeness, cross-platform filesystem behavior or root-only WAL candidate capture. No CI runner/workflow, PR, push, deployment, live provider IO, nested executor, reminder or background job is used. Root independently transfers, reviews and replays this exact excluded-base delta.

Final tested production SHA256: `1b6a5512475f4b4441f40f4b60abfd5c52e0c9939f95951051cf56e13a5f94fe`; new parser test SHA256: `a1bd8bd888212cf405c90aa39bc6e278c577e3a8341bc5f27fecc191e3a7bccb`. Final 213-test log SHA256: `7dc8d8d38dcddb6e7623695fc6e20b456da9ee98bd683bc90d4758cfc74ad760`; retained identical failed TypeScript logs: `a3702293ae2e3f281185feb31f13c93fa767d98b249b23e1594836d80c765781`; passing TypeScript log: `561e0b64da9c027206b026047fea097e70b4e9f9488a41f2a7de084bcdd29e2b`. Original private-evidence test SHA256 remains `572d64abf410240429f5c57da070ba440d3477a26c2f1c6621c2eb49710fecdd`; original report remains `4824d819cba55c474535ded90030989ab09c2311718a1bd091ee35cbc80b8793`.
