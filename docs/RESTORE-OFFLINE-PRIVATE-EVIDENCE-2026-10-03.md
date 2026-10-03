# Offline envelope private byte binding — 2026-10-03

This three-file prerequisite binds the structural offline envelope to actual private evidence bytes through the unchanged shared reader. It implements no owner parser, qualification verifier, current authority, native write permission, coordinator wiring or release permission. All product gates remain NOT VERIFIED.

Exact excluded base: `ea2f5790c0f1a62e20be7cf6dd00139868ea22e5`, public `SJS1001/Distributor`. Work is isolated on `codex/offline-private-evidence`; earlier Billing/Integration deliveries and other owners' files are preserved. Owned files are the new [implementation](../src/server/restore-offline-private-evidence.ts), [tests](../tests/restore-offline-private-evidence.test.ts), and this report. No existing file is modified. Repository instructions, current offline contract, envelope parser and shared private reader were inspected. The supplied canonical delegated rule requests Astra/High for this boundary; launcher controls and effective model/reasoning verification are unavailable. The workstation-only canonical rule path is unavailable here.

## API and lifetime

`readOfflinePrivateEvidence(envelopeInput, manifestInput, captureInput?)` returns an opaque process-local handle. Inputs are unknown data, not callback ports. The envelope passes the actual `parseOfflineTaskEnvelope`; manifest uses the existing version-one `{version,root,files:[{reference,path}]}` shape. Optional capture has exactly `{references,maxBytes}`. Omit capture to retain no report buffers.

```ts
using evidence = readOfflinePrivateEvidence(envelope, privateManifest, {
  references: [selectedReference],
  maxBytes: selectedBudget,
});
// The caller must separately maintain/recheck its current authority and fence.
const historicalSummary = evidence.complete();
// Disposing the scope erases all selected private buffers, including on throw.
```

Alternatively, always call `dispose()` in `finally`. `Symbol.dispose` and `dispose` perform the same idempotent cleanup. Initial failure erases shared-reader captures; completion failure erases any buffers transferred to this handle. A second completion fails and disposes the handle, including captures retained after a successful first completion. Disposal before completion permanently invalidates completion. The stream buffer is erased by the existing shared reader.

Selected buffers remain closure-private and owned by the handle after successful completion until disposal. The handle has no buffer, map, text, generic JSON or arbitrary-parser callback getter. Its frozen method object is not a claimed deep freeze of mutable Buffers; the internal `ReadonlyMap` annotation is not relied on for runtime security. Future fixed owner parser methods must be implemented inside this private boundary, consume these same retained allocations after successful completion, return only their exact permitted normalized facts, and dispose on success or failure. They cannot be supplied by callers or reopen paths. This increment intentionally does not expose private bytes merely to make a generic future parser possible. Integration of those fixed parsers is a separate prerequisite.

The frozen summary contains only `status:"historical-byte-binding"`, the complete envelope binding, file count, total bytes, set hash and `qualification:"unverified"`. It contains no reference names, paths, raw bytes or qualification permit. Copies of this historical summary have no handle authority and cannot complete again. `qualificationHash` is structurally present in the parsed envelope and envelope binding but is explicitly **unverified**; a matching hash does not authenticate an observation or make a task eligible. The function does not inspect a clock or claim that evidence remains current after completion.

## Exact byte binding

1. Reject proxies before reflection; reject accessors, exotic prototypes, symbols, nonenumerable/unknown fields, sparse arrays and excessive depth/list/string/node sizes without invoking caller code. List length is checked before whole-list reflection or copying. Capture lists are bounded to sixteen before that reflection. Strict shape/budget validation and detachment occur before shared-reader byte allocations or filesystem access.
2. Require 1–1,000 envelope items and exact manifest coverage. Every distinct manifest reference belongs to the envelope; duplicate references, duplicate paths, extras, omissions and unsafe paths refuse. Enforce the unchanged 64 MiB/file and 256 MiB/total envelope/reader bounds. Selected captures must be distinct envelope references, at most 1 MiB each, sixteen entries and 4 MiB aggregate, within the caller's smaller positive budget. Both declared sizes and actual shared-reader capture sizes are bounded.
3. Compute the expected set commitment with the **existing core canonical function and shared-reader `localeCompare` sort**, preserving manifest order for locale-equivalent distinct references. Do not substitute the envelope's code-unit ordering, change normalization, or redefine the shared hash convention. Tests include ordinary mixed-case ordering and canonically equivalent Unicode spellings. This preserves the existing environment-dependent collation behavior; cross-runtime collation qualification is not claimed.
4. Invoke the actual `readRestorePrivateEvidence` once for the complete set. It hashes every file against its expected SHA256, reading each once and retaining selected copies from that same stream. No path reopen, stat-size substitute or second independent parsing read is introduced.
5. On single-use completion, the shared reader revalidates its pinned root, traversed descendants and file identities before transferring selected buffers. Compare its file count, total bytes and exact set hash to the envelope-derived values before returning any summary. Its set hash commits to every **measured** `{reference,sha256,bytes}` tuple. Equality to the envelope-derived commitment therefore checks every individual byte count, under the same SHA256 collision-resistance assumption as the file digests. It is not merely a total-size comparison. Selected allocations additionally receive direct length and digest checks. Swapping two declared counts while preserving all digests and the total refuses even when neither file is captured.

The shared reader's descriptor/no-follow/nonblocking checks, uid/gid/private modes, single-link rule, file size and nanosecond identity checks, descendant directory retention, stream limits and descriptor cleanup are unchanged. This wrapper does not promise stronger filesystem atomicity. Root ancestors/storage and exclusion of concurrent writers still require independently controlled deployment conditions. Successful completion is a historical observation; it is not a lasting filesystem lease. External current-trust/operations/candidate/source checks remain root composition responsibilities.

All errors are replaced with the fixed code `RESTORE_OFFLINE_PRIVATE_EVIDENCE` and fixed message `Offline private evidence binding did not complete.` Private paths, references, raw reports, causes and syscall details are not propagated. Unlike the lower-level reader, this boundary intentionally does not preserve filesystem error codes. There is no provider/network/database IO, filesystem write, credential access, source mutation or background task.

## Verification

Environment: Node `v24.19.0`, Linux/x64, UID 0, synthetic private directories/files (0700/0600). Tests exercise the actual local filesystem/shared reader and temporarily observe Buffer allocations and actual synchronous file IO; they do not substitute mocked evidence contents or reader results. Existing dependencies are reused through a temporary uncommitted symlink; no dependency/configuration changes.

Initial new-file run: **49/49 passed**, full TypeScript passed. Expanded initial combined run: **124/124 passed**, including shared reader, envelope and approvals. Retained logs remain separate; no original failing assertion was skipped or weakened. Final focused run: **125/125 passed** (54 new, 71 existing), zero failed/cancelled/skipped/todo; final full TypeScript, assigned formatting and whitespace checks passed. No failing run occurred in this increment. Self-review added a compatibility assertion for locale-equivalent references after preserving shared-reader manifest tie order.

```sh
node --import tsx --test tests/restore-offline-private-evidence.test.ts tests/restore-private-evidence.test.ts tests/restore-offline-envelope.test.ts tests/restore-offline-approvals.test.ts
npm run typecheck
./node_modules/.bin/prettier --check src/server/restore-offline-private-evidence.ts tests/restore-offline-private-evidence.test.ts docs/RESTORE-OFFLINE-PRIVATE-EVIDENCE-2026-10-03.md
git diff --check
```

Coverage includes complete valid manifests, exact per-file counts with conserved totals, wrong set hash, missing/extra/duplicate references, multibyte and embedded NUL report bytes, selected-only captures, sixteen selected files/exact 4 MiB, oversized-list rejection before reflection, capture limits before allocation, live/revoked proxies and accessors throughout all input layers without callbacks, configuration detachment, file/ancestor/root change, same-byte new inode replacement, stale handles, single completion, explicit resource cleanup after caller failure, byte zeroing and private error redaction. Existing focused regressions retain symlink/hardlink/interrupted/growing stream and approval-envelope boundaries.

This local receipt does not qualify root-only WAL candidate capture, Mac filesystem behavior, operational authority/fencing, actual provider evidence, production infrastructure, or owner parser semantics. No CI, runner, provider call, PR, push, deployment, nested executor or reminder is used. Root independently reviews and replays the exact three-file patch before integration.

Final tested production SHA256: `c251dc3e212ba705fc457467f7fdba4d99dfd446500bd91169a872ce787414d0`. Final dedicated test SHA256: `572d64abf410240429f5c57da070ba440d3477a26c2f1c6621c2eb49710fecdd`. Retained initial 49-test log SHA256: `14e5f2a1a218ecbc6befdcf631e55f8d12faa046f484e92fc6a9ed2d588acf67`; expanded 124-test log: `92a19cebd39d523b9ba8f96cb4d265478292be2fa5e8c5e85258c10185bbef6a`; final 125-test log: `ef0b289e102d04228d7f41f8cbdb99b16c85fde723966915ad5a11e8e1953679`. These engineering receipts are synthetic local outcomes, not external evidence qualification.
