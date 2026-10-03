# Canada Post offline member consistency comparison

Date: 2026-10-03. Repository `SJS1001/Distributor`, published source branch
`codex/local-distributor-checkpoint`. Exact excluded baseline:
`dd8517e9bf735b26be0854d3f785c845a374959f`. Isolated local branch:
`codex/cloud-canada-post-comparison`. Tested implementation commit:
`d806a0f5a942083fa9312476b21edcca6b6f03b0`. The closing commit adds this report;
its exact SHA is in the external transfer manifest to avoid a self-referential
commit identifier.

Only three new files belong to this delta:

- `src/server/canada-post-offline-member-evidence.ts`
- `tests/canada-post-offline-member-evidence.test.ts`
- This report.

The historical gap report and all original tests remain byte-for-byte unchanged.
The published proposed-reference native lookup supplies the previously missing
contract. This increment implements a pure comparison prerequisite for accepted
D-013/D-025/D-039. It does not complete the qualified carrier import or any product
gate. No existing digest domain, native guard, parser, Application, schema or
provider integration changes.

## Fixed operation and exact inputs

`compareCanadaPostOfflineMemberEvidence(input: unknown)` is synchronous, has no
Database/Platform instance or read/write port, and uses no filesystem, transport,
clock, callbacks, registry, constructor injection, environment switch or permission
flag. It accepts the following exact outer object:

```ts
{
  version: (1,
    native, // CarrierOfflineMemberFacts
    proposedReferences, // CarrierOfflineProposedReferenceFacts, one target pair
    account, // exact CanadaPostAccountBinding, no credentials
    platform, // one PlatformOfflineCarrierReview for EACH member
    custody, // one PackedCarrierCustodyReview for EACH native shipment
    members); // one captured external created outcome for EACH member
}
```

The `members` entries are exactly:

```ts
{
  bookingId, reviewHash, configurationHash, groupId, customerRequestId,
  shipmentId, tracking, status: "created", details,
  label: { encoding: "base64", bytes, sha256, data }
}
```

Here `groupId` is the provider group ID (native UUID without hyphens), and
`shipmentId` is the proposed provider shipment ID; the native shipment ID is
independently bound through the immutable booking intent and custody. The PDF
representation is the existing native reader's detached blob descriptor shape.
There is no raw-byte getter. Caller-owned strings remain caller-owned; this pure
operation neither owns nor disposes a private evidence handle.

`details` supports exactly the existing helper's ordinary domestic full
`deliverySpec`, including its print/preferences fields, and either the pickup
or deposit shipping-point fields. Unknown provider metadata, optional variations,
transmission/return/customs/notification/options extensions, and partial detail
schemas refuse. This is an intentionally narrow offline profile, not a new or
complete Canada Post SDK schema. The existing helper accepts some additional
provider defaults/metadata; this operation deliberately does not accept all of
those variations.

Actual reused production helpers:

- `captureCanadaPostAccountBinding` validates a strict detached nonsecret account
  descriptor; `canadaPostConfigurationHash` computes its existing compatibility
  hash, with no hash-domain change.
- `captureCarrierConfiguration` validates the retained display configuration.
- `reviewCanadaPostShipment` validates the immutable intent's review hash and
  generates the existing exact customer request ID and ordinary request body.
- `captureCanadaPostShipmentDetails` joins detail identity, tracking/status,
  shipping point, contacts, service, parcel, references and settlement to that
  request. The comparator first requires exact equality of the full supported
  `deliverySpec`, so fields ignored by the legacy helper cannot slip through.
- `validateCarrierLabel` checks the existing bounded PDF signature contract.
  This helper checks `%PDF-` and length, **not rendering, PDF structural validity,
  harmlessness, authenticity, or carrier issuance**. Those properties are not
  claimed by the comparison.

## Supported native profile and joins

The initial profile accepts a CA organization using CAD or USD; a single ordinary
untransmitted group; exactly one active unknown target; and all other members
already created through one original send attempt each. It requires retained
configuration on every intent and identical origin/display configuration across
siblings, matching the actual native reader's group invariant. Groups with
pending siblings, multiple unknowns, predecessors/replacements, connected extra
or canceled groups, retries/reconciliations, released or retained claims,
manifest attempts, transmission, booked native shipments, or later custody
refuse. A stricter comparison does not make the retained state eligible for import.

The actual Platform reader refuses US organizations with
`CARRIER_PROVENANCE_REGION`; this code does not fabricate a US projection or
relax that guard. The native Carrier reader itself has broader regional support.

Every original native row field is checked within this profile. The comparison
binds org/region/currency/raw hold, group/configuration/review hashes, exact ordered
membership, booking sequences and canonical intent bytes, their hashes, review
hashes, native packed shipment and allocations, absence of later custody history,
provider references, and every sibling PDF descriptor. It requires exact external
membership and unique native/provider shipment IDs, tracking and request IDs.
Original raw hold and all hashes remain historical consistency inputs only.

The target's new shipment/tracking pair must equal the proposed-reference result;
that result must bind the same native member review, raw hold, configuration,
warehouse and scoped counts/hash. Created sibling pairs and label bytes must
match retained native facts exactly. The existing owner lookup—not this pure
function—checks all retained member and ordinary booking references, including
inactive/other-group rows, ambiguous configurations, and manifest-promoted copies.
Its opaque `scopeHash` cannot be recomputed from the redacted output. Copied facts
can be coherently forged: a passing hash comparison is not proof that the native
lookup ran or that its full scope is current. A changed configuration hash never
proves a different provider account. All corresponding blockers remain.

Platform review is required for each member because a target-only projection
omits sibling preparation receipts. All views must share the whole retained
history commitment/counts and agree exactly on duplicate group rows. The joined
set must contain each booking and group preparation command receipt, its exact
request-hash audit and result, the preparation events, and one send claim plus
created/unknown completion per member. Domain details, receipt actor/key/hash,
canonical detail/payload bytes, result JSON, durable audit ordering, claim actor,
created label hash and provider shipment event all join. The unknown attempt
must follow completed siblings. Every selected audit/event must be consumed once;
each view must contain the full repeated group history and its own preparation.
Unknown/additional lineage refuses, including terminal transmission history.

This does **not** reconstruct missing original command payloads, prove event
ordering/actor information the schema did not retain, or authenticate historical
claim tokens. The existing six Platform blockers are returned unchanged. Facts
such as `createdAt` are checked as strict timestamps and bound by their original
projection hashes, without inventing equality between separately sampled native
clocks.

## Hostile data, budgets, result and errors

The first operation is a bounded detached capture. Normal and revoked proxies
are rejected with `node:util.types.isProxy` before reflection or `Array.isArray`.
Only ordinary/null-prototype records, ordinary dense arrays and finite primitive
data are accepted. Accessors, symbols, hidden fields, custom prototypes, cycles,
functions, sparse/extended arrays, unsafe native integers and negative zero
refuse. Descriptors are read without invoking getters. Exact schemas precede
legacy helper use. No operator-supplied callback runs.

Exported upper bounds are 100 members, 100,000 visited nodes, depth 24, arrays of
at most 4,000 elements, records of at most 64 keys, strings of at most 1,398,104
UTF-16 code units, aggregate 16 MiB UTF-8 key/value text, and PDFs of at most
1,048,576 decoded bytes each. All limits apply together; repeated Platform views
and duplicate native/external PDF descriptors consume the aggregate budget, so
100 maximum-size members are not promised. Wide ordinary enumerable records
stop during enumeration before key-array materialization; JavaScript has no
bounded iterator for non-enumerable own/symbol keys, so their final rejection
uses `Reflect.ownKeys`. This is not an OS memory sandbox for a malicious host
that has already constructed arbitrarily large objects.

Base64 length, descriptor size/digest syntax and encoding are checked before
allocation; canonical base64, exact decoded size/digest and native PDF signature
are then checked. Each temporary decoded buffer is zeroed in `finally`, on both
success and refusal. No decoded buffer escapes. The detached private strings are
not represented as securely erased memory. No path is opened, and no log/error
contains input bytes, addresses, account descriptors, private paths or store data.
Failures use one fixed redacted `CANADA_POST_OFFLINE_EVIDENCE` message.

Success returns deeply frozen detached data: version/purpose, org/region/currency,
native target IDs, native/proposed/configuration commitments, per-member Platform
commitments, exact per-member native/provider identities, request body hash,
label hash/length, custody hash, retained blockers, `inputHash`, and
`comparisonHash`. It returns no PDF/base64 bytes, account preimage, address,
`verified`, eligibility, qualification, authority, grant, or reusable permit.
The new input-hash purpose is `canada-post-offline-member-captured-input-v1`;
the result purpose is `canada-post-offline-member-consistency-v1`.

## Root composition and qualification still required

Root owns the next fixed opaque private-evidence operation. It must consume one
completed capture once, compare the exact captured bytes with this fixed parser,
erase owned captures on success/refusal and never reopen a path or offer a
caller callback/raw getter. This assignment deliberately does not edit that
shared handle, so one-shot acquisition/authentication is **not implemented here**.
Existing failed-refund behavior remains unchanged.

Root must join these results to fresh actual native Carrier, proposal-aware
reference, Fulfillment and Platform owning reads in the same required native
writer with current scoped IAM/password/site authority and a current raw hold.
It must bind the exact reviewed generation/session/candidate/source interval,
original command and immutable provenance, and maintain qualified external
current trust/revocation, independent approvals and source/candidate fencing
through the real native commit. Reference review is no reservation. A consistent
copied projection remains consistent even after its originating DB is closed;
the restart test explicitly demonstrates why it cannot be used as current authority.

Separately accountable operations/carrier qualification must establish the real
historical account/application identity (including account equivalence across
configuration changes), acquisition binding of shipment ID to details/PDF,
exhaustive external membership/outcomes, absence of later transmission, provider
truth and source interval. Existing detail helpers do not authenticate their
acquisition path or associate an HTTP response with a provider ID independently.
No synthetic fixture or `testApplication: true` declaration supplies those facts.
Wake inputs are the reviewed fixed root capture/native-join/coordinator code plus
independently qualified account/evidence/fencing/approval contracts. There is no
new public HTTP route, writer/import/retry/release operation or provider call.

## Verification and retained failures

Environment: Linux x64, Node `v24.19.0`, native SQLite `3.53.3`. Dependencies came
from the preserved installed repository `node_modules`; no dependency, runtime,
environment, account or permission changes were made. Requested Astra/high is
**unverified**: the launcher exposes no effective model/effort control. The
canonical local rule path `/Users/stevensmith/.codex/rules/delegation-model-selection.md`
is unavailable on this cloud host. No nested agent was launched.

Private logs remain at `/workspace/distributor-canada-post-comparison-audit/`.
Initial new-test run reported 89 checks: 82 pass, 7 fail. Four failures came from
a synthetic customer number also occurring inside an unrelated tracking number;
the fixture now uses a distinct synthetic number. Three checked native error
codes against human message text; the new tests now assert the actual `code`
property. Initial TypeScript reported two new-fixture typing errors (readonly
native intent and row-typed booking ID); only those fixture annotations changed.
All original tests remain unchanged. `initial.log` and `typecheck-initial.log`
retain these failed attempts.

A later adversarial reproduction coherently rehashed a sibling's origin and its
display configuration separately. Both were wrongly accepted by the draft
comparator: the existing native reader requires group-wide equality, beyond each
member's own valid hash. `group-invariant-red.log` retains both missing-exception
failures (exit 1). The new comparator now enforces those exact native invariants;
`group-invariant-green.log` records 2/2 pass (exit 0). A test-only overloaded
`Buffer.from` annotation caused one later TypeScript failure, retained in
`typecheck-final.log`; a correctly typed test interception fixed it without a
production change.

Commands and results at the tested implementation:

- `npm run typecheck`: exit 0 (`typecheck-3.log`). Full repository typechecking.
- `node --import tsx --test --test-name-pattern='coherently rehashed' tests/canada-post-offline-member-evidence.test.ts`:
  2/2 pass, exit 0 after the repair.
- Final affected native command below: 487/487 pass, exit 0 (`affected-final.log`), including 94 new checks.
- Assigned-file `prettier --check` and staged `git diff --check`: exit 0.

```sh
node --import tsx --test \
  tests/canada-post-offline-member-evidence.test.ts \
  tests/carrier-offline-member-evidence.test.ts \
  tests/carrier-offline-member-review.test.ts \
  tests/carrier-offline-proposed-reference-review.test.ts \
  tests/platform-offline-carrier-review.test.ts \
  tests/fulfillment-offline-carrier-custody.test.ts \
  tests/canada-post-evidence.test.ts \
  tests/canada-post-creation.test.ts \
  tests/canada-post-groups.test.ts \
  tests/canada-post-manifest.test.ts
```

The prior affected run passed 485/485 before adding the two group-invariant
regressions. New coverage uses actual file-backed Application/Database fixtures
and the real owning readers, both CA currency profiles and event-report modes,
US refusal, pickup/deposit, native outside-group and ordinary/promoted references,
immutable/no-write comparisons, restart, changed/missing/extra membership,
replacement/later custody, claims/transmission, config/origin drift, independent
shipment/tracking collisions, Platform original/history joins, strict detail/PDF
refusal, data traps, resource budgets and temporary-buffer cleanup. Provider
clients in native fixture creation are synthetic guarded functions only.

No full-suite/product/qualified infrastructure gate is claimed. No CI jobs,
workflows, runners, provider I/O, credentials, production data, push, PR, merge,
deployment, reminders or background executor were used. Transfer is an exact
three-path binary diff excluding the stated baseline, deterministic gzip and
independently encoded numbered chunks; the manifest supplies raw/gzip/chunk and
final-file byte counts and SHA-256. Root reviews, integrates and publishes.
