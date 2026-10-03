# Restore consumption of native historical dispositions — 2026-10-03

## Scope and exact composition

The isolated implementation starts at published Distributor checkpoint
`1877440ddfcfdb76963b0b7b0296c01b93b24d95`. The original cloud worktree and
completed commits remain intact. Direct shell GitHub access was unavailable;
the authorized read-only GitHub connector retrieved the exact commit/tree/blob
objects, whose Git hashes were checked before creating the isolated shallow
checkout. No remote branch, PR, CI, runner or provider was used.

The separately owned Platform prerequisite was supplied after implementation
began, published by ROOT at `8806da338a7bedccfd61fcfaff5dd4df2d405733`.
Its local sibling artifact was verified before applying:

- Raw patch: 36,104 bytes, SHA256
  `d2d140a98da5c329fa05dddf800abbf6459e985587186707ed8ff0553ad2a476`.
- Gzip SHA256:
  `502a927494966696df8e3a1b9edee5b1228cfa232c64cc824423c2d844cc6cd3`.
- Separate local prerequisite commit:
  `ad1c9ef` (`Apply verified Platform disposition receipt prerequisite`).

The returned consumer diff excludes all three prerequisite files. It is an
owned-path `git diff --binary` against `1877440`; the six owned paths have the
same preimages on the separate prerequisite commit. ROOT must retain the
published Platform adapter when applying it. No competing receipt reader was
implemented. Application composition uses exactly
`platform.integrationDispositionReceipts(nativeMaintenanceActor)` on the same
Database/transaction as the owner projections. That port rechecks current
finance/password/tenant authority while preserving every historical author and
complete scoped receipt history.

## Consumer rule

`RestoreActivation.settledNativeQueues` now requires the existing native writer
transaction and invokes Integration's task-shaped complete queue inspection.
It no longer opens a second connection for the queue scan. The three exceptions
are exact owner outputs, never terminal labels synthesized by the consumer:

| Native queue row                             | Required owner projection            | Independent obligations                                                                                                                                 |
| -------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blocked unsent QuickBooks credit application | `canceled-unsent-credit-application` | Complete original apply/cancel receipts, native input/hash/reservation/current disposition and source identities must qualify.                          |
| Blocked unsent Stripe checkout predecessor   | `superseded-unsent-checkout`         | Complete immutable renewal lineage must qualify. Every successor is still independently scanned.                                                        |
| Non-created Canada Post member               | `canceled-unused-membership`         | Complete group/member/booking/cancellation receipts qualify through CarrierBookings. Ordinary bookings and groups still need their own terminal states. |

The existing accepted terminal states for effects, callbacks, refund callbacks,
bookings, groups, journals, both revocation queues and both authorization queues
are unchanged. Operation leases, balance reads and refund polls still block on
any retained claim. Pending, running, blocked or unknown unrelated work remains
unresolved, including pending/unknown checkout successors and separately pending
bookings from a canceled Canada Post group. No new completed-successor rule was
added to the historical lineage projection; the ordinary independent queue rule
continues to govern the leaf.

Every exceptional effect/member is scanned, with no history page or cache. Each
binding uses the complete native row hash; integration derives organization
region/currency through IAM and passes exact account/provider/residency identity
to its existing validator. Carrier projection results must match the selected
organization/group/booking and complete member hash. Owner validators remain
responsible for all original source, receipt, site and hash checks.

The inspection compares the connection's `total_changes()` before and after
all synchronous callbacks. A faulty trusted adapter that writes any owner row,
including an independent queue inspected earlier, makes the transaction fail.
This adds no write capability or generic store proxy. Other connections cannot
advance the native candidate while the existing writer transaction is held.

Preparation, exact retained-input review, and release-signature acceptance all
repeat the owning queue inspection. Existing activation transitions already call
retained-input review under their writer transactions, so they also repeat it.
The existing released runtime gate still permits ordinary post-release business
work; it does not incorrectly require an eternally empty queue.

Candidate capture, dossier/manifest equality, private-byte checks, current
external restore trust, release signatures, adapter identity, generation,
rollback/forward-hold semantics, and live transport holds remain in force.
Historical receipts do not become newly verified provider truth. Queue
qualification alone never clears recovery hold or permits a transport.

## Explicit maintenance authority, closed by default

`Application.configureRestoreNativeDispositions(configuration?)` is a trusted
filesystem/application composition API. It has no HTTP, environment, manifest,
or dossier switch. Omission/withdrawal leaves all historical exceptions closed;
an ordinary fully terminal queue needs no historical exception grant.

The configuration copies an explicit mapping for each organization/projection
to a **pre-existing native principal** and an independent external maintenance
authority ID. Ambiguous mappings fail. Finance projections require current
native **finance** staff; Canada Post requires current **warehouse** staff and
its owner-enforced site scope. Admin is not an ambient substitute. Native IAM
availability, organization, role, account restriction and password state are
read again under the writer transaction; Platform and owning projection readers
repeat their own current checks. No user is created or elevated in production.
Dossier preparer/signer IDs are never resolved as IAM actors.

The separately qualified host boundary must implement:

- `observe(RestoreNativeMaintenanceRequest)`: return a signed current
  `RestoreNativeMaintenanceAssociation`, or null. It must independently verify
  the external/native maintenance association and its current revocation status.
- `loadTrust()`: read current independently qualified external authority keys.
  Exactly one matching current Ed25519 key is required after observation.

A request includes the fixed read-only purpose, a new unpredictable challenge,
organization/projection, exact native record ID/hash, mapped native principal,
mapped external authority and native recovery generation. The signed canonical
association includes that exact request, association ID, external evidence
hash, observation time and expiry. The consumer checks the signature, a maximum
30-second interval, current non-regressing time, exact request equality and
unchanged configuration. A copied signed answer cannot satisfy a fresh challenge
or a different target. Missing/expired/revoked/malformed authority fails closed.

This typed boundary is **default disabled and not externally qualified** by
these tests. Production must supply a bounded synchronous, read-only, genuinely
current association observer and trust loader. Locally signing arbitrary copied
IAM data is not an acceptable production implementation. The tests' generated
keys and association signer are explicit synthetic fixtures. No external
maintenance service, filesystem trust provisioner, provider result import,
offline mutation or activation permission was implemented. ROOT must qualify
that composition independently before use.

## Verification and preserved failures

Environment: Linux, Node 24.19.0, UID 0; existing installed dependencies reused
without lockfile/dependency changes. Requested Astra/High cannot be verified:
this launcher exposes no effective model/effort setting. The canonical owner
rule path was inaccessible; the owner-supplied model rule was followed without
launching nested agents or claiming a selected setting.

Initial red was preserved at the **unchanged** queue consumer: a real native
Canada Post prepare/group cancel/ordinary booking cancel still threw
`RESTORE_UNRESOLVED` at `settledNativeQueues`. A separate full-prepare attempt
failed earlier with `RESTORE_REVIEW_CHANGED` during candidate capture.
Unprivileged foreground execution was unavailable (`runuser` could not set
groups); no permission change or database-guard workaround was made.

Positive cases create original native invoices, credits, credit applications,
independent cancellations, checkout renewals and Canada Post groups/cancellations
through owning commands. Historical invoice/credit/checkout provider outcomes
are deterministic synthetic in-memory adapters before isolation, not actual
provider facts. Queue checks use the real Platform receipt reader and real
owning validators. The external maintenance signer and operations adapter are
synthetic. Direct test-only row changes exercise corruption and additional
independent blockers; they never stand in for positive native lineage.

Foreground commands and outcomes:

```sh
node --import tsx --test --test-name-pattern='native queue' tests/restore-native-dispositions.test.ts
node --import tsx --test tests/restore-native-dispositions.test.ts
node --import tsx --test tests/integration-restore-dispositions.test.ts tests/platform-restore-disposition-receipts.test.ts tests/carrier-restore-dispositions.test.ts tests/accounting-credit-cancellation.test.ts tests/checkout-renewal.test.ts tests/checkout-observations.test.ts
node --import tsx --test tests/restore-activation-boundary-review.test.ts tests/restore-activation.test.ts tests/restore-review.test.ts tests/recovery.test.ts tests/recovery-profiles.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/restore-activation.ts src/server/application.ts src/server/integration.ts src/server/integration-restore-dispositions.ts tests/restore-native-dispositions.test.ts docs/RESTORE-NATIVE-DISPOSITIONS-2026-10-03.md
git diff --check
```

- Dedicated native queue checks: **22/22 pass**, including CA/CAD, US/USD,
  CA/USD, reporting on/off, default closure, fresh challenge/authority withdrawal,
  current role/site/password/tenant checks, damaged/duplicate/incomplete receipts,
  changed binding/reservation/renewal/provider artifacts, all independent queue
  categories, pending/unknown successors, pending ordinary booking, complete
  history beyond a page, same-transaction damage, rollback and unchanged rows.
- Full dedicated file: **22 pass, 3 fail**. All three full-restore tests fail
  during the existing candidate capture guard with `RESTORE_REVIEW_CHANGED`,
  before their prepare/retained-review/release assertions. They remain unchanged
  and unskipped for ROOT's workstation; their target assertions are unverified
  here. The preceding intermediate full run was 20 pass / 3 identical failures,
  before adding two more independent native boundary checks.
- Affected owner regressions: **150/150 pass**.
- Existing restore/review/recovery regressions: **31 pass, 80 fail**. All 80
  failures contain `RESTORE_REVIEW_CHANGED` at candidate inspection (49 direct
  errors; 31 fixture assertions expecting `RESTORE_REVIEW` instead). This is the
  already reported UID-0 candidate/WAL metadata limitation, not a passing restore
  qualification. No existing test or private-byte assertion was weakened.
- TypeScript, assigned formatting and diff whitespace checks pass.

Native queue checks intentionally invoke the private boundary through a test-only
typed cast inside the actual Database transaction, to retain useful native
coverage despite capture being blocked. They are not represented as successful
full prepare/activation. ROOT must run the three unchanged full-restore tests
and affected restore suite in its supported workstation environment and review
the current external maintenance composition before integration/publication.
Actual source fencing, routing, infrastructure, provider evidence, customer or
operator gates, RPO/RTO and production acceptance remain unverified.

Retained local synthetic log SHA256 values:

- Initial native boundary red:
  `389de9e7a51525fe7e3ab7da15c31f75b0ba8794df3ab1b35fc31ca110d1dbfc`.
- Initial capture failure:
  `3d1a21f6e559f103671c61e65721409275282fd3b3a469cf2e72658c51929d78`.
- Final dedicated 25-test run:
  `02aa704414f7958c31af4d38119096ebf9529383b3e93cc3f1338569cda1ba56`.
- Affected 150-test owner run:
  `f1313f9715ec84f65f67723603d281c05fddb71874273141a61ca96ba6fa2a01`.
- Existing 111-test restore/recovery run:
  `0f280acfd876420cdb2b531e88d1304179c8fd284ebbc7c09345c594cfc267b4`.
