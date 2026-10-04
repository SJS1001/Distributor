# Read-only checkout reference join

This independently owned prerequisite composes the existing native first-unknown checkout join with both complete proposed-reference readers. It changes no existing source, tests, purposes, hash domains, schema, Application, routes or restore release behavior. D-010/D-024/D-039 remain incomplete; no product gate or external qualification is inferred.

## Version and ownership

- Exact excluded base: `178ea011d6a1a3aaee6876441f48be1f6f68c442` (the previously delivered five reference-reader files).
- Tested source/test commit: `348b19e95bee5bde87e913c4ac443cb5b34b1119`. The closing commit adds this report only; its exact identity and the full three-file transfer hashes are in the delivery manifest.
- New files only: [join](../src/server/restore-offline-checkout-reference-join.ts), [tests](../tests/restore-offline-checkout-reference-join.test.ts), and this report.
- Existing source worktree and concurrent owner files were preserved. Root owns shared composition, old native join, Application, schema and publication.
- Requested model: Astra/high for the financial/security boundary. Launcher/effective settings were not exposed and remain unverified. The supplied canonical owner rule was followed; the Mac filesystem rule path was unavailable here. No nested delegation.

The filename follows the assigned UTC checkpoint naming. Foreground execution occurred on 2026-10-03 in the owner's America/Toronto timezone (2026-10-04 UTC on the host).

## Fixed public API

```ts
const join = new RestoreOfflineCheckoutReferenceJoin(
  application.database,
  application.identity,
  application.billing,
  application.integration.checkouts,
);
// Caller already holds this same Database's outer native writer.
const receipt = join.getInTransaction({ id, orgId }, issuedComparison);
isCapturedOfflineCheckoutReferenceJoin(receipt);
```

`issuedComparison` must be the exact process-issued, frozen object from `compareOfflineCheckoutPaidEvidence`. A clone, lookalike, serialized hash, Proxy or caller-provided receipt cannot substitute for it. The join takes no callback, SQL, source-facts, permission, completeness or policy flags. Its return type is `OfflineCheckoutReferenceJoin`; it does not expose a native/provider payload getter.

The constructor builds the actual `RestoreOfflineCheckoutNativeJoin`, `BillingOfflineCheckoutReferenceReview` and `IntegrationOfflineCheckoutReferenceReview` using the actual same-application owners. Existing owning graph checks validate Database, IAM, Platform, Billing/opening, Integration/checkouts, residency, MFA and their actual Stores and method identities. This class additionally pins all three composed implementation prototypes and full method descriptors, rejects instance overrides, and invokes only those fixed methods. It does not duplicate their complete SQL/history validators or read foreign tables.

Before any read, the call checks the comparison's WeakSet identity, detaches the two bounded primitive actor fields without invoking accessors, validates the fixed implementation descriptors, and invokes the Billing reader's fixed composition guard. That guard requires the actual outer writer and current raw recovery hold. The owner readers freshly validate current active finance staff authority, no customer scope, tenant/password policy and the current Stripe residency choice. The join records `total_changes()` through an actual Integration Store; this is its only direct SQL.

## Composition and precise discharge

The fixed Integration reference operation runs first so global Integration and Billing count/type/UTF-8/row/aggregate preflights precede candidate capture. Then the join explicitly invokes the Billing reference reader and original native join. Every result must carry its actual private owner brand and match the selected organization, actor, customer, invoice, effect, comparison and candidate identities. Payment/session references, binding hash, native hash, intent and outcome hashes are joined exactly. The Integration receipt's embedded Billing reference hash must equal the separately captured Billing receipt.

The complete three-operation capture is repeated in the same outer writer. All three receipt hashes must remain equal; final graph/raw-hold checks and unchanged `total_changes()` prevent hidden same-value writes, while each owner repeats its own current authority/candidate checks. Caught synchronous reentry poisons the outer call. A failed call resets the busy state for a fresh later review; it issues no receipt. No nested owner transaction is added.

Only these checks are removed:

| Removed check                                                      | Actual operation that discharges it                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `current-native-candidate-authority-and-raw-hold`                  | `RestoreOfflineCheckoutNativeJoin.getInTransaction`                                                      |
| `billing-proposed-payment-reference-history-contract-required`     | `BillingOfflineCheckoutReferenceReview.getInTransaction`                                                 |
| `integration-proposed-session-reference-history-contract-required` | `IntegrationOfflineCheckoutReferenceReview.getInTransaction` (also binds its own actual Billing receipt) |

The join verifies the exact `requiredChecks` transformation promised by each composed receipt. A future owner change cannot silently remove an additional check through an otherwise valid branded result.

The result is detached, recursively frozen and privately WeakSet-issued. It contains exact proposed `paymentReference`/`sessionReference`, selected native identities, comparison/candidate/native/binding/intent/outcome hashes, and `nativeJoinHash`, `paymentReferenceHash`, `sessionReferenceHash`. It returns neither raw collections nor `allowed`, `qualified` or import permission. Its literal purpose is `distributor-offline-checkout-reference-join-v1`; its hash is SHA256 of the existing canonical encoding of `{ domain: "distributor-offline-checkout-reference-join-receipt-v1", body }`. Existing purposes and digest domains remain unchanged. Process branding is a construction-origin check, not a persistent or reusable authority grant.

These four checks remain, in their original order:

1. `qualified-stripe-account-runtime-binding-and-provider-truth`
2. `qualified-complete-source-interval-and-command-provenance`
3. `qualified-source-candidate-fences-and-authority-through-commit`
4. `fixed-checkout-owner-application-contract-required`

## Admitted scope and refusals

The selected checkout remains the existing first-unknown, zero-current-settlement profile. This enhancement does not expand it to settled selected invoices, selected renewal/observation histories, inbox or callbacks. The globally complete readers preserve their independent conservative profile refusals for unrelated pending/terminal checkout obligations, active claims, foreign organizations, unsupported opening records, orphan/cross-scope histories and unqualified callback/inbox attribution. No retained obligation is silently discarded or declared terminal.

Real sibling unknown checkout renewal and not-found reconciliation histories are supported only where the existing complete owner reader supports and validates them. Proposed PaymentIntent references already attached to another invoice and proposed sessions retained for another customer both refuse, even when the original selected native join by itself can produce a consistent receipt. Same-writer uncommitted collisions are visible. A current candidate mismatch, withdrawn processing choice or revoked native principal refuses; rollback restores the unchanged original facts.

Source/provider completeness, account ownership, declared test/direct runtime binding, external authority, native command provenance and host fencing through COMMIT are not authenticated by the comparison or these receipts. This result grants no transport, retry, observation/import, payment mutation, release or activation. Root must integrate the fixed task and qualified host; the old join intentionally retains its original missing-reference checks and original tests unchanged.

## Foreground evidence

Environment: Linux x64, UID 0, Node `24.19.0`, SQLite `3.53.3`, OpenSSL `3.5.7`, TypeScript `7.0.2`, Prettier `3.9.9`. Existing isolated dependencies were reused through a temporary untracked `node_modules` symlink; no dependencies or lockfiles changed. The symlink was removed before transfer. There was no root-only WAL metadata failure, setuid attempt or filesystem-guard relaxation in these runs. No provider/network call was made; the actual Application fixtures use synthetic in-process adapter replies solely to create native historical uncertainty.

| Check                                          | Outcome                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Dedicated new join tests                       | **28/28 pass**, zero failed/cancelled/skipped/todo, exit 0, 15843.319160 ms   |
| Combined affected tests below                  | **517/517 pass**, zero failed/cancelled/skipped/todo, exit 0, 22842.276349 ms |
| Complete `tsc --noEmit`                        | Pass, exit 0                                                                  |
| Prettier on the three owned files              | Pass                                                                          |
| `git diff --check` and staged whitespace check | Pass                                                                          |
| Baseline file identity check                   | Every baseline blob unchanged; only three new owned files                     |

Dedicated command:

```sh
node --import tsx --test tests/restore-offline-checkout-reference-join.test.ts
```

Affected command (the 28 dedicated checks are included in 517):

```sh
node --import tsx --test \
  tests/restore-offline-checkout-reference-join.test.ts \
  tests/billing-offline-checkout-reference-review.test.ts \
  tests/integration-offline-checkout-reference-review.test.ts \
  tests/integration-offline-checkout-evidence.test.ts \
  tests/restore-offline-checkout-native-join.test.ts \
  tests/integration-offline-checkout-review.test.ts \
  tests/billing-offline-checkout-review.test.ts \
  tests/integration-offline-settled-checkout-review.test.ts \
  tests/checkout-access.test.ts tests/checkout-current.test.ts \
  tests/checkout-history-proof.test.ts tests/checkout-observations.test.ts \
  tests/checkout-renewal.test.ts tests/providers.test.ts \
  tests/integration-offline-refund-evidence.test.ts \
  tests/restore-offline-refund-native-join.test.ts
```

Other checks:

```sh
node_modules/.bin/tsc --noEmit
node_modules/.bin/prettier --check \
  src/server/restore-offline-checkout-reference-join.ts \
  tests/restore-offline-checkout-reference-join.test.ts \
  docs/RESTORE-OFFLINE-CHECKOUT-REFERENCE-JOIN-2026-10-04.md
git diff --check
```

The dedicated fixtures cover CA/CAD, CA/USD and US/USD with event reporting both disabled and enabled; exact three-receipt and digest binding; exact four remaining blockers; old-join refusal preservation; callback-free Proxy/revoked Proxy/accessor refusal; current role/activity/account/tenant/password/residency checks; raw hold and candidate mismatch; same-writer authority rollback; read rollback and Application reopen; cross-invoice PaymentIntent and cross-customer session collision; real sibling renewal/reconciliation; native uncommitted payment collision; unrelated pending obligations and active leases; forged/cross-application owners, method descriptors and Store substitutions; caught reentry and same-value write refusal; and complete count/multibyte/NUL/invalid-UTF8 refusal. The byte preflight tests assert zero shared candidate pathname reads. Actual original owner rows, comparison hashes and native effects remain unchanged by successful reviews.

Retained failed attempts (private logs remain outside the patch):

- `dedicated-initial.log`: module-load failure before any fixture; new test import named the new class from the old join path. Corrected the new test import only.
- `dedicated-second.log`: 18/18 passed before expanded adversarial coverage.
- `dedicated-third.log`: 27/28 passed. The NUL test expected `OFFLINE_CHECKOUT_SESSION_REFERENCE_LIMIT`; the actual fixed owner SQL preflight refuses NUL as `OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW` first. Corrected that new expected code to the actual earlier malformed-text refusal, retaining the same oversized NUL input, refusal, zero pathname-read and rollback assertions. Existing tests/assertions were untouched.
- `typecheck-expanded.log`: three new test typing errors (possibly undefined tuple value and two readonly `fs.lstatSync` assignments). Corrected tuple access and used the same explicit test-only builtin cast as existing fixtures. Initial implementation-only and final complete TypeScript checks pass.
- `dedicated-final.log`, `affected.log`, `typecheck-final.log`: successful results above. No hidden skipped or weakened old assertions; no production repair was needed after the initial implementation.

These are bounded synthetic engineering checks, not a full-suite, browser, real-provider, infrastructure, customer, operating-policy or product acceptance receipt. No CI, runner, PR, push, merge, deployment, provider account, background test or reminder was created. Root independently transfers, reviews and replays before publication. Assignment ends after the exact three-file manifest and independently encoded gzip segments are returned.
