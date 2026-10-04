# Strict retained checkout recovery callback guards

Excluded public base: `6d7044732c2437e3b874a1e3883e7cae6da00e0a`, tree `a537f3d2982079689dc4c419fb41e8552a35aaae`. Shell GitHub access was blocked; the public read connector supplied the missing Git objects. Every blob, recursive tree and reconstructed commit identity was verified before checkout. Existing worktrees were preserved. The closing commit and exact final file identities are in the delivery manifest.

Only the [shared recovery reader](../src/server/restore-offline-commit-recovery.ts), its [tests](../tests/restore-offline-commit-recovery.test.ts) and this document change. Root owns paid-owner caller binding and signed composition. No schema, Application, other owner, dependency or historical report changes are included.

## Fixed API and boundary

```ts
RestoreOfflineCommitRecoveryReader.prototype.getCapturedCheckoutInTransaction(
  actor: Actor,
  envelopeInput: unknown,
): OfflineCommitRecovery
```

Root can bind this prototype method at module load. It calls a private shared implementation, not the replaceable public `getInTransaction`. There is no caller strictness option, SQL port, callback or new authority/result field. Legacy `getInTransaction` continues its historical consistency-only semantics and intentional fault-injection seams.

Strict reads pin module-load descriptors for Database, Store, Identity, MultiFactor, FactorCipher, Platform, RestoreOfflineStorage and RestoreActivation. Descriptor-only construction captures the original objects and links without invoking child accessors or imposing strict prototype checks on legacy startup. Strict entry checks exact object prototypes, all prototype descriptor attributes, absence of instance method overrides, actual database/store/namespace links, IAM-to-Platform/MFA/cipher links and the original path. The original pinned RestoreActivation accessor confirms its private offline-storage identity. IAM role-array descriptors are validated before `security()` can use them. No key bytes are returned or serialized.

Checks run before the first native call, after the direct filesystem stat, after candidate-file pin creation, after native candidate capture, after retained reread, and after the final `unchanged()` callback. The latter was the late recovery window. Persistent and self-removing substitutions both refuse before the replaced method executes. The strict path also requires current raw hold, inert actor ID/organization capture, fresh finance/staff/password authority, unchanged hold and `total_changes()`, and final owner validation. Caught same-reader strict reentry poisons that attempt. Strict graph checks are not a sandbox against arbitrary replacement of built-ins or module code.

The return type, exact envelope/receipt/session/generation binding and bounded owning-storage validation are unchanged. Both absence and retained receipt remain historical consistency classifications. Neither proves external source/provider truth, signed current authority, execution/retry/release permission, evidence qualification or fencing through COMMIT. Root must separately validate paid-owner provenance and bind the strict entry. No provider transport or mutation is added.

## Foreground verification

Environment: Linux x64, Node 24.19.0, SQLite 3.53.3, OpenSSL 3.5.7, TypeScript 7.0.2, Prettier 3.9.9. Existing dependencies were reused via a temporary untracked symlink, removed before delivery. Requested model/effort: Astra/high; effective runtime settings were not exposed. No nested session, provider call, CI, PR, merge or push occurred.

Initial red: the new strict entry was temporarily routed to the unchanged legacy implementation. Eight first/final filesystem substitution cases failed (0/8 pass, exit 1, 2964.43623 ms), demonstrating the assertions exercise the missing boundary rather than a missing method. The full strict implementation was then restored. Red log SHA-256: `c910294650d3dad312c741f91b4f375a976410044e219b3bf124811d8eba2128`; retained privately, not in the patch.

Dedicated repaired run: 72/72 pass, exit 0, 15506.749609 ms. A subsequent explicit legacy compatibility regression brings the owned suite to 73 cases; all 73 passed in the affected run below. The tests cover CA/CAD, CA/USD and US/USD with reports on/off, reopen equality, absent/retained receipts, early/direct-stat/candidate/final callbacks, instance/prototype replacements, persistent/self-removing hooks, accessor/proxy graph replacement, current IAM/hold/writer checks, caught reentry, same-value writes with outer rollback, and frozen/read-only conservation. Every byte of the original test file remains an unchanged prefix.

```sh
node --import tsx --test --test-name-pattern='strict offline.*(first|final)' tests/restore-offline-commit-recovery.test.ts
node --import tsx --test tests/restore-offline-commit-recovery.test.ts
node --import tsx --test --test-concurrency=4 \
  tests/restore-offline-commit-recovery.test.ts \
  tests/restore-offline-commit-guard.test.ts \
  tests/restore-offline-native-phase.test.ts \
  tests/restore-activation.test.ts \
  tests/schema-upgrade.test.ts \
  tests/restore-offline-checkout-private-evidence.test.ts \
  tests/integration-offline-checkout-paid.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/prettier/bin/prettier.cjs --check src/server/restore-offline-commit-recovery.ts tests/restore-offline-commit-recovery.test.ts docs/RESTORE-OFFLINE-RECOVERY-CALLBACK-GUARDS-2026-10-04.md
git diff --check
```

Affected run: 441/482 pass, 41 fail, zero cancelled/skipped/todo, exit 1, 58791.097378 ms. Every failure is in `restore-activation.test.ts` setup: `captureRestoreCandidate` → `pinRestoreCandidateFiles`, `RESTORE_REVIEW_CHANGED: Candidate files changed during inspection`, before the recovery reader is reached. The other six suites pass, including schema upgrade and intentional rollback checks. A bounded `CA/false persistent release` rerun with the exact **baseline recovery source restored** reproduced the same failure (0/1 pass, exit 1, 923.200196 ms). The implemented source was restored byte-exactly afterward. This proves the selected failure predates the repair; it does not independently identify the filesystem cause of every failure. No file guard or assertion was weakened.

Affected log SHA-256: `518e82711493b3467ea0ec992e3401c7bd249951cf5364ff88eb8f84b0d627f6`. Baseline reproduction log SHA-256: `03b0a241a9f9e1fd13a8b0b5722f413a35746d3113e75cb4e107ffda552a9bf0`. Full TypeScript exits 0; owned formatting, document links and whitespace checks pass. No full-system replay or product/provider qualification is claimed. Root's concurrent paid-owner fixes and coordinator wiring are not present in this excluded-base checkout and remain independently integrated and verified by root.
