# Pure offline task envelope — 2026-10-03

Implements only the structural envelope, canonical binding and finance/security
approval message from the [common proposed contract](RESTORE-OFFLINE-CONTRACT-2026-10-03.md).
No task is registered or authorized. Root integration remains default disabled;
all task/product gates remain **NOT VERIFIED**.

## Baseline and exclusive scope

Exact public `SJS1001/Distributor` baseline on `codex/local-distributor-checkpoint`:
`fd763528b7903b632fe4b946680fc8ee67e33286`, tree
`15cc6cbe0c17d01425590f3009c42b1a1dec8e05`. The isolated checkout starts detached
at that exact commit. Shell GitHub access was blocked by network policy. Read-only
GitHub connector commit/tree/blob reads supplied missing objects, combined with
already available verified local Git blobs. Every reconstructed blob/tree and
the original commit matched its Git object ID before checkout. No remote writes.

Read AGENTS, README, PLAN, DECISIONS, current HANDOFF entries and the common
offline contract. The owner's supplied canonical model rule requests Astra/High
for this security boundary. Effective model and reasoning settings are not
runtime-readable here and remain **unverified**; no nested agent/session launched.

This delta owns only:

- `src/server/restore-offline-envelope.ts`
- `tests/restore-offline-envelope.test.ts`
- this report

Previous Platform commit `5773df107a36ac17c959d1ba3afe89b25c0936cc` remains in
its original checkout, with its exact diff SHA-256
`d2d140a98da5c329fa05dddf800abbf6459e985587186707ed8ff0553ad2a476`
and gzip SHA-256
`502a927494966696df8e3a1b9edee5b1228cfa232c64cc824423c2d844cc6cd3`
unchanged. Earlier work and concurrent owner files were not modified. No database,
filesystem, network, registry mutation, signature verification or runtime wiring
is performed by the new module. Existing review/release message APIs are unchanged.

## API and signing bytes

```ts
const parsed = parseOfflineTaskEnvelope(input, {
  maxApprovalWindowMs: 900_000,
});
const bytes = canonicalOfflineTaskEnvelope(parsed);
const binding = offlineTaskBinding(parsed);
const message = offlineTaskApprovalMessage(parsed, signerId, "finance");
```

All four exported functions validate their input; a TypeScript assertion cannot
bypass parsing. A stricter expiry policy must be supplied consistently to each
call. `parseOfflineTaskEnvelope` returns new, recursively frozen objects/arrays
and readonly types, retaining no caller references. The other functions return
primitive strings. Invalid data raises `DomainError` with code
`RESTORE_OFFLINE_ENVELOPE`, status 400 and a fixed redacted message.

Canonical representation: compact JSON, recursively sorted object keys in UTF-16
code-unit order, unchanged array order, JSON string escaping, no Unicode
normalization, ordinary JSON nonnegative integer encoding, UTF-8 for SHA-256.
Negative zero and lone surrogates are rejected so they cannot collapse during
encoding. Fixed contract object keys are ASCII; no locale-dependent sorting is
used. This is an explicitly specified local format, not a claim of implementing
an unrelated canonical-JSON standard.

The binding is SHA-256 of the complete canonical envelope. Approval bytes are
exactly canonical JSON of
`{purpose:"distributor-restore-offline-approval-v1",binding,signerId,role}`.
Only `finance` and `security` are accepted, and each signer must differ exactly
from both `preparedBy` and `executorId`. Preparers and executors may be the same
identifier; the proposed contract does not require those two roles to differ.
No signer, key, human independence, operations independence, current identity,
quorum, revocation or signature is verified by building a message. Two messages
for the same person do not establish two independent approvals.

The frozen synthetic fixture independently pins the canonical JSON, finance and
security messages and binding:
`ace041ad55240a1f6a662201656405c5010a0f788b4e9987fc115e9f8cc0093b`.
Expected bytes and digest were generated separately using Python sorted compact
JSON and SHA-256, then embedded as literals in the test. Existing review and
activation purpose messages are tested as different signing bytes.

## Exact structure and explicit parser policies

Every top-level and nested field follows the common contract's table, including
the complete supplied organization list, prior claim or explicit null, source
endpoints, evidence qualification hash, operations fields and trust registry hash.
No operational booleans, local paths, payloads or signature arrays are accepted.
Unknown, missing, symbol, nonenumerable and accessor properties fail closed.
Ordinary objects with Object/null prototype are accepted. Other prototypes,
proxies (including revoked ones), sparse/decorated arrays and coercible wrappers
are rejected without invoking user getters, traps, toJSON, valueOf or toString.
Frozen inputs are accepted. Fixed-depth schema inspection also refuses cycles.

| Input                                  | Implemented bound/meaning                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Envelope discriminator                 | Exactly version `1`, purpose `distributor-restore-offline-task-v1`                                                                            |
| IDs, task name/owner, adapter identity | 1–160 UTF-16 code units; no trimming, leading/trailing whitespace or C0/DEL controls                                                          |
| Evidence references                    | Same exact identity rules, 1–2,000 UTF-16 code units                                                                                          |
| Opaque source cursors                  | 1–2,000 UTF-16 code units; whitespace/control characters preserved exactly; no comparison or interpretation                                   |
| Region and currency                    | CA/US, independently CAD/USD; CA/USD remains valid; no inferred FX or country/currency mapping                                                |
| Hashes                                 | Exactly 64 lowercase hexadecimal characters                                                                                                   |
| Revisions, sequences, dev/ino          | Nonnegative safe integers; no negative zero, coercion, fractions, infinity or NaN                                                             |
| Task version                           | Positive safe integer, structurally bounded but entirely unqualified until a future static registry authorizes name/owner/version and payload |
| Organizations                          | 1–1,000 entries, strict increasing code-unit order by ID, unique IDs; task org must occur in this supplied list                               |
| Sites                                  | 0–1,000 IDs, strict increasing code-unit order and uniqueness                                                                                 |
| Evidence                               | 0–1,000 items, strict increasing code-unit order by reference and uniqueness                                                                  |
| File bytes                             | 1–67,108,864 each; nonempty files follow the existing private evidence contract                                                               |
| Total bytes                            | At most 268,435,456, inclusive                                                                                                                |
| Dates                                  | Exact four-digit-year UTC ISO timestamp with three millisecond digits and `Z`; round-trip validation rejects calendar normalization           |
| Approval interval                      | `0 < expiresAt - preparedAt <= maxApprovalWindowMs`; default and maximum 900,000 ms, caller may choose any smaller positive integer           |

The fifteen-minute ceiling comes from the common proposal, and is exported as
parser policy, **not approved production freshness policy**. No wall clock is
read: historical structurally valid envelopes can be parsed without claiming
they authorize a current effect. Neither file identity numbers nor source audit
sequence numbers are checked against an actual system. Cursors and source
sequences are not ordered against each other; the qualified source contract must
establish interval semantics. Signed identity arrays are never silently sorted.

The parser cannot establish that the supplied organization/site/evidence lists
are complete for a real candidate/task. Empty site/evidence sets do not assert
that a task requires none. `priorClaim: null` does not prove absence of a native
claim. Evidence set/payload/qualification hashes are retained binding fields,
not recomputed or qualified without their separately defined source data.

Input is an in-memory value, not raw JSON text. Passing JSON text fails. This
module cannot detect duplicate JSON properties already discarded by an upstream
JSON decoder; any future raw control-file reader must enforce its own exact-byte
and duplicate-property requirements before accepting such values. Parsing grants
no authority even when all structural checks pass.

## Foreground verification

Environment: Linux x86_64, Node `v24.19.0`, repository-installed TypeScript and
Prettier reused via a temporary dependency symlink, removed before committing.
No dependency or compiler configuration changes, fixture servers or background
jobs. Commands run from the isolated checkout:

```sh
node --import tsx --test tests/restore-offline-envelope.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/restore-offline-envelope.ts tests/restore-offline-envelope.test.ts docs/RESTORE-OFFLINE-ENVELOPE-2026-10-03.md
git diff --check
```

Final focused result: **15/15 passed**, zero failures/skips/cancellations,
636.912391 ms. TypeScript passes. Assigned formatting and diff whitespace checks
pass. Tests cover sensitivity of all 61 fixture binding leaves (the two fixed
discriminators reject changes), collection/claim changes, detached frozen output,
unknown/missing/accessor/symbol keys at every object depth, no proxy/coercion side
effects, malformed numbers/dates/hashes, limits/order/deduplication, CA/CAD,
US/USD, CA/USD, explicit expiry policy and message separation/collisions.

Historical initial focused result was 14/14 passing, 384.8795 ms. Initial
TypeScript failed because `String.isWellFormed()` was outside the configured
ES2023 type library. Replaced only that check with an equivalent Unicode-mode
lone-surrogate regex; added a valid supplementary-character/cyclic-input test.
No compiler target change or weakened assertion. Original logs are preserved
separately from the final logs:

| Log                                        | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Initial focused tests                      | `729ba763eccf67faeeb4c47d115af5a06be54ced6542d14ac53b15ef92a6d1a4` |
| Initial TypeScript failure                 | `e41285f048afa9f3a84e2f052a92b5cef8e399d4b20855dfc55da650a9207909` |
| Final focused tests                        | `21a83c8d49763d0b8eaeb9c4802363916ae655a96d663cc27303b89d39e4ddf4` |
| Final TypeScript (empty successful output) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

This bounded pure implementation does not exercise production trust, private
file reading, operations qualification, source completeness, native IAM,
transactional authority, phase/permits, schema/imports or release wiring. Those
remain separate owner prerequisites. No provider IO, CI/runner, deployment,
remote push, PR or merge was performed. Root must verify/apply the exact owned
delta; implementation and test completion do not verify any product gate.
