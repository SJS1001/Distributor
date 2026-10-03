# Offline phase boundary review — 2026-10-03

Bounded independent review of public `SJS1001/Distributor`, branch `codex/local-distributor-checkpoint`, exact checkpoint **d6f8818a34626caf164769d196ecd9b27abb5799** (tree `8b1dadb49d69ab91f1b52035150c0360c7ec27d7`). The published checkpoint was reconstructed from read-only Git-data metadata/blobs and existing local Git objects, verifying every fetched blob and the exact tree/commit hashes before a clean detached checkout. The previously failed embedded phase transfer was not reused. Prior completed checkouts/patches remain untouched.

Only [the new boundary tests](../tests/restore-offline-phase-boundary.test.ts) and this report are owned by this review. **No production repair is included.** Root owns repairs to [the phase module](../src/server/restore-offline-phase.ts). All task/product gates remain **NOT VERIFIED**; outputs are static proposals, never qualified infrastructure observations or write authority.

AGENTS, README, PLAN, DECISIONS, current HANDOFF, the [common contract](RESTORE-OFFLINE-CONTRACT-2026-10-03.md), [phase implementation report](RESTORE-OFFLINE-PHASE-2026-10-03.md), existing phase tests and relevant [native release](../src/server/restore-activation.ts) methods were inspected. The owner canonical rule requests Astra/High for this adversarial boundary; model/effort controls and runtime-effective settings were not exposed, so effective settings remain **unverified**. No nested delegation was launched.

## Reproduced findings

Both findings concern acceptance of malformed native history by the pure validator. Neither demonstrates a provider gate bypass: retained releases still produce a barrier and block ordinary offline transitions. Root should retain that distinction when prioritizing repairs.

### F1 — Forward recovery hold can be followed by impossible rollback completion

Four unchanged RED test cases are named `native forward hold cannot resume to rolled-back: marker=..., phase=...`. Each calls `classifyOfflineReleaseHistory` with one complete, head-consistent release. All currently return successfully where the assertion expects `RESTORE_OFFLINE_PHASE`.

Exact fixture conventions: `id="release-one"`; `binding=digest(canonical({fixture:"phase-boundary",label:"release-one"}))`; every point has `at=1000`; revision equals history length and head state/phase/at equal the last history entry. `forwardRecoveryRequired` is either exactly `true` or completely absent. The two histories, each tested with both marker variants, are:

| Retained phase | Exact ordered state/phase pairs                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| stopping       | prepared/prepared → stopping/stopping → forward-held/stopping → returning/returning → rolled-back/rolled-back  |
| returning      | prepared/prepared → stopping/stopping → returning/returning → forward-held/returning → rolled-back/rolled-back |

Observed classification is `control-intent-retained`, `forward-recovery-marker`, release count 1. Failure is `AssertionError [ERR_ASSERTION]: Missing expected exception.`

At this exact checkpoint, native `rollback()` returns the retained record immediately when `forwardRecoveryRequired === true`, or when state is `forward-held` without an explicit false marker. It cannot append returning/rolled-back in these fixtures. Native writes retain the marker; `supersede()`/`isolate()` can terminalize the old release as superseded, but cannot turn it into rolled-back. The pure `validReleaseEdge()` allows stopping→returning and returning→rolled-back before its general forward-held check. Its record-level validation only requires a boolean marker and some historical forward-held point; it does not reconcile that marker with the resumed history.

Suggested root repair: validate continued rollback against the explicit marker and native conservative legacy rule. Preserve legitimate interrupted-control recovery with **false**, and preserve supersession for true/false/absent histories. A passing control test covers both stopped phases with explicit false and all three marker variants ending in superseded. Do not infer when a true flag arose if the projection lacks per-revision flags; reject only paths inconsistent with every possible native placement. These tests target the supplied baseline's native semantics, not an invented migration interpretation for older release writers.

### F2 — Held revision accepts a timestamp native hold never writes

The RED `native held entries cannot advance the retained control timestamp` first accepts this valid same-time control history:

```json
[
  { "state": "prepared", "phase": "prepared", "at": 1000 },
  { "state": "fencing", "phase": "fencing", "at": 1000 },
  { "state": "held", "phase": "fencing", "at": 1000 }
]
```

It then changes only the last point's `at` and the release head's `at` to **1001**, preserving revision 3, ID/binding and exact head agreement. The validator still succeeds; the refusal assertion fails with `Missing expected exception`.

Native `hold()` deliberately appends `current.at`, including when the clock fails; it neither samples nor advances the timestamp. No native writer emits ordinary `held` through `write()`. The phase edge validator checks only nondecreasing time, admitting this impossible failure record. This is a lower-impact native-history consistency gap, not evidence of a lost barrier. Suggested root repair: require the retained timestamp for ordinary held transitions. Do not apply this indiscriminately to every forward-held point: native rollback can emit forward-held through timestamped `write()` as well as `hold()`.

## Additional bounded checks and interpretation

Ten new checks pass beyond the five RED cases:

- Explicit-false rollback resumes and independently superseded positive/legacy holds remain accepted, with original control intent retained.
- Each revision in a six-point history containing repeated approvals and repeated holds contributes to the final invalidation release-history binding. Changed retained revisions cannot retain the prior session hash.
- Self-consistent terminal continuation refuses for both rolled-back and superseded, including repeated terminal and held-terminal variants.
- Independently rehashed session copies cannot move a nonempty release anchor into an earlier isolate/open revision. A completely rehashed generation is syntactically valid but cannot match the independently retained prior expectation. This is not authentication of either supplied copy.
- Consumed bindings remain unique across sessions, changed request IDs, owners, task names and organizations. **Request strings alone are not globally unique under the published contract:** its permanent key explicitly includes instance/session/owner/org/task/request. A new session with a different binding and the same request string is currently valid. The test documents this distinction instead of inventing a broader policy. Root must resolve any desired stronger global request rule explicitly before durable wiring.
- Composed/decomposed Unicode, distinct lone surrogates, delimiter-bearing IDs and `__proto__`/`constructor` string values retain distinct canonical generation hashes and receipt identities. Leading/trailing Unicode whitespace and ASCII newline aliases refuse. No Unicode normalization is claimed or introduced.
- Normal and revoked proxies substituted into 23 primitive-valued state/receipt slots and three native release-point slots fail closed with **zero** coercion/reflection trap executions (52 variants). This extends the existing tests of whole-object/array proxies. Nested accessors, inherited prototypes, hidden properties and symbols also refuse with zero getter calls.
- Exactly 1,000 terminal release records totaling 10,000 revisions parse; an additional revision in the final record refuses. A session totaling 10,000 steps parses; appending its next step refuses. Sparse arrays with length `0xffffffff` refuse before executing their first-element getter. These are bounded synthetic correctness checks, not production resource or latency qualification.

The complete-history projection deliberately omits native `version`, row hash, file identity and actual current storage. Future trusted projection construction must validate those independently; absence of those fields from this narrow pure type is not reported as a new defect. No database, FS, network or clock authority was introduced in tests or implementation. No actual native store, adapter or provider was exercised by this pure review.

## Foreground verification and retained evidence

Environment: Linux x64, Node **24.19.0**, OpenSSL **3.5.7**, existing dependency installation reused without package changes. Commands run from the isolated checkpoint checkout:

```sh
node --import tsx --test tests/restore-offline-phase.test.ts
node --import tsx --test tests/restore-offline-phase.test.ts tests/restore-offline-phase-boundary.test.ts
npm run typecheck
./node_modules/.bin/prettier --check tests/restore-offline-phase-boundary.test.ts docs/RESTORE-OFFLINE-PHASE-BOUNDARY-2026-10-03.md
git diff --cached --check
```

- Unchanged phase baseline: **25/25 pass**, exit 0; 444.169723 ms.
- Combined focused replay: **40 tests, 35 pass, 5 fail**, zero skips/cancellations/todo; exit **1**, 1280.429265 ms. All original 25 pass. New boundary file: 10 pass, five RED assertions retained. Combined log SHA-256: `e61d79ce02403206fe92531b7e8ee38576324cb2e0e02e1f2d009a7a9364fc57`.
- Complete TypeScript: exit 0. Assigned Prettier and patch whitespace checks pass at delivery.
- First new-test replay: 9/15 pass, six failures. Five were the above retained findings. The sixth was a **test-fixture error**, not a production defect: hashing raw lone-surrogate labels directly yielded the same UTF-8 replacement bytes for two synthetic bindings. The fixture now hashes their canonical JSON representation, independently preserving their distinct identities; the production Unicode assertion remains intact and passes. The original first-run log remains separate from the combined replay.

Unmodified baseline source SHA-256:

| File                                | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| src/server/restore-offline-phase.ts | `3863e257163ca09cddddb8679d6db4b0bfe7ffec234b0d544fb3a6d3892926f3` |
| src/server/restore-activation.ts    | `9669e36cc1f217fb8f4d3b446aaa35e9d13ee914f4517125bd78170babd59099` |
| tests/restore-offline-phase.test.ts | `82746308463d611c6643180a77ba3265da9a4f5024ba3bb414fe5806e2f1b794` |

No full native/browser suite, Mac replay, durable coordinator, release-time concurrency, independent current registry, qualified infrastructure or provider outcome is established. No CI, workflow, dependency changes, production edits, background job, PR, push or deployment. Root must review/replay the exact two-file delta and repair production separately; these failing assertions must not be skipped or converted to acceptance of malformed histories.

## Root replay and repair

Root reproduced all five reported failures on the published parent and repaired them. The original cloud outcomes above remain historical. The [local repair receipt](evidence/LOCAL-OFFLINE-PHASE-BOUNDARY-REPAIR-2026-10-03.md) records exact tested hashes, retained failures, native fixture timestamp corrections and the final 149/149 focused result. No task or product gate is verified by this repair.
