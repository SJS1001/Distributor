# Fixed checkout private application capture

## Scope and checkpoint

Excluded public base: `61e4a16e2bd35596141fcc36b1c8d624cf020cc2`, tree
`9a1ec53e422bde85ee127153cea85eab07e728d7`, fetched over the existing public HTTPS
remote for `SJS1001/Distributor` / `codex/local-distributor-checkpoint`.
The prior private-reader donor `75d5c18` is already included in this published
base and is not retransmitted. This delta changes only the private checkout
reader, its existing test file, and this new report. No owner application,
coordinator, schema, shared parser, dependency or runtime configuration changed.

Requested model: Astra/high. Effective model and reasoning settings are not
exposed by this launcher, so they remain unverified. No nested delegation was
used. Historical work and reports are preserved in their original worktrees.

## Fixed API and actual call order

`CheckoutPrivateHandle.captureForApplicationInTransaction(actorLocator)` is an
alternative to `reviewInTransaction(actorLocator)`. Either consumes the same
completed handle once; both erase the captured allocation in `finally`, including
refusal. Existing `read`/`complete` descriptor pinning, one-file byte limits,
canonical fatal UTF-8 parsing, inert object capture, digest and fixed task checks
remain unchanged. The existing review result remains redacted and unchanged;
its exact method-list test now includes the newly added method.

The new path performs these synchronous operations:

1. Verify the actual issued handle identity, completed lifetime and reader
   reentry state. Recheck the captured allocation's length and file digest.
2. Decode/copy the already captured bytes under the existing strict bounds and
   canonical rules. Require the canonical input digest to equal the captured
   envelope payload hash. Mint the actual fixed checkout comparator result and
   match organization, effect and native-state binding to the envelope.
3. Run the actual `RestoreOfflineCheckoutNativeJoin` on the same validated
   Database/Identity/Billing/IntegrationCheckouts graph and current actor.
4. Read a fixed native `total_changes()` counter, review the actual OPEN phase,
   run `RestoreOfflineCheckoutReferenceJoin.getInTransaction` on the freshly
   minted comparison, then review the actual OPEN phase again. The reference
   join itself performs complete current owning payment/session reference reads
   and repeated native joins. No caller ports or comparison receipts enter.
5. Require identical phase receipts, exact envelope binding, matching native
   and reference comparison/candidate hashes, unchanged write counter and an
   unpoisoned handle. The fixed counter spans phase/reference reads as well as
   their existing native zero-write checks; it detects logically identical SQL
   writes that candidate logical hashing alone cannot detect.
6. Deep-freeze the complete result, register its identity in a private WeakSet,
   then erase/dispose the handle before returning. No path is reopened to parse
   evidence. No raw byte/input getter, caller callback or task-owner import is
   added.

The actual caller must already hold the native Database writer transaction.
Current native IAM/password/organization scope, raw recovery hold, complete
history, candidate file identity and OPEN generation/session/lineage remain
mandatory. The constructor binds actual owners and pins the real methods; it
does not accept interchangeable reader ports. The fixed integration Store read
is only `SELECT total_changes() AS n`, not a foreign business-table lookup.

## Result and provenance boundaries

`CheckoutPrivateApplicationCapture` contains exactly:

- `version: 1` and `purpose: "native-private-checkout-application-consistency-only"`;
- `envelopeBinding`, evidence `setHash`, canonical `payloadHash`;
- actual issued `comparison`, including its fixed captured payment/session
  `outcome`, actual issued `referenceJoin`, actual `native` and `phase` receipts;
- `captureHash` equal to `digest(canonical({ domain, body }))`, where domain is
  `distributor-offline-checkout-private-application-capture-v1` and body is every
  preceding field, excluding `captureHash` itself.

All nested data is detached from caller inputs and deeply frozen. Existing
comparator/reference/native hash domains and limits are unchanged. The
reference receipt discharges its specific native reference requirements; the
nested native receipt retains its original required-checks list unchanged.

`isCapturedCheckoutPrivateApplicationCapture(unknown)` uses only object type
and private WeakSet membership. It invokes no getters, reflection, coercion or
proxy traps, including for revoked proxies. Rehashing a clone, copying fields,
prototype inheritance, proxy wrapping and persisted JSON do not acquire the
brand. The nested comparison and reference receipts retain their own actual
process-issued brands.

This brand proves process provenance only. It is **not** an authority token,
external qualification, current permission after return, or globally single-use
owner-write permit. The handle is consumed once; the frozen returned object is
not erased or revoked on later actor/state changes. A future fixed owning task
must enforce its own current native checks, exact envelope/candidate/request
binding, consume-once semantics and durable CAS/receipt rules. It must not accept
an old capture merely because the predicate still returns true. No owner-write
consumer, task registry, owner import or application cycle is implemented here.

Actual application reopen is tested as fresh native consistency only. Neither
old capture brands nor these receipt hashes establish durable external authority.
Independent current trust/revocation, signature and duty separation, provider
and runtime-account truth, source completeness, source/candidate fencing through
actual COMMIT, owner application and exact durable response recovery remain root
composition/qualification obligations. Synthetic fixtures do not qualify that
infrastructure. No release, retry, provider call, live enablement or product gate
is authorized or claimed.

## Verification and retained failures

Environment: Linux x64, Node `v24.19.0`, embedded SQLite `3.53.3`; existing locked
checkout dependencies were reused without installation or manifest changes.
All commands were direct foreground native tests; no CI or runner was invoked.
Private logs remain outside tracked source at
`/workspace/distributor-checkout-private-application-audit`.

Retained initial outcomes:

- Baseline production source with the six new application-profile tests:
  `node --import tsx --test --test-name-pattern='application capture' tests/restore-offline-checkout-private-evidence.test.ts`
  exited 1: 0/6 passed, all six failed because the method did not exist;
  3710.218575 ms. `application-baseline-red.log` SHA-256
  `a162ab75ebfd31ab17bf6818896e2eaebdeab27d85281024da40e866a9ef4acb`.
- First implementation run: 67/73 passed, six old exact method-list assertions
  rejected the intentionally new method; all six new profile tests passed.
  The method-list assertion was expanded exactly, with all prior methods and
  assertions retained. Exit 1, 18837.312998 ms; `application-initial.log` SHA-256
  `9c0da0f9b0c4b4e366b515c6101e1d4269d0815b6e20ad4b8b3947e00cfc6ec7`.
- Dedicated adversarial run then passed 93/93, exit 0, 28544.724002 ms.
  First affected run passed 509/509, exit 0, 55011.818625 ms.
- TypeScript caught two new test typing errors (readonly hash assignment and
  unchecked buffer index), then a SQL counter union type in the additional
  zero-write test. These test-only typing failures are retained in
  `typecheck-final.log` and `typecheck-corrected.log`. Fixes do not weaken runtime
  assertions. The final counter type assertion has no runtime effect.
- The added phase no-op-write test passed 1/1, exit 0, 2115.825046 ms, proving
  refusal/erasure and actual outer rollback on a logically identical write.

Final production/test checkpoint: `1a3f7189b391983780ab5711330e95334196a6f8`.
The preceding production commit is `9457dd6b4b7a6316917f589d3358511b63c01079`;
the only subsequent code/test change is a compile-time type assertion on the
new test's fixed SQL counter. Executed JavaScript and production source are
identical between those commits. The closing commit adds only this report.

Final commands/outcomes:

```sh
node --import tsx --test tests/restore-offline-checkout-private-evidence.test.ts
```

Exit 0, **94/94**, no skips/cancellations, 28808.154723 ms, at final checkpoint;
`dedicated-committed.log`.

```sh
node --import tsx --test tests/restore-offline-checkout-private-evidence.test.ts tests/restore-offline-checkout-reference-join.test.ts tests/restore-offline-checkout-native-join.test.ts tests/billing-offline-checkout-reference-review.test.ts tests/integration-offline-checkout-reference-review.test.ts tests/integration-offline-checkout-evidence.test.ts tests/billing-offline-checkout-review.test.ts tests/integration-offline-checkout-review.test.ts tests/restore-offline-native-phase.test.ts tests/restore-private-evidence.test.ts
```

Exit 0, **510/510**, no skips/cancellations, 60750.615184 ms;
`affected-committed.log`, run on `9457dd6` with the same executed source as final.

```sh
npm run typecheck
./node_modules/.bin/prettier --check src/server/restore-offline-checkout-private-evidence.ts tests/restore-offline-checkout-private-evidence.test.ts docs/RESTORE-OFFLINE-CHECKOUT-PRIVATE-APPLICATION-2026-10-04.md
git diff --check
```

Full TypeScript and assigned-file format/whitespace checks exit 0. No full-system
suite or product/infrastructure qualification is claimed. The final transfer
manifest carries the exact closing commit, per-file bytes/SHA-256, and raw and
deterministic-gzip patch bytes/hashes against the excluded base.

Coverage includes all six CA/CAD, CA/USD and US/USD report modes; actual opaque
capture followed by independent actual reference join; exact outcome and hash
bindings; nested freeze and detached mutation; forged/rehashed/normal/revoked
proxy brand refusals with trap counts; mutually exclusive review/application
lifetime; capture/review/read/dispose reentry; buffer erasure and descriptor
closure; no private pathname reopen after completion; current principal, role,
password, organization, raw hold, claim, complete native history and OPEN phase;
actual same-Database owning-method substitution; payment/session collisions
outside the selected invoice; same-writer late reference changes; actual
rollback and exact reopen; provider-call and full native state conservation.
No historical assertions/timeouts were removed. Existing test fixtures now
optionally create actual native collision rows before entering recovery hold.
No generic production callback or authorization relaxation was introduced.


Root integration correction: application captures bind `task.expectedStateHash` to the complete actually issued `referenceJoin.hash`; the redacted review keeps its native hash contract. The fixed owning application must still refresh the current join and raw capture binding before mutation. The original cloud 94-pass replay predates this correction. Root's combined capture/lease-guard replay passes 135/135 with zero other outcomes; full regression has not yet been repeated. Initial root fixture method-name and preexisting collision setup failures are retained in private logs.
