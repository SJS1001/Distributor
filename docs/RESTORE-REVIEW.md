# Read-only review of an isolated restored store

Engineering continuation, 2026-10-03. The owner accepted source-bound reconciliation, separate finance/security approval, writer/routing evidence and effect-dependent rollback. The new review validates a signed offline dossier while leaving the durable recovery hold intact. It is a review prerequisite, not activation, measured RPO/RTO or production clearance. All tasks and gates remain NOT VERIFIED. Use the [encrypted restore procedure](RECOVERY.md) first.

## Capture the candidate

Keep the restored store isolated, stop every rehearsal writer, preserve its recorded reporting profile and use its exact current version-10 schema. Capture a fresh descriptor on the workstation:

```sh
npm run recovery:review -- capture /absolute/private/recovered.db > /absolute/private/candidate.json
```

Prepare private output directories and restrictive permissions before redirecting metadata. The command opens SQLite read-only, validates the exact schema/region and integrity/foreign keys, requires a retained recovery hold and at least one organization, and hashes every persisted application table in one read transaction. Typed values and deterministic ordering bind sessions, grants, policies, effects, receipts and audit history without printing those row values. The returned descriptor contains logical/schema/archive hashes, source completion/restore times, region and organization IDs/currencies. It rejects a database or existing sidecar symlink and detects a replaced main-file identity. Trusted ancestor directories and concurrent filesystem access remain operator responsibilities.

The logical hash includes all application rows and the restore hold; it differs from the pre-restore archive snapshot hash because restore isolation changes sessions, tokens and other security state. A matching hash proves identity of that captured SQLite snapshot, not external outcome reconciliation or continued absence of writers. Rehearsal writes invalidate the descriptor; freeze and capture again.

## Assemble and sign the dossier

Use the exact `RestoreDossier` contract in `src/server/restore-review.ts`. Version 1 requires:

- Preparer ID, exact UTC preparation/expiry timestamps, and the captured candidate descriptor. Preparation cannot be in the future; validity is at most fifteen minutes.
- Authoritative source identity and logical hash, durable cutoff cursor, audit sequence, and cutoff evidence.
- Exactly every captured organization once, each with inventory, billing, access and customer residency evidence.
- All eight stable provider IDs per organization: `stripe`, `quickbooks`, `ups`, `fedex`, `usps`, `canada-post`, `purolator`, `dhl-express`. Explicit `reconciled` or `not-used` outcomes require evidence; `unknown` refuses review. Reconcile copied pending/sending attempts against independent post-cutoff outcomes. “Not used” is an accountable review finding, not an inference from a missing provider match.
- Operations evidence for writer fencing, routing and rollback; distinct nonempty lists of source/candidate writer authorities; rollback mode `source-before-effects-forward-recovery-after-effects`; explicit positive rehearsal RPO/RTO minutes. The accepted starting targets are 15 and 240 minutes respectively. The program checks declared targets, not attainment.

Each evidence item is `{reference, sha256}` with a nonempty bounded reference and lowercase SHA-256. Retain the referenced evidence privately; the tool does not fetch or verify its contents. Current infrastructure fencing, routing, external reconciliations and source data loss remain accountable operator findings.

Two distinct approved people, finance and security, neither the preparer, sign the same canonical dossier hash with distinct Ed25519 keys. The signature message comes from `restoreApprovalMessage(dossierHash, signerId, role)` and includes the domain purpose `distributor-restore-review-v1`. Compute the dossier hash as `digest(canonical(dossier))` from `src/server/core.ts`; sign the returned message's UTF-8 bytes using Ed25519 and encode the 64-byte signature as standard base64. The approval object is `{signerId, role, dossierHash, signature}`. Preserve exact strings and array order; editing any evidence changes the signed hash.

Keep private signing keys in an approved separate signing process. The CLI only reads public keys. The trusted registry is a separately controlled array of `{id, role, publicKey}` objects, with PEM Ed25519 public keys. Load a fresh authoritative registry for each review; removal or role change revokes that person's approval. Copied database grants alone cannot prove current restore approvers. Unique IDs and keys are mechanically checked; distinct real people and key custody require operator qualification.

## Review and retain the receipt

The dossier, approval array and current trusted registry must be private regular nonsymlink JSON files (no group/world permission), each at most 1 MiB:

```sh
npm run recovery:review -- review /absolute/private/recovered.db /absolute/private/dossier.json /absolute/private/approvals.json /absolute/private/trusted-approvers.json
```

The tool recaptures and exactly compares the candidate, checks full organization/provider evidence coverage, timestamps, writer-list separation, rollback declaration and both signatures against the supplied current registry. Success returns `status: reviewed-isolated`, `providerHold: true`, `activationAuthorized: false`, exact dossier/candidate hashes, approver IDs/roles and review/expiry times. Retain the exact input files, registry provenance and receipt privately. It persists no approval in the database, clears no hold, changes no routing and performs no provider IO. Failure leaves those states unchanged.

Candidate writes, evidence changes, expiry, unknown outcomes, missing organizations/providers, shared keys/principals or removed approvers require fresh review. Approval is a snapshot receipt, not a lock or durable release authorization. An activation transition must independently recapture within writer fencing and implement interruption recovery before it can use these reviews. No activation/release command exists.

## Remaining implementation and qualification

An infrastructure-specific activation adapter, durable release transition, current-authority integration, post-cutoff import/reconciliation and rollback by observed effects remain separate dependent engineering. Actual provider, warehouse, finance and security records; source freeze; physical routing/writer authority; storage/key residency; RPO/RTO performance and operator rehearsal remain qualification evidence. Full-table hashing streams application rows but SQLite sorts using memory; production size, sorting/index cost, lock duration and malicious concurrent access need qualification. See [local checks](evidence/LOCAL-CORRECTIONS-RESTORE-REVIEW-2026-10-03.md).
