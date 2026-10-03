# Native restore disposition eligibility repair — 2026-10-03

Exact parent: `d461e68eaf75a5ee575c1abe51545797ab5d5631`. This is a
three-file repair delta, excluding the previously delivered consumer and Platform
prerequisite. Existing tests, filesystem guards, authority contracts and other
owners' work are unchanged.

## Reproduction and change

ROOT reports the applied parent passes all 25 dedicated consumer tests on its
Mac, but the combined 367-test run has two failures. This repair addresses only
its reported `copied blocked provider intent refuses release despite signed
report declarations` mismatch: an unrelated blocked Stripe checkout with empty
payload and no renewal returns `RESTORE_MAINTENANCE_AUTHORITY` before it can be
classified as unresolved native work. The other reported failure is outside
this assignment.

The cloud reproduced the mismatch on unchanged parent production code using
same-writer boundary tests: both unrelated blocked checkout and credit-application
fixtures returned `RESTORE_MAINTENANCE_AUTHORITY` instead of
`RESTORE_UNRESOLVED` without configuration. A configured authority was also
unnecessarily queried for absent or wrong-org native historical identities.
The four new tests initially produced **1 pass / 3 fail**. That failure is
retained; the original restore-activation test was not edited.

Integration now performs two preliminary, refusal-only owning reads before
requesting maintenance authority:

- Blocked Stripe checkout: an outgoing `integration_checkout_renewals` row must
  bind the exact organization and predecessor effect ID.
- Blocked QuickBooks credit application: an
  `integration_credit_cancellations` row must bind the exact organization and
  effect ID.

Both identities are necessary under the complete existing owner validators.
Their existence is not sufficient evidence. The consumer still requests fresh
maintenance authority, derives the full native binding, and executes complete
owning source/receipt/hash/reservation/lineage validation on the same writer
connection. Malformed or forged matching history still fails that validation.
No alternate authority, permissive fallback, error remapping, queue mutation,
provider lookup or transport was added. Independent successor and claim checks
are unchanged.

## Foreground verification

Linux, Node 24.19.0, UID 0; existing installed dependencies reused without
repository dependency changes. Requested Astra/High is unverified because
runtime model/effort controls are not exposed. The canonical owner rule path
remains unavailable; the supplied rule was followed without nested delegation.

```sh
node --import tsx --test --test-name-pattern='native queue preliminary' tests/restore-native-dispositions.test.ts
node --import tsx --test --test-name-pattern='native queue' tests/restore-native-dispositions.test.ts
node --import tsx --test tests/restore-native-dispositions.test.ts tests/restore-activation.test.ts
node --import tsx --test tests/integration-restore-dispositions.test.ts tests/platform-restore-disposition-receipts.test.ts tests/accounting-credit-cancellation.test.ts tests/checkout-renewal.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/integration.ts tests/restore-native-dispositions.test.ts docs/RESTORE-NATIVE-DISPOSITIONS-REPAIR-2026-10-03.md
git diff --check
```

- Native queue selection: **26/26 pass**, preserving all previous meaningful
  authority refusal checks.
- Four targeted new tests: **4/4 pass**. Final supplemental assertions also show
  another effect's genuine same-org cancellation/renewal cannot qualify an
  unrelated blocked effect. Missing/wrong-org identities never query that
  target's authority. Genuine eligible records still require current authority,
  reject forged matching history, and reject later authority revocation.
- Affected owner regressions: **74/74 pass**.
- Full dedicated consumer plus unchanged restore-activation suite:
  **26 pass / 44 fail**. All 44 failures are `RESTORE_REVIEW_CHANGED` during
  the existing candidate/private-file inspection. This includes all 41 existing
  restore-activation tests and the three dedicated full-restore tests; their
  intended assertions are not reached here. No assertion, filesystem guard or
  timeout was relaxed, and no setuid workaround was attempted.
- TypeScript, assigned formatting and diff whitespace checks pass.

The full/queue runs used the final production repair; the final same-org
other-effect assertions were then run in the four-test targeted selection.
ROOT must replay the original full restore test on its supported workstation.
The narrow native boundary reproduction is not represented as a successful
cloud end-to-end restore run. Actual external maintenance qualification,
provider truth, infrastructure and product gates remain unverified.

Retained synthetic log SHA256 values:

- Exact initial red:
  `b4121c1230f50945391bfa00ddc7b785fac3eb34f674f1a47d56b1a975f0a133`.
- Native queue selection:
  `d01d0993ed3d8437a62e45d03928bf05294e68df0342f083d0688a1376bce6c7`.
- Final targeted selection:
  `0af68c09a0aaf3ffb9684f7d67a96cb0c44d875c9b8bdfed344fc5a28649a1eb`.
- Owner regressions:
  `7cc5243e726aa1a4ba668106e9b138daa3343ae2277012e1a2fbf7b393dc4991`.
- Full consumer/restore run:
  `b25911c73a49eb60bcb13886e5b495d358f8e027530aefeca7fa25b2cdc13fb3`.
