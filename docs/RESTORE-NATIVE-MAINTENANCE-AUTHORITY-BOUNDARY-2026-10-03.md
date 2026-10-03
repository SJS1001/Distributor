# Native maintenance authority adversarial boundary — 2026-10-03

## Exact source and ownership

Fresh public HTTPS clone of SJS1001/Distributor, branch `codex/local-distributor-checkpoint`, detached exact excluded base `1207c8193fc56b79408ebb232b38580f6f3b3db8`. Only two new files are delivered: `tests/restore-native-maintenance-authority-boundary.test.ts` and this report. No existing source, tests or reports changed. Local commit only; no push, PR, CI/runner, deployment, provider call, production repair, account/secret access or authority grant. No delegation or automation was created. No lane subscription exists to remove.

Read AGENTS.md, README.md, docs/PLAN.md, docs/DECISIONS.md and bounded current HANDOFF (parallel cloud expansion). `rules/delegation-model-selection.md` does not exist in this exact checkout. User requested gpt-6-astra/High for security; effective model/reasoning is not exposed by the runtime and cannot be verified or changed by a prompt.

## Method and actual boundary

Synthetic command-created carrier bookings and a wholly unsent canceled Canada Post group are isolated with the actual native restore generation/hold. A separately generated Ed25519 key signs each current challenge; copied IAM supplies only the native principal. The test enters `RestoreActivation.settledNativeQueues()` in the actual database transaction, which calls owning integration/carrier historical projection and actual `RestoreActivation.nativeAuthority()`. The TypeScript cast makes that historical entry point accessible without replacing implementation. No mock signature validator or mocked projection is used. Fixture construction creates no transport adapter or provider result. The disabled activation adapter is present only to inject a deterministic clock; no adapter controls are called.

Rows from every non-internal SQLite table except platform_restore_releases are captured independently and compared after accepted/refused projection. No release operation is called; the separate provider-access assertion proves the recovery hold remains active. The same-writer callback-mutation case checks transaction rollback. IAM corruption cases deliberately change fixture rows inside a transaction and roll them back after refusal; they do not grant persistent authority.

Fixtures reuse this repository's original carrier setup pattern. Torsion vectors are the complete eight-point synthetic subgroup from the fixed `restore-offline-approvals.test.ts`; both trusted-key forgery and signature-R substitution are tested through native historical projection, without using the offline approval validator.

## Results and commands

Environment: Linux x64, UID 0, Node v24.19.0, OpenSSL 3.5.7. Existing installed dependencies were read through a scratch symlink to `/workspace/scratch/8d804e7e74ec/Distributor/node_modules`; no install, package/lock change or network dependency fetch. This is an environment dependency limitation, not an isolated package-install qualification. That untracked symlink is excluded from the delivery and removed before commit.

| Command                                                                                        | Actual exit/outcome                                                   |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `tsx --test tests/restore-native-maintenance-authority-boundary.test.ts`                       | 1; launcher IPC socket EPERM, no native tests executed                |
| `node --import tsx --test tests/restore-native-maintenance-authority-boundary.test.ts` initial | 1; 36/53 pass, 17 fail, no skips/cancellations                        |
| same command after fixture correction/additions                                                | 1; 45/64 pass, 19 fail, no skips/cancellations                        |
| same command final delivery input                                                              | 1; 53/72 pass, 19 fail, no skips/cancellations/todo; 10,386.027017 ms |
| `node --import tsx --test tests/restore-native-dispositions.test.ts` unchanged comparator      | 1; 26/29 pass, 3 fail, no skips/cancellations/todo; 6,652.689811 ms   |
| `tsc --noEmit` initial                                                                         | 2; copied helper missing fixture type alias; original error retained  |
| `tsc --noEmit` corrected/final test                                                            | 0                                                                     |
| `prettier --check tests/restore-native-maintenance-authority-boundary.test.ts`                 | 0                                                                     |
| `git diff --check`                                                                             | 0                                                                     |

Initial request getter/proxy construction signed the wrapped request, causing fixture-side reflection. Corrected only fixture construction: sign the plain request first, then wrap the returned request. Zero-reflection and refusal assertions are unchanged. The initial static error was corrected by naming `ReturnType<typeof fixture>` directly. Original logs are preserved below. Additional tests retain all meaningful original failing assertions; no production change or weakened gate makes this package green.

The unchanged comparator's three full prepare/activation tests fail during `captureRestoreCandidate` with `RESTORE_REVIEW_CHANGED` / Candidate files changed during inspection. They never reach the tested authority boundary on this UID-0 environment. Report as an existing environment/source qualification limitation, not a maintenance-authority defect. The 26 remaining comparator cases execute and pass. No full suite, browser, production, external-source, cutover or release qualification is claimed.

## Reproduced production defects (19 unchanged red assertions)

1. **Canonical crypto encodings (3 failures)** — `src/server/restore-activation.ts`, nativeAuthority key/signature processing. A base64 signature with nonzero pad bits decodes to the same bytes and is accepted. PEM with leading junk or trailing bytes is accepted by createPublicKey. Enforce bounded exact canonical Ed25519 SPKI/key encoding and base64 decode/re-encode equality before verification; retain scalar/point subgroup checks independently of OpenSSL behavior. This is encoding ambiguity, not proof of a key swap or invalid strong-key signature acceptance.
2. **Observation shape/active reflection (8 failures)** — nativeAuthority observation/request materialization. Observation getter/proxy and request getter/proxy are actively reflected before refusal (4 failures). Valid signatures over extra observation fields, including a one-MiB extra field, are accepted (2). Hidden symbol/nonenumerable observation keys are accepted (2). Reject proxy values before reflection; use own data-property descriptors, exact key allowlists, plain-prototype checks and byte/count limits recursively before canonicalization/destructuring/signature processing. Getter/proxy failure proves unsafe reflection even where signature mismatch later refuses; it must not be described as successful projection in every such case.
3. **Trust roster shape/bounds (8 failures)** — nativeAuthority current loadTrust/filter/import path. Trust-array and trust-entry getters/proxies execute (4); extra array/entry keys and oversized roster/entry are accepted (4). Bound roster count and UTF-8 key/id bytes before filtering/importing keys; reject proxies, holes/accessors, non-data/extra keys and ambiguous identities. The fixture's 10,002-entry roster and one-MiB extra trust field are intentionally gross over-budget inputs; tests do not select a business-sized roster policy.

Repair constraints for root: preserve current trust reload AFTER observation; exact org/projection/record/principal/external-authority/purpose/challenge/generation association; fresh current configuration identity; safe monotone sampled clock and expiry; native role/site/active/org/current-password checks; same-writer transaction and no-write guards. The maintenance association permits only read-only historical projection, never IO, claim retirement, restored release, authoritative provider truth or transport authorization. Narrowly harden `configureNativeDispositions`/`nativeAuthority` under root ownership and rerun these unchanged assertions; this lane changes neither production path.

## Passing controls and limits

Exact request identity and every generation field, cross-target challenge replay, current trust revocation after observation, configuration withdrawal during observation, expiry/clock rollback/future observation/overlong validity, inactive/role/site/tenant/password-change native authority, duplicate/missing/foreign mapping, invalid/truncated signature, duplicate trust/changed current key, noncanonical scalar, all eight weak trusted-point forgeries and all eight signature-R substitutions refuse on this runtime. A normal canonical current signature permits projection with no row changes and retains recovery hold. Oversized associationId/signature inputs refuse before accessing the trusted-key getter. The malicious same-writer booking mutation rolls back.

Weak-point refusal on Linux/OpenSSL 3.5.7 does not establish cross-platform safety: the historical offline approval receipt reports Darwin/OpenSSL behavior differences, and nativeAuthority still delegates point acceptance to OpenSSL. No weak-point production acceptance is reproduced here. Initial commentary suggesting weak-point failure was corrected after examining per-case results.

The focused fixture exercises actual canceled-unused-membership historical projection, not a full restored filesystem clone/release or every billing projection. Other mapping projection identities are substituted adversarially and refused. Current external association/fencing/revocation infrastructure remains synthetic and unqualified. Timeliness is measured by two sampled native clocks; tests do not prove an external monotonic time source. No signature-work spy is installed; descriptor counters and the trusted-key getter sentinel measure actual reflection boundaries without mocking crypto.

## Retained original receipts

Full original logs below are synthetic, contain no credentials/provider/customer data, and are included in the two-file delivery. SHA-256 and bytes refer to original UTF-8 logs before Markdown wrapping. Empty final typecheck output has the SHA-256 of zero bytes.

### maintenance-authority-first.log

Bytes: 790; SHA-256: `76404b13ed3055e661100c3e12d36908b0c6115ff412b6d90f446e6a3a1efab7`.

```text
node:net:2145
      const error = new UVExceptionWithHostPort(rval, 'listen', address, port);
                    ^

Error: listen EPERM: operation not permitted /tmp/tsx-0/19.pipe
    at Server.setupListenHandle [as _listen2] (node:net:2145:21)
    at listenInCluster (node:net:2224:12)
    at Server.listen (node:net:2361:5)
    at file:///workspace/scratch/8d804e7e74ec/Distributor/node_modules/tsx/dist/cli.mjs:53:32174
    at new Promise (<anonymous>)
    at createIpcServer (file:///workspace/scratch/8d804e7e74ec/Distributor/node_modules/tsx/dist/cli.mjs:53:32152)
    at async file:///workspace/scratch/8d804e7e74ec/Distributor/node_modules/tsx/dist/cli.mjs:55:542 {
  code: 'EPERM',
  errno: -1,
  syscall: 'listen',
  address: '/tmp/tsx-0/19.pipe',
  port: -1
}

Node.js v24.19.0

```

### maintenance-authority-native-red.log

Bytes: 22118; SHA-256: `a2bf335e19578567a334408628ab55286e3402710cfd8d0c3e2ae1c4fbf496e8`.

```text
✔ native historical projection accepts fresh canonical signed association without writes or hold release (183.208015ms)
✔ native exact signed request refuses substituted orgId (132.359742ms)
✔ native exact signed request refuses substituted projection (125.459093ms)
✔ native exact signed request refuses substituted recordId (128.543448ms)
✔ native exact signed request refuses substituted nativePrincipalId (126.017606ms)
✔ native exact signed request refuses substituted externalAuthorityId (127.498051ms)
✔ native exact signed request refuses substituted purpose (130.183709ms)
✔ native exact signed request refuses substituted challenge (121.899198ms)
✔ native exact signed request refuses substituted generation (123.026483ms)
✔ native signed recovery generation refuses changed snapshotHash (126.597843ms)
✔ native signed recovery generation refuses changed restoredAt (119.774435ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (119.126537ms)
✔ native replay cannot reuse prior valid target/challenge (124.653108ms)
✔ native current trust revocation during observation wins (123.379606ms)
✔ native configuration replacement during observation refuses old grant (119.841447ms)
✔ native current clock refuses expiry (120.834024ms)
✔ native current clock refuses rollback (118.91644ms)
✔ native current clock refuses future (120.830999ms)
✔ native current clock refuses too-long (126.061944ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (135.998385ms)
✔ native copied principal loses role authority in current same-writer snapshot (140.605464ms)
✔ native copied principal loses site authority in current same-writer snapshot (138.908702ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (134.233297ms)
✔ native copied principal loses current password authority in current same-writer snapshot (153.41475ms)
✔ native small-order trusted key forgery refused 01000000-00 (120.960185ms)
✔ native small-order trusted key forgery refused c7176a70-7a (119.595575ms)
✔ native small-order trusted key forgery refused 00000000-80 (121.417033ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (124.436891ms)
✔ native small-order trusted key forgery refused ecffffff-7f (124.291472ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (119.654604ms)
✔ native small-order trusted key forgery refused 00000000-00 (121.256571ms)
✔ native small-order trusted key forgery refused c7176a70-fa (125.348488ms)
✔ native canonical Ed25519 encoding refuses scalar (117.917533ms)
✖ native canonical Ed25519 encoding refuses signature-pad-bits (129.526973ms)
✖ native canonical Ed25519 encoding refuses key-trailing-bytes (131.92313ms)
✖ native canonical Ed25519 encoding refuses key-leading-junk (126.081733ms)
✖ native byte/descriptor preflight observation getter precedes active reflection (128.098648ms)
✖ native byte/descriptor preflight observation proxy precedes active reflection (132.114739ms)
✖ native byte/descriptor preflight observation extra-key precedes active reflection (126.266182ms)
✖ native byte/descriptor preflight observation oversized precedes active reflection (149.982109ms)
✖ native byte/descriptor preflight request getter precedes active reflection (132.388712ms)
✖ native byte/descriptor preflight request proxy precedes active reflection (127.429788ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (119.158826ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (131.511749ms)
✖ native byte/descriptor preflight trust-array getter precedes active reflection (126.120673ms)
✖ native byte/descriptor preflight trust-array proxy precedes active reflection (128.120942ms)
✖ native byte/descriptor preflight trust-array extra-key precedes active reflection (130.017805ms)
✖ native byte/descriptor preflight trust-array oversized precedes active reflection (131.619802ms)
✖ native byte/descriptor preflight trust-entry getter precedes active reflection (129.615557ms)
✖ native byte/descriptor preflight trust-entry proxy precedes active reflection (130.900477ms)
✖ native byte/descriptor preflight trust-entry extra-key precedes active reflection (126.571683ms)
✖ native byte/descriptor preflight trust-entry oversized precedes active reflection (134.08347ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (121.722104ms)
ℹ tests 53
ℹ suites 0
ℹ pass 36
ℹ fail 17
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7984.161205

✖ failing tests:

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses signature-pad-bits (129.526973ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses key-trailing-bytes (131.92313ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses key-leading-junk (126.081733ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation getter precedes active reflection (128.098648ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  4 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:540:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation proxy precedes active reflection (132.114739ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  26 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:540:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 26,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation extra-key precedes active reflection (126.266182ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:545:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation oversized precedes active reflection (149.982109ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:545:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight request getter precedes active reflection (132.388712ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  6 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:540:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 6,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight request proxy precedes active reflection (127.429788ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  114 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:540:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 114,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array getter precedes active reflection (126.120673ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  2 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:540:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array proxy precedes active reflection (128.120942ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  8 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:540:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 8,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array extra-key precedes active reflection (130.017805ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:545:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array oversized precedes active reflection (131.619802ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:545:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry getter precedes active reflection (129.615557ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  2 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:540:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry proxy precedes active reflection (130.900477ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  4 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:540:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry extra-key precedes active reflection (126.571683ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:545:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry oversized precedes active reflection (134.08347ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:545:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

```

### maintenance-authority-typecheck-first.log

Bytes: 105; SHA-256: `0bba046d918eb434853053e40773006f4a4d16b7ef35b5984407aa0ef73c256b`.

```text
tests/restore-native-maintenance-authority-boundary.test.ts(111,23): error TS2304: Cannot find name 'F'.

```

### maintenance-authority-final-red.log

Bytes: 25242; SHA-256: `de05c34974db526647e259ccc3bdc8380786f829e17697ed93b4de9b5c4f67dd`.

```text
✔ native historical projection accepts fresh canonical signed association without writes or hold release (193.686486ms)
✔ native exact signed request refuses substituted orgId (129.321064ms)
✔ native exact signed request refuses substituted projection (128.311498ms)
✔ native exact signed request refuses substituted recordId (132.023439ms)
✔ native exact signed request refuses substituted nativePrincipalId (128.084605ms)
✔ native exact signed request refuses substituted externalAuthorityId (130.430609ms)
✔ native exact signed request refuses substituted purpose (129.195918ms)
✔ native exact signed request refuses substituted challenge (132.156027ms)
✔ native exact signed request refuses substituted generation (144.444513ms)
✔ native signed recovery generation refuses changed snapshotHash (133.251284ms)
✔ native signed recovery generation refuses changed restoredAt (135.921626ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (133.097466ms)
✔ native replay cannot reuse prior valid target/challenge (134.037978ms)
✔ native current trust revocation during observation wins (127.415996ms)
✔ native configuration replacement during observation refuses old grant (125.453198ms)
✔ native current clock refuses expiry (128.894201ms)
✔ native current clock refuses rollback (124.352433ms)
✔ native current clock refuses future (130.173795ms)
✔ native current clock refuses too-long (130.649109ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (140.117411ms)
✔ native copied principal loses role authority in current same-writer snapshot (139.437382ms)
✔ native copied principal loses site authority in current same-writer snapshot (140.22956ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (136.494954ms)
✔ native copied principal loses current password authority in current same-writer snapshot (140.21662ms)
✔ native small-order trusted key forgery refused 01000000-00 (127.108897ms)
✔ native small-order trusted key forgery refused c7176a70-7a (143.092228ms)
✔ native small-order trusted key forgery refused 00000000-80 (132.062781ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (124.431102ms)
✔ native small-order trusted key forgery refused ecffffff-7f (127.970955ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (127.678553ms)
✔ native small-order trusted key forgery refused 00000000-00 (126.225876ms)
✔ native small-order trusted key forgery refused c7176a70-fa (131.787134ms)
✔ native canonical Ed25519 encoding refuses scalar (164.867323ms)
✖ native canonical Ed25519 encoding refuses signature-pad-bits (139.017958ms)
✖ native canonical Ed25519 encoding refuses key-trailing-bytes (128.829484ms)
✖ native canonical Ed25519 encoding refuses key-leading-junk (134.587627ms)
✖ native byte/descriptor preflight observation getter precedes active reflection (134.862402ms)
✖ native byte/descriptor preflight observation proxy precedes active reflection (131.706824ms)
✖ native byte/descriptor preflight observation extra-key precedes active reflection (132.74334ms)
✖ native byte/descriptor preflight observation oversized precedes active reflection (149.418316ms)
✖ native byte/descriptor preflight request getter precedes active reflection (134.570812ms)
✖ native byte/descriptor preflight request proxy precedes active reflection (130.290194ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (116.349069ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (125.080712ms)
✖ native byte/descriptor preflight trust-array getter precedes active reflection (128.449713ms)
✖ native byte/descriptor preflight trust-array proxy precedes active reflection (123.888581ms)
✖ native byte/descriptor preflight trust-array extra-key precedes active reflection (125.123487ms)
✖ native byte/descriptor preflight trust-array oversized precedes active reflection (131.225737ms)
✖ native byte/descriptor preflight trust-entry getter precedes active reflection (123.275194ms)
✖ native byte/descriptor preflight trust-entry proxy precedes active reflection (130.137624ms)
✖ native byte/descriptor preflight trust-entry extra-key precedes active reflection (133.654657ms)
✖ native byte/descriptor preflight trust-entry oversized precedes active reflection (125.07318ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (130.679232ms)
✔ native explicit composition refuses duplicate-mapping (120.908238ms)
✔ native explicit composition refuses foreign-principal (115.640468ms)
✔ native explicit composition refuses missing-mapping (118.238524ms)
✔ native independently current cryptographic authority refuses invalid-signature (119.975949ms)
✔ native independently current cryptographic authority refuses truncated-signature (115.37043ms)
✔ native independently current cryptographic authority refuses duplicate-trust (117.866121ms)
✔ native independently current cryptographic authority refuses changed-key (120.436065ms)
✖ native observation rejects hidden symbol key (130.723402ms)
✖ native observation rejects hidden nonenumerable key (125.440415ms)
✔ native oversized associationId refuses before trusted-key getter (118.061059ms)
✔ native oversized signature refuses before trusted-key getter (125.990762ms)
ℹ tests 64
ℹ suites 0
ℹ pass 45
ℹ fail 19
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9191.216733

✖ failing tests:

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses signature-pad-bits (139.017958ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses key-trailing-bytes (128.829484ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses key-leading-junk (134.587627ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation getter precedes active reflection (134.862402ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  4 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation proxy precedes active reflection (131.706824ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  26 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 26,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation extra-key precedes active reflection (132.74334ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation oversized precedes active reflection (149.418316ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight request getter precedes active reflection (134.570812ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  4 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight request proxy precedes active reflection (130.290194ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  76 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 76,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array getter precedes active reflection (128.449713ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  2 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array proxy precedes active reflection (123.888581ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  8 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 8,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array extra-key precedes active reflection (125.123487ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array oversized precedes active reflection (131.225737ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry getter precedes active reflection (123.275194ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  2 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry proxy precedes active reflection (130.137624ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  4 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry extra-key precedes active reflection (133.654657ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry oversized precedes active reflection (125.07318ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:13429
✖ native observation rejects hidden symbol key (130.723402ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:638:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:13429
✖ native observation rejects hidden nonenumerable key (125.440415ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:638:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

```

### maintenance-authority-baseline.log

Bytes: 6712; SHA-256: `a7498aadd84a6cd83ea64a6c741d190d87f8b59b4acd5e6a33fb4b2943bebc4b`.

```text
✔ native queue CA/CAD/false: real cancellation and settled renewal preserve all owner rows (273.298965ms)
✔ native queue US/USD/true: real cancellation and settled renewal preserve all owner rows (219.46251ms)
✔ native queue CA/USD/true: real cancellation and settled renewal preserve all owner rows (231.072758ms)
✔ native queue canceled Canada Post membership reporting=false (191.534163ms)
✔ native queue canceled Canada Post membership reporting=true (161.9488ms)
✔ native queue defaults closed without native/external association; dossier-style IDs cannot supply one (89.618191ms)
✔ native queue always requires the existing writer transaction (156.725511ms)
✔ native queue fresh association rejects revocation, cached grants, changed binding and ambiguous mappings (178.820433ms)
✔ native queue repeats IAM role, site, password and tenant checks under the same transaction (250.877621ms)
✔ native queue checks current finance role/password rather than copied grant (216.832369ms)
✔ native queue pending successor remains independent (unknown=false) (198.068967ms)
✔ native queue pending successor remains independent (unknown=true) (202.278838ms)
✔ native queue canceled group does not settle its ordinary pending booking (143.032085ms)
✔ native queue malformed/duplicate/missing receipt or changed cancellation/renewal/binding is unresolved (412.412422ms)
✔ native queue Canada Post complete receipt/member/group corruption cannot project (232.491601ms)
✔ native queue faulty maintenance callback cannot mutate owner history inside its transaction (153.552002ms)
✔ native queue current snapshot sees uncommitted receipt damage and rolls back (209.526755ms)
✖ full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review (146.91055ms)
✖ full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority (195.72113ms)
✔ native queue current configuration withdrawal during observation refuses retained grant (144.509283ms)
✔ native queue preserves every independent callback, journal, auth, revocation and read/poll claim blocker (212.295267ms)
✔ native queue complete history scans cannot hide an extra blocked effect or ambiguous late receipt (243.796734ms)
✖ full restore: historical dispositions preserve dossier evidence and release signatures through activation (198.888166ms)
✔ native queue ordinary terminal store needs no historical maintenance grant (67.775417ms)
✔ native queue rejects and rolls back a callback-created independent claim after its initial scan (164.799487ms)
✔ native queue preliminary eligibility refuses unrelated blocked stripe intent before authority (129.857491ms)
✔ native queue preliminary eligibility refuses unrelated blocked quickbooks intent before authority (132.835181ms)
✔ native queue preliminary eligibility requires the exact owning org/effect identity (263.688396ms)
✔ native queue preliminary eligibility never substitutes for current authority or complete evidence (216.029672ms)
ℹ tests 29
ℹ suites 0
ℹ pass 26
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6652.689811

✖ failing tests:

test at tests/restore-native-dispositions.test.ts:1:22348
✖ full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review (146.91055ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at restoreSetup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:260:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:1013:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-native-dispositions.test.ts:1:22933
✖ full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority (195.72113ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at restoreSetup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:260:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:1032:7)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-native-dispositions.test.ts:1:28228
✖ full restore: historical dispositions preserve dossier evidence and release signatures through activation (198.888166ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at restoreSetup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:260:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:1289:7)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

```

### maintenance-authority-typecheck-final.log

Bytes: 0; SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### maintenance-authority-delivery-red.log

Bytes: 25902; SHA-256: `674809f15637d9163218b088c1e6b8715ecc3bd2aa1fa924a74a7267021afc50`.

```text
✔ native historical projection accepts fresh canonical signed association without writes or hold release (182.705237ms)
✔ native exact signed request refuses substituted orgId (127.165878ms)
✔ native exact signed request refuses substituted projection (125.341271ms)
✔ native exact signed request refuses substituted recordId (125.004382ms)
✔ native exact signed request refuses substituted nativePrincipalId (122.062786ms)
✔ native exact signed request refuses substituted externalAuthorityId (120.645936ms)
✔ native exact signed request refuses substituted purpose (119.743171ms)
✔ native exact signed request refuses substituted challenge (138.938281ms)
✔ native exact signed request refuses substituted generation (140.890426ms)
✔ native signed recovery generation refuses changed snapshotHash (128.243138ms)
✔ native signed recovery generation refuses changed restoredAt (148.343735ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (122.823587ms)
✔ native replay cannot reuse prior valid target/challenge (133.308833ms)
✔ native current trust revocation during observation wins (137.018519ms)
✔ native configuration replacement during observation refuses old grant (123.051971ms)
✔ native current clock refuses expiry (128.381491ms)
✔ native current clock refuses rollback (122.131611ms)
✔ native current clock refuses future (126.097114ms)
✔ native current clock refuses too-long (123.063709ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (137.929486ms)
✔ native copied principal loses role authority in current same-writer snapshot (144.129576ms)
✔ native copied principal loses site authority in current same-writer snapshot (149.131391ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (140.879164ms)
✔ native copied principal loses current password authority in current same-writer snapshot (137.306615ms)
✔ native small-order trusted key forgery refused 01000000-00 (119.365189ms)
✔ native small-order trusted key forgery refused c7176a70-7a (121.611775ms)
✔ native small-order trusted key forgery refused 00000000-80 (119.600495ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (119.47512ms)
✔ native small-order trusted key forgery refused ecffffff-7f (119.180731ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (119.598593ms)
✔ native small-order trusted key forgery refused 00000000-00 (132.690298ms)
✔ native small-order trusted key forgery refused c7176a70-fa (129.188065ms)
✔ native canonical Ed25519 encoding refuses scalar (125.530848ms)
✖ native canonical Ed25519 encoding refuses signature-pad-bits (141.186849ms)
✖ native canonical Ed25519 encoding refuses key-trailing-bytes (131.135148ms)
✖ native canonical Ed25519 encoding refuses key-leading-junk (130.964179ms)
✖ native byte/descriptor preflight observation getter precedes active reflection (134.235654ms)
✖ native byte/descriptor preflight observation proxy precedes active reflection (131.634773ms)
✖ native byte/descriptor preflight observation extra-key precedes active reflection (136.23196ms)
✖ native byte/descriptor preflight observation oversized precedes active reflection (147.156871ms)
✖ native byte/descriptor preflight request getter precedes active reflection (140.642437ms)
✖ native byte/descriptor preflight request proxy precedes active reflection (132.808347ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (122.987944ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (128.390479ms)
✖ native byte/descriptor preflight trust-array getter precedes active reflection (141.190194ms)
✖ native byte/descriptor preflight trust-array proxy precedes active reflection (129.473466ms)
✖ native byte/descriptor preflight trust-array extra-key precedes active reflection (139.184032ms)
✖ native byte/descriptor preflight trust-array oversized precedes active reflection (139.99665ms)
✖ native byte/descriptor preflight trust-entry getter precedes active reflection (131.463394ms)
✖ native byte/descriptor preflight trust-entry proxy precedes active reflection (146.15059ms)
✖ native byte/descriptor preflight trust-entry extra-key precedes active reflection (168.658607ms)
✖ native byte/descriptor preflight trust-entry oversized precedes active reflection (130.120745ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (135.270623ms)
✔ native explicit composition refuses duplicate-mapping (128.75637ms)
✔ native explicit composition refuses foreign-principal (123.889381ms)
✔ native explicit composition refuses missing-mapping (128.45252ms)
✔ native independently current cryptographic authority refuses invalid-signature (136.91983ms)
✔ native independently current cryptographic authority refuses truncated-signature (123.950564ms)
✔ native independently current cryptographic authority refuses duplicate-trust (127.979464ms)
✔ native independently current cryptographic authority refuses changed-key (127.800763ms)
✖ native observation rejects hidden symbol key (134.510402ms)
✖ native observation rejects hidden nonenumerable key (132.021144ms)
✔ native oversized associationId refuses before trusted-key getter (130.748206ms)
✔ native oversized signature refuses before trusted-key getter (130.009617ms)
✔ native signature R small-order substitution refused 01000000-00 (130.223482ms)
✔ native signature R small-order substitution refused c7176a70-7a (126.672975ms)
✔ native signature R small-order substitution refused 00000000-80 (144.014573ms)
✔ native signature R small-order substitution refused 26e8958f-05 (146.82699ms)
✔ native signature R small-order substitution refused ecffffff-7f (129.614079ms)
✔ native signature R small-order substitution refused 26e8958f-85 (125.591858ms)
✔ native signature R small-order substitution refused 00000000-00 (141.149154ms)
✔ native signature R small-order substitution refused c7176a70-fa (134.27131ms)
ℹ tests 72
ℹ suites 0
ℹ pass 53
ℹ fail 19
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10386.027017

✖ failing tests:

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses signature-pad-bits (141.186849ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses key-trailing-bytes (131.135148ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:9161
✖ native canonical Ed25519 encoding refuses key-leading-junk (130.964179ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:452:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation getter precedes active reflection (134.235654ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  4 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation proxy precedes active reflection (131.634773ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  26 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 26,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation extra-key precedes active reflection (136.23196ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight observation oversized precedes active reflection (147.156871ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight request getter precedes active reflection (140.642437ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  4 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight request proxy precedes active reflection (132.808347ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  76 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 76,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array getter precedes active reflection (141.190194ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  2 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array proxy precedes active reflection (129.473466ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  8 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 8,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array extra-key precedes active reflection (139.184032ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-array oversized precedes active reflection (139.99665ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry getter precedes active reflection (131.463394ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  2 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry proxy precedes active reflection (146.15059ms)
  AssertionError [ERR_ASSERTION]: hostile descriptors/proxies must be refused before active reflection/signature processing

  4 !== 0

      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:546:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry extra-key precedes active reflection (168.658607ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:10119
✖ native byte/descriptor preflight trust-entry oversized precedes active reflection (130.120745ms)
  AssertionError [ERR_ASSERTION]: malformed/oversized external authority input must fail closed
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:551:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:13429
✖ native observation rejects hidden symbol key (134.510402ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:638:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:13429
✖ native observation rejects hidden nonenumerable key (132.021144ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:638:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

```

## Incremental production repair receipt — 2026-10-03

The preceding sections/logs are retained historical red evidence. This new owner-authorized repair is incremental against exact excluded `b0add58029bfe361f5f1bcaf5b475513cd5f296c`; the earlier `1207c819` base and its two-file patch are NOT part of this delivery. Owned delta: existing `src/server/restore-activation.ts`, ONE new private `src/server/restore-native-maintenance-verifier.ts`, appended boundary tests and this appended report. No Database/storage, Integration reader, Platform reader, carrier/raw-hold, schema/profile/application, offline approval source/tests or other existing file is changed. No push, remote CI/runner, PR, deployment, secrets/account/provider IO, nested session, polling routine or automation. No subscription was created and none remains to remove. Effective Astra/High remains unverified: the runtime does not expose those settings.

### Root's separately supplied platform evidence

Root reports replay of the unchanged original 72 tests against published `27a81cc` plus the b0add580 delta on Darwin: all 19 Linux red failures reproduce, plus trusted identity-point forgery `01000000-00` is accepted. Root retained private original log SHA-256 `98339029d4d0c8c8dfbcbbdddb0b213b64c4238b1e6a4d77cb444924ae7c92e7`. This is root-supplied evidence, not a Darwin run performed by this cloud lane; the private original log is not available here and is not fabricated. Linux/OpenSSL 3.5.7 had refused those weak-point forgeries. Root must replay the repair on Darwin/current combined tree before claiming that platform result.

The root's later coordination note confirms separate prime-subgroup repair of root-owned restore-offline-approvals.ts/tests. This lane deliberately does not touch those files or assume that root repair is in this excluded cloud base.

### Repair and preserved constraints

`configureNativeDispositions` now withdraws prior configuration BEFORE capturing a replacement. A rejected replacement, even if its exception is caught inside observation, cannot retain an old in-flight association. Only exact plain own enumerable data descriptors are copied; functions are captured from data descriptors, proxies refused and invocation uses Reflect.apply without reading an attacker-controlled bind property. The mappings and full Actor/sites payload are bounded/copied; matching duplicate mappings still refuse at existing exact target selection before observe, preserving original behavior/assertions.

`nativeAuthority` first captures the full observation/request/generation recursively, including exact keys, IDs, purpose, UUID-v4 challenge, target hash and canonical native timestamps. No callback-owned object reaches canonical(), property destructuring or signature work. Null prototypes are allowed; other prototypes, getters, proxies (normal/revoked), symbol/nonenumerable/extra fields, sparse arrays and oversized fields refuse with RESTORE_MAINTENANCE_AUTHORITY.

Current trust is loaded AFTER observation, preserving revocation dominance. The entire dense trust roster passes bounded descriptor/UTF-8/PEM/duplicate-ID/duplicate-key preflight before ANY key import. All roster keys, including unrelated ones, then pass strict key/point validation. Limit is 256 entries (same engineering bound as the existing offline approval roster); mappings and site arrays share that finite limit. Identity fields are at most 160 UTF-8 bytes/160 code units and disallow control/unpaired surrogate characters. Hashes are exactly 64 lowercase hexadecimal characters, timestamps canonical 24-character native ISO strings, keys exactly 113 ASCII PEM bytes/44 canonical SPKI DER bytes, signatures exactly 88 canonical base64 characters/64 bytes. Those exact recursive limits bound the signed message; there is no post-serialization size check or unbounded key import preceding roster preflight.

The private helper copies the existing offline verifier's RFC 8032 field arithmetic, canonical point/scalar/SPKI/base64 checks. It retains [8]P nonidentity and adds fixed-scalar [L]P identity using RFC 8032 extended-coordinate addition (253 fixed bits). This rejects mixed-torsion points as well as all eight small-order points independently of host OpenSSL. The addition is private public-point validation, not a new signing scheme, general exposed crypto facility or replacement signature equation. Strong canonical keys and signatures still use OpenSSL for the final signature equation. No existing offline crypto algorithm/source is edited.

The first clock still checks observation freshness before current trust. The second sample is now taken AFTER bounded trust/key/signature work, so expiry/rollback during that work refuses. Configuration identity and fresh current native IAM organization/account/role/password checks remain after external proof; owning module site checks and same-writer no-write/hold guards remain intact. This permits only historical read-only projection; it grants no release, live IO, claim retirement or provider truth.

### Verification and preserved red-to-green history

Original 72-test file prefix is exactly unchanged: 20,366 bytes SHA-256 `aa425097bc27f60c110b5c90f4fe43e67fe3f6c8340086e5288b2fd85bb345f4`. New tests are append-only; original 19 Linux red logs above remain unchanged, as does the root-supplied Darwin failure note. The initial repair passes 72/72 with original assertions intact. Added cases first produce eight failures (88/96): six malformed-replacement cases, caught reconfiguration and an unrelated weak roster key. These meaningful assertions are preserved; withdrawing configuration before capture and validating all roster points repair them (96/96).

The final package adds 29 focused cases and passes **101/101**, zero failures/cancellations/skips/todo, exit 0, 15,826.694102 ms. Added coverage includes malformed/revoked configuration/callback proxies, recursive generation getters/proxies/hidden keys, trust sparse/foreign-prototype/hidden/symbol/UTF-8/duplicate-key/unrelated-weak inputs, 256-entry acceptance and 257-entry refusal before entry reflection, exact 160-byte Unicode association acceptance, expiry/configuration change during trust reload, full-roster descriptor capture before key import, and prime-subgroup validation before even permissive host crypto. Seven mixed-subgroup test vectors were independently computed with Python affine RFC 8032 addition of the standard base point and each nonidentity torsion vector. The native historical projection remains the entry point in every new case. Crypto sentinel tests intentionally mock only host verify/createPublicKey and require zero invocations; they do not mock an authority validator or the projection. All original 72 and ordinary valid-signature tests use real crypto.

| Foreground command                                                                                           | Actual result                                                 |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `node --import tsx --test tests/restore-native-maintenance-authority-boundary.test.ts` initial repair        | exit 0; 72/72                                                 |
| same command after first appended tests                                                                      | exit 1; 88/96, eight retained failures                        |
| same command after targeted fixes                                                                            | exit 0; 96/96                                                 |
| same command with subgroup/clock sentinels                                                                   | exit 0; 100/100                                               |
| same command final delivery test input                                                                       | exit 0; 101/101                                               |
| `node --import tsx --test tests/restore-native-dispositions.test.ts tests/restore-offline-approvals.test.ts` | exit 1; 45/48, zero skips/cancellations/todo; 7,238.186973 ms |
| `tsc --noEmit` first and final                                                                               | exit 0                                                        |
| `prettier --check` all four owned files                                                                      | exit 0                                                        |
| `git diff --check`                                                                                           | exit 0                                                        |

Comparator breakdown: unchanged native dispositions **26/29** and unchanged offline approvals **19/19**. The same three full restore cases fail at candidate capture with RESTORE_REVIEW_CHANGED / Candidate files changed during inspection before reaching this repair, matching the original excluded-base environment failures. No assertion skipped, fixture capture gate weakened or unrelated candidate-source repair made. Node v24.19.0/OpenSSL 3.5.7/Linux x64/UID 0 and the same existing read-only dependency installation are used; the temporary node_modules symlink is excluded and removed before commit. No full suite/browser/isolated install/production or qualified external authority proof is claimed. Combined-root/Darwin replay remains pending.

Self-review checked capture-before-active-reflection, complete-roster-before-import ordering, all point/scalar ranges, fixed loop bounds, canonical bytes, captured callback/mapping separation, rejected-replacement withdrawal, late trust revocation/configuration/time changes, original target binding and native authority, owning row conservation and recovery hold. No schema, dependency, external trust policy/infrastructure or release rights introduced. The 256-entry and UTF-8 bounds are explicit engineering input contracts rather than qualified production throughput limits.

### Incremental retained receipts

Original UTF-8 log byte counts/SHA-256 precede each verbatim receipt. Final typecheck output is empty. Test/source hashes bind the final delivery input before report-only append/format; no source/test change follows verification.

#### maintenance-repair-first.log

Bytes: 6241; SHA-256: `be79ed0b475ef703cb72b64695da1a0d05cec50700fb90c86b77bb10a8a20136`.

```text
✔ native historical projection accepts fresh canonical signed association without writes or hold release (182.399864ms)
✔ native exact signed request refuses substituted orgId (124.924015ms)
✔ native exact signed request refuses substituted projection (120.104663ms)
✔ native exact signed request refuses substituted recordId (123.885388ms)
✔ native exact signed request refuses substituted nativePrincipalId (125.172451ms)
✔ native exact signed request refuses substituted externalAuthorityId (122.40845ms)
✔ native exact signed request refuses substituted purpose (123.492996ms)
✔ native exact signed request refuses substituted challenge (118.464727ms)
✔ native exact signed request refuses substituted generation (121.9186ms)
✔ native signed recovery generation refuses changed snapshotHash (122.577534ms)
✔ native signed recovery generation refuses changed restoredAt (119.15609ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (121.543715ms)
✔ native replay cannot reuse prior valid target/challenge (134.631475ms)
✔ native current trust revocation during observation wins (120.331044ms)
✔ native configuration replacement during observation refuses old grant (130.973275ms)
✔ native current clock refuses expiry (131.596926ms)
✔ native current clock refuses rollback (130.862237ms)
✔ native current clock refuses future (125.987901ms)
✔ native current clock refuses too-long (127.068652ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (146.588645ms)
✔ native copied principal loses role authority in current same-writer snapshot (157.424813ms)
✔ native copied principal loses site authority in current same-writer snapshot (145.352264ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (169.488934ms)
✔ native copied principal loses current password authority in current same-writer snapshot (155.385272ms)
✔ native small-order trusted key forgery refused 01000000-00 (124.751699ms)
✔ native small-order trusted key forgery refused c7176a70-7a (122.993296ms)
✔ native small-order trusted key forgery refused 00000000-80 (129.472333ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (122.649117ms)
✔ native small-order trusted key forgery refused ecffffff-7f (124.104042ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (127.789302ms)
✔ native small-order trusted key forgery refused 00000000-00 (126.785929ms)
✔ native small-order trusted key forgery refused c7176a70-fa (123.010682ms)
✔ native canonical Ed25519 encoding refuses scalar (121.029132ms)
✔ native canonical Ed25519 encoding refuses signature-pad-bits (127.669601ms)
✔ native canonical Ed25519 encoding refuses key-trailing-bytes (119.651173ms)
✔ native canonical Ed25519 encoding refuses key-leading-junk (120.098628ms)
✔ native byte/descriptor preflight observation getter precedes active reflection (125.602213ms)
✔ native byte/descriptor preflight observation proxy precedes active reflection (122.432199ms)
✔ native byte/descriptor preflight observation extra-key precedes active reflection (123.973574ms)
✔ native byte/descriptor preflight observation oversized precedes active reflection (127.632786ms)
✔ native byte/descriptor preflight request getter precedes active reflection (124.315972ms)
✔ native byte/descriptor preflight request proxy precedes active reflection (123.210484ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (121.496657ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (128.939709ms)
✔ native byte/descriptor preflight trust-array getter precedes active reflection (119.535258ms)
✔ native byte/descriptor preflight trust-array proxy precedes active reflection (118.851776ms)
✔ native byte/descriptor preflight trust-array extra-key precedes active reflection (125.019944ms)
✔ native byte/descriptor preflight trust-array oversized precedes active reflection (118.857064ms)
✔ native byte/descriptor preflight trust-entry getter precedes active reflection (124.552839ms)
✔ native byte/descriptor preflight trust-entry proxy precedes active reflection (124.390494ms)
✔ native byte/descriptor preflight trust-entry extra-key precedes active reflection (118.117709ms)
✔ native byte/descriptor preflight trust-entry oversized precedes active reflection (118.230228ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (132.369153ms)
✔ native explicit composition refuses duplicate-mapping (116.979792ms)
✔ native explicit composition refuses foreign-principal (117.147826ms)
✔ native explicit composition refuses missing-mapping (120.830803ms)
✔ native independently current cryptographic authority refuses invalid-signature (121.999356ms)
✔ native independently current cryptographic authority refuses truncated-signature (131.381843ms)
✔ native independently current cryptographic authority refuses duplicate-trust (123.251726ms)
✔ native independently current cryptographic authority refuses changed-key (130.356787ms)
✔ native observation rejects hidden symbol key (115.482513ms)
✔ native observation rejects hidden nonenumerable key (115.866472ms)
✔ native oversized associationId refuses before trusted-key getter (122.812033ms)
✔ native oversized signature refuses before trusted-key getter (121.953877ms)
✔ native signature R small-order substitution refused 01000000-00 (122.373901ms)
✔ native signature R small-order substitution refused c7176a70-7a (122.852785ms)
✔ native signature R small-order substitution refused 00000000-80 (131.971693ms)
✔ native signature R small-order substitution refused 26e8958f-05 (117.815964ms)
✔ native signature R small-order substitution refused ecffffff-7f (118.414858ms)
✔ native signature R small-order substitution refused 26e8958f-85 (120.004065ms)
✔ native signature R small-order substitution refused 00000000-00 (119.594077ms)
✔ native signature R small-order substitution refused c7176a70-fa (120.816451ms)
ℹ tests 72
ℹ suites 0
ℹ pass 72
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9961.688598

```

#### maintenance-repair-typecheck-first.log

Bytes: 0; SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

#### maintenance-repair-added-red.log

Bytes: 17514; SHA-256: `e72733f9d4e0ddd63240a9fd11dba4a2ed542fe44bae2c084d170ce766bc5600`.

```text
✔ native historical projection accepts fresh canonical signed association without writes or hold release (185.255053ms)
✔ native exact signed request refuses substituted orgId (137.331605ms)
✔ native exact signed request refuses substituted projection (123.999467ms)
✔ native exact signed request refuses substituted recordId (124.957522ms)
✔ native exact signed request refuses substituted nativePrincipalId (121.696312ms)
✔ native exact signed request refuses substituted externalAuthorityId (124.440813ms)
✔ native exact signed request refuses substituted purpose (121.259783ms)
✔ native exact signed request refuses substituted challenge (118.997216ms)
✔ native exact signed request refuses substituted generation (121.421995ms)
✔ native signed recovery generation refuses changed snapshotHash (122.754384ms)
✔ native signed recovery generation refuses changed restoredAt (122.921407ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (121.284108ms)
✔ native replay cannot reuse prior valid target/challenge (127.726088ms)
✔ native current trust revocation during observation wins (116.598208ms)
✔ native configuration replacement during observation refuses old grant (130.214043ms)
✔ native current clock refuses expiry (128.194626ms)
✔ native current clock refuses rollback (123.614816ms)
✔ native current clock refuses future (122.343226ms)
✔ native current clock refuses too-long (125.10238ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (141.308955ms)
✔ native copied principal loses role authority in current same-writer snapshot (143.713103ms)
✔ native copied principal loses site authority in current same-writer snapshot (140.025357ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (142.391609ms)
✔ native copied principal loses current password authority in current same-writer snapshot (144.120558ms)
✔ native small-order trusted key forgery refused 01000000-00 (120.355848ms)
✔ native small-order trusted key forgery refused c7176a70-7a (124.66516ms)
✔ native small-order trusted key forgery refused 00000000-80 (124.368903ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (115.177133ms)
✔ native small-order trusted key forgery refused ecffffff-7f (117.26225ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (120.352803ms)
✔ native small-order trusted key forgery refused 00000000-00 (119.531875ms)
✔ native small-order trusted key forgery refused c7176a70-fa (116.808184ms)
✔ native canonical Ed25519 encoding refuses scalar (122.473313ms)
✔ native canonical Ed25519 encoding refuses signature-pad-bits (121.078698ms)
✔ native canonical Ed25519 encoding refuses key-trailing-bytes (120.319243ms)
✔ native canonical Ed25519 encoding refuses key-leading-junk (120.043606ms)
✔ native byte/descriptor preflight observation getter precedes active reflection (125.55934ms)
✔ native byte/descriptor preflight observation proxy precedes active reflection (117.79268ms)
✔ native byte/descriptor preflight observation extra-key precedes active reflection (118.220807ms)
✔ native byte/descriptor preflight observation oversized precedes active reflection (125.541733ms)
✔ native byte/descriptor preflight request getter precedes active reflection (130.987751ms)
✔ native byte/descriptor preflight request proxy precedes active reflection (117.87826ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (122.423788ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (127.994374ms)
✔ native byte/descriptor preflight trust-array getter precedes active reflection (117.445317ms)
✔ native byte/descriptor preflight trust-array proxy precedes active reflection (117.013004ms)
✔ native byte/descriptor preflight trust-array extra-key precedes active reflection (120.186192ms)
✔ native byte/descriptor preflight trust-array oversized precedes active reflection (118.4814ms)
✔ native byte/descriptor preflight trust-entry getter precedes active reflection (122.481275ms)
✔ native byte/descriptor preflight trust-entry proxy precedes active reflection (123.282283ms)
✔ native byte/descriptor preflight trust-entry extra-key precedes active reflection (117.60049ms)
✔ native byte/descriptor preflight trust-entry oversized precedes active reflection (121.689966ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (135.760652ms)
✔ native explicit composition refuses duplicate-mapping (128.62844ms)
✔ native explicit composition refuses foreign-principal (122.586173ms)
✔ native explicit composition refuses missing-mapping (134.935808ms)
✔ native independently current cryptographic authority refuses invalid-signature (125.935398ms)
✔ native independently current cryptographic authority refuses truncated-signature (134.397676ms)
✔ native independently current cryptographic authority refuses duplicate-trust (130.837915ms)
✔ native independently current cryptographic authority refuses changed-key (138.666347ms)
✔ native observation rejects hidden symbol key (121.889122ms)
✔ native observation rejects hidden nonenumerable key (126.750907ms)
✔ native oversized associationId refuses before trusted-key getter (127.557144ms)
✔ native oversized signature refuses before trusted-key getter (128.403111ms)
✔ native signature R small-order substitution refused 01000000-00 (132.638993ms)
✔ native signature R small-order substitution refused c7176a70-7a (129.722311ms)
✔ native signature R small-order substitution refused 00000000-80 (141.203254ms)
✔ native signature R small-order substitution refused 26e8958f-05 (120.929023ms)
✔ native signature R small-order substitution refused ecffffff-7f (124.762587ms)
✔ native signature R small-order substitution refused 26e8958f-85 (124.308943ms)
✔ native signature R small-order substitution refused 00000000-00 (127.495371ms)
✔ native signature R small-order substitution refused c7176a70-fa (125.397465ms)
✖ native malformed configuration withdraws old mapping without reflecting getter (152.987286ms)
✖ native malformed configuration withdraws old mapping without reflecting proxy (137.021385ms)
✖ native malformed configuration withdraws old mapping without reflecting revoked-proxy (142.00853ms)
✖ native malformed configuration withdraws old mapping without reflecting mapping-getter (140.320686ms)
✖ native malformed configuration withdraws old mapping without reflecting sites-getter (147.087236ms)
✖ native malformed configuration withdraws old mapping without reflecting callback-proxy (138.605278ms)
✖ native caught malformed reconfiguration during observe cannot retain old grant (144.110545ms)
✔ native full current trust roster refuses sparse (127.651841ms)
✔ native full current trust roster refuses revoked-proxy (136.53253ms)
✔ native full current trust roster refuses prototype (124.120213ms)
✔ native full current trust roster refuses hidden-key (129.116361ms)
✔ native full current trust roster refuses symbol-key (127.379891ms)
✔ native full current trust roster refuses unicode-id (128.37316ms)
✔ native full current trust roster refuses duplicate-key (128.51918ms)
✖ native full current trust roster refuses unrelated-weak-key (147.992412ms)
✔ native recursive bounded association preflight refuses generation-getter (121.949448ms)
✔ native recursive bounded association preflight refuses generation-proxy (122.2561ms)
✔ native recursive bounded association preflight refuses generation-hidden (127.340151ms)
✔ native recursive bounded association preflight refuses association-utf8 (124.466586ms)
✔ native recursive bounded association preflight refuses request-utf8 (127.787175ms)
✔ native recursive bounded association preflight refuses prototype (126.819596ms)
✔ native complete 256-key trust roster accepts canonical current signer at final position (158.633357ms)
✔ native 257-entry trust roster refuses before reading any entry descriptor (121.128138ms)
✔ native exact 160-byte UTF8 association identity remains accepted (140.804746ms)
ℹ tests 96
ℹ suites 0
ℹ pass 88
ℹ fail 8
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13180.992812

✖ failing tests:

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:14532
✖ native malformed configuration withdraws old mapping without reflecting getter (152.987286ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:762:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:14532
✖ native malformed configuration withdraws old mapping without reflecting proxy (137.021385ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:762:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:14532
✖ native malformed configuration withdraws old mapping without reflecting revoked-proxy (142.00853ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:762:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:14532
✖ native malformed configuration withdraws old mapping without reflecting mapping-getter (140.320686ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:762:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:14532
✖ native malformed configuration withdraws old mapping without reflecting sites-getter (147.087236ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:762:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:14532
✖ native malformed configuration withdraws old mapping without reflecting callback-proxy (138.605278ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:762:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:15756
✖ native caught malformed reconfiguration during observe cannot retain old grant (144.110545ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:780:5)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/restore-native-maintenance-authority-boundary.test.ts:1:16169
✖ native full current trust roster refuses unrelated-weak-key (147.992412ms)
  AssertionError [ERR_ASSERTION]: actual native historical projection must refuse this authority input
      at Object.refuse (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:228:12)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-maintenance-authority-boundary.test.ts:843:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

```

#### maintenance-repair-expanded-green.log

Bytes: 8354; SHA-256: `1ce43099a9128811b2dd47da397a03a9183d1a1a8c661750b409d2309a1a9a30`.

```text
✔ native historical projection accepts fresh canonical signed association without writes or hold release (194.268049ms)
✔ native exact signed request refuses substituted orgId (134.914141ms)
✔ native exact signed request refuses substituted projection (124.096088ms)
✔ native exact signed request refuses substituted recordId (126.033151ms)
✔ native exact signed request refuses substituted nativePrincipalId (124.197751ms)
✔ native exact signed request refuses substituted externalAuthorityId (119.65774ms)
✔ native exact signed request refuses substituted purpose (123.552498ms)
✔ native exact signed request refuses substituted challenge (123.906742ms)
✔ native exact signed request refuses substituted generation (121.111615ms)
✔ native signed recovery generation refuses changed snapshotHash (130.772252ms)
✔ native signed recovery generation refuses changed restoredAt (124.387348ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (126.247654ms)
✔ native replay cannot reuse prior valid target/challenge (135.311851ms)
✔ native current trust revocation during observation wins (128.837272ms)
✔ native configuration replacement during observation refuses old grant (134.903094ms)
✔ native current clock refuses expiry (135.087212ms)
✔ native current clock refuses rollback (127.573635ms)
✔ native current clock refuses future (126.632505ms)
✔ native current clock refuses too-long (132.012968ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (149.282412ms)
✔ native copied principal loses role authority in current same-writer snapshot (148.800754ms)
✔ native copied principal loses site authority in current same-writer snapshot (147.132938ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (174.994758ms)
✔ native copied principal loses current password authority in current same-writer snapshot (185.068097ms)
✔ native small-order trusted key forgery refused 01000000-00 (124.296361ms)
✔ native small-order trusted key forgery refused c7176a70-7a (168.650409ms)
✔ native small-order trusted key forgery refused 00000000-80 (131.342351ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (140.803007ms)
✔ native small-order trusted key forgery refused ecffffff-7f (131.639871ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (129.364597ms)
✔ native small-order trusted key forgery refused 00000000-00 (122.464836ms)
✔ native small-order trusted key forgery refused c7176a70-fa (123.996628ms)
✔ native canonical Ed25519 encoding refuses scalar (126.704945ms)
✔ native canonical Ed25519 encoding refuses signature-pad-bits (128.501795ms)
✔ native canonical Ed25519 encoding refuses key-trailing-bytes (119.913276ms)
✔ native canonical Ed25519 encoding refuses key-leading-junk (134.236338ms)
✔ native byte/descriptor preflight observation getter precedes active reflection (122.629976ms)
✔ native byte/descriptor preflight observation proxy precedes active reflection (117.426034ms)
✔ native byte/descriptor preflight observation extra-key precedes active reflection (119.476377ms)
✔ native byte/descriptor preflight observation oversized precedes active reflection (130.116673ms)
✔ native byte/descriptor preflight request getter precedes active reflection (118.951004ms)
✔ native byte/descriptor preflight request proxy precedes active reflection (120.846304ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (127.360213ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (129.657249ms)
✔ native byte/descriptor preflight trust-array getter precedes active reflection (121.302813ms)
✔ native byte/descriptor preflight trust-array proxy precedes active reflection (122.517446ms)
✔ native byte/descriptor preflight trust-array extra-key precedes active reflection (124.314608ms)
✔ native byte/descriptor preflight trust-array oversized precedes active reflection (120.410577ms)
✔ native byte/descriptor preflight trust-entry getter precedes active reflection (119.518661ms)
✔ native byte/descriptor preflight trust-entry proxy precedes active reflection (124.751827ms)
✔ native byte/descriptor preflight trust-entry extra-key precedes active reflection (117.017647ms)
✔ native byte/descriptor preflight trust-entry oversized precedes active reflection (120.216514ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (133.542681ms)
✔ native explicit composition refuses duplicate-mapping (117.120913ms)
✔ native explicit composition refuses foreign-principal (126.746827ms)
✔ native explicit composition refuses missing-mapping (124.178681ms)
✔ native independently current cryptographic authority refuses invalid-signature (127.319381ms)
✔ native independently current cryptographic authority refuses truncated-signature (135.351174ms)
✔ native independently current cryptographic authority refuses duplicate-trust (128.832373ms)
✔ native independently current cryptographic authority refuses changed-key (133.778968ms)
✔ native observation rejects hidden symbol key (121.221129ms)
✔ native observation rejects hidden nonenumerable key (123.077631ms)
✔ native oversized associationId refuses before trusted-key getter (128.947828ms)
✔ native oversized signature refuses before trusted-key getter (128.462245ms)
✔ native signature R small-order substitution refused 01000000-00 (130.243624ms)
✔ native signature R small-order substitution refused c7176a70-7a (160.427432ms)
✔ native signature R small-order substitution refused 00000000-80 (129.228482ms)
✔ native signature R small-order substitution refused 26e8958f-05 (133.040743ms)
✔ native signature R small-order substitution refused ecffffff-7f (130.727894ms)
✔ native signature R small-order substitution refused 26e8958f-85 (131.409733ms)
✔ native signature R small-order substitution refused 00000000-00 (134.143337ms)
✔ native signature R small-order substitution refused c7176a70-fa (133.353305ms)
✔ native malformed configuration withdraws old mapping without reflecting getter (125.084559ms)
✔ native malformed configuration withdraws old mapping without reflecting proxy (126.043065ms)
✔ native malformed configuration withdraws old mapping without reflecting revoked-proxy (136.460073ms)
✔ native malformed configuration withdraws old mapping without reflecting mapping-getter (125.32439ms)
✔ native malformed configuration withdraws old mapping without reflecting sites-getter (122.216131ms)
✔ native malformed configuration withdraws old mapping without reflecting callback-proxy (126.14569ms)
✔ native caught malformed reconfiguration during observe cannot retain old grant (122.909296ms)
✔ native full current trust roster refuses sparse (121.306237ms)
✔ native full current trust roster refuses revoked-proxy (126.122029ms)
✔ native full current trust roster refuses prototype (124.499811ms)
✔ native full current trust roster refuses hidden-key (123.286376ms)
✔ native full current trust roster refuses symbol-key (123.384162ms)
✔ native full current trust roster refuses unicode-id (127.374594ms)
✔ native full current trust roster refuses duplicate-key (118.42477ms)
✔ native full current trust roster refuses unrelated-weak-key (121.611808ms)
✔ native recursive bounded association preflight refuses generation-getter (119.930903ms)
✔ native recursive bounded association preflight refuses generation-proxy (119.711972ms)
✔ native recursive bounded association preflight refuses generation-hidden (124.830215ms)
✔ native recursive bounded association preflight refuses association-utf8 (135.84144ms)
✔ native recursive bounded association preflight refuses request-utf8 (116.131269ms)
✔ native recursive bounded association preflight refuses prototype (117.277759ms)
✔ native complete 256-key trust roster accepts canonical current signer at final position (1122.388008ms)
✔ native 257-entry trust roster refuses before reading any entry descriptor (119.582698ms)
✔ native exact 160-byte UTF8 association identity remains accepted (136.905615ms)
ℹ tests 96
ℹ suites 0
ℹ pass 96
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14286.058563

```

#### maintenance-repair-final-focused.log

Bytes: 8737; SHA-256: `f582935d39e9cfb1ee4f83f512ba8674cf70fe7ffc3482b9d0eb1e00776688b2`.

```text
✔ native historical projection accepts fresh canonical signed association without writes or hold release (195.906827ms)
✔ native exact signed request refuses substituted orgId (127.443385ms)
✔ native exact signed request refuses substituted projection (121.569341ms)
✔ native exact signed request refuses substituted recordId (125.421985ms)
✔ native exact signed request refuses substituted nativePrincipalId (131.550021ms)
✔ native exact signed request refuses substituted externalAuthorityId (128.218693ms)
✔ native exact signed request refuses substituted purpose (148.839258ms)
✔ native exact signed request refuses substituted challenge (124.527445ms)
✔ native exact signed request refuses substituted generation (144.233058ms)
✔ native signed recovery generation refuses changed snapshotHash (126.91058ms)
✔ native signed recovery generation refuses changed restoredAt (121.094395ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (121.985339ms)
✔ native replay cannot reuse prior valid target/challenge (184.304215ms)
✔ native current trust revocation during observation wins (124.467945ms)
✔ native configuration replacement during observation refuses old grant (134.36607ms)
✔ native current clock refuses expiry (133.662979ms)
✔ native current clock refuses rollback (125.575426ms)
✔ native current clock refuses future (124.273211ms)
✔ native current clock refuses too-long (128.259355ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (144.406679ms)
✔ native copied principal loses role authority in current same-writer snapshot (156.051188ms)
✔ native copied principal loses site authority in current same-writer snapshot (153.496434ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (145.992663ms)
✔ native copied principal loses current password authority in current same-writer snapshot (144.818161ms)
✔ native small-order trusted key forgery refused 01000000-00 (117.660653ms)
✔ native small-order trusted key forgery refused c7176a70-7a (119.326898ms)
✔ native small-order trusted key forgery refused 00000000-80 (124.7559ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (118.528463ms)
✔ native small-order trusted key forgery refused ecffffff-7f (119.533981ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (125.552395ms)
✔ native small-order trusted key forgery refused 00000000-00 (131.912258ms)
✔ native small-order trusted key forgery refused c7176a70-fa (132.498912ms)
✔ native canonical Ed25519 encoding refuses scalar (125.642327ms)
✔ native canonical Ed25519 encoding refuses signature-pad-bits (126.469224ms)
✔ native canonical Ed25519 encoding refuses key-trailing-bytes (118.695305ms)
✔ native canonical Ed25519 encoding refuses key-leading-junk (125.29272ms)
✔ native byte/descriptor preflight observation getter precedes active reflection (129.207045ms)
✔ native byte/descriptor preflight observation proxy precedes active reflection (121.324512ms)
✔ native byte/descriptor preflight observation extra-key precedes active reflection (122.042445ms)
✔ native byte/descriptor preflight observation oversized precedes active reflection (130.31643ms)
✔ native byte/descriptor preflight request getter precedes active reflection (123.017246ms)
✔ native byte/descriptor preflight request proxy precedes active reflection (119.072934ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (122.116576ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (134.560532ms)
✔ native byte/descriptor preflight trust-array getter precedes active reflection (128.381991ms)
✔ native byte/descriptor preflight trust-array proxy precedes active reflection (120.103528ms)
✔ native byte/descriptor preflight trust-array extra-key precedes active reflection (129.444869ms)
✔ native byte/descriptor preflight trust-array oversized precedes active reflection (124.740325ms)
✔ native byte/descriptor preflight trust-entry getter precedes active reflection (122.53042ms)
✔ native byte/descriptor preflight trust-entry proxy precedes active reflection (125.494663ms)
✔ native byte/descriptor preflight trust-entry extra-key precedes active reflection (123.263187ms)
✔ native byte/descriptor preflight trust-entry oversized precedes active reflection (123.81537ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (138.170831ms)
✔ native explicit composition refuses duplicate-mapping (124.369827ms)
✔ native explicit composition refuses foreign-principal (125.150734ms)
✔ native explicit composition refuses missing-mapping (133.896751ms)
✔ native independently current cryptographic authority refuses invalid-signature (133.716409ms)
✔ native independently current cryptographic authority refuses truncated-signature (130.510391ms)
✔ native independently current cryptographic authority refuses duplicate-trust (129.093784ms)
✔ native independently current cryptographic authority refuses changed-key (136.416191ms)
✔ native observation rejects hidden symbol key (123.69614ms)
✔ native observation rejects hidden nonenumerable key (125.222803ms)
✔ native oversized associationId refuses before trusted-key getter (191.875592ms)
✔ native oversized signature refuses before trusted-key getter (128.373167ms)
✔ native signature R small-order substitution refused 01000000-00 (142.343114ms)
✔ native signature R small-order substitution refused c7176a70-7a (169.179998ms)
✔ native signature R small-order substitution refused 00000000-80 (140.558242ms)
✔ native signature R small-order substitution refused 26e8958f-05 (144.329178ms)
✔ native signature R small-order substitution refused ecffffff-7f (133.690199ms)
✔ native signature R small-order substitution refused 26e8958f-85 (133.360466ms)
✔ native signature R small-order substitution refused 00000000-00 (132.900437ms)
✔ native signature R small-order substitution refused c7176a70-fa (130.155075ms)
✔ native malformed configuration withdraws old mapping without reflecting getter (119.677856ms)
✔ native malformed configuration withdraws old mapping without reflecting proxy (120.135697ms)
✔ native malformed configuration withdraws old mapping without reflecting revoked-proxy (119.783015ms)
✔ native malformed configuration withdraws old mapping without reflecting mapping-getter (121.912388ms)
✔ native malformed configuration withdraws old mapping without reflecting sites-getter (123.03414ms)
✔ native malformed configuration withdraws old mapping without reflecting callback-proxy (123.677672ms)
✔ native caught malformed reconfiguration during observe cannot retain old grant (130.990035ms)
✔ native full current trust roster refuses sparse (126.631539ms)
✔ native full current trust roster refuses revoked-proxy (119.903587ms)
✔ native full current trust roster refuses prototype (126.075711ms)
✔ native full current trust roster refuses hidden-key (123.635348ms)
✔ native full current trust roster refuses symbol-key (125.263154ms)
✔ native full current trust roster refuses unicode-id (140.570725ms)
✔ native full current trust roster refuses duplicate-key (121.381467ms)
✔ native full current trust roster refuses unrelated-weak-key (128.614801ms)
✔ native recursive bounded association preflight refuses generation-getter (148.995923ms)
✔ native recursive bounded association preflight refuses generation-proxy (127.953173ms)
✔ native recursive bounded association preflight refuses generation-hidden (128.589603ms)
✔ native recursive bounded association preflight refuses association-utf8 (131.394164ms)
✔ native recursive bounded association preflight refuses request-utf8 (135.299758ms)
✔ native recursive bounded association preflight refuses prototype (125.615666ms)
✔ native complete 256-key trust roster accepts canonical current signer at final position (1144.067115ms)
✔ native 257-entry trust roster refuses before reading any entry descriptor (136.782325ms)
✔ native exact 160-byte UTF8 association identity remains accepted (154.628271ms)
✔ native strict prime-subgroup trusted-key capture precedes permissive OpenSSL (300.384877ms)
✔ native strict prime-subgroup signature-R capture precedes permissive OpenSSL (321.532995ms)
✔ native second sampled clock still refuses expiry reached during trust reload (127.266066ms)
✔ native configuration replacement during current trust reload refuses old grant (130.244129ms)
ℹ tests 100
ℹ suites 0
ℹ pass 100
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15404.557856

```

#### maintenance-repair-comparators.log

Bytes: 8583; SHA-256: `362166b0f4bc372939d01270d279136c7a68c9ab1c77a3401129290af424deb0`.

```text
✔ native queue CA/CAD/false: real cancellation and settled renewal preserve all owner rows (363.450441ms)
✔ native queue US/USD/true: real cancellation and settled renewal preserve all owner rows (239.656258ms)
✔ native queue CA/USD/true: real cancellation and settled renewal preserve all owner rows (235.113672ms)
✔ native queue canceled Canada Post membership reporting=false (174.348457ms)
✔ native queue canceled Canada Post membership reporting=true (167.932967ms)
✔ native queue defaults closed without native/external association; dossier-style IDs cannot supply one (76.539377ms)
✔ native queue always requires the existing writer transaction (142.172728ms)
✔ native queue fresh association rejects revocation, cached grants, changed binding and ambiguous mappings (192.235801ms)
✔ native queue repeats IAM role, site, password and tenant checks under the same transaction (316.828353ms)
✔ native queue checks current finance role/password rather than copied grant (232.880497ms)
✔ native queue pending successor remains independent (unknown=false) (215.001648ms)
✔ native queue pending successor remains independent (unknown=true) (208.259033ms)
✔ native queue canceled group does not settle its ordinary pending booking (142.967197ms)
✔ native queue malformed/duplicate/missing receipt or changed cancellation/renewal/binding is unresolved (676.364232ms)
✔ native queue Canada Post complete receipt/member/group corruption cannot project (328.403125ms)
✔ native queue faulty maintenance callback cannot mutate owner history inside its transaction (153.594694ms)
✔ native queue current snapshot sees uncommitted receipt damage and rolls back (223.980096ms)
✖ full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review (141.601276ms)
✖ full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority (190.808399ms)
✔ native queue current configuration withdrawal during observation refuses retained grant (145.170282ms)
✔ native queue preserves every independent callback, journal, auth, revocation and read/poll claim blocker (200.024918ms)
✔ native queue complete history scans cannot hide an extra blocked effect or ambiguous late receipt (241.658973ms)
✖ full restore: historical dispositions preserve dossier evidence and release signatures through activation (190.175395ms)
✔ native queue ordinary terminal store needs no historical maintenance grant (64.832542ms)
✔ native queue rejects and rolls back a callback-created independent claim after its initial scan (173.681706ms)
✔ native queue preliminary eligibility refuses unrelated blocked stripe intent before authority (132.242343ms)
✔ native queue preliminary eligibility refuses unrelated blocked quickbooks intent before authority (134.152046ms)
✔ native queue preliminary eligibility requires the exact owning org/effect identity (323.146868ms)
✔ native queue preliminary eligibility never substitutes for current authority or complete evidence (221.059218ms)
✔ exact synthetic Ed25519 signatures and redacted frozen summary (14.705859ms)
✔ fingerprints independently bind all supplied public identities without redefining registryHash (37.409636ms)
✔ all changed nested envelope leaves invalidate retained signatures, even with updated binding fields (331.111104ms)
✔ exactly finance then security; no partial/extra/reordered/role-substituted bundle (18.440364ms)
✔ identity and person separation includes preparer, executor and operations (57.868115ms)
✔ duplicate roster IDs/keys and key substitution fail even in unused entries (17.950125ms)
✔ canonical padded 64-byte signature base64, including unused padding bits (30.245025ms)
✔ SPKI public-only Ed25519 with canonical PEM, no private/alternate/trailing encoding (5.923527ms)
✔ legacy review/release purpose signatures do not substitute for offline approvals (7.990566ms)
✔ all input object depths reject unsupported/missing/nonenumerable/symbol/accessor properties (130.817475ms)
✔ proxies, revoked proxies, coercions and wrong root types never invoke caller code (136.832391ms)
✔ bounded IDs/people/list counts and malformed sparse arrays (350.355873ms)
✔ caller mutations cannot alter a captured summary or leave a verification cache (4.443074ms)
✔ expired historical input is only cryptographic evidence; no current truth or policy bypass (5.709254ms)
✔ independent signature and roster fingerprint vectors (6.453357ms)
✔ noncanonical Ed25519 scalar and synthetic weak-point forgeries are refused (3.096923ms)
✔ roster decoding rejects every torsion point and malformed compressed point independently of native verify (8.535139ms)
✔ invalid R/scalars never reach even a permissive native verifier (46.839705ms)
✔ all out-of-field encodings fail and valid sign/scalar boundaries still reach native verification (13.726782ms)
ℹ tests 48
ℹ suites 0
ℹ pass 45
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7238.186973

✖ failing tests:

test at tests/restore-native-dispositions.test.ts:1:22348
✖ full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review (141.601276ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at restoreSetup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:260:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:1013:7)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-native-dispositions.test.ts:1:22933
✖ full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority (190.808399ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at restoreSetup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:260:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:1032:7)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-native-dispositions.test.ts:1:28228
✖ full restore: historical dispositions preserve dossier evidence and release signatures through activation (190.175395ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at restoreSetup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:260:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-native-dispositions.test.ts:1289:7)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

```

#### maintenance-repair-delivery-focused.log

Bytes: 8821; SHA-256: `c7e411265cc261544215735b8107ad27f358a9db2b19c43ee3f3eac53e97630d`.

```text
✔ native historical projection accepts fresh canonical signed association without writes or hold release (196.530311ms)
✔ native exact signed request refuses substituted orgId (150.093863ms)
✔ native exact signed request refuses substituted projection (128.104828ms)
✔ native exact signed request refuses substituted recordId (131.690349ms)
✔ native exact signed request refuses substituted nativePrincipalId (142.36506ms)
✔ native exact signed request refuses substituted externalAuthorityId (138.071069ms)
✔ native exact signed request refuses substituted purpose (167.880397ms)
✔ native exact signed request refuses substituted challenge (148.024826ms)
✔ native exact signed request refuses substituted generation (153.22706ms)
✔ native signed recovery generation refuses changed snapshotHash (135.7546ms)
✔ native signed recovery generation refuses changed restoredAt (139.097654ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (134.181163ms)
✔ native replay cannot reuse prior valid target/challenge (154.366588ms)
✔ native current trust revocation during observation wins (132.537208ms)
✔ native configuration replacement during observation refuses old grant (137.864224ms)
✔ native current clock refuses expiry (140.223859ms)
✔ native current clock refuses rollback (130.723624ms)
✔ native current clock refuses future (124.381332ms)
✔ native current clock refuses too-long (131.9413ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (177.620878ms)
✔ native copied principal loses role authority in current same-writer snapshot (161.234412ms)
✔ native copied principal loses site authority in current same-writer snapshot (152.076683ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (161.979847ms)
✔ native copied principal loses current password authority in current same-writer snapshot (148.11298ms)
✔ native small-order trusted key forgery refused 01000000-00 (130.076368ms)
✔ native small-order trusted key forgery refused c7176a70-7a (125.328485ms)
✔ native small-order trusted key forgery refused 00000000-80 (129.015032ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (121.294088ms)
✔ native small-order trusted key forgery refused ecffffff-7f (126.458607ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (125.723466ms)
✔ native small-order trusted key forgery refused 00000000-00 (151.128103ms)
✔ native small-order trusted key forgery refused c7176a70-fa (132.162928ms)
✔ native canonical Ed25519 encoding refuses scalar (135.976799ms)
✔ native canonical Ed25519 encoding refuses signature-pad-bits (139.791421ms)
✔ native canonical Ed25519 encoding refuses key-trailing-bytes (138.120925ms)
✔ native canonical Ed25519 encoding refuses key-leading-junk (134.723308ms)
✔ native byte/descriptor preflight observation getter precedes active reflection (131.562443ms)
✔ native byte/descriptor preflight observation proxy precedes active reflection (125.625246ms)
✔ native byte/descriptor preflight observation extra-key precedes active reflection (127.43265ms)
✔ native byte/descriptor preflight observation oversized precedes active reflection (132.226033ms)
✔ native byte/descriptor preflight request getter precedes active reflection (200.653944ms)
✔ native byte/descriptor preflight request proxy precedes active reflection (119.800622ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (121.238563ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (129.833368ms)
✔ native byte/descriptor preflight trust-array getter precedes active reflection (120.734986ms)
✔ native byte/descriptor preflight trust-array proxy precedes active reflection (125.526596ms)
✔ native byte/descriptor preflight trust-array extra-key precedes active reflection (128.252931ms)
✔ native byte/descriptor preflight trust-array oversized precedes active reflection (125.937983ms)
✔ native byte/descriptor preflight trust-entry getter precedes active reflection (123.791092ms)
✔ native byte/descriptor preflight trust-entry proxy precedes active reflection (132.652002ms)
✔ native byte/descriptor preflight trust-entry extra-key precedes active reflection (125.05626ms)
✔ native byte/descriptor preflight trust-entry oversized precedes active reflection (122.050359ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (131.594792ms)
✔ native explicit composition refuses duplicate-mapping (118.107502ms)
✔ native explicit composition refuses foreign-principal (127.241368ms)
✔ native explicit composition refuses missing-mapping (134.607492ms)
✔ native independently current cryptographic authority refuses invalid-signature (142.88911ms)
✔ native independently current cryptographic authority refuses truncated-signature (137.265252ms)
✔ native independently current cryptographic authority refuses duplicate-trust (134.130695ms)
✔ native independently current cryptographic authority refuses changed-key (135.068003ms)
✔ native observation rejects hidden symbol key (125.665177ms)
✔ native observation rejects hidden nonenumerable key (124.298755ms)
✔ native oversized associationId refuses before trusted-key getter (131.831974ms)
✔ native oversized signature refuses before trusted-key getter (134.89484ms)
✔ native signature R small-order substitution refused 01000000-00 (135.998066ms)
✔ native signature R small-order substitution refused c7176a70-7a (156.200367ms)
✔ native signature R small-order substitution refused 00000000-80 (134.077366ms)
✔ native signature R small-order substitution refused 26e8958f-05 (126.093532ms)
✔ native signature R small-order substitution refused ecffffff-7f (127.681711ms)
✔ native signature R small-order substitution refused 26e8958f-85 (129.101954ms)
✔ native signature R small-order substitution refused 00000000-00 (131.770924ms)
✔ native signature R small-order substitution refused c7176a70-fa (137.826266ms)
✔ native malformed configuration withdraws old mapping without reflecting getter (124.819394ms)
✔ native malformed configuration withdraws old mapping without reflecting proxy (123.521068ms)
✔ native malformed configuration withdraws old mapping without reflecting revoked-proxy (121.355289ms)
✔ native malformed configuration withdraws old mapping without reflecting mapping-getter (126.973441ms)
✔ native malformed configuration withdraws old mapping without reflecting sites-getter (124.298903ms)
✔ native malformed configuration withdraws old mapping without reflecting callback-proxy (133.732485ms)
✔ native caught malformed reconfiguration during observe cannot retain old grant (147.703067ms)
✔ native full current trust roster refuses sparse (144.88309ms)
✔ native full current trust roster refuses revoked-proxy (130.712676ms)
✔ native full current trust roster refuses prototype (130.793468ms)
✔ native full current trust roster refuses hidden-key (134.009173ms)
✔ native full current trust roster refuses symbol-key (134.960439ms)
✔ native full current trust roster refuses unicode-id (142.539242ms)
✔ native full current trust roster refuses duplicate-key (153.874695ms)
✔ native full current trust roster refuses unrelated-weak-key (144.734336ms)
✔ native recursive bounded association preflight refuses generation-getter (121.139363ms)
✔ native recursive bounded association preflight refuses generation-proxy (120.359986ms)
✔ native recursive bounded association preflight refuses generation-hidden (120.803085ms)
✔ native recursive bounded association preflight refuses association-utf8 (128.691464ms)
✔ native recursive bounded association preflight refuses request-utf8 (117.030389ms)
✔ native recursive bounded association preflight refuses prototype (120.424514ms)
✔ native complete 256-key trust roster accepts canonical current signer at final position (1106.668486ms)
✔ native 257-entry trust roster refuses before reading any entry descriptor (118.411013ms)
✔ native exact 160-byte UTF8 association identity remains accepted (132.078378ms)
✔ native strict prime-subgroup trusted-key capture precedes permissive OpenSSL (273.665002ms)
✔ native strict prime-subgroup signature-R capture precedes permissive OpenSSL (314.258749ms)
✔ native second sampled clock still refuses expiry reached during trust reload (123.492945ms)
✔ native configuration replacement during current trust reload refuses old grant (123.217941ms)
✔ native whole-roster descriptor preflight precedes every key import (121.447147ms)
ℹ tests 101
ℹ suites 0
ℹ pass 101
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15826.694102

```

#### maintenance-repair-delivery-typecheck.log

Bytes: 0; SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

#### Final tested input hashes

- `src/server/restore-activation.ts`: 33293 bytes, SHA-256 `4aed4564e0d30ad00fe348b0402928d3213b34ebd653b0a9e5b61253cfdf8234`.
- `src/server/restore-native-maintenance-verifier.ts`: 13317 bytes, SHA-256 `5f26354966fe87dea7eaf447571c26d68583001735dc1b84489d7040dddc1559`.
- `tests/restore-native-maintenance-authority-boundary.test.ts`: 31313 bytes, SHA-256 `52c5b8ad2508f4134befc06130a016b45d6a6d06be233f48122e31a31c3d9212`.
