# Restore activation boundary review — 2026-10-03

## Workstation repair verification

ROOT applied the exact follow-up repair
`9c8c91a1fd8b619b66ec1de8783aca4313386912` after verifying its
12,558-byte patch SHA-256
`e7708960dbf4ba82fce0c383a00afd15d4dba9c015b544a2b9c6c9398a88f064`.
On macOS arm64, non-root Node 24.16.0, the combined boundary, activation,
review, recovery, profile and schema suite passes **202/202**, with zero
failures, skips or cancellations in 34,059.336667 ms. The eight new tests
remain unchanged from the original local reproduction and reach their
target assertions after the repair. TypeScript and assigned formatting pass.

The private native log SHA-256 is
`3696c92c6585162d85f003913b0d638ba28fb096a9a1c9a8b9fb45ddc6755ca9`.
These are synthetic workstation checks; actual fencing, routing, external
reconciliation and infrastructure qualification remain outstanding. The cloud
environment failures and original local failures below remain historical.

## Repair follow-up — ROOT reproduction, cloud replay still blocked

This follow-up supersedes the original lack of defect reproduction below.
The original cloud failures and transfer are retained as historical evidence;
they are not relabeled as successful execution.

ROOT supplied an explicit workstation reproduction on macOS arm64, non-root
Node 24.16: applying only these eight tests to unchanged restore production
reached all eight target assertions and failed 0/8 in 1634.806208 ms. ROOT retains
the original red log privately. This cloud session relies on that supplied
reproduction; it did not independently run the workstation or inspect its log.

Confirmed behavior reported by ROOT:

- Changed adapter identity was rejected only after an unwanted fence or stop.
- Four stopping/returning cases retained a forward hold for observed/unknown
  effects, then incorrectly accepted a later `none` observation after restart.
- Replacing the main file during observation still returned gate permission.
- A competing connection rolled back during observation, yet the pending gate
  call returned permission from its stale released snapshot.

### Narrow implementation delta

`src/server/restore-activation.ts` now checks the configured adapter against the
signed release identity before every external control, including a safety stop.
A stop still needs no surviving approval, but must target the reviewed adapter.

Rollback retains optional `forwardRecoveryRequired` metadata in the existing
hashed release record. Observed/unknown effects or a detected changed candidate
set it to true. Evidence acquired inside a transaction is also carried into the
error hold if a later assertion rolls that transaction back. A subsequent
rollback returns the retained mandatory hold without another control, even if a
later observation says `none`. Existing history is preserved.

An interrupted control without such effect evidence retains explicit false.
It can still recover by observing a fully stopped, unchanged candidate under
current authority; the existing lost-source-response test must continue to pass
without replaying the route. An older `forward-held` record without this field
cannot distinguish these cases, so it remains held and requires the existing
independent reconciliation/supersede path. This is intentionally conservative;
absence of historical evidence is not a negative provider outcome. No SQL schema,
version integration or foreign-table write was introduced.

Before returning runtime gate permission, the coordinator rechecks private file
identity, reads the current durable release and requires the same ID/revision
and released state, and rechecks configured adapter identity. Current approvals,
recovery generation and expiring operations authority remain required after
observation. These synchronous checks close the two demonstrated callback gaps;
they do not claim filesystem-administrator isolation or external fencing proof.

The same eight tests are byte-identical to the original transferred package.
No other source, tests, shared tracking, schema, platform or dependencies changed.

### Follow-up baseline, commands and actual outcomes

The local repair delta is based exactly on
`e33ad405a97479f42e59aca30f21054da9323f19`, whose parent is
`c006b554351ad4280f6329a1ec872717962f839d`. The initial 22,521-byte format-patch
remains preserved with SHA-256
`6d371fec744c487dc708e98b62a10923289fb897be4c7477aa73d1e7e93ffc7d`.
The accounting commit/patch also remain preserved. Only this follow-up delta is
transferred; the initial package is not retransmitted.

Foreground commands in this cloud checkout:

```sh
node --import tsx --test tests/restore-activation-boundary-review.test.ts tests/restore-activation.test.ts tests/restore-review.test.ts tests/recovery.test.ts tests/recovery-profiles.test.ts tests/schema-upgrade.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/restore-activation.ts tests/restore-activation-boundary-review.test.ts docs/RESTORE-ACTIVATION-BOUNDARY-REVIEW-2026-10-03.md
git diff --check
```

Native replay: **122/202 pass, 80 fail, exit 1**, zero skipped/cancelled,
23652.581061 ms. All eight assigned scenarios still fail during fixture capture,
not their target assertions. The other 72 failures report the same candidate-file
integrity change as the earlier baseline control. Node 24.19.0/root remains
blocked; no metadata guard was bypassed and no further environment workaround
was attempted. TypeScript passes, exit 0. Assigned formatting and patch whitespace
pass. Native post-fix correctness remains pending ROOT's unprivileged replay,
including the existing lost-response rollback and supersede cases.

Follow-up native log `/tmp/restore-boundary-repair-native.log` SHA-256:
`328f0656e30dd05e207b0030265257d893d9f59945bab976f909b8122411ea45`.
TypeScript log `/tmp/restore-boundary-repair-typecheck.log` is empty, SHA-256:
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Requested Astra/High remains unverified: effective model/effort are not exposed.
No nested session, agent, CI, provider I/O, deployment, PR/push/merge, account,
secret, background task or subscription was used. All commands finished in this
turn. Actual infrastructure is unqualified; all task/product gates remain
**NOT VERIFIED**.

## Historical initial package (unchanged evidence follows)

## Result: execution blocked, no production repair

This package contains eight proposed adversarial native tests and the evidence
below. **The activation findings are not confirmed.** Every new scenario stops
in fixture candidate capture before its target assertion. Do not treat this
package as passing coverage, an activation approval or a verified fix. Replay
the tests under a supported unprivileged runtime before deciding whether to
integrate tests or change implementation.

No production file was modified. In particular, `restore-activation.ts` remains
byte-identical to the exact baseline, SHA-256
`60ebe58d557311878fc907f354a81c7d8aca8c3651306b02278500d71114f50c`.
The owner required deterministic reproduction before a production fix; the
fixture failures do not satisfy that requirement.

## Exact baseline and preservation

- Repository: `SJS1001/Distributor`, branch `codex/local-distributor-checkpoint`.
- Requested and verified baseline: `c006b554351ad4280f6329a1ec872717962f839d`.
- Verified root tree: `bbf0777b8f6e471f3778de085f384cded28fa7fc`.
- Separate checkout: `Distributor-restore-review`; initial tree was clean.
- Previous accounting checkout remains at local commit
  `65b80fa46aa22dc5194961b54144930a338afe72`. Its original 26,661-byte patch still
  hashes to `0eecff516d7cb60b17996e37efd18099f29e1516b78c031466f9dc52159f08bd`.
- No model/effort control or effective configuration is exposed. Requested
  Astra/High remains unverified; no model change or delegation was attempted.

Direct GitHub fetching was blocked by network policy. The read-only GitHub
connector verified the branch and supplied the exact commit/tree and missing
blobs. Local Git blob/tree/commit reconstruction matched every expected object
hash and all 1,142 tree entries. This is an exact shallow baseline, not an
approximate file snapshot. Existing pinned dependencies were reused without
changing manifests or lockfiles.

Read AGENTS, README, PLAN, DECISIONS, relevant current HANDOFF material and
RESTORE-ACTIVATION, then inspected the activation coordinator, current native
tests, read-only review/evidence boundaries and platform gate. No other owner's
source, existing tests, schema/version, HTTP, browser, shared tracking, dependency
or workflow file was edited.

## Native prerequisite blocker

Runtime: Node `v24.19.0`, Linux, effective UID 0, overlay filesystem. The sandbox
user namespace maps only UID 0. Attempts to select an unprivileged synthetic-test
process were refused (`runuser`: cannot set groups; `setuid`: invalid argument;
user-namespace mapping: operation not permitted). No approval escalation or
integrity-guard relaxation was used.

The unchanged baseline command below fails before any adapter control:

```sh
node --import tsx --test --test-name-pattern='default disabled' tests/restore-activation.test.ts
```

It reports `RESTORE_REVIEW_CHANGED: Candidate files changed during inspection`
from `captureRestoreCandidate()` during fixture setup. The new scenarios fail
at the same point. A read-only diagnostic wrapped `lstatSync` solely to log
metadata differences, preserving the actual returned values and guard behavior.
It observed only the existing `app.db-wal` ctime changing while capture opened
its read-only SQLite connection:

```text
app.db-wal ctimeNs 1791047831451224873 -> 1791047831452837940
RESTORE_REVIEW_CHANGED Candidate files changed during inspection.
```

Observed device/inode/mode/link count/owner/group/size/mtime stayed unchanged in
that probe. This is consistent with root-only SQLite WAL ownership handling,
but no syscall trace was obtained; the precise kernel operation is unverified.
The established guard correctly refuses changed metadata according to its
contract. It must not be weakened merely to obtain green tests.

Parent action: replay under the normal unprivileged runtime where the existing
restore suite has previously passed. If root execution is an intended supported
configuration, diagnose and qualify its WAL metadata behavior in the separate
`restore-review.ts` ownership lane. There is no safely justified code patch to
that out-of-scope guard from this review. No live infrastructure is needed for
the proposed synthetic tests.

## Proposed assertions awaiting valid reproduction

| Native scenario                                           | Source concern and expected assertion                                                                                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changed adapter before fence or safety stop (2 tests)     | `call()` checks configured availability but does not compare adapter identity with the signed release before invoking a control. Expect no control to reach a differently identified adapter.                                                        |
| Contradictory effects at stopping/returning (4 tests)     | A `forward-held` release does not record whether forward recovery became mandatory because of observed/unknown effects. Expect a later `none` observation and a restart to preserve the earlier forward-recovery requirement without routing source. |
| Candidate replacement inside adapter observation (1 test) | `observe()` checks file identity before the callback. Expect replacement during that callback to close the same gate call, not only a later call.                                                                                                    |
| Competing rollback during gate observation (1 test)       | `permits()` retains its earlier release snapshot while the callback runs. Expect a terminal transition on another connection to invalidate the pending stale observation.                                                                            |

The fixture follows the existing native signed-dossier/evidence contract and
uses explicit synthetic adapters. It does not infer outcomes from timeouts or
lookup misses, send provider requests, weaken file checks or change foreign
business tables. The returning-phase cases deliberately simulate an adapter
throwing after a source-route side effect; they subsequently offer explicit
contradictory observations. Histories and control counts are asserted.

Existing signer/domain, trust/expiry, source/generation, restart and ordinary
effect checks were inspected. Their prior passing receipts are historical only.
No new runtime assurance for those boundaries is claimed here, and no cosmetic
duplicate scenarios were added to inflate coverage.

## Commands and actual outcomes

All commands ran directly in the foreground against the exact baseline source.
All processes finished before commit/transfer; none was left running.

```sh
node --import tsx --test tests/restore-activation-boundary-review.test.ts
node --import tsx --test tests/restore-activation.test.ts tests/restore-review.test.ts tests/recovery.test.ts tests/recovery-profiles.test.ts tests/schema-upgrade.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check tests/restore-activation-boundary-review.test.ts
git diff --check
```

| Check                                                 | Outcome                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| New proposed boundary scenarios                       | 0/8 pass, 8/8 fixture failures, exit 1; no target assertion reached             |
| Unchanged existing restore/schema/recovery regression | 122/194 pass, 72 fail, exit 1; failures report candidate-file integrity changes |
| Isolated unchanged default-disabled baseline control  | 0/1 pass, candidate-capture failure, exit 1                                     |
| TypeScript                                            | Pass, exit 0                                                                    |
| Assigned test formatting                              | Pass, exit 0                                                                    |
| Patch whitespace                                      | Pass                                                                            |

No tests were skipped or cancelled. Initial failures and unsuccessful runtime
selection attempts remain historical; none is relabeled as a product defect or
passing verification. Raw synthetic logs remain outside Git.

| Log under `/tmp`                       | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `restore-boundary-final-new.log`       | `d602395299cab6e4234f4224785bea32c67cbc2f0e2e1d05ef88e3c415a6ecf9` |
| `restore-boundary-regression.log`      | `0f4c5bd11a6355d5625d6b299f6f610702453da3be09e439e5f4b95b24e162d5` |
| `restore-baseline-fixture-check.log`   | `c5b2d4060888166096df44e7cbe172515b936ec23c3daa197cdb0aa20904dcdc` |
| `restore-boundary-final-typecheck.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `restore-boundary-format.log`          | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |

## Delivery and limits

Local commit contains only this new report and the new proposed boundary test
file. Exact `git format-patch -1 --stdout` bytes are transferred in numbered,
individually decodable base64 foreground outputs below 12,000 characters each.
Transfer metadata identifies each decoded chunk's byte count/SHA-256 and the
whole patch's byte count/SHA-256. Decode each chunk, concatenate decoded bytes in
order and verify the whole hash before reviewing.

This is a blocked review/test package, not a completed production repair.
Actual writer fencing, routing, external trust, provider outcomes, infrastructure,
residency and recovery targets remain unqualified. No CI/Actions/runner,
provider I/O/accounts/secrets/settings, PR/merge/push, deployment, purchase,
new coding session, nested delegation, background automation, reminder or
send_later was used. No subscription was created. All task/product gates remain
**NOT VERIFIED**.
