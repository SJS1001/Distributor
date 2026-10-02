# Local warranty duration and claim provenance evidence

Partial D-008/D-030/D-031, REQ-03/17 and scoped CH-06/07/08/10 engineering evidence. All 44 tasks and 10 gates remain NOT VERIFIED. [Hash-bearing companion](LOCAL-WARRANTY-POLICY-2026-10-01.json), [warranty procedure](../WARRANTY.md) and [schema upgrades](../SCHEMA-UPGRADES.md).

Parent `6256cc7c4323b520283430c182daad37f7bb0c52`, branch `codex/local-distributor-checkpoint`. The companion identifies 303 tested input hashes; the subsequent local commit is recorded in the handoff. Direct macOS arm64 workstation, Node 24.16.0/npm 11.13.0, synthetic regional SQLite, separate local OS processes and loopback HTTP/Chromium. Captured commands began 2026-10-02 UTC (2026-10-01 Toronto); actual times, exit codes and log hashes are retained. Current storage version is 5. No dependency, license or workflow change. No CI/cloud runner/session, actual provider/device request, push/PR, deployment, purchase/account or live data.

| Check | Actual outcome |
| --- | --- |
| `npm test` | PASS 1552/1552; includes 12 new policy tests, four additional previous-version upgrade cases and one additional old-archive refusal |
| `npm run test:e2e` | PASS 69/69 with production build; includes one new phone policy/claim/snapshot journey |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `npm run verify:runtime` | PASS, exit 0; 192 copied inputs, 69 exclusively development packages absent, 27 child command records, CA/US each start twice, authenticated PDF/ZPL replay and local encrypted backup/restore |
| Focused policy/warranty/schema/recovery tests | PASS 79/79 |
| Focused phone journey | PASS 1/1 |

The companion retains historical evidence/license hashes, actual command metadata, unchanged tested inputs, final built assets matching the isolated production build, earlier failures/traces and the isolated runtime receipt. Documentation structure/link and whitespace checks are recorded separately and establish no product acceptance.

## What the checks establish

A current administrator changes the whole-day duration with the reviewed policy version and a reason. IAM preserves unrelated organization policy. Policy selection, event, audit and command receipt commit atomically. The unsaved default is version 1; the first explicit choice is version 2. Separate processes competing for the same version produce one selection and one stale-review refusal.

New claims require the reviewed current policy version after an explicit selection. A policy-change/submission race produces a claim valid under the serialized transaction or a stale-review refusal without new facts. Exact retries return the original claim after fresh authority checks, even after policy changes. The claim and public policy/date snapshot commit together; injected late audit faults roll both back along with activity, events and retry receipts. Malformed policy, date arithmetic or replacement lineage fails closed without new facts.

Existing claims retain their submission-time end and policy independently of later current assessments and restart. Replacement claims inherit the preceding claim's end, original shipment and known policy; handover does not restart coverage. Older claims retain dates with an explicitly absent snapshot, and replacements of those claims do not invent policy provenance. Fresh persisted principal, role, site, password and buyer account checks precede historical replay and reads. HTTP schemas reject unexpected query/payload fields, invalid CSRF/origin and wrong-account access. Public projections omit administrator reason and identity.

The independently frozen version-four schema joins the earlier frozen versions. Sixteen previous-version combinations (v1–v4, CA/US, reports on/off) upgrade to a separate fresh version-five file while preserving original source bytes, historical claim dates, session/native records and ciphertext. New snapshot storage is empty for older claims. Unversioned exact layouts receive the same empty addition. Encrypted current-version restore retains both claim snapshots and the independently selected current policy. Authenticated v1–v4 archives are refused rather than implicitly upgraded.

The 390-by-844 phone journey loses a successful policy reply and retries the same key/payload. It rejects a stale claim review, reloads the dates, then loses a successful claim reply; retry after another policy change still returns the original snapshot. A transient snapshot read failure offers retry. Closing restores focus. A buyer sees the retained policy while ordinary current coverage shows the newer policy, without administrative metadata or browser errors.

## Preserved corrections and limits

Initial focused checks exposed a nested policy-reader transaction; the reader now shares the owning transaction. Two test expectations were corrected for fractional revision validation and session revocation; fresh authenticated wrong-account refusal remains checked. Strict empty-query validation was added. The initial phone trace exposed snapshot controls attached to inventory count rows; controls now belong to Returns claim rows. Failed logs and browser traces remain private and hashed, alongside superseded checks. Uncaptured historical command times/exit codes are not invented.

This is provisional duration configuration. Eligibility, expiry enforcement, transferability, product/customer terms, alternative start triggers and vendor approval remain unresolved. Ordinary sale previews use the current policy; immutable assessment begins at claim submission, not original sale. Legacy provenance is unavailable. Separate-process SQLite checks do not qualify distributed writers or throughput. Actual providers/devices, residency infrastructure, production security/load, disk/power recovery, agreed RPO/RTO and operator acceptance remain unqualified. The full system remains incomplete; no product gate is accepted.
