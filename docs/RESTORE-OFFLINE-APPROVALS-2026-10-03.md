# Offline approval cryptography — 2026-10-03

**Historical receipt, superseded in part:** root subsequently reproduced a
weak-point acceptance on Darwin/Node 24.16.0/OpenSSL 3.5.6. The original passing
Linux receipt below does not establish cross-platform strict point validation.
See the [bounded repair and retained failure](RESTORE-OFFLINE-APPROVALS-REPAIR-2026-10-03.md).

Pure verification of exactly two Ed25519 offline-envelope approvals against
strictly parsed **supplied** public roster and person associations. This verifies
cryptographic consistency and asserted separation only. It does not establish
current trust, real human identity, freshness, operational safety or permission.
All task/product gates remain **NOT VERIFIED**; integration stays default disabled.

## Baseline and ownership

Base commit: `6f6614a0550fcb414ba347c3065961a58c86cb1e`, the completed envelope
implementation on `fd763528b7903b632fe4b946680fc8ee67e33286`. The original checkout,
envelope delta and previous Platform/accounting/restore/recovery work are
preserved. Repository instructions and the common offline contract were read in
the preceding envelope assignment; current instructions and HANDOFF ownership
were rechecked for this assignment. No resynchronization or change to another
owner's files was performed.

Exclusive new files are `src/server/restore-offline-approvals.ts`,
`tests/restore-offline-approvals.test.ts`, and this report. The envelope parser,
legacy restore review/release functions, database, snapshot helper, phase
validator, restore/application consumer and carrier evidence remain unchanged.
No runtime wiring, token/permit, registry mutation, signature production API,
provider IO, database/file/network/time callback or persisted authority exists
in the new module.

The owner's canonical model rule requests Astra/High for this security boundary.
Effective model/reasoning settings are not exposed and remain **unverified**.
No nested agent, session, background work, CI/runner, remote push, PR, settings
change or deployment was used.

## Narrow API

```ts
const summary = verifyOfflineTaskApprovals(
  envelope, // always reparsed, including already typed/parsed values
  approvals, // exactly [financeApproval, securityApproval]
  suppliedRoster,
  suppliedAssociations,
  { maxApprovalWindowMs: 900_000 }, // optional structural parser policy
);
const rosterFingerprint = offlineApprovalRosterFingerprint(suppliedRoster);
```

Exact inputs:

| Input          | Fields and bounds                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Approval       | `{signerId,role,binding,signature}`; exactly two entries, finance first then security                                               |
| Roster         | 2–256 entries, each exactly `{id,role,personId,publicKey}`; all entries validated, including unused ones                            |
| Associations   | Exactly `{preparer:{id,personId},executor:{id,personId},operations:{id,personId}}`                                                  |
| Roles          | Exactly `finance` or `security`; approval and selected roster role must match                                                       |
| IDs/person IDs | 1–160 UTF-16 code units, no leading/trailing whitespace, C0/DEL controls or lone surrogates; no coercion or normalization           |
| Binding        | Exact lowercase SHA-256 of the complete reparsed envelope                                                                           |
| Signature      | Canonical padded base64, exactly 88 characters representing exactly 64 bytes; re-encoding must match, including unused padding bits |
| Public key     | Canonical 113-character PEM SPKI Ed25519 **PUBLIC KEY**, a single 60-character base64 line, LF separators and final LF              |

PEM private keys, KeyObject inputs, DER buffers, certificates, other algorithms,
noncanonical base64/PEM, extra whitespace and trailing material are refused.
Node's `createPublicKey` decodes the public key; type/algorithm and exact exported
SPKI PEM must match. Key fingerprints are lowercase SHA-256 of exported SPKI DER.
Node's Ed25519 `verify(null, messageBytes, key, signatureBytes)` performs the
cryptographic check. The original commit implemented no explicit curve-point
arithmetic; the linked repair adds bounded point/scalar validation before that
native check, preserving the original verification receipt below.

At every new input object/array depth, unknown/missing/symbol/nonenumerable keys,
accessors, proxies (including revoked ones), unsupported prototypes, sparse or
decorated arrays fail closed without invoking caller getters, traps, toJSON,
valueOf or toString. Object/null-prototype plain records and frozen records are
accepted. All decoded inputs are detached. Errors are fixed redacted
`RESTORE_OFFLINE_APPROVAL` DomainErrors (400); envelope errors retain the strict
parser's `RESTORE_OFFLINE_ENVELOPE` code. Crypto parse/verify exceptions do not
expose caller key material or evidence.

## Separation and exactly what signatures prove

Both signatures use the existing pure envelope builder's exact
`distributor-restore-offline-approval-v1` bytes. The full binding is compared
before signature verification. Changed envelope/claim/evidence, substituted
roles or keys, partial/extra/reversed bundles, duplicate roster IDs/DER key
fingerprints and signatures from legacy review/release domains fail closed.

Association IDs must exactly match `preparedBy`, `executorId` and
`operations.authorityId` respectively. Operations must have a different supplied
ID and person ID from preparer/executor. Preparers and executors may be the same;
when their IDs match their person assertions must agree. A roster entry sharing
any association ID must assert the same person, even if unused. The two selected
approvers must have different signer IDs, person IDs and DER keys, and differ
from all three associations by both ID and person ID. Unused roster entries may
assert the same person under different distinct IDs/keys; they cannot serve as
the two independent selected approvals.

These are consistency checks over assertions, **not verification that those
assertions identify real distinct people**. A caller can supply a false but
distinct person ID; the tests explicitly demonstrate that signatures alone
cannot detect that. No association is inferred from display names, email, a
native IAM actor or a boolean. The native and external current-authority owners
remain responsible for qualifying these identities and their associations.

The returned recursively frozen summary has exactly
`{binding,rosterFingerprint,associationsFingerprint,signers}`. Signers are a
frozen `[finance,security]` tuple of
`{signerId,role,personId,keyFingerprint}`. No signature, public key or raw evidence
is returned; no caller reference, crypto object or mutable cache is retained.
These identifiers are redacted from raw evidence but still require the future
coordinator's normal identity-data handling; this is not an anonymous receipt.

## Fingerprint encoding and future trust integration

Fingerprints below are separate local domains, not replacements for the common
contract's `envelope.trust.registryHash`. Neither is compared to that field:

- Roster fingerprint: SHA-256 of UTF-8 compact JSON with fixed insertion order
  `{purpose:"distributor-restore-offline-roster-v1",entries:[...]}`. Each entry is
  `{id,role,personId,keyFingerprint}` in that order; entries sort by exact ID in
  UTF-16 code-unit order. Input roster order is immaterial; caller input is never
  mutated. All supplied entries affect the fingerprint.
- Association fingerprint: SHA-256 of UTF-8 compact JSON with fixed insertion
  order `{purpose:"distributor-restore-offline-associations-v1",preparer,executor,operations}`,
  each association encoded `{id,personId}` in that order.

This encoding is pinned independently in tests. The fixture roster fingerprint is
`33b9b908e554f6170634732eede529b4fb75f5a2a63f0a42d86d04b57cd9e412`.
Envelope canonicalization is unchanged. Public roster/key/person changes affect
the summary fingerprint, but a fingerprint alone does not authenticate them.

A future qualified coordinator must obtain the roster and associations through
its independently authenticated current trust source, define how that complete
registry binds them to the signed authority/revision/registry hash, prevent
rollback, and recheck current revocations, identity and key status at its required
authorization boundaries. It must also verify expiry/current clock, source and
operations evidence, phase, IAM and transaction authority. This function has no
clock and intentionally accepts otherwise valid historical signatures. Its
summary is neither release readiness nor permission to write, and does not
qualify an operations attestation or prove a source was fenced.

## Foreground verification and retained outcomes

Environment: Linux x86_64, Node `v24.19.0`. Existing installed repository
dependencies reused through a temporary symlink, removed before commit; no
dependency/configuration changes. Deterministic public synthetic private-key
seeds live only in tests; they have no operational use. Pinned signature and DER
fingerprint vectors were independently cross-checked with Python cryptography
46.0.0 Ed25519 and separately constructed canonical messages.

```sh
node --import tsx --test tests/restore-offline-approvals.test.ts tests/restore-offline-envelope.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/restore-offline-approvals.ts tests/restore-offline-approvals.test.ts docs/RESTORE-OFFLINE-APPROVALS-2026-10-03.md
git diff --check
```

Final combined focused result: **31/31 passed** (16 new approval tests plus 15
unchanged envelope tests), zero failures/skips/cancellations, 709.251745 ms.
Full TypeScript and assigned formatting/whitespace checks pass. Coverage includes
all 61 envelope fixture leaves, nested claim/evidence mutation, purpose/role/key
substitution, duty/person collisions, duplicate and unused malformed roster
entries, canonical base64 padding bits, public-only key encoding, malformed
objects/proxies, list limits, caller mutation, frozen summaries, expired
historical data, noncanonical Ed25519 scalar and bounded synthetic weak-point
forgery refusals. These adversarial cases are not claims of exhaustive
cryptographic implementation qualification.

Initial focused run: 14/14 passed, 488.539585 ms; initial full TypeScript passed.
Two additional independently pinned/vector and forgery tests were added before
the final run. No failed test/typecheck result occurred or was discarded in this
assignment. Retained log hashes:

| Log                                                | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Initial approval tests                             | `66089401dd8f487c8668f9d3cbf8c6b8049ae5848ee5e23544d51574f541fe5c` |
| Final combined tests                               | `16fd39daff40222b351b1435f4f2ff4fffbdd400dd247d845d293fd6673a5e4d` |
| Initial/final TypeScript (empty successful output) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

No broader infrastructure/product qualification is claimed. Root must verify and
apply the exact three-file delta; all current trust/authority and integration
prerequisites above remain outstanding.
