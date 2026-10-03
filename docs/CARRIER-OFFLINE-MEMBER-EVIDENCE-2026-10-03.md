# Carrier evidence comparison: missing native reference contract

Date: 2026-10-03. Repository `SJS1001/Distributor`, public branch
`codex/local-distributor-checkpoint`, exact excluded baseline
`197eae15678a677b09e9593ef9e398d54eb2abc0`.

**Blocked implementation, with a native reproduction.** No pure carrier
comparator or opaque carrier method is delivered. The assignment explicitly
permits reporting a reproducible missing native projection contract instead of
fabricating one. This return adds only the new test and this report. Existing
source, tests, reports, guards and failed-refund behavior remain unchanged.

## Exact missing join

The accepted design's “Required invariant checks before the first write” requires
preserving the native duplicate provider-reference check across all retained
groups in the organization/configuration, and separately resolving equivalent
carrier accounts across configuration changes. Its “Idempotency and immutable
provenance” section explicitly says the first slice must refuse when the relevant
duplicate-reference search cannot be completed safely.

`CarrierOfflineMemberReview.reviewUnknownMemberInTransaction(actor, groupId,
bookingId)` at `carrier-offline-member-review.ts:139` accepts no proposed provider
shipment ID or tracking number. It correctly checks existing native references
against one another, then returns the connected target group's histories and
two **opaque hashes** of the wider reference scopes:

- `duplicateScopeHash` at line 671 covers other groups' member references in the
  same organization/configuration, including disconnected and inactive rows.
- `bookingReferenceScopeHash` at line 690 covers retained ordinary Canada Post
  booking references across the organization.

Those other-group reference tuples are not returned. A new externally captured
target outcome cannot be checked for collision with them by a pure function over
`CarrierOfflineMemberFacts`. This is a missing **proposed-outcome join**, not a
claim that the existing reader fails to detect two already-retained duplicate
native outcomes. Its existing tests and protections remain intact.

The other requested native inputs do not close this gap:

- `PlatformOfflineCarrierReviewReader.getInTransaction` returns selected target
  group/booking command, audit and event facts (`platform-offline-carrier-review.ts:860–907`),
  plus an opaque complete-history commitment. It does not expose the unrelated
  created shipment's ID/tracking through that target review. It permanently retains
  its completeness/authority blockers.
- `Fulfillment.reviewPackedCarrierCustodyInTransaction` at `fulfillment.ts:173`
  supplies exact packed custody and no linked delivery history. It is correctly
  unrelated to Integration's provider-reference inventory.
- `reviewCanadaPostShipment` and `captureCanadaPostShipmentDetails` at
  `canada-post-evidence.ts:166,296` validate configuration/request/detail
  consistency. They have no native reference inventory and do not promise
  collision detection or authentic provider identity. Reusing those helpers does
  not supply the missing join.

Requiring equal or changed scope hashes cannot answer whether a particular new
ID is already present. Enumerating only the connected target members would hide
the reproduced conflict. Adding operator-supplied collision lists, a
`collisionFree` flag, a SQL/callback port or an unqualified account-equivalence
assertion would manufacture the missing contract. None was added.

## Reproduction using actual owners

The new test creates three ordinary shipments through native accept, pick, pack
and booking preparation on an actual file-backed Application/Database. It uses
the actual nonsecret account-binding hash and explicit, guarded synthetic native
creation results; no provider transport occurs.

1. Prepare a two-member target group. Create its first member successfully; make
   its second creation lose the response, retaining an unknown target member.
2. Prepare a disconnected one-member group under the same organization/site and
   exact configuration. Successfully create it with distinct provider shipment ID
   `OUTSIDE_CREATED_SHIPMENT` and tracking `9999999999999999`.
3. Activate the real raw restore hold with the native Platform operation. Read
   Carrier, Platform and both target members' Fulfillment custody in **one real
   native writer transaction**, using the existing current-IAM owning methods.
4. Verify the outside reference really exists using a fixed read-only Integration
   store query as a **test oracle**, without inserting corrupt rows, bypassing the
   authorizer or exposing that query to a production comparator.
5. Verify the joined returned data contains neither the outside group nor those
   IDs, while retaining the wider scope hashes. Supply internally matching target
   Canada Post details using the already-owned outside tracking. The actual pure
   detail helper accepts that internally coherent observation. No proposed-ID
   collision verdict can be derived from the returned target projection.

Both **CA/CAD and CA/USD** reproduce this contract limitation. Both target custody
snapshots exactly match their immutable native preparations, both are still
packed, every original blocker remains, returned native data is frozen, repeat
reads are identical and `total_changes()` is conserved.

For **US/USD**, the current Carrier reader accepts its native fixture, but the
actual Platform reader refuses with `CARRIER_PROVENANCE_REGION` at line 216. The
join therefore supports neither a fabricated US Platform projection nor a relaxed
regional guard. No US carrier comparison is claimed.

The two private-capture tests use the **actual opaque handle**, actual private
0700 directory/0600 report and PDF files, and both native currency profiles. The
completed report/PDF capture remains `historical-byte-binding`, qualification
`unverified`. Removing the original paths after completion cannot manufacture a
comparison method. Calling the existing fixed failed-refund method under the
carrier task refuses; all actual captured allocations are zeroed, repeated
completion refuses, descriptors close, and no path is reopened. The synthetic
envelope's hashes are fixture bindings, never independent trust/proof ports.

These tests deliberately describe a **missing prerequisite**. Five passing tests
do not mean the requested carrier comparator exists. They are not assertions of
provider authenticity, original group completeness, independent account identity,
source fencing, eligibility, finality, permission or a successfully imported label.

## Smallest owner continuation

Root/Carrier must supply a bounded fixed native proposed-reference review before
this comparator can claim that part of consistency. Keep the same Database
writer, current scoped native IAM and raw hold. It should either:

- return the necessary bounded detached reference tuples for the relevant native
  scope, with existing byte/row preflights and deliberate site/privacy handling;
  or
- accept the fixed proposed shipment/tracking pair(s) and perform the exact
  owner-controlled collision join, refusing conflicts without exposing unrelated
  site/customer rows. A proposal-aware result must bind the exact target,
  proposed values and complete checked native scope, with explicit limits.

The precise API and its integration ordering belong to Root/Carrier. It must
include both created-member references and ordinary retained booking references,
with native manifest-promoted copies handled exactly as the existing reader does.
It must not infer distinct accounts from different configuration hashes. Historical
account-equivalence resolution and independent external qualification remain
separate unresolved prerequisites, not data this test can invent.

**Wake input:** an exact published baseline containing the reviewed owning
reference-join contract (or an explicit reviewed narrowing that leaves this
comparison inconclusive and requires that separate native join). The reader and
its API are outside this assignment's production ownership. No shared-source
change was attempted.

After that contract is available, continue the requested fixed pure comparator:
strict detached bounded input before reflection/materialization, full native
intent/group/sibling/custody and Platform joins, actual strict account preimage,
complete external member/detail/PDF comparison with existing Canada Post helpers,
then one nonenumerable fixed opaque method consuming the same captured bytes and
erasing them on every outcome. Do not add a raw getter or generic parser/callback.
Missing members, extras, replacement/later custody, transmission, claims,
configuration drift, out-of-scope references, malformed PDF and resource/hostile
inputs still need dedicated comparator tests once that operation exists.

This report does not request schema, Application, import/writer/retry/release,
provider access or authority changes. A completed pure comparison would remain
local consistency only; root's qualified coordinator and durable reservations
are separate work.

## Actual verification and delivery

Fetched the existing public HTTPS remote and verified the exact baseline in the
requested fresh isolated worktree `/workspace/Distributor-carrier-member-evidence`,
branch `codex/cloud-carrier-member-evidence`. Earlier worktrees/commits are
preserved. Requested Astra/high remains **unverified**: the launcher exposes no
effective model/effort setting. No nested delegation occurred.

Runtime: **Node v24.19.0, Linux x64, native SQLite 3.53.3**, existing dependencies.
No dependency/configuration or service changes were required. One read-only shell
invocation failed with `exec-server transport disconnected`; the next bounded
`pwd` succeeded and foreground work continued in the same worktree.

Initial dedicated command:

```sh
node --import tsx --test tests/carrier-offline-member-evidence.test.ts
```

Exit **0**, **5/5 pass**, zero failed/cancelled/skipped/todo, 2837.962231 ms.
There was no initial failing test or TypeScript result to suppress. Original
`initial.log` SHA-256:
`559bb45a872d5ff4a71c0592dde12c7d4ac325b315eb0226769df7ef7f0102e4`.

Affected command after assigned test formatting:

```sh
node --import tsx --test tests/carrier-offline-member-evidence.test.ts tests/carrier-offline-member-review.test.ts tests/platform-offline-carrier-review.test.ts tests/fulfillment-offline-carrier-custody.test.ts tests/canada-post-evidence.test.ts tests/restore-offline-private-evidence.test.ts tests/restore-offline-private-refund-parser.test.ts tests/restore-offline-refund-native-projection.test.ts
npm run typecheck
```

Tests exit **0**, **412/412 pass**, zero failed/cancelled/skipped/todo,
8174.863527 ms. Complete TypeScript exits **0**. All old test assertions remain
byte-for-byte unchanged. Assigned Prettier/whitespace results and final exact
commit/file/patch hashes accompany the transfer manifest. The exact local commit
has the excluded baseline as parent; only this new report and new test are in its
delta. Private logs remain under
`/workspace/distributor-carrier-member-evidence-audit`.

No production comparator, private-handle change, native write, CI/runner/workflow,
PR/push/merge/deployment, account/secret/settings change or background automation
is delivered. Full system/product gates remain **NOT VERIFIED**. Root owns review,
the missing native API, integration and publication.
