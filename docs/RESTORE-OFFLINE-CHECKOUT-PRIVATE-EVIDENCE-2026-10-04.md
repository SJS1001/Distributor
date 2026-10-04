# First-unknown paid checkout private capture

This adds the missing fixed one-shot private-byte binding and current native
review prerequisite for `integration.checkout-paid.import` v1. It is read-only
consistency, not a qualified paid-checkout import. It does not expose private
payloads, provide an owning application bridge, authorize payment, reserve a
provider reference, release recovery, or assert an external COMMIT fence.

## Baseline and exclusive files

Excluded public baseline: `f1583c3ae343e3bd1ea265a98b77bb2134507085`, tree
`db79742e99320d6272147ce37e11a66a147d144f`, repository `SJS1001/Distributor`,
published branch `codex/local-distributor-checkpoint`. Normal public HTTPS fetch
succeeded. A separate worktree starts at that exact commit, excluding the prior
nine-file schema-21 delivery. All existing source, tests, schema, Application,
shared private parser and historical reports remain unchanged.

Only these three new paths belong to this return:

- `src/server/restore-offline-checkout-private-evidence.ts`
- `tests/restore-offline-checkout-private-evidence.test.ts`
- this document

Requested Astra/high is **unverified**. The runtime exposes neither an effective
model/effort setting nor a control to select one. The canonical
`rules/delegation-model-selection.md` was not present in the checkout/workspace
or supplied macOS rule location. The owner's explicit security-boundary model
request is recorded without claiming it was applied. No agent/session was
launched or delegated.

## Fixed API and bindings

Trusted native composition constructs:

```ts
new RestoreOfflineCheckoutPrivateEvidence(
  application.database,
  application.identity,
  application.billing,
  application.integration.checkouts,
);
```

The constructor creates the actual `RestoreOfflineCheckoutNativeJoin`, whose
existing descriptor/brand/identity checks require the linked owner graph from
one actual Database. After that verification, it obtains the graph's Platform
and creates the existing `RestoreOfflineNativePhase`. It neither initializes
storage nor accepts a read port, callback, registry, adapter, or authority flag.
The underlying native/phase entry methods are captured at module load rather
than dispatched through operator-selected methods. This is trusted in-process
composition, not a sandbox against arbitrary code replacing runtime intrinsics.

`read(envelopeInput: unknown, manifestInput: unknown)` copies bounded inert data
before parsing, hashing or property traversal. It accepts exactly fixed owner
`integration`, name `integration.checkout-paid.import`, version 1, revision
sentinel 0, null prior claim, and no warehouse site IDs for this financial task.
The actual native owning reader still checks current finance, account, password,
provider-choice and raw-hold policy; an empty site list grants no permission.

Exactly one envelope evidence item must equal the sole manifest reference.
The evidence-set hash is recomputed with the existing core canonical domain.
The file hash and exact declared byte count must match the shared private
original-profile reader. The fixed checkout cap is **131,072 bytes**, using the
existing checkout comparator limit; it does not increase the shared original
profile's 16,016,384-byte cap or change any other caller.

The frozen handle exposes only:

- `complete()` — finalize pinned identity checks once and return a redacted
  `historical-byte-binding` summary with `qualification: "unverified"`.
- `reviewInTransaction(actorLocator)` — consume once under the caller's actual
  existing native Database writer, with actor exactly `{id, orgId}`.
- `dispose()` / `[Symbol.dispose]()` — erase and retire the issued handle;
  repeated cleanup is safe.

The handle is an actual issued identity stored in a private WeakMap, not a shape,
hash, caller boolean or copied prototype. Borrowed methods with a forged/proxy
receiver refuse without inspecting it. No getter can retrieve captured bytes,
parsed JSON, comparator outcome, envelope or a native mutation permit.

## Call ordering and lifecycle

1. `read` validates the detached envelope/manifest and starts the shared
   `readRestorePrivateOriginalEvidence` fixed one-file capture. That reader
   enforces absolute private operator-owned roots, strict descendants, no
   symlink/hardlink/traversal/extra entries, bounded streaming, descriptor cleanup
   and pinned metadata identity. Descriptors are closed before `read` returns.
2. `complete` performs the shared final identity checks. It verifies exact file
   count, reference set, byte count and SHA, then retains the private allocation
   only inside the closure. Completion is not JSON acceptance or qualification.
3. `reviewInTransaction` verifies the same allocation's length/hash again,
   fatally decodes UTF-8, bounds nesting before JSON materialization, and copies
   bounded inert parsed data. Canonical private JSON uses **code-unit key
   ordering**, exactly matching the Canada Post private pattern; exact
   reencoding refuses alternate spellings, duplicate keys, BOM and whitespace.
   The task payload hash is `digest(canonical(input))`, preserving the existing
   envelope/private pattern. The comparator's separately domain-bound
   `inputHash` remains unchanged.
4. The existing `compareOfflineCheckoutPaidEvidence` validates the complete fixed
   source/candidate/account/provider assertion shape and issues its genuine
   comparison. Org, effect subject and native facts hash must equal the envelope
   task org, subject and expected state hash. Source/candidate equality and all
   original unsupported-history refusals remain the comparator's responsibility.
5. The actual native join runs with that exact comparison under the caller's
   writer. It recaptures current Integration/Billing history, IAM, raw hold and
   candidate, and verifies the current exact owner graph before phase reads.
   The existing native phase then checks the exact OPEN session, lineage,
   generation, schema, complete release history, logical candidate and pinned
   file dev/ino. Its safe bigint identity conversion is reused unchanged.
6. Only a deeply frozen redacted `native-private-checkout-consistency-only`
   result is returned: envelope/set/payload hashes and the existing native and
   phase summaries. Their unresolved checks are preserved. Every review outcome
   erases captured buffers and retires the WeakMap identity in `finally`.

Per-reader busy/poison state spans read, completion and review. Caught nested
reads/completions/reviews and disposal during active verification cannot leave a
successful outer result. Pending review, duplicate completion, failed parsing,
changed bytes, invalid actor, native refusal and file interruption all dispose.
Explicit pending/completed disposal also erases buffers. Parsed strings/objects
are local temporaries released on return, not promised cryptographic zeroization
of immutable JavaScript strings or garbage-collected copies.

After successful completion the capture describes historical exact bytes. Review
uses that same captured allocation and never reopens a report path; removing the
report after completion does not substitute the input. The **database** is still
freshly pinned/reviewed. A changed candidate, owner, current principal, session,
raw hold or native fact refuses. Long-lived source/evidence exclusion and current
external authority remain required independently.

## Strict input and remaining qualification

Proxy roots, nested proxies and revoked proxies are rejected before reflection
or `Array.isArray`. Traversal uses own value descriptors only and refuses
accessors, executable values, unsafe prototypes/keys, cycles, symbols,
non-enumerable extras, sparse/extended arrays, invalid/lossy Unicode and unsafe
numbers. JSON copy bounds use the existing checkout limits: depth 20, 4,096
nodes, 128 array items, 64 keys and 65,536 UTF-8 bytes per string, with a bounded
aggregate and 131,072-byte raw file ceiling. The existing comparator additionally
applies its stricter worst-case escaped-byte budget. Valid supplementary Unicode
is preserved; unpaired surrogates and U+FFFD refuse. Envelopes/manifests use
separate bounded structural limits and the existing strict parsers.

The admitted assertion profile remains test/direct-account Stripe, first unknown
checkout, exact amount/currency/intent, paid complete session and succeeded
PaymentIntent, with the original native zero-settlement and empty-history
restrictions. No provider request occurs here. Calling the synthetic comparator
or producing a matching hash proves neither provider truth nor eligibility.

Required independent work remains explicit in the returned native/phase checks:

- Qualified Stripe account/runtime binding, provider observation truth and full
  source interval/command provenance.
- Current signatures, clock, external trust/revocation, independent authority,
  source/candidate fencing and an interlock through actual COMMIT.
- Bounded native proposed-session and proposed-payment reference checks. The
  baseline native join still advertises these missing composition contracts;
  this wrapper never fabricates reference availability or consumes another
  owner's forthcoming work.
- A fixed owning checkout application and durable exact receipt/recovery
  composition. No application bridge or owning mutation is implemented here.

Signed external preparer/executor names are not manufactured native IAM actors.
Actual scoped native locators are supplied by trusted host composition. Envelope
assertions do not register tasks or grant permission. All product gates remain
NOT VERIFIED; root owns enhanced joins, qualified coordinator and publication.

## Foreground verification and retained failures

Environment: Linux x64, Node v24.19.0, SQLite 3.53.3. Existing locked workspace
node_modules were temporarily linked; no dependencies, runtime configuration,
accounts, secrets or settings changed. All filesystem/database/provider-shaped
fixtures are synthetic. The fixture's one synthetic lost-response adapter call
prepares UNKNOWN before the hold; the capture/review makes zero provider calls.

The dedicated actual-owner tests cover CA/CAD, CA/USD and US/USD with reports
both on/off; original source/candidate hashes and native owner guards remain
unchanged. They assert exact comparisons, full candidate/phase and
`total_changes` conservation, closed descriptors, buffer erasure, single-use
identity, no report reopen, pending/complete/review reentry and poison,
interrupted/mutated/replaced files/parents, malformed manifests and canonical
JSON, trap sentinels, byte/node/depth bounds, independent captures, changed IAM,
processing choice, raw hold, native history/claim/payment, actual owner graph
substitution, candidate pathname replacement, rollback and exact-profile reopen.

Private logs are retained outside tracked source under
`/workspace/distributor-checkout-private-evidence-audit`:

- `private-initial.log`: exit 1, 9/15 passed, six successes failed their subsequent
  idempotent-cleanup assertion because the first implementation checked the
  retired WeakMap entry during `dispose`. Fixed cleanup still checks the exact
  issued receiver but safely repeats erasure; no assertion was weakened.
- `private-second.log`: exit 1, 64/65 passed. Reopen used default reports enabled
  against the original reports-disabled fixture, changing the schema/candidate.
  The guard correctly refused. The test now reopens the same explicit reports
  profile and retains exact snapshot equality.
- `typecheck-second.log`: npm command exit 1; the test write helper inferred the narrower
  `Buffer<ArrayBuffer>` default. Explicit `Buffer` input typing fixes the test
  without weakening runtime bounds.
- `private-third.log`: exit 0, 67/67, zero skipped/cancelled, 10,393.029342 ms.

Tested source/test commit: `b15e260550e3fdf603c8082a7b0dfa47c2c6b0a5`.
The tests ran on exactly those file contents. The closing commit adds only this
report; its full SHA and exact file/patch identities accompany the transfer.

Final direct foreground command:

```sh
node --import tsx --test tests/restore-offline-checkout-private-evidence.test.ts tests/integration-offline-checkout-evidence.test.ts tests/restore-offline-checkout-native-join.test.ts tests/integration-offline-checkout-review.test.ts tests/billing-offline-checkout-review.test.ts tests/restore-offline-native-phase.test.ts tests/restore-private-evidence.test.ts tests/restore-offline-canada-post-private-native.test.ts tests/restore-offline-envelope.test.ts
npm run typecheck
npx --no-install prettier --check src/server/restore-offline-checkout-private-evidence.ts tests/restore-offline-checkout-private-evidence.test.ts docs/RESTORE-OFFLINE-CHECKOUT-PRIVATE-EVIDENCE-2026-10-04.md
git diff --check
```

- Affected: **457/457 passed**, zero failed/cancelled/skipped/todo, exit 0,
  **29,423.436506 ms**. Includes all 67 dedicated cases.
- Complete TypeScript: exit 0. Assigned Prettier and whitespace: exit 0.
  Static checks were not separately timed.
- Existing tracked baseline files are unchanged; only the three assigned
  additions are included. No older schema return or parent delivery is included.

Retained log SHA-256 values:

- Initial lifecycle red: `a4a4f2e8dd0a7bde11bfd46810ca70318d771764711acdee9706624fa9a93a5f`.
- Second reopen red: `87c8cb330d7f15a7c578f3d540b224d5ed319b03e1cd4f1efb8657038d6c5d3c`.
- Test Buffer typing red: `f6b551dfd86f7b9215605c3f11300e8370946dd4ca67e42fc1e60c6dec8685d8`.
- Final affected pass: `55c922666c1ee04de88d0acb0a08683a5cc9174097593b2ab0d82a369d057c3c`.

No browser/full-product gate, external infrastructure, provider, live environment,
CI/runner/workflow, PR, merge, push, deployment or automation is claimed or used.
