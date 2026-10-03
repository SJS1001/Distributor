# Restore offline command exclusion — 2026-10-03

Excluded baseline: `2e2746294c19955674e6e11fc3d827c1f07a7d18` (tree `f8c755773a6105db99b5aed4b7e51d8410debc24`). Exact public owner-authorized source reconstructed from GitHub Git objects with object SHA and byte verification after shell fetch was blocked. No other source modifications, push, provider IO, accounts or deployment. Requested Astra/High: effective model/reasoning controls and metadata unavailable/unverified; prompts do not configure runtime.

## Policy and composition

RestoreActivation constructs the one fixed RestoreOfflineStorage with its actual Database; Platform exposes that same instance. The guard invokes the captured native reader against the private instance in the native writer, without alternate connections, caller-selected guards or migrations from review. Complete head/journal/provenance validation runs before interpreting emptiness. Invalid, ambiguous, missing retained head, mismatched current raw recovery generation/schema/region/organization inventory, or removed/regressed retained release history refuses access. Retained releases must remain matching monotone prefixes; closed maintenance may be followed by additional normal releases.

| Valid retained state                                   | Ordinary/new/cached commands; prepare/approve/activate/forward controls |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Truly uninitialized empty journal                      | Existing gates continue                                                 |
| Generation only, isolated, open, draining, invalidated | Refuse                                                                  |
| Closed                                                 | Existing restore/release gates continue; no authority conferred         |
| Corrupt, ambiguous, generation/history mismatch        | Refuse                                                                  |

Invalidation is not closure. Starting isolation is already maintenance: it cannot permit ordinary writes before OPEN. CLOSED removes only this exclusion. No phase grants provider access, release authority or claim retirement. Provider refusals preserve the existing RECOVERY_HOLD contract. rawRecoveryHoldInTransaction and original strict maintenance verifier remain unchanged.

Checks precede cached command/preparation returns, proof callbacks and adapter observation/control. Ordinary commands compare the original retained anchor after authorization/payload serialization, perform/result serialization, before receipt/audit commit; refusal rolls back native writes. Release callbacks recheck phase and release revision before controls and after synchronous observation/control, using the same writer. This serializes this database's native synchronous work; two reads do not linearize external authority or external effects. An already issued uncertain effect retains its existing durable intent/hold behavior. stopCandidate remains available without approval during maintenance; unsafe routeCandidate/routeSource remain refused. Rollback can retain stopping/forward-held intent when further observation is excluded.

## Fixtures and outcomes

Actual CA/US Database/Application fixtures use same-writer storage transitions, real Catalog commands/cached receipts, restart, complete SQLite row conservation, corruption/generation/history faults, callback changes, release controls and revoked current trust. Release-control fixtures explicitly seed synthetic retained release intents with genuine signatures/native candidate bindings; they do not claim a successful production prepare/release or real provider observation. Valid phase transitions cannot start isolation after a retained release, so release callback fault tests corrupt the real retained head rather than fabricate an empty history. No original tests changed.

Environment: Node v24.19.0, OpenSSL 3.5.7, Linux x64 UID 0. Existing locally available dependencies reused via temporary symlink, removed before commit; no installation. tsx shell launcher IPC unavailable, so Node import loader used. Canonical owner model policy file absent; AGENTS/README/PLAN/DECISIONS and bounded HANDOFF read.

Commands executed foreground with actual native exits:

- `node --import tsx --test tests/restore-offline-command-exclusion.test.ts`: final 60/60 pass, exit 0, no skips. Same final tests against exact excluded production: 4 pass/56 fail, exit 1. Earlier qualified 47-test baseline: 3 pass/44 fail, exit 1. Native exit retained separately from Python restoration wrapper exit 0.
- `node --import tsx --test tests/restore-native-maintenance-authority-boundary.test.ts tests/restore-native-dispositions.test.ts tests/restore-offline-approvals.test.ts tests/restore-offline-storage.test.ts tests/restore-activation.test.ts`: final 173 pass/44 fail of 217, exit 1. Exact baseline replay: identical 173/44, identical failure-name set. All 44 fail during external full restore candidate capture with RESTORE_REVIEW_CHANGED / Candidate files changed during inspection. Thus full release activation comparators are not green in this environment. Dedicated native authority/offline approvals/storage assertions remain intact. Initial patch comparator had 3 additional provider error-code regressions; fixed while preserving fail-closed policy and original tests.
- `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `node node_modules/prettier/bin/prettier.cjs --check src/server/platform.ts src/server/restore-activation.ts tests/restore-offline-command-exclusion.test.ts docs/RESTORE-OFFLINE-COMMAND-EXCLUSION-2026-10-03.md`: exit 0; all four assigned files use Prettier code style.

Limitations: full candidate hashing inside the writer adds cost proportional to database size; no load benchmark, multi-process control qualification, real external IO or successful full restore activation is claimed. Root must replay in its current combined tree and qualified runtime. No general new crypto implementation. Initial fixture failures were setup errors (SQLite row prototypes, attempting forbidden isolation after retained release), retained as receipts and corrected without weakening production assertions.

## Original receipt manifest and full logs

The following logs are retained byte-for-byte in the checkout-parent scratch workspace. All original bytes are additionally retained in the delivered original-receipts.tar.gz bundle; the table identifies each raw log. Selected complete comparator/final logs follow; large failing assertion object dumps remain unchanged in the receipt bundle.

| Receipt                         | Raw bytes | SHA256                                                           |
| ------------------------------- | --------: | ---------------------------------------------------------------- |
| exclusion-behavior-red.log      |     67565 | e73100ed18b2e4d7cc935c033e193be458ce6e7dc5f2e6c2e7cf0d77689c5b05 |
| exclusion-comparators-base.log  |     72730 | 096a3132ef97d1fe67ad1a2474121f2ee12a5bc2d27f2aa4d0d23b2f36e57f3c |
| exclusion-comparators-final.log |     72743 | 7b2e4c8c527648996ad17133a9cdbdf2f6f3b6b2c8dd2729a7739ce45cd8446d |
| exclusion-comparators.log       |     80066 | 023e21cd65d88b3d9ec221b881359b497bd95f186e3e6687e5834d160594afb2 |
| exclusion-corrected-green.log   |      4669 | 2e971fc6077d8a6d88ce597997442da78e36ceb6eae7227b345fe8c47cea1018 |
| exclusion-expanded-green.log    |      5830 | deaf2697bcb317d60e2ac8c23be0da6da8722f92a9e531b5cc0b089dbc9ff69a |
| exclusion-final-base-red.log    |    841531 | 9f22555fefcbd683298ec716f6f7aebca2646c45b0b34caa3656d0f898f1ba47 |
| exclusion-final-green.log       |      5920 | ac10a67190938d33a8844ec102b537018cdd41557d263b9635dd517ff324e728 |
| exclusion-final60-base-red.log  |   1105116 | ebf7157c73f3f8ddff38e8d15afc930d02c9877135e0d88efb8d3ee1dbc99ad2 |
| exclusion-first-green.log       |     22759 | 28cd6d90aecfa148122c61463efa0ec4f132a1fc8d6774e9ee036f4ac682d0ce |
| exclusion-qualified-red.log     |    552127 | 7a3a3b2beb297188621049f58983e238a626ab6edcfd557f1ca365ea742b549c |
| exclusion-red.log               |     67586 | 6d4612a19f611dcac394f24e7468ae80a201df41f014cb56cc028c8a68af82d7 |
| exclusion-type-final.log        |         0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| exclusion-type-final2.log       |         0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| exclusion-type-first.log        |         0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| exclusion-type-green.log        |         0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

### exclusion-comparators-base.log

```text
✖ CA/false persistent release controls the real gate and restarts closed (81.421869ms)
✖ CA/true persistent release controls the real gate and restarts closed (73.242068ms)
✖ US/false persistent release controls the real gate and restarts closed (61.125374ms)
✖ US/true persistent release controls the real gate and restarts closed (64.452586ms)
✖ default disabled rejects preparation before adapter IO (63.36255ms)
✖ unknown provider declaration and invalid signatures cannot prepare (68.131979ms)
✖ candidate changes retain a durable hold without routing (61.185655ms)
✖ evidence changes retain a durable hold without routing (57.427161ms)
✖ trust changes retain a durable hold without routing (60.794845ms)
✖ expiry changes retain a durable hold without routing (58.193398ms)
✖ replacement changes retain a durable hold without routing (57.598831ms)
✖ backwards changes retain a durable hold without routing (55.630249ms)
✖ fence lost response resumes by observing, never resending (60.373238ms)
✖ routeCandidate lost response resumes by observing, never resending (59.19463ms)
✖ failed fencing and unsettled controls never route or release (57.463907ms)
✖ concurrent operator cannot claim a second release or replay controls (57.891983ms)
✖ internal writer in another process during routing invalidates release (56.322754ms)
✖ ordinary application commands are held during the release lifecycle (58.097263ms)
✖ rollback with none effects preserves history and never rewinds writes (59.87727ms)
✖ rollback with internal effects preserves history and never rewinds writes (56.221372ms)
✖ rollback with external effects preserves history and never rewinds writes (73.966777ms)
✖ rollback with unknown effects preserves history and never rewinds writes (58.197389ms)
✖ rollback lost response inspects source route on restart without replay (57.899825ms)
✖ expiry and lost current authority close an already released gate (58.447562ms)
✖ v16/false exact fresh-file upgrade preserves hold and source bytes (59.887726ms)
✖ v16/true exact fresh-file upgrade preserves hold and source bytes (57.931903ms)
✖ encrypted restore of released store retains history but cannot inherit release (57.025185ms)
✖ read-only review signatures cannot authorize activation, and release signatures cannot move to another binding (60.131343ms)
✖ current cursor authority drift closes released gate (57.394902ms)
✖ current hash authority drift closes released gate (57.984884ms)
✖ current binding authority drift closes released gate (58.202602ms)
✖ current token authority drift closes released gate (59.169961ms)
✖ current stale authority drift closes released gate (57.398968ms)
✖ current unknown authority drift closes released gate (57.801045ms)
✖ current trust authority drift closes released gate (57.833655ms)
✖ actual process exit after routing intent restarts held and observes exactly one control (57.217254ms)
✖ fresh reviewed forward release supersedes an expired held generation without erasing history (57.299619ms)
✖ copied pending provider intent refuses release despite signed report declarations (58.878271ms)
✖ copied running provider intent refuses release despite signed report declarations (57.334401ms)
✖ copied unknown provider intent refuses release despite signed report declarations (65.170403ms)
✖ copied blocked provider intent refuses release despite signed report declarations (58.395944ms)
✔ native queue CA/CAD/false: real cancellation and settled renewal preserve all owner rows (277.589872ms)
✔ native queue US/USD/true: real cancellation and settled renewal preserve all owner rows (236.980822ms)
✔ native queue CA/USD/true: real cancellation and settled renewal preserve all owner rows (234.312184ms)
✔ native queue canceled Canada Post membership reporting=false (177.428153ms)
✔ native queue canceled Canada Post membership reporting=true (173.353362ms)
✔ native queue defaults closed without native/external association; dossier-style IDs cannot supply one (106.008716ms)
✔ native queue always requires the existing writer transaction (153.984095ms)
✔ native queue fresh association rejects revocation, cached grants, changed binding and ambiguous mappings (179.596145ms)
✔ native queue repeats IAM role, site, password and tenant checks under the same transaction (301.435792ms)
✔ native queue checks current finance role/password rather than copied grant (216.270872ms)
✔ native queue pending successor remains independent (unknown=false) (201.358142ms)
✔ native queue pending successor remains independent (unknown=true) (210.588566ms)
✔ native queue canceled group does not settle its ordinary pending booking (145.798389ms)
✔ native queue malformed/duplicate/missing receipt or changed cancellation/renewal/binding is unresolved (670.548565ms)
✔ native queue Canada Post complete receipt/member/group corruption cannot project (365.315026ms)
✔ native queue faulty maintenance callback cannot mutate owner history inside its transaction (182.173335ms)
✔ native queue current snapshot sees uncommitted receipt damage and rolls back (221.411742ms)
✖ full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review (144.456611ms)
✖ full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority (190.867258ms)
✔ native queue current configuration withdrawal during observation refuses retained grant (153.06403ms)
✔ native queue preserves every independent callback, journal, auth, revocation and read/poll claim blocker (228.978413ms)
✔ native queue complete history scans cannot hide an extra blocked effect or ambiguous late receipt (274.620014ms)
✖ full restore: historical dispositions preserve dossier evidence and release signatures through activation (202.304286ms)
✔ native queue ordinary terminal store needs no historical maintenance grant (66.460402ms)
✔ native queue rejects and rolls back a callback-created independent claim after its initial scan (177.030367ms)
✔ native queue preliminary eligibility refuses unrelated blocked stripe intent before authority (162.267214ms)
✔ native queue preliminary eligibility refuses unrelated blocked quickbooks intent before authority (145.293415ms)
✔ native queue preliminary eligibility requires the exact owning org/effect identity (399.061934ms)
✔ native queue preliminary eligibility never substitutes for current authority or complete evidence (262.787634ms)
✔ native historical projection accepts fresh canonical signed association without writes or hold release (187.86811ms)
✔ native exact signed request refuses substituted orgId (125.47297ms)
✔ native exact signed request refuses substituted projection (133.746904ms)
✔ native exact signed request refuses substituted recordId (125.616737ms)
✔ native exact signed request refuses substituted nativePrincipalId (127.035449ms)
✔ native exact signed request refuses substituted externalAuthorityId (121.75542ms)
✔ native exact signed request refuses substituted purpose (120.934901ms)
✔ native exact signed request refuses substituted challenge (124.528054ms)
✔ native exact signed request refuses substituted generation (123.293731ms)
✔ native signed recovery generation refuses changed snapshotHash (124.038174ms)
✔ native signed recovery generation refuses changed restoredAt (124.388133ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (117.420436ms)
✔ native replay cannot reuse prior valid target/challenge (140.609113ms)
✔ native current trust revocation during observation wins (139.074321ms)
✔ native configuration replacement during observation refuses old grant (127.877745ms)
✔ native current clock refuses expiry (123.659093ms)
✔ native current clock refuses rollback (124.683589ms)
✔ native current clock refuses future (117.402779ms)
✔ native current clock refuses too-long (123.652333ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (145.191563ms)
✔ native copied principal loses role authority in current same-writer snapshot (143.788917ms)
✔ native copied principal loses site authority in current same-writer snapshot (144.979494ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (142.192918ms)
✔ native copied principal loses current password authority in current same-writer snapshot (150.425284ms)
✔ native small-order trusted key forgery refused 01000000-00 (118.144148ms)
✔ native small-order trusted key forgery refused c7176a70-7a (116.467709ms)
✔ native small-order trusted key forgery refused 00000000-80 (130.027144ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (138.432913ms)
✔ native small-order trusted key forgery refused ecffffff-7f (143.347251ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (130.488326ms)
✔ native small-order trusted key forgery refused 00000000-00 (124.947668ms)
✔ native small-order trusted key forgery refused c7176a70-fa (146.963633ms)
✔ native canonical Ed25519 encoding refuses scalar (127.924137ms)
✔ native canonical Ed25519 encoding refuses signature-pad-bits (122.910417ms)
✔ native canonical Ed25519 encoding refuses key-trailing-bytes (129.521894ms)
✔ native canonical Ed25519 encoding refuses key-leading-junk (125.056997ms)
✔ native byte/descriptor preflight observation getter precedes active reflection (150.330626ms)
✔ native byte/descriptor preflight observation proxy precedes active reflection (120.62595ms)
✔ native byte/descriptor preflight observation extra-key precedes active reflection (139.026677ms)
✔ native byte/descriptor preflight observation oversized precedes active reflection (136.266903ms)
✔ native byte/descriptor preflight request getter precedes active reflection (127.740786ms)
✔ native byte/descriptor preflight request proxy precedes active reflection (117.834217ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (153.211759ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (129.60496ms)
✔ native byte/descriptor preflight trust-array getter precedes active reflection (161.220049ms)
✔ native byte/descriptor preflight trust-array proxy precedes active reflection (123.681742ms)
✔ native byte/descriptor preflight trust-array extra-key precedes active reflection (165.943706ms)
✔ native byte/descriptor preflight trust-array oversized precedes active reflection (125.646837ms)
✔ native byte/descriptor preflight trust-entry getter precedes active reflection (154.566773ms)
✔ native byte/descriptor preflight trust-entry proxy precedes active reflection (121.539809ms)
✔ native byte/descriptor preflight trust-entry extra-key precedes active reflection (119.369003ms)
✔ native byte/descriptor preflight trust-entry oversized precedes active reflection (121.366317ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (125.245993ms)
✔ native explicit composition refuses duplicate-mapping (122.099504ms)
✔ native explicit composition refuses foreign-principal (118.988579ms)
✔ native explicit composition refuses missing-mapping (125.02585ms)
✔ native independently current cryptographic authority refuses invalid-signature (130.603517ms)
✔ native independently current cryptographic authority refuses truncated-signature (118.540473ms)
✔ native independently current cryptographic authority refuses duplicate-trust (121.516113ms)
✔ native independently current cryptographic authority refuses changed-key (129.504568ms)
✔ native observation rejects hidden symbol key (117.619864ms)
✔ native observation rejects hidden nonenumerable key (120.048839ms)
✔ native oversized associationId refuses before trusted-key getter (125.532194ms)
✔ native oversized signature refuses before trusted-key getter (172.670497ms)
✔ native signature R small-order substitution refused 01000000-00 (143.996578ms)
✔ native signature R small-order substitution refused c7176a70-7a (132.427309ms)
✔ native signature R small-order substitution refused 00000000-80 (163.8219ms)
✔ native signature R small-order substitution refused 26e8958f-05 (136.573997ms)
✔ native signature R small-order substitution refused ecffffff-7f (133.233796ms)
✔ native signature R small-order substitution refused 26e8958f-85 (134.03142ms)
✔ native signature R small-order substitution refused 00000000-00 (161.4885ms)
✔ native signature R small-order substitution refused c7176a70-fa (137.346713ms)
✔ native malformed configuration withdraws old mapping without reflecting getter (130.217943ms)
✔ native malformed configuration withdraws old mapping without reflecting proxy (132.370516ms)
✔ native malformed configuration withdraws old mapping without reflecting revoked-proxy (152.203331ms)
✔ native malformed configuration withdraws old mapping without reflecting mapping-getter (136.583401ms)
✔ native malformed configuration withdraws old mapping without reflecting sites-getter (123.234115ms)
✔ native malformed configuration withdraws old mapping without reflecting callback-proxy (148.711677ms)
✔ native caught malformed reconfiguration during observe cannot retain old grant (124.052836ms)
✔ native full current trust roster refuses sparse (115.786719ms)
✔ native full current trust roster refuses revoked-proxy (117.655661ms)
✔ native full current trust roster refuses prototype (119.859447ms)
✔ native full current trust roster refuses hidden-key (120.98811ms)
✔ native full current trust roster refuses symbol-key (117.813409ms)
✔ native full current trust roster refuses unicode-id (118.731565ms)
✔ native full current trust roster refuses duplicate-key (120.788128ms)
✔ native full current trust roster refuses unrelated-weak-key (117.937136ms)
✔ native recursive bounded association preflight refuses generation-getter (116.629202ms)
✔ native recursive bounded association preflight refuses generation-proxy (116.437832ms)
✔ native recursive bounded association preflight refuses generation-hidden (118.555719ms)
✔ native recursive bounded association preflight refuses association-utf8 (115.787521ms)
✔ native recursive bounded association preflight refuses request-utf8 (120.275976ms)
✔ native recursive bounded association preflight refuses prototype (118.612405ms)
✔ native complete 256-key trust roster accepts canonical current signer at final position (1091.098569ms)
✔ native 257-entry trust roster refuses before reading any entry descriptor (116.137549ms)
✔ native exact 160-byte UTF8 association identity remains accepted (146.833817ms)
✔ native strict prime-subgroup trusted-key capture precedes permissive OpenSSL (289.84443ms)
✔ native strict prime-subgroup signature-R capture precedes permissive OpenSSL (302.66746ms)
✔ native second sampled clock still refuses expiry reached during trust reload (124.68185ms)
✔ native configuration replacement during current trust reload refuses old grant (123.896816ms)
✔ native whole-roster descriptor preflight precedes every key import (115.604307ms)
✔ exact synthetic Ed25519 signatures and redacted frozen summary (23.683198ms)
✔ fingerprints independently bind all supplied public identities without redefining registryHash (84.811496ms)
✔ all changed nested envelope leaves invalidate retained signatures, even with updated binding fields (647.791514ms)
✔ exactly finance then security; no partial/extra/reordered/role-substituted bundle (39.900826ms)
✔ identity and person separation includes preparer, executor and operations (114.907193ms)
✔ duplicate roster IDs/keys and key substitution fail even in unused entries (32.679386ms)
✔ canonical padded 64-byte signature base64, including unused padding bits (49.306884ms)
✔ SPKI public-only Ed25519 with canonical PEM, no private/alternate/trailing encoding (3.647766ms)
✔ legacy review/release purpose signatures do not substitute for offline approvals (12.493638ms)
✔ all input object depths reject unsupported/missing/nonenumerable/symbol/accessor properties (257.006288ms)
✔ proxies, revoked proxies, coercions and wrong root types never invoke caller code (170.746858ms)
✔ bounded IDs/people/list counts and malformed sparse arrays (806.643769ms)
✔ caller mutations cannot alter a captured summary or leave a verification cache (12.764577ms)
✔ expired historical input is only cryptographic evidence; no current truth or policy bypass (12.09766ms)
✔ independent signature and roster fingerprint vectors (15.621449ms)
✔ noncanonical Ed25519 scalar and synthetic weak-point forgeries are refused (6.186498ms)
✔ roster decoding rejects every torsion point and malformed compressed point independently of native verify (13.629913ms)
✔ mixed-torsion roster points fail the local prime-subgroup policy (13.909215ms)
✔ mixed-torsion signature R never reaches a permissive native verifier (49.305312ms)
✔ invalid R/scalars never reach even a permissive native verifier (101.837075ms)
✔ all out-of-field encodings fail and valid sign/scalar boundaries still reach native verification (27.85196ms)
✔ CA/false: Platform initializes empty storage; explicit generation/session/receipts survive restart (193.450096ms)
✔ US/false: Platform initializes empty storage; explicit generation/session/receipts survive restart (152.372343ms)
✔ CA/true: Platform initializes empty storage; explicit generation/session/receipts survive restart (153.085889ms)
✔ US/true: Platform initializes empty storage; explicit generation/session/receipts survive restart (153.989915ms)
✔ all storage methods require the caller's existing native transaction and reject owner-scope escape (68.756141ms)
✔ two native connections compare the exact retained head and stale CAS cannot append anything (102.060412ms)
✔ late head failure rolls back journal, receipt reservation and other native writes atomically (127.424657ms)
✔ global request identity and binding remain reserved across closed sessions and generations (251.608591ms)
✔ copied or swapped generation bindings refuse native writes; rotation retains historical sessions (153.554186ms)
✔ durable read refuses head-hash instead of trusting a plausible head (108.909008ms)
✔ durable read refuses head-revision instead of trusting a plausible head (107.50538ms)
✔ durable read refuses head-state instead of trusting a plausible head (110.024592ms)
✔ durable read refuses journal-hash instead of trusting a plausible head (106.838283ms)
✔ durable read refuses journal-deletion instead of trusting a plausible head (113.311985ms)
✔ durable read refuses generation instead of trusting a plausible head (106.20095ms)
✔ durable read refuses receipt-hash instead of trusting a plausible head (111.784319ms)
✔ durable read refuses receipt-deletion instead of trusting a plausible head (111.775426ms)
✔ append-only SQL guards reject ordinary updates/deletes and STRICT tables reject invalid types (116.803255ms)
✔ normal/revoked proxy or accessor input cannot execute traps or change storage (149.683815ms)
✔ native generation creation rejects foreign schema/region/organization/source bindings and leaves no authority (129.491436ms)
✔ retained prepared release blocks opening and cannot disappear on generation rotation (163.416534ms)
✔ retained superseded release blocks opening and cannot disappear on generation rotation (171.219245ms)
✔ retained rolled-back release blocks opening and cannot disappear on generation rotation (162.505568ms)
✔ stored generation, task and anchor are detached from caller mutation; accessor anchors never execute (112.910838ms)
✔ oversized durable text is refused by byte preflight before historical parsing (87.560034ms)
ℹ tests 217
ℹ suites 0
ℹ pass 173
ℹ fail 44
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15391.134059

✖ failing tests:

test at tests/restore-activation.test.ts:1:4845
✖ CA/false persistent release controls the real gate and restarts closed (81.421869ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:242:17)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.start (node:internal/test_runner/test:1242:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:4845
✖ CA/true persistent release controls the real gate and restarts closed (73.242068ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:242:17)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:4845
✖ US/false persistent release controls the real gate and restarts closed (61.125374ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:242:17)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:4845
✖ US/true persistent release controls the real gate and restarts closed (64.452586ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:242:17)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6031
✖ default disabled rejects preparation before adapter IO (63.36255ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:288:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6327
✖ unknown provider declaration and invalid signatures cannot prepare (68.131979ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:298:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ candidate changes retain a durable hold without routing (61.185655ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ evidence changes retain a durable hold without routing (57.427161ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ trust changes retain a durable hold without routing (60.794845ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ expiry changes retain a durable hold without routing (58.193398ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ replacement changes retain a durable hold without routing (57.598831ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ backwards changes retain a durable hold without routing (55.630249ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:7695
✖ fence lost response resumes by observing, never resending (60.373238ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:343:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:7695
✖ routeCandidate lost response resumes by observing, never resending (59.19463ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:343:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:8367
✖ failed fencing and unsettled controls never route or release (57.463907ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:373:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:8732
✖ concurrent operator cannot claim a second release or replay controls (57.891983ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:385:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:9418
✖ internal writer in another process during routing invalidates release (56.322754ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:410:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10119
✖ ordinary application commands are held during the release lifecycle (58.097263ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:436:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10482
✖ rollback with none effects preserves history and never rewinds writes (59.87727ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:459:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10482
✖ rollback with internal effects preserves history and never rewinds writes (56.221372ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:459:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10482
✖ rollback with external effects preserves history and never rewinds writes (73.966777ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:459:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10482
✖ rollback with unknown effects preserves history and never rewinds writes (58.197389ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:459:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:11075
✖ rollback lost response inspects source route on restart without replay (57.899825ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:479:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:11718
✖ expiry and lost current authority close an already released gate (58.447562ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:504:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:12417
✖ v16/false exact fresh-file upgrade preserves hold and source bytes (59.887726ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:528:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:12417
✖ v16/true exact fresh-file upgrade preserves hold and source bytes (57.931903ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:528:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:13781
✖ encrypted restore of released store retains history but cannot inherit release (57.025185ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:578:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:14411
✖ read-only review signatures cannot authorize activation, and release signatures cannot move to another binding (60.131343ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:600:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current cursor authority drift closes released gate (57.394902ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current hash authority drift closes released gate (57.984884ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current binding authority drift closes released gate (58.202602ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current token authority drift closes released gate (59.169961ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current stale authority drift closes released gate (57.398968ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current unknown authority drift closes released gate (57.801045ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current trust authority drift closes released gate (57.833655ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15666
✖ actual process exit after routing intent restarts held and observes exactly one control (57.217254ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:648:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:712
✖ fresh reviewed forward release supersedes an expired held generation without erasing history (57.299619ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:709:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:1576
✖ copied pending provider intent refuses release despite signed report declarations (58.878271ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:731:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:1576
✖ copied running provider intent refuses release despite signed report declarations (57.334401ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:731:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:1576
✖ copied unknown provider intent refuses release despite signed report declarations (65.170403ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:731:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:1576
✖ copied blocked provider intent refuses release despite signed report declarations (58.395944ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:731:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-native-dispositions.test.ts:1:22348
✖ full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review (144.456611ms)
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
✖ full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority (190.867258ms)
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
✖ full restore: historical dispositions preserve dossier evidence and release signatures through activation (202.304286ms)
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

### exclusion-comparators-final.log

```text
✖ CA/false persistent release controls the real gate and restarts closed (124.834448ms)
✖ CA/true persistent release controls the real gate and restarts closed (92.623043ms)
✖ US/false persistent release controls the real gate and restarts closed (95.685526ms)
✖ US/true persistent release controls the real gate and restarts closed (88.442509ms)
✖ default disabled rejects preparation before adapter IO (84.649729ms)
✖ unknown provider declaration and invalid signatures cannot prepare (82.131322ms)
✖ candidate changes retain a durable hold without routing (76.968906ms)
✖ evidence changes retain a durable hold without routing (78.571384ms)
✖ trust changes retain a durable hold without routing (87.212217ms)
✖ expiry changes retain a durable hold without routing (77.849565ms)
✖ replacement changes retain a durable hold without routing (99.341694ms)
✖ backwards changes retain a durable hold without routing (92.843632ms)
✖ fence lost response resumes by observing, never resending (75.831069ms)
✖ routeCandidate lost response resumes by observing, never resending (77.427978ms)
✖ failed fencing and unsettled controls never route or release (77.976888ms)
✖ concurrent operator cannot claim a second release or replay controls (82.084778ms)
✖ internal writer in another process during routing invalidates release (75.889326ms)
✖ ordinary application commands are held during the release lifecycle (92.624966ms)
✖ rollback with none effects preserves history and never rewinds writes (82.867098ms)
✖ rollback with internal effects preserves history and never rewinds writes (77.584344ms)
✖ rollback with external effects preserves history and never rewinds writes (79.096657ms)
✖ rollback with unknown effects preserves history and never rewinds writes (77.185362ms)
✖ rollback lost response inspects source route on restart without replay (80.932147ms)
✖ expiry and lost current authority close an already released gate (83.038918ms)
✖ v16/false exact fresh-file upgrade preserves hold and source bytes (84.031376ms)
✖ v16/true exact fresh-file upgrade preserves hold and source bytes (83.016033ms)
✖ encrypted restore of released store retains history but cannot inherit release (104.343855ms)
✖ read-only review signatures cannot authorize activation, and release signatures cannot move to another binding (111.920231ms)
✖ current cursor authority drift closes released gate (104.51954ms)
✖ current hash authority drift closes released gate (80.1651ms)
✖ current binding authority drift closes released gate (86.681726ms)
✖ current token authority drift closes released gate (129.93048ms)
✖ current stale authority drift closes released gate (79.58233ms)
✖ current unknown authority drift closes released gate (109.904378ms)
✖ current trust authority drift closes released gate (97.147438ms)
✖ actual process exit after routing intent restarts held and observes exactly one control (78.615972ms)
✖ fresh reviewed forward release supersedes an expired held generation without erasing history (87.488489ms)
✖ copied pending provider intent refuses release despite signed report declarations (100.005096ms)
✖ copied running provider intent refuses release despite signed report declarations (89.24166ms)
✖ copied unknown provider intent refuses release despite signed report declarations (76.457984ms)
✖ copied blocked provider intent refuses release despite signed report declarations (76.631267ms)
✔ native queue CA/CAD/false: real cancellation and settled renewal preserve all owner rows (378.674195ms)
✔ native queue US/USD/true: real cancellation and settled renewal preserve all owner rows (368.582211ms)
✔ native queue CA/USD/true: real cancellation and settled renewal preserve all owner rows (375.369466ms)
✔ native queue canceled Canada Post membership reporting=false (254.747381ms)
✔ native queue canceled Canada Post membership reporting=true (244.04985ms)
✔ native queue defaults closed without native/external association; dossier-style IDs cannot supply one (121.302602ms)
✔ native queue always requires the existing writer transaction (201.348713ms)
✔ native queue fresh association rejects revocation, cached grants, changed binding and ambiguous mappings (246.437749ms)
✔ native queue repeats IAM role, site, password and tenant checks under the same transaction (427.803585ms)
✔ native queue checks current finance role/password rather than copied grant (347.74783ms)
✔ native queue pending successor remains independent (unknown=false) (283.927089ms)
✔ native queue pending successor remains independent (unknown=true) (316.760558ms)
✔ native queue canceled group does not settle its ordinary pending booking (197.459392ms)
✔ native queue malformed/duplicate/missing receipt or changed cancellation/renewal/binding is unresolved (815.640379ms)
✔ native queue Canada Post complete receipt/member/group corruption cannot project (393.738402ms)
✔ native queue faulty maintenance callback cannot mutate owner history inside its transaction (204.112504ms)
✔ native queue current snapshot sees uncommitted receipt damage and rolls back (273.559857ms)
✖ full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review (192.501348ms)
✖ full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority (245.946127ms)
✔ native queue current configuration withdrawal during observation refuses retained grant (198.556317ms)
✔ native queue preserves every independent callback, journal, auth, revocation and read/poll claim blocker (252.872361ms)
✔ native queue complete history scans cannot hide an extra blocked effect or ambiguous late receipt (323.075476ms)
✖ full restore: historical dispositions preserve dossier evidence and release signatures through activation (313.322351ms)
✔ native queue ordinary terminal store needs no historical maintenance grant (115.168798ms)
✔ native queue rejects and rolls back a callback-created independent claim after its initial scan (229.203184ms)
✔ native queue preliminary eligibility refuses unrelated blocked stripe intent before authority (147.992553ms)
✔ native queue preliminary eligibility refuses unrelated blocked quickbooks intent before authority (147.305847ms)
✔ native queue preliminary eligibility requires the exact owning org/effect identity (381.875281ms)
✔ native queue preliminary eligibility never substitutes for current authority or complete evidence (275.974602ms)
✔ native historical projection accepts fresh canonical signed association without writes or hold release (243.455423ms)
✔ native exact signed request refuses substituted orgId (200.381512ms)
✔ native exact signed request refuses substituted projection (189.145964ms)
✔ native exact signed request refuses substituted recordId (196.140471ms)
✔ native exact signed request refuses substituted nativePrincipalId (226.714649ms)
✔ native exact signed request refuses substituted externalAuthorityId (203.999153ms)
✔ native exact signed request refuses substituted purpose (162.883604ms)
✔ native exact signed request refuses substituted challenge (164.661998ms)
✔ native exact signed request refuses substituted generation (164.299151ms)
✔ native signed recovery generation refuses changed snapshotHash (162.61625ms)
✔ native signed recovery generation refuses changed restoredAt (219.158108ms)
✔ native signed recovery generation refuses changed sourceCompletedAt (174.59134ms)
✔ native replay cannot reuse prior valid target/challenge (202.724719ms)
✔ native current trust revocation during observation wins (170.054056ms)
✔ native configuration replacement during observation refuses old grant (171.549375ms)
✔ native current clock refuses expiry (173.022176ms)
✔ native current clock refuses rollback (176.153394ms)
✔ native current clock refuses future (207.729373ms)
✔ native current clock refuses too-long (194.795936ms)
✔ native copied principal loses inactive authority in current same-writer snapshot (209.769823ms)
✔ native copied principal loses role authority in current same-writer snapshot (208.93223ms)
✔ native copied principal loses site authority in current same-writer snapshot (201.587197ms)
✔ native copied principal loses tenant authority in current same-writer snapshot (229.933898ms)
✔ native copied principal loses current password authority in current same-writer snapshot (200.079517ms)
✔ native small-order trusted key forgery refused 01000000-00 (169.781741ms)
✔ native small-order trusted key forgery refused c7176a70-7a (178.783422ms)
✔ native small-order trusted key forgery refused 00000000-80 (173.834603ms)
✔ native small-order trusted key forgery refused 26e8958f-05 (169.189983ms)
✔ native small-order trusted key forgery refused ecffffff-7f (171.046235ms)
✔ native small-order trusted key forgery refused 26e8958f-85 (166.527273ms)
✔ native small-order trusted key forgery refused 00000000-00 (161.093572ms)
✔ native small-order trusted key forgery refused c7176a70-fa (171.750568ms)
✔ native canonical Ed25519 encoding refuses scalar (170.253418ms)
✔ native canonical Ed25519 encoding refuses signature-pad-bits (167.232231ms)
✔ native canonical Ed25519 encoding refuses key-trailing-bytes (176.53775ms)
✔ native canonical Ed25519 encoding refuses key-leading-junk (164.651048ms)
✔ native byte/descriptor preflight observation getter precedes active reflection (179.05477ms)
✔ native byte/descriptor preflight observation proxy precedes active reflection (219.416767ms)
✔ native byte/descriptor preflight observation extra-key precedes active reflection (240.690904ms)
✔ native byte/descriptor preflight observation oversized precedes active reflection (215.39361ms)
✔ native byte/descriptor preflight request getter precedes active reflection (170.055395ms)
✔ native byte/descriptor preflight request proxy precedes active reflection (175.525272ms)
✔ native byte/descriptor preflight request extra-key precedes active reflection (223.422719ms)
✔ native byte/descriptor preflight request oversized precedes active reflection (212.542301ms)
✔ native byte/descriptor preflight trust-array getter precedes active reflection (179.600253ms)
✔ native byte/descriptor preflight trust-array proxy precedes active reflection (171.839779ms)
✔ native byte/descriptor preflight trust-array extra-key precedes active reflection (173.102806ms)
✔ native byte/descriptor preflight trust-array oversized precedes active reflection (182.311625ms)
✔ native byte/descriptor preflight trust-entry getter precedes active reflection (163.634083ms)
✔ native byte/descriptor preflight trust-entry proxy precedes active reflection (168.644335ms)
✔ native byte/descriptor preflight trust-entry extra-key precedes active reflection (180.295177ms)
✔ native byte/descriptor preflight trust-entry oversized precedes active reflection (235.014055ms)
✔ native same-writer observer mutation cannot grant projection or persist writes (174.002202ms)
✔ native explicit composition refuses duplicate-mapping (174.88442ms)
✔ native explicit composition refuses foreign-principal (166.04345ms)
✔ native explicit composition refuses missing-mapping (174.743181ms)
✔ native independently current cryptographic authority refuses invalid-signature (165.988337ms)
✔ native independently current cryptographic authority refuses truncated-signature (166.126856ms)
✔ native independently current cryptographic authority refuses duplicate-trust (168.845019ms)
✔ native independently current cryptographic authority refuses changed-key (178.483126ms)
✔ native observation rejects hidden symbol key (174.032108ms)
✔ native observation rejects hidden nonenumerable key (171.240585ms)
✔ native oversized associationId refuses before trusted-key getter (172.993771ms)
✔ native oversized signature refuses before trusted-key getter (188.2742ms)
✔ native signature R small-order substitution refused 01000000-00 (182.024793ms)
✔ native signature R small-order substitution refused c7176a70-7a (193.111227ms)
✔ native signature R small-order substitution refused 00000000-80 (160.872199ms)
✔ native signature R small-order substitution refused 26e8958f-05 (167.942126ms)
✔ native signature R small-order substitution refused ecffffff-7f (166.394039ms)
✔ native signature R small-order substitution refused 26e8958f-85 (161.278278ms)
✔ native signature R small-order substitution refused 00000000-00 (166.821003ms)
✔ native signature R small-order substitution refused c7176a70-fa (167.645207ms)
✔ native malformed configuration withdraws old mapping without reflecting getter (158.752044ms)
✔ native malformed configuration withdraws old mapping without reflecting proxy (162.476486ms)
✔ native malformed configuration withdraws old mapping without reflecting revoked-proxy (159.893071ms)
✔ native malformed configuration withdraws old mapping without reflecting mapping-getter (161.052186ms)
✔ native malformed configuration withdraws old mapping without reflecting sites-getter (167.625258ms)
✔ native malformed configuration withdraws old mapping without reflecting callback-proxy (183.174152ms)
✔ native caught malformed reconfiguration during observe cannot retain old grant (183.621448ms)
✔ native full current trust roster refuses sparse (165.324385ms)
✔ native full current trust roster refuses revoked-proxy (162.06153ms)
✔ native full current trust roster refuses prototype (162.474423ms)
✔ native full current trust roster refuses hidden-key (156.691654ms)
✔ native full current trust roster refuses symbol-key (157.90117ms)
✔ native full current trust roster refuses unicode-id (156.164368ms)
✔ native full current trust roster refuses duplicate-key (160.817031ms)
✔ native full current trust roster refuses unrelated-weak-key (161.742469ms)
✔ native recursive bounded association preflight refuses generation-getter (157.315946ms)
✔ native recursive bounded association preflight refuses generation-proxy (162.101771ms)
✔ native recursive bounded association preflight refuses generation-hidden (163.459309ms)
✔ native recursive bounded association preflight refuses association-utf8 (166.226887ms)
✔ native recursive bounded association preflight refuses request-utf8 (172.533687ms)
✔ native recursive bounded association preflight refuses prototype (166.647702ms)
✔ native complete 256-key trust roster accepts canonical current signer at final position (1196.544212ms)
✔ native 257-entry trust roster refuses before reading any entry descriptor (162.680504ms)
✔ native exact 160-byte UTF8 association identity remains accepted (182.756627ms)
✔ native strict prime-subgroup trusted-key capture precedes permissive OpenSSL (342.29607ms)
✔ native strict prime-subgroup signature-R capture precedes permissive OpenSSL (357.822887ms)
✔ native second sampled clock still refuses expiry reached during trust reload (170.840591ms)
✔ native configuration replacement during current trust reload refuses old grant (167.758689ms)
✔ native whole-roster descriptor preflight precedes every key import (171.550892ms)
✔ exact synthetic Ed25519 signatures and redacted frozen summary (36.456071ms)
✔ fingerprints independently bind all supplied public identities without redefining registryHash (66.762595ms)
✔ all changed nested envelope leaves invalidate retained signatures, even with updated binding fields (874.704605ms)
✔ exactly finance then security; no partial/extra/reordered/role-substituted bundle (40.874234ms)
✔ identity and person separation includes preparer, executor and operations (125.115568ms)
✔ duplicate roster IDs/keys and key substitution fail even in unused entries (32.055134ms)
✔ canonical padded 64-byte signature base64, including unused padding bits (51.754768ms)
✔ SPKI public-only Ed25519 with canonical PEM, no private/alternate/trailing encoding (3.350056ms)
✔ legacy review/release purpose signatures do not substitute for offline approvals (13.493677ms)
✔ all input object depths reject unsupported/missing/nonenumerable/symbol/accessor properties (314.362749ms)
✔ proxies, revoked proxies, coercions and wrong root types never invoke caller code (190.761408ms)
✔ bounded IDs/people/list counts and malformed sparse arrays (915.011983ms)
✔ caller mutations cannot alter a captured summary or leave a verification cache (20.525391ms)
✔ expired historical input is only cryptographic evidence; no current truth or policy bypass (21.57814ms)
✔ independent signature and roster fingerprint vectors (27.601201ms)
✔ noncanonical Ed25519 scalar and synthetic weak-point forgeries are refused (10.809476ms)
✔ roster decoding rejects every torsion point and malformed compressed point independently of native verify (18.899336ms)
✔ mixed-torsion roster points fail the local prime-subgroup policy (13.898337ms)
✔ mixed-torsion signature R never reaches a permissive native verifier (52.231017ms)
✔ invalid R/scalars never reach even a permissive native verifier (104.749557ms)
✔ all out-of-field encodings fail and valid sign/scalar boundaries still reach native verification (28.956346ms)
✔ CA/false: Platform initializes empty storage; explicit generation/session/receipts survive restart (279.377552ms)
✔ US/false: Platform initializes empty storage; explicit generation/session/receipts survive restart (259.54304ms)
✔ CA/true: Platform initializes empty storage; explicit generation/session/receipts survive restart (229.008001ms)
✔ US/true: Platform initializes empty storage; explicit generation/session/receipts survive restart (213.453693ms)
✔ all storage methods require the caller's existing native transaction and reject owner-scope escape (94.229879ms)
✔ two native connections compare the exact retained head and stale CAS cannot append anything (129.338691ms)
✔ late head failure rolls back journal, receipt reservation and other native writes atomically (149.677901ms)
✔ global request identity and binding remain reserved across closed sessions and generations (299.339108ms)
✔ copied or swapped generation bindings refuse native writes; rotation retains historical sessions (208.79403ms)
✔ durable read refuses head-hash instead of trusting a plausible head (143.037429ms)
✔ durable read refuses head-revision instead of trusting a plausible head (166.711997ms)
✔ durable read refuses head-state instead of trusting a plausible head (132.790161ms)
✔ durable read refuses journal-hash instead of trusting a plausible head (139.167522ms)
✔ durable read refuses journal-deletion instead of trusting a plausible head (172.200632ms)
✔ durable read refuses generation instead of trusting a plausible head (190.593984ms)
✔ durable read refuses receipt-hash instead of trusting a plausible head (160.368673ms)
✔ durable read refuses receipt-deletion instead of trusting a plausible head (149.287412ms)
✔ append-only SQL guards reject ordinary updates/deletes and STRICT tables reject invalid types (183.596848ms)
✔ normal/revoked proxy or accessor input cannot execute traps or change storage (164.341725ms)
✔ native generation creation rejects foreign schema/region/organization/source bindings and leaves no authority (149.002612ms)
✔ retained prepared release blocks opening and cannot disappear on generation rotation (204.800593ms)
✔ retained superseded release blocks opening and cannot disappear on generation rotation (199.581796ms)
✔ retained rolled-back release blocks opening and cannot disappear on generation rotation (238.760101ms)
✔ stored generation, task and anchor are detached from caller mutation; accessor anchors never execute (137.454501ms)
✔ oversized durable text is refused by byte preflight before historical parsing (103.877611ms)
ℹ tests 217
ℹ suites 0
ℹ pass 173
ℹ fail 44
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 20526.389178

✖ failing tests:

test at tests/restore-activation.test.ts:1:4845
✖ CA/false persistent release controls the real gate and restarts closed (124.834448ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:242:17)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.start (node:internal/test_runner/test:1242:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:4845
✖ CA/true persistent release controls the real gate and restarts closed (92.623043ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:242:17)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:4845
✖ US/false persistent release controls the real gate and restarts closed (95.685526ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:242:17)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:4845
✖ US/true persistent release controls the real gate and restarts closed (88.442509ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:242:17)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6031
✖ default disabled rejects preparation before adapter IO (84.649729ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:288:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6327
✖ unknown provider declaration and invalid signatures cannot prepare (82.131322ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:298:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ candidate changes retain a durable hold without routing (76.968906ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ evidence changes retain a durable hold without routing (78.571384ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ trust changes retain a durable hold without routing (87.212217ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ expiry changes retain a durable hold without routing (77.849565ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ replacement changes retain a durable hold without routing (99.341694ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:6952
✖ backwards changes retain a durable hold without routing (92.843632ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:320:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:7695
✖ fence lost response resumes by observing, never resending (75.831069ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:343:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:7695
✖ routeCandidate lost response resumes by observing, never resending (77.427978ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:343:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:8367
✖ failed fencing and unsettled controls never route or release (77.976888ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:373:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:8732
✖ concurrent operator cannot claim a second release or replay controls (82.084778ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:385:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:9418
✖ internal writer in another process during routing invalidates release (75.889326ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:410:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10119
✖ ordinary application commands are held during the release lifecycle (92.624966ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:436:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10482
✖ rollback with none effects preserves history and never rewinds writes (82.867098ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:459:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10482
✖ rollback with internal effects preserves history and never rewinds writes (77.584344ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:459:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10482
✖ rollback with external effects preserves history and never rewinds writes (79.096657ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:459:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:10482
✖ rollback with unknown effects preserves history and never rewinds writes (77.185362ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:459:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:11075
✖ rollback lost response inspects source route on restart without replay (80.932147ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:479:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:11718
✖ expiry and lost current authority close an already released gate (83.038918ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:504:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:12417
✖ v16/false exact fresh-file upgrade preserves hold and source bytes (84.031376ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:528:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:12417
✖ v16/true exact fresh-file upgrade preserves hold and source bytes (83.016033ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:528:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:13781
✖ encrypted restore of released store retains history but cannot inherit release (104.343855ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:578:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:14411
✖ read-only review signatures cannot authorize activation, and release signatures cannot move to another binding (111.920231ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:600:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current cursor authority drift closes released gate (104.51954ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current hash authority drift closes released gate (80.1651ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current binding authority drift closes released gate (86.681726ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current token authority drift closes released gate (129.93048ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current stale authority drift closes released gate (79.58233ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current unknown authority drift closes released gate (109.904378ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15056
✖ current trust authority drift closes released gate (97.147438ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:626:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:1:15666
✖ actual process exit after routing intent restarts held and observes exactly one control (78.615972ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:648:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:712
✖ fresh reviewed forward release supersedes an expired held generation without erasing history (87.488489ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:709:13)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:1576
✖ copied pending provider intent refuses release despite signed report declarations (100.005096ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:731:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:1576
✖ copied running provider intent refuses release despite signed report declarations (89.24166ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:731:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:1576
✖ copied unknown provider intent refuses release despite signed report declarations (76.457984ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:731:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-activation.test.ts:14:1576
✖ copied blocked provider intent refuses release despite signed report declarations (76.631267ms)
  Error: Candidate files changed during inspection.
      at check (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/core.ts:19:21)
      at <anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-candidate-snapshot.ts:69:7)
      at captureRestoreCandidate (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/src/server/restore-review.ts:112:5)
      at setup (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:55:21)
      at TestContext.<anonymous> (/workspace/scratch/462e9eb917f3/Distributor-maintenance-authority/tests/restore-activation.test.ts:731:15)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12) {
    code: 'RESTORE_REVIEW_CHANGED',
    status: 409
  }

test at tests/restore-native-dispositions.test.ts:1:22348
✖ full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review (192.501348ms)
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
✖ full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority (245.946127ms)
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
✖ full restore: historical dispositions preserve dossier evidence and release signatures through activation (313.322351ms)
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

### exclusion-final-green.log

```text
✔ CA generation-only excludes new real Catalog command and conserves rows (148.644331ms)
✔ CA generation-only excludes cached real Catalog command and conserves rows (125.455831ms)
✔ CA isolated excludes new real Catalog command and conserves rows (134.565951ms)
✔ CA isolated excludes cached real Catalog command and conserves rows (194.596376ms)
✔ CA open excludes new real Catalog command and conserves rows (201.023251ms)
✔ CA open excludes cached real Catalog command and conserves rows (234.040878ms)
✔ CA draining excludes new real Catalog command and conserves rows (267.277334ms)
✔ CA draining excludes cached real Catalog command and conserves rows (228.592028ms)
✔ CA invalidated excludes new real Catalog command and conserves rows (207.741317ms)
✔ CA invalidated excludes cached real Catalog command and conserves rows (191.854147ms)
✔ CA uninitialized history and valid closed phase retain ordinary command compatibility without provider rights (308.374406ms)
✔ CA retained open exclusion survives restart on same actual storage/writer (156.579673ms)
✔ US generation-only excludes new real Catalog command and conserves rows (160.535856ms)
✔ US generation-only excludes cached real Catalog command and conserves rows (120.397406ms)
✔ US isolated excludes new real Catalog command and conserves rows (145.182685ms)
✔ US isolated excludes cached real Catalog command and conserves rows (142.533017ms)
✔ US open excludes new real Catalog command and conserves rows (150.842178ms)
✔ US open excludes cached real Catalog command and conserves rows (153.155641ms)
✔ US draining excludes new real Catalog command and conserves rows (169.555524ms)
✔ US draining excludes cached real Catalog command and conserves rows (167.821386ms)
✔ US invalidated excludes new real Catalog command and conserves rows (224.638867ms)
✔ US invalidated excludes cached real Catalog command and conserves rows (204.64643ms)
✔ US uninitialized history and valid closed phase retain ordinary command compatibility without provider rights (330.17536ms)
✔ US retained open exclusion survives restart on same actual storage/writer (217.9495ms)
✔ normal command fails closed on head-json rather than treating it as empty (207.269013ms)
✔ normal command fails closed on missing-head rather than treating it as empty (168.30049ms)
✔ normal command fails closed on raw-generation rather than treating it as empty (203.468998ms)
✔ normal command fails closed on missing-hold rather than treating it as empty (168.782407ms)
✔ command guard uses its fixed constructor storage despite public read-method substitution (158.097705ms)
✔ ordinary new command rechecks phase after authorization callback (242.425814ms)
✔ ordinary cached command rechecks phase after authorization callback (298.926976ms)
✔ ordinary perform callback cannot commit a newly opened maintenance session with its command (240.094549ms)
✔ command result serialization cannot hide a newly isolated maintenance session (242.051699ms)
✔ CA OPEN offline phase refuses prepare before cached return/proof/write/control (152.348562ms)
✔ CA OPEN offline phase refuses activate before cached return/proof/write/control (154.405187ms)
✔ CA OPEN offline phase refuses approveRelease before cached return/proof/write/control (146.736742ms)
✔ US OPEN offline phase refuses prepare before cached return/proof/write/control (145.647198ms)
✔ US OPEN offline phase refuses activate before cached return/proof/write/control (148.939406ms)
✔ US OPEN offline phase refuses approveRelease before cached return/proof/write/control (150.993857ms)
✔ actual retained release control fence refuses active maintenance before adapter IO (147.929091ms)
✔ actual retained release control routeCandidate refuses active maintenance before adapter IO (143.357261ms)
✔ actual retained release control routeSource refuses active maintenance before adapter IO (151.217169ms)
✔ rollback keeps safety stop available without approvals while excluding observe/source routing in OPEN phase (149.770957ms)
✔ retained history cannot conceal substitution of a previously retained native release (145.994538ms)
✔ release fence rechecks complete phase after current-trust callback damage before control (188.498593ms)
✔ release routeCandidate rechecks complete phase after current-trust callback damage before control (281.88882ms)
✔ release routeSource rechecks complete phase after current-trust callback damage before control (278.008302ms)
✔ closed offline phase keeps canonical approved native control available under original gates (194.934649ms)
✔ isolated phase refuses retained prepare without release/audit effects (137.960601ms)
✔ isolated phase refuses retained activate without release/audit effects (129.421211ms)
✔ draining phase refuses retained prepare without release/audit effects (163.126186ms)
✔ draining phase refuses retained activate without release/audit effects (169.515531ms)
✔ invalidated phase refuses retained prepare without release/audit effects (171.68852ms)
✔ invalidated phase refuses retained activate without release/audit effects (159.257386ms)
✔ CA fresh release prepare is excluded before evidence work or release insertion (148.788415ms)
✔ US fresh release prepare is excluded before evidence work or release insertion (144.151435ms)
✔ closed-to-open-to-closed authorization callback cannot hide a changed maintenance revision (295.602084ms)
✔ public Platform offline alias cannot substitute another history for its constructor-paired guard (134.206724ms)
✔ closed phase supplies no release authority after trust revocation (163.79143ms)
✔ adapter observation callback damage rolls back and refuses before any forward routing (251.328741ms)
ℹ tests 60
ℹ suites 0
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12043.654463

```

### Baseline boundary failure summaries

The complete untouched original logs are in the receipt bundle. These title/outcome lines identify every reproduced final baseline refusal failure:

```text
✖ CA generation-only excludes new real Catalog command and conserves rows (127.318797ms)
✖ CA generation-only excludes cached real Catalog command and conserves rows (112.660974ms)
✖ CA isolated excludes new real Catalog command and conserves rows (104.189909ms)
✖ CA isolated excludes cached real Catalog command and conserves rows (101.97734ms)
✖ CA open excludes new real Catalog command and conserves rows (109.071346ms)
✖ CA open excludes cached real Catalog command and conserves rows (109.05404ms)
✖ CA draining excludes new real Catalog command and conserves rows (122.780742ms)
✖ CA draining excludes cached real Catalog command and conserves rows (114.351555ms)
✖ CA invalidated excludes new real Catalog command and conserves rows (128.829997ms)
✖ CA invalidated excludes cached real Catalog command and conserves rows (122.899147ms)
✖ CA retained open exclusion survives restart on same actual storage/writer (127.200257ms)
✖ US generation-only excludes new real Catalog command and conserves rows (83.801668ms)
✖ US generation-only excludes cached real Catalog command and conserves rows (86.808225ms)
✖ US isolated excludes new real Catalog command and conserves rows (102.004782ms)
✖ US isolated excludes cached real Catalog command and conserves rows (95.855951ms)
✖ US open excludes new real Catalog command and conserves rows (101.341609ms)
✖ US open excludes cached real Catalog command and conserves rows (101.094327ms)
✖ US draining excludes new real Catalog command and conserves rows (113.179256ms)
✖ US draining excludes cached real Catalog command and conserves rows (112.944321ms)
✖ US invalidated excludes new real Catalog command and conserves rows (111.476186ms)
✖ US invalidated excludes cached real Catalog command and conserves rows (110.156263ms)
✖ US retained open exclusion survives restart on same actual storage/writer (107.308896ms)
✖ normal command fails closed on head-json rather than treating it as empty (122.732915ms)
✖ normal command fails closed on missing-head rather than treating it as empty (120.52959ms)
✖ normal command fails closed on raw-generation rather than treating it as empty (121.607827ms)
✖ normal command fails closed on missing-hold rather than treating it as empty (127.107637ms)
✖ command guard uses its fixed constructor storage despite public read-method substitution (105.430071ms)
✖ ordinary new command rechecks phase after authorization callback (136.680576ms)
✖ ordinary cached command rechecks phase after authorization callback (139.621919ms)
✖ ordinary perform callback cannot commit a newly opened maintenance session with its command (135.274353ms)
✖ command result serialization cannot hide a newly isolated maintenance session (138.555946ms)
✖ CA OPEN offline phase refuses prepare before cached return/proof/write/control (114.555874ms)
✖ CA OPEN offline phase refuses activate before cached return/proof/write/control (112.338136ms)
✖ CA OPEN offline phase refuses approveRelease before cached return/proof/write/control (111.920906ms)
✖ US OPEN offline phase refuses prepare before cached return/proof/write/control (110.094611ms)
✖ US OPEN offline phase refuses activate before cached return/proof/write/control (121.002834ms)
✖ US OPEN offline phase refuses approveRelease before cached return/proof/write/control (111.983021ms)
✖ actual retained release control fence refuses active maintenance before adapter IO (122.47137ms)
✖ actual retained release control routeCandidate refuses active maintenance before adapter IO (107.267533ms)
✖ actual retained release control routeSource refuses active maintenance before adapter IO (113.474892ms)
✖ rollback keeps safety stop available without approvals while excluding observe/source routing in OPEN phase (103.69376ms)
✖ retained history cannot conceal substitution of a previously retained native release (96.363036ms)
✖ release fence rechecks complete phase after current-trust callback damage before control (128.730497ms)
✖ release routeCandidate rechecks complete phase after current-trust callback damage before control (144.690926ms)
✖ release routeSource rechecks complete phase after current-trust callback damage before control (129.935015ms)
✖ isolated phase refuses retained prepare without release/audit effects (100.462414ms)
✖ isolated phase refuses retained activate without release/audit effects (102.146875ms)
✖ draining phase refuses retained prepare without release/audit effects (123.188092ms)
✖ draining phase refuses retained activate without release/audit effects (124.139097ms)
✖ invalidated phase refuses retained prepare without release/audit effects (120.7485ms)
✖ invalidated phase refuses retained activate without release/audit effects (123.656239ms)
✖ CA fresh release prepare is excluded before evidence work or release insertion (113.004392ms)
✖ US fresh release prepare is excluded before evidence work or release insertion (111.618301ms)
✖ closed-to-open-to-closed authorization callback cannot hide a changed maintenance revision (178.209003ms)
✖ public Platform offline alias cannot substitute another history for its constructor-paired guard (102.753863ms)
✖ adapter observation callback damage rolls back and refuses before any forward routing (133.25049ms)
ℹ tests 60
ℹ suites 0
ℹ pass 4
ℹ fail 56
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7967.074993
✖ failing tests:
✖ CA generation-only excludes new real Catalog command and conserves rows (127.318797ms)
✖ CA generation-only excludes cached real Catalog command and conserves rows (112.660974ms)
✖ CA isolated excludes new real Catalog command and conserves rows (104.189909ms)
✖ CA isolated excludes cached real Catalog command and conserves rows (101.97734ms)
✖ CA open excludes new real Catalog command and conserves rows (109.071346ms)
✖ CA open excludes cached real Catalog command and conserves rows (109.05404ms)
✖ CA draining excludes new real Catalog command and conserves rows (122.780742ms)
✖ CA draining excludes cached real Catalog command and conserves rows (114.351555ms)
✖ CA invalidated excludes new real Catalog command and conserves rows (128.829997ms)
✖ CA invalidated excludes cached real Catalog command and conserves rows (122.899147ms)
✖ CA retained open exclusion survives restart on same actual storage/writer (127.200257ms)
✖ US generation-only excludes new real Catalog command and conserves rows (83.801668ms)
✖ US generation-only excludes cached real Catalog command and conserves rows (86.808225ms)
✖ US isolated excludes new real Catalog command and conserves rows (102.004782ms)
✖ US isolated excludes cached real Catalog command and conserves rows (95.855951ms)
✖ US open excludes new real Catalog command and conserves rows (101.341609ms)
✖ US open excludes cached real Catalog command and conserves rows (101.094327ms)
✖ US draining excludes new real Catalog command and conserves rows (113.179256ms)
✖ US draining excludes cached real Catalog command and conserves rows (112.944321ms)
✖ US invalidated excludes new real Catalog command and conserves rows (111.476186ms)
✖ US invalidated excludes cached real Catalog command and conserves rows (110.156263ms)
✖ US retained open exclusion survives restart on same actual storage/writer (107.308896ms)
✖ normal command fails closed on head-json rather than treating it as empty (122.732915ms)
✖ normal command fails closed on missing-head rather than treating it as empty (120.52959ms)
✖ normal command fails closed on raw-generation rather than treating it as empty (121.607827ms)
✖ normal command fails closed on missing-hold rather than treating it as empty (127.107637ms)
✖ command guard uses its fixed constructor storage despite public read-method substitution (105.430071ms)
✖ ordinary new command rechecks phase after authorization callback (136.680576ms)
✖ ordinary cached command rechecks phase after authorization callback (139.621919ms)
✖ ordinary perform callback cannot commit a newly opened maintenance session with its command (135.274353ms)
✖ command result serialization cannot hide a newly isolated maintenance session (138.555946ms)
✖ CA OPEN offline phase refuses prepare before cached return/proof/write/control (114.555874ms)
✖ CA OPEN offline phase refuses activate before cached return/proof/write/control (112.338136ms)
✖ CA OPEN offline phase refuses approveRelease before cached return/proof/write/control (111.920906ms)
✖ US OPEN offline phase refuses prepare before cached return/proof/write/control (110.094611ms)
✖ US OPEN offline phase refuses activate before cached return/proof/write/control (121.002834ms)
✖ US OPEN offline phase refuses approveRelease before cached return/proof/write/control (111.983021ms)
✖ actual retained release control fence refuses active maintenance before adapter IO (122.47137ms)
✖ actual retained release control routeCandidate refuses active maintenance before adapter IO (107.267533ms)
✖ actual retained release control routeSource refuses active maintenance before adapter IO (113.474892ms)
✖ rollback keeps safety stop available without approvals while excluding observe/source routing in OPEN phase (103.69376ms)
✖ retained history cannot conceal substitution of a previously retained native release (96.363036ms)
✖ release fence rechecks complete phase after current-trust callback damage before control (128.730497ms)
✖ release routeCandidate rechecks complete phase after current-trust callback damage before control (144.690926ms)
✖ release routeSource rechecks complete phase after current-trust callback damage before control (129.935015ms)
✖ isolated phase refuses retained prepare without release/audit effects (100.462414ms)
✖ isolated phase refuses retained activate without release/audit effects (102.146875ms)
✖ draining phase refuses retained prepare without release/audit effects (123.188092ms)
✖ draining phase refuses retained activate without release/audit effects (124.139097ms)
✖ invalidated phase refuses retained prepare without release/audit effects (120.7485ms)
✖ invalidated phase refuses retained activate without release/audit effects (123.656239ms)
✖ CA fresh release prepare is excluded before evidence work or release insertion (113.004392ms)
✖ US fresh release prepare is excluded before evidence work or release insertion (111.618301ms)
✖ closed-to-open-to-closed authorization callback cannot hide a changed maintenance revision (178.209003ms)
✖ public Platform offline alias cannot substitute another history for its constructor-paired guard (102.753863ms)
✖ adapter observation callback damage rolls back and refuses before any forward routing (133.25049ms)
```
