# Read-only review of an isolated restored store

Engineering continuation, 2026-10-03. The owner accepted source-bound reconciliation, separate finance/security approval, writer/routing evidence and effect-dependent rollback. The new review validates a signed offline dossier while leaving the durable recovery hold intact. It is a review prerequisite, not activation, measured RPO/RTO or production clearance. All tasks and gates remain NOT VERIFIED. Use the [encrypted restore procedure](RECOVERY.md) first.

## Capture the candidate

Keep the restored store isolated, stop every rehearsal writer, preserve its recorded reporting profile and use its exact current schema-17 profile. Capture a fresh descriptor on the workstation:

```sh
npm run recovery:review -- capture /absolute/private/recovered.db > /absolute/private/candidate.json
```

Prepare private output directories and restrictive permissions before redirecting metadata. The command opens SQLite read-only, validates the exact schema/region and integrity/foreign keys, requires a retained recovery hold and at least one organization, and hashes every persisted application table in one read transaction. Typed values and deterministic ordering bind sessions, grants, policies, effects, receipts and audit history without printing those row values. The returned descriptor contains logical/schema/archive hashes, source completion/restore times, region and organization IDs/currencies. It rejects a database or sidecar symlink and compares main, WAL and rollback-journal identity, size and change timestamps across capture. Shared-index identity is checked separately because SQLite read marks can change during an ordinary read. A read-only connection may create its empty WAL and shared index; their identities are retained after opening. Detected concurrent commits or file replacements refuse capture. Trusted ancestor directories and exclusion of concurrent filesystem writers remain operator responsibilities; these metadata checks do not provide an infrastructure writer fence.

The logical hash includes all application rows and the restore hold; it differs from the pre-restore archive snapshot hash because restore isolation changes sessions, tokens and other security state. A matching hash proves identity of that captured SQLite snapshot, not external outcome reconciliation or continued absence of writers. Rehearsal writes invalidate the descriptor; freeze and capture again.

## Assemble and sign the dossier

Use the exact `RestoreDossier` contract in `src/server/restore-review.ts`. Version 1 requires:

- Preparer ID, exact UTC preparation/expiry timestamps, and the captured candidate descriptor. Preparation cannot be in the future; validity is at most fifteen minutes.
- Authoritative source identity and logical hash, durable cutoff cursor, audit sequence, and cutoff evidence.
- Exactly every captured organization once, each with inventory, billing, access and customer residency evidence.
- All eight stable provider IDs per organization: `stripe`, `quickbooks`, `ups`, `fedex`, `usps`, `canada-post`, `purolator`, `dhl-express`. Explicit `reconciled` or `not-used` outcomes require evidence; `unknown` refuses review. Reconcile copied pending/sending attempts against independent post-cutoff outcomes. “Not used” is an accountable review finding, not an inference from a missing provider match.
- Operations evidence for writer fencing, routing and rollback; distinct nonempty lists of source/candidate writer authorities; rollback mode `source-before-effects-forward-recovery-after-effects`; explicit positive rehearsal RPO/RTO minutes. The accepted starting targets are 15 and 240 minutes respectively. The program checks declared targets, not attainment.

Each evidence item is `{reference, sha256}` with a nonempty bounded reference and lowercase SHA-256. Retain the referenced evidence privately. The signature-only `review` command does not fetch or verify its contents; `verify-evidence` below verifies local file bytes. Current infrastructure fencing, routing, external reconciliations and source data loss remain accountable operator findings.

Two distinct approved people, finance and security, neither the preparer, sign the same canonical dossier hash with distinct Ed25519 keys. The signature message comes from `restoreApprovalMessage(dossierHash, signerId, role)` and includes the domain purpose `distributor-restore-review-v1`. Compute the dossier hash as `digest(canonical(dossier))` from `src/server/core.ts`; sign the returned message's UTF-8 bytes using Ed25519 and encode the 64-byte signature as standard base64. The approval object is `{signerId, role, dossierHash, signature}`. Preserve exact strings and array order; editing any evidence changes the signed hash.

Keep private signing keys in an approved separate signing process. The CLI only reads public keys. The trusted registry is a separately controlled array of `{id, role, publicKey}` objects, with PEM Ed25519 public keys. Load a fresh authoritative registry for each review; removal or role change revokes that person's approval. Copied database grants alone cannot prove current restore approvers. Preparer, approver and writer identities must use exact strings without surrounding whitespace; whitespace aliases cannot satisfy separation of duties or writer-list separation. Unique IDs and keys are mechanically checked; distinct real people and key custody require operator qualification.

## Review and retain the receipt

The dossier, approval array and current trusted registry must be private regular nonsymlink JSON files (no group/world permission), each at most 1 MiB:

```sh
npm run recovery:review -- review /absolute/private/recovered.db /absolute/private/dossier.json /absolute/private/approvals.json /absolute/private/trusted-approvers.json
```

The tool recaptures and exactly compares the candidate, checks full organization/provider evidence coverage, timestamps, writer-list separation, rollback declaration and both signatures against the supplied current registry. The command checks its clock before capture and after signature review; expiry during capture or a backwards completion clock refuses a receipt. Success returns `status: reviewed-isolated`, `providerHold: true`, `activationAuthorized: false`, exact dossier/candidate hashes, approver IDs/roles and review/expiry times. Retain the exact input files, registry provenance and receipt privately. It persists no approval in the database, clears no hold, changes no routing and performs no provider IO. Failure leaves those states unchanged.

Candidate writes, evidence changes, expiry, unknown outcomes, missing organizations/providers, shared keys/principals or removed approvers require fresh review. Approval is a snapshot receipt, not a lock or durable release authorization. An activation transition must independently recapture within writer fencing and implement interruption recovery before it can use these reviews. The separate [durable restore coordinator](RESTORE-ACTIVATION.md) now implements a retained lifecycle through an explicitly configured operations adapter and independently signed release authority. It has no HTTP route or live CLI activation switch.

## Verify the private evidence files

Use `RestoreEvidenceManifest` in `src/server/restore-evidence.ts` to map each unique signed reference to a local file. The manifest has exactly `{version: 1, root, files: [{reference, path}]}`. `root` is an absolute private directory; each `path` is a distinct relative path below it. No URLs are fetched. Mapping order does not affect the evidence-set fingerprint. A signed reference reused across dossier sections needs one mapping and must have the same SHA-256 everywhere. Missing, duplicate, unsigned or conflicting references refuse verification.

Keep the manifest itself private, regular and nonsymlink, at most 1 MiB. The root and nested directories must be owned by the operator and have no group/world permissions; files must be nonempty, owned by the operator and have no group/world permissions. Directory/file symlinks, file hard links and path traversal are refused. Prepare this private tree before review and exclude concurrent writers. The root's ancestors must be trusted: these checks do not defend against an attacker controlling the enclosing filesystem.

```sh
npm run recovery:review -- verify-evidence /absolute/private/recovered.db /absolute/private/dossier.json /absolute/private/approvals.json /absolute/private/trusted-approvers.json /absolute/private/evidence-manifest.json
```

The command first validates the signed dossier, then streams and hashes every mapped file using bounded buffers. Limits are 1,000 distinct references, 64 MiB per file and 256 MiB total. It checks file identity, permissions, size and change timestamps across reads, reloads the external trust registry, recaptures the candidate and rechecks retained file/directory metadata before completion. Authority revocation, candidate changes, elapsed expiry, clock reversal, mismatched bytes or detected file changes refuse the entire result. Filesystem failures produce a generic CLI error without printing paths or content. For larger dossiers, qualify a separate procedure; do not split one signed dossier into incomplete manifests.

Success returns `status: reviewed-evidence-isolated`, the existing signed-review metadata and `{files, bytes, setHash, verifiedAt}` under `evidence`. The set hash binds sorted references, actual SHA-256 fingerprints and byte counts; paths and evidence bytes are absent from the receipt. The command writes no database or evidence file, performs no provider IO and retains `providerHold: true`, `activationAuthorized: false`. Retain the manifest and receipt privately. A matching fingerprint establishes the supplied bytes' identity; it does not validate the truth of a report, independently reconcile providers or prove that routing/writers were fenced. Later evidence changes require a fresh run. The receipt is still a snapshot, with no durable release authority.

## Remaining implementation and qualification

An infrastructure-specific activation adapter, durable release transition, current-authority integration, post-cutoff import/reconciliation and rollback by observed effects remain separate dependent engineering. Actual provider, warehouse, finance and security records; source freeze; physical routing/writer authority; storage/key residency; RPO/RTO performance and operator rehearsal remain qualification evidence. Full-table hashing streams application rows but SQLite sorts using memory; production size, sorting/index cost, lock duration and malicious concurrent access need qualification. See [initial local checks](evidence/LOCAL-CORRECTIONS-RESTORE-REVIEW-2026-10-03.md) and [private evidence checks](evidence/LOCAL-RESTORE-EVIDENCE-2026-10-03.md).
