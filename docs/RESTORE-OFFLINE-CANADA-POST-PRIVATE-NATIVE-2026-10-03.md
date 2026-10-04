# Canada Post private capture and native consistency join

Date: 2026-10-03. Repository `SJS1001/Distributor`, published branch
`codex/local-distributor-checkpoint`. Exact excluded baseline:
`a0b555e27b7412077afd22dee064687ae763f181`. Fresh isolated local branch:
`codex/cloud-canada-post-private-native`. Tested implementation commit:
`26aa729fcb48479da405f79eb6979fd45240d737`. The closing commit adds this report;
its exact SHA is supplied by the external transfer manifest.

This increment adds only:

- `src/server/restore-offline-canada-post-private-evidence.ts`
- `src/server/restore-offline-canada-post-native-join.ts`
- `tests/restore-offline-canada-post-private-native.test.ts`
- This report.

Shared private readers, the published comparator, original assertions/reports,
Application, schema, dependencies and the other owner's original Platform command
reader are unchanged. This is a prerequisite for accepted D-013/D-025/D-039,
not a qualified import, mutation coordinator, provider result or acceptance gate.

## Fixed host composition and lifecycle

A trusted host constructs:

```ts
const reader = new RestoreOfflineCanadaPostPrivateEvidence(
  app.database,
  app.identity,
  app.platform,
  app.fulfillment,
);
const handle = reader.read(envelopeInput, manifestInput);
try {
  const summary = handle.complete();
  // The trusted caller owns the actual outer native writer and other gates.
  const result = app.database.transaction(() =>
    handle.reviewInTransaction({ id: actorId, orgId }),
  );
} finally {
  handle.dispose();
}
```

The example is a read-only consistency review. It does not authorize a writer
operation or supply the independent guards required around an actual mutation
and COMMIT. Production Application does not construct/register this reader.

`read(envelopeInput: unknown, manifestInput: unknown)` accepts one strict envelope
and an exact `{version: 1, root, files: [{reference, path}]}` manifest. The envelope
must declare exactly one evidence item and fixed task
`{owner: "integration", name: "integration.canada-post-member.import", version: 1}`.
This profile is structural only. An arbitrary signed or unsigned envelope cannot
register an adapter, select a procedure, grant permissions or enable a route.

The read returns a frozen closure-backed handle with exactly `complete()`,
`reviewInTransaction(actorLocator)`, `dispose()` and `[Symbol.dispose]()`. There
is no reference selector, payload/byte/map getter, parser callback, generic task
registry or constructor-supplied read port.

- `read` streams and closes the one private file through the existing
  `readRestorePrivateOriginalEvidence`, with a smaller fixed **16,000,000-byte**
  ceiling. The shared original profile's 16,016,384-byte ceiling and all legacy
  limits remain unchanged. The complete expected reference/digest map and exact
  manifest are checked; expected set hash uses the unchanged `core.canonical`
  convention. No undeclared item or manifest entry is accepted.
- `complete` invokes the shared final pinned file/directory identity check before
  releasing captured allocations internally. It checks exact file count, measured
  bytes, set hash and captured digest against the detached envelope. It returns
  only a frozen `historical-byte-binding` summary with envelope binding, byte
  count, set hash and `qualification: "unverified"`.
- `reviewInTransaction` consumes the completed capture once. It decodes those
  same owned bytes with fatal UTF-8 and BOM preservation, parses strict canonical
  JSON, binds its payload hash, and performs the fixed native join. It never opens
  the evidence pathname again. The tests remove the pathname after completion
  and still obtain the same native consistency result.
- Every completion failure, comparison refusal or disposal erases owned capture
  buffers. Every review succeeds or fails into disposed state. Repeated/early
  operations refuse. Disposal is idempotent. The published pure comparator
  erases its temporary decoded PDF allocations on success/refusal as before.
  No decoded PDF or private input escapes through the result or a getter.
- Streaming reentry invalidates the whole outer read. Disposal or reentry during
  native capture invalidates the join before a result can escape. Separate
  ordinary calls are separate one-shot captures, not a global operational lease.

The shared reader retains O_NOFOLLOW/NONBLOCK, descriptor cleanup, operator-owned
private root/descendants, link/path/permission checks, 64-KiB streaming, before/
after stat identity and final completion checks. A completed capture binds its
historical read, not future truth of a pathname. Root ancestors and exclusion of
untrusted filesystem writers remain host obligations. No provider transport or
private runtime data is used.

## JSON and task bindings

The one file contains the exact published
`compareCanadaPostOfflineMemberEvidence` input, including embedded canonical
base64 label descriptors. The supported profile and all existing comparator
blockers remain intact: CA/CAD or CA/USD, one untransmitted ordinary group, one
unknown target, created siblings and original supported claim/history lineage.
US remains refused by the actual Platform owner. The PDF helper validates only
the native length/signature contract; this is not rendering, malware inspection,
provider issuance or structural PDF qualification.

Private JSON uses recursive **code-unit key ordering**, unchanged array order,
and `JSON.stringify` primitive encoding. This is a private-file encoding contract,
not a change to any legacy hash domain. BOM, duplicate keys, whitespace/alternative
serialization, invalid UTF-8, lone surrogate strings/keys, nonfinite numbers,
negative zero and unsupported data shapes refuse. Before recursive serialization
or comparison, parsed data is copied through bounded descriptors: maximum
100,000 nodes, depth 24, arrays 4,000, records 64 fields, strings 1,398,104 UTF-16
units and aggregate 16,000,000 UTF-8 key/value bytes. The file itself is bounded
before capture/JSON parsing. JSON.parse necessarily materializes the already
file-bounded input before the structural walk; this is not an arbitrary-input
memory sandbox. Both normal and revoked Proxy objects are rejected before
reflection/Array.isArray on caller envelope/manifest/actor objects. Accessors,
custom prototypes, hidden/symbol/extra fields and callable values refuse without
invoking caller code. Enumerable record width is bounded before own-key-array
allocation; JavaScript offers no bounded own-symbol enumeration API.

Task bindings are fixed and documented rather than invented mutable revisions:

- `subjectId` is the native target **booking ID**.
- `orgId` matches the current native owner facts and current IAM actor.
- `siteIds` is exactly the single target warehouse ID.
- `expectedStateHash` is the complete native member review hash.
- `expectedRevision` is **0**, a structural sentinel for this revisionless native
  profile. It is not a fabricated booking revision or a storage CAS capability.
- `priorClaim` must be null for the supported no-retained-claim profile.
- `payloadHash` is `digest(core.canonical(parsedComparatorInput))`.
- Evidence item bytes/digest and set hash bind the exact private file; envelope
  binding uses the existing `offlineTaskBinding` operation.

Unknown task revisions/profiles, extra/orphan manifest entries, mismatched byte
counts/digests/set hashes, wrong scope, unsupported claims and unbound payloads
refuse. No qualification is inferred from any of these hashes.

## Native process provenance and exact same-writer recapture

The private reader internally constructs its own `RestoreOfflineCanadaPostNativeJoin`.
That class constructs the fixed `CarrierOfflineMemberReview` and
`PlatformOfflineCarrierReviewReader` from the same actual Database/Identity/
Platform. Host-supplied Database/Identity/Platform/Fulfillment objects must use
native prototypes, have no own method overrides, and expose the actual same
native database/store-owner associations through inert own data fields. Mixed
Application owners and Proxy/read-port objects refuse. Constructors create only
reader objects and owned store references; they perform no migrations or writes.

The private module stores each handle in a private WeakMap. Its internal bridge
`isInternalCanadaPostPrivateCapture` checks exact handle, native instance,
envelope and parsed-object identities plus the `joining` lifecycle state; it
returns a boolean only and cannot expose payload. The native
`joinCapturedInTransaction(token, actor, envelope, input)` checks this provenance
before traversing **any** supplied actor/envelope/input. The identities are never
exported from the handle. Fabricated/copied/prototype-copied/Proxy captures cannot
enter. This module bridge is fixed implementation plumbing, not an operator
callback or an authenticity/authority predicate.

The join then:

1. Requires the actual Database caller-held outer writer (`requireTransaction`),
   and revalidates native owner wiring. An owner `Store.visit` context is not a
   substitute. No new transaction or database connection is opened by either
   production module.
2. Accepts only inert exact `{id, orgId}` actor locators, then re-reads current IAM.
   Supplied roles/sites/names are rejected rather than treated as grants. The
   actual Carrier, Platform and Fulfillment owners each retain their current
   IAM, password and warehouse/site checks. There is no conversion of signer or
   envelope executor IDs into native IAM principals.
3. Runs the unchanged strict pure comparator, captures the Database's complete
   current candidate using its private opened-file pin, and binds envelope
   candidate logical hash plus safely converted bigint dev/ino. It compares the
   actual raw hold, schema hash, region and complete organization set to the
   envelope. It does not accept a caller-provided database path.
4. Freshly reads the target Carrier facts and the proposal-aware reference facts.
   For **every** retained member, in native preparation order, it freshly reads
   the owning Platform provenance and Fulfillment packed custody projections.
   The private input must contain those arrays in that exact order.
5. Compares **all canonical bytes of each complete bounded projection**, not just
   target scalar fields or hashes. This includes sibling original intents/labels,
   outside-reference scope commitments, original receipts/audits/events and full
   retained history counts/hash, custody allocations/history and native hold.
   The actual proposed-reference owner still performs conservative collisions
   over retained member and ordinary booking references, promoted copies and
   ambiguous configurations. No account equivalence is invented here.
6. Rechecks actual hold and complete candidate plus pinned file identity, and
   the private capture's current lifecycle, before returning. Read-only tests
   conserve native `total_changes()`; failed native mutations used as test fault
   injection roll back and restore the original candidate.

The frozen result contains only purpose/version, envelope binding, current actor
locator, candidate hash, published redacted comparator result, required-check
strings and a hash. An internal WeakSet brands results returned by the real
native constructor; `isCapturedCanadaPostNativeJoin` checks identity without
traversal. **This is process provenance only.** Structured copies lose that brand;
an original result's brand does not remain a current permission, phase or lease.
No private bytes, raw owner rows, paths or errors are exposed.

## Required composition and external qualification still missing

No shared opaque parser, Application route, importer/writer, retry/cancel/release
operation, task registration, schema, HTTP API or CLI is wired. Root's concurrent
original Platform command reader is not guessed or duplicated. Complete existing
Platform projections are compared, but their original-command-payload and
historical completeness blockers remain.

This module does not verify current OPEN session/release history, trusted recovery
instance lineage, independent finance/security signatures, preparer/executor/
operations separation, clocks/expiry, external trust/revocation, account/provider
truth, complete source interval, source/candidate fencing through actual COMMIT,
original command payload qualification, or exact durable task/owner receipt
recovery. Those are explicit required checks in the result. A structural envelope
and raw hold are not evidence of those properties.

Root must compose these prerequisites with the actual default-disabled qualified
coordinator and independent current authority. It must determine an approved
static carrier owner operation and perform any label import from the same owned
capture inside that fixed operation; this handle returns no reusable bytes or
mutation permit. Its one-shot read-only result cannot later supply label bytes
by reopening the file. Independent operations/carrier owners must qualify the
account/application identity, source and candidate fences, evidence acquisition,
exhaustiveness/no later transmission and provider truth. Security/finance owners
must supply independently current scoped approvals. Wake input is the reviewed
static root composition plus qualified external contracts; no synthetic fixture
satisfies that dependency. All tasks/product gates remain NOT VERIFIED.

## Verification and preserved failures

Environment: Linux x64, Node `v24.19.0`, native SQLite `3.53.3`. Existing installed
repository dependencies were reused through a temporary worktree symlink; no
installation/dependency/runtime/settings changes. Requested Astra/high is
**unverified**, because the launcher exposes no effective model/effort setting.
The owner's canonical local rule path
`/Users/stevensmith/.codex/rules/delegation-model-selection.md` is unavailable on
this cloud host. No nested agent/executor was launched.

Private logs: `/workspace/distributor-canada-post-private-native-audit/`.
The initial dedicated run exited 1: 48 tests, 43 pass, 5 fail (one parent failure
also counted its failed child). Preserve `initial.log` unchanged:

- Two real new-production lifecycle defects were reproduced: streaming reentry
  did not invalidate the outer capture; disposal during native capture could
  return a stale joined result. Added explicit ownership/poison state and final
  identity/lifecycle checks fix both without changing the assertions.
- The stale Platform fixture initially wrote an unrelated audit action outside
  the actual carrier reader's fixed inventory. It now records a genuine retained
  outside-group carrier claim and retains the refusal assertion.
- Restart initially switched the fixture's event-report mode. Preserving the
  original mode avoids changing candidate state during reopening; exact equality
  and restart assertions remain.

Initial test compilation also exposed an overly narrow inferred Buffer generic;
an explicit Buffer fixture type fixed it. A later TypeScript control-flow refusal
at the conditional-finally boundary was corrected with an explicit `return fail()`
in the always-throwing outer catch. Failed compiler logs remain alongside the
successful log. The repaired dedicated run passed 48/48, followed by four
additional meaningful checks (fresh candidate with revoked/site/password IAM,
owner SQL-context refusal, completion disposal, coherent copied native facts).

Final verification of the tested source:

- `npm run typecheck`: exit 0, complete repository TypeScript (`typecheck-3.log`).
- Affected foreground native command below: **354/354 pass**, including 52 new
  checks; zero failures/cancellations/skips/todos, exit 0 (`affected.log`).
- Assigned four-path Prettier and staged/baseline whitespace checks: exit 0.

```sh
node --import tsx --test \
  tests/restore-offline-canada-post-private-native.test.ts \
  tests/canada-post-offline-member-evidence.test.ts \
  tests/carrier-offline-member-evidence.test.ts \
  tests/carrier-offline-member-review.test.ts \
  tests/carrier-offline-proposed-reference-review.test.ts \
  tests/platform-offline-carrier-review.test.ts \
  tests/fulfillment-offline-carrier-custody.test.ts \
  tests/restore-private-evidence.test.ts \
  tests/restore-offline-private-evidence.test.ts \
  tests/restore-offline-private-original-parser.test.ts
```

Tests use actual file-backed Application/Database/owner readers and private
0700/0600 temporary files. Both supported native currencies and event-report
modes pass. Real filesystem replacement/link/mode/interruption tests, no-reopen
capture, allocation/descriptor accounting, malformed JSON/UTF-8/resource refusals,
complete sibling/Platform/custody/reference drift, current authority, no writes,
reentry/disposal, process-brand refusal and restart are exercised. Existing
synthetic carrier clients perform no provider I/O. Historical tests and guards
are unchanged. No full-system/product/infrastructure qualification is claimed.

Local commits only. No CI/runners/workflows, provider I/O, credentials, accounts,
PR creation/merge, remote push, deployment, reminders, send_later or background
work. The transfer manifest supplies exact base/tested/closing SHAs, exclusive
four-path binary diff, final file SHA-256/bytes, raw/deterministic-gzip SHA-256/bytes
and independently hashed base64 chunks no larger than 9,600 characters. Root
independently reviews, integrates, verifies and publishes.
