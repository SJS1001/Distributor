# Shared private restore bytes — 2026-10-03

Implemented byte-integrity prerequisite at `SJS1001/Distributor` baseline `fd763528b7903b632fe4b946680fc8ee67e33286` on the owner-selected published `codex/local-distributor-checkpoint`. Only [release evidence wrapper](../src/server/restore-evidence.ts), [private reader](../src/server/restore-private-evidence.ts), [new focused tests](../tests/restore-private-evidence.test.ts) and this document belong to this increment. Previous local commits are preserved separately. No schema, application, Platform, owner projection, transport, public CLI/HTTP or recovery gate change is included.

A byte match establishes integrity against the supplied reference/digest map. It does **not** establish report truth, independent provider observations, fencing/routing, native IAM identity, approval, phase permission or authority to mutate anything. The [common offline contract](RESTORE-OFFLINE-CONTRACT-2026-10-03.md) remains a proposal apart from this byte reader prerequisite. Separate signed offline domain/operations/session/owner packets and their qualified consumers remain future work. All tasks/product gates remain **NOT VERIFIED**.

## Internal interface and call order

`readRestorePrivateEvidence(expected, manifest, capture?)` accepts a native `Map<string, string>` (typed `ReadonlyMap`) containing the exact expected references and lowercase SHA-256 digests. The caller must obtain that map through its domain's current signature/binding checks; the reader independently validates its shape and bounds. It cannot detect duplicate keys already collapsed by a caller constructing a Map: the caller must reject conflicting declarations before constructing it. The release wrapper retains its existing conflicting-reference check.

The manifest stays `{version: 1, root, files: [{reference, path}]}`. Only plain data records and dense plain arrays are supported; unknown fields, symbols, accessors and exotic prototypes are refused. No operation, executable callback, parser, SQL, table or authority is accepted from the payload. The Map must be a native Map without own properties. References are nonblank strings up to 2,000 characters, digests exact lowercase 64-character hex, the absolute root is bounded to 4,096 characters without NUL, and relative child paths retain the original 2,000-character bound. Every expected reference must occur exactly once, every path must be distinct, and unsigned/missing mappings refuse. Unlisted entries in the directory are not enumerated or treated as evidence, matching the original reader.

1. Validate and snapshot all supplied data and selection; validate complete mapping coverage before opening evidence files. Inputs are copied into private records/maps, so later caller mutation cannot redirect the staged check.
2. Read/hash every mapped file, closing each descriptor in `finally`. Copy only explicitly selected bytes directly from the same stream buffer fed to SHA-256. No second path read supplies capture data.
3. Return a frozen object with **only** `complete()` and `discard()`. It contains no accessible report bytes, summary or authority token. No descriptor remains open. Keep this object local to one synchronous operation; never serialize/persist it or treat possession as a permit.
4. The caller performs its own current binding/trust/phase checks before completion. A caller failure must execute `discard()` in `finally`. No caller callback is invoked by the reader.
5. `complete()` is one-shot. Recheck all retained directory and file identities and metadata, then return `{files, bytes, setHash, captured}`. `captured` is a readonly-typed Map of the explicitly selected reference to its private Buffer; it is empty by default. Neither the summary nor any captured bytes escape on failure. Repeated completion, or completion after discard or failed completion, refuses permanently.
6. Call `discard()` in `finally` even after success. Failed/abandoned staged reads overwrite their private capture buffers and clear references. On success the caller owns the transferred buffers; discard does not erase already-returned material. The caller must bound its own lifetime, avoid logging/persisting reports, and erase/dispose of buffers when no longer needed. JavaScript buffer overwrite is best effort, not a secure-erasure guarantee.

Returned capture allocations are independent of caller inputs, the reused stream buffer and filesystem writes after completion. They are intentionally mutable caller-owned Buffers (a TypeScript readonly Map is not a runtime immutability guarantee). The caller can parse or erase them without changing the summary or any other capture. Mutation by the caller changes those bytes; the digest summary does not authenticate subsequently modified content. No `verified: true`, generic permission, path, store identifier or raw report appears in the summary. Captured values are private material, not a receipt, and must never be included in a public serialization.

## Limits and filesystem invariants

Unchanged stream limits: 1–1,000 mapped files, nonempty regular files up to 64 MiB each, total up to 256 MiB, and one 64 KiB stream buffer. The configured root and traversed descendant directories must be private and owned by the effective operator. Files must be private, operator-owned, single-link regular files. Reject root/descendant/file symlinks, hard links, traversal, absolute children, empty path segments, backslashes and NUL. Open with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; special files cannot turn a read into a blocking FIFO operation.

Retain original `lstat`/`fstat` identity checks before open, after open/read, repeated directory traversal and final completion: device, inode, size, nanosecond modification/change times, mode, link count, UID and GID. Check stream growth and counted bytes against both bounds and final size. Replacements with identical contents still refuse. All read/open/stat failures close any acquired descriptor; no captured result is returned. Domain refusal codes/messages remain specific; underlying filesystem failures retain their error code (including `EINTR`) but replace raw message/path/syscall/cause with a fixed private-evidence error. The release CLI already sanitizes these failures and its public output is unchanged.

Opt-in capture is deliberately smaller than streaming verification:

- Explicit selection of 1–16 distinct expected references; unknown/duplicate/excess selections refuse before file open.
- Mandatory integer `maxBytes` budget from 1 byte through 4 MiB, checked against the sum of selected file sizes before allocating each buffer.
- At most 1 MiB per selected file. Larger evidence can still be streamed without capture, but a requested capture refuses even if the stream limit permits it.
- Allocate exactly each selected file's validated size. Streaming growth cannot enlarge that allocation or exceed the budget. At most 4 MiB of reader-owned capture allocations coexist, plus the 64 KiB stream buffer and bounded metadata. There is no all-file accumulator or concatenation copy.

The existing operational prerequisite remains: the operator controls root ancestors and excludes concurrent writers. This is synchronous path/metadata verification, not an OS sandbox, directory-descriptor capability, filesystem snapshot or persistent lock. It does not continuously guard files after completion, prove absence of a privileged attacker, or supply infrastructure fencing. Do not weaken it to support uncontrolled ancestors or a caller requesting larger captures. Future qualified parsers should consume captured bytes directly, never reopen the source path for parsing.

## Release wrapper compatibility

`reviewRestoreEvidence` keeps its six arguments/default clock and exported manifest type. It still requires a **complete** release dossier with separate finance/security approvals and current trust, rather than accepting unresolved provider outcomes for reuse by offline imports. Call order is:

1. Initial `reviewRestoreDossier(candidate, dossier, approvals, loadTrust(), clock())`.
2. Existing release manifest-envelope check and conflicting signed-reference check, followed by staged private read **without capture**.
3. Second `reviewRestoreDossier` with freshly loaded trust and a fresh clock sample, recapturing the candidate.
4. `complete()` final private file/directory checks.
5. Final finite/monotonic clock and expiry checks.
6. Original release result fields, `status: "reviewed-evidence-isolated"` and evidence `{files, bytes, setHash, verifiedAt}`. Preserve `activationAuthorized: false`, provider hold and candidate contents.

The set hash is still SHA-256 over canonical sorted `{reference, sha256, bytes}` records. Captured material never enters this wrapper's output. This increment neither creates a release nor changes retained recovery history or actual application gates.

## Future caller obligations

A future offline owner consumer must first qualify the separately signed expected reference map and exact task/session/recovery generation, candidate, source interval, organization and claim bindings. After reading and before completion it must refresh those bindings, independent current finance/security/operations duties and deliberately configured scoped native IAM authority. An external signer/preparer ID must never be converted into a native actor implicitly.

Only after complete byte validation may a bounded owner parser consume the selected bytes. Parsed provider claims still require independently qualified observations and current source fencing; private byte identity does not supply either. Parsing and subsequent native mutation must fail closed on malformed/unsupported facts. The exact native writer transaction must assert active hold, isolated reconciliation, current scoped authority and task binding again before any owner effect or receipt. After release control intent, qualified stop/supersede and fresh review are prerequisites. These transaction, phase, qualification and owner-import operations are deliberately not implemented here.

## Verification and limits

Runtime: Node `v24.19.0` with the existing installed repository dependencies; no dependency installation/change was needed for this increment. Astra/High was requested under the owner-supplied canonical model rule, but effective runtime model/effort is not exposed and is unverified. Direct foreground commands only; no CI or provider traffic.

Before extraction, the unchanged `tests/restore-review.test.ts` passed 31/31. New tests exercise actual private temporary files, detached same-stream capture, no default capture, strict structures/coverage/caps, links/permissions/path escapes, FIFO refusal, mutation during read and between read/completion, same-byte replacement from an independent process, one-shot discard/failure, sanitized IO errors and descriptor closure. Existing release tests retain their original assertions/timeouts, including current candidate, authority/key/role, signatures, expiry, backwards clocks and unchanged held candidate/output behavior.

The first new-test run passed 29/30; its sole failure was cleanup of a deliberately read-only private test directory, after the target refusal. Cleanup now restores that synthetic directory's mode. The first typecheck with new tests found a Node overload typing error in the IO observer's argument indexing; only the test observer cast changed. Both original failures remain in the private audit logs. Final focused/regression command passed **145/145**, zero failures/skips/cancellations:

```sh
node --import tsx --test tests/restore-private-evidence.test.ts tests/restore-review.test.ts tests/restore-activation.test.ts tests/restore-activation-boundary-review.test.ts tests/recovery.test.ts tests/recovery-profiles.test.ts
npm run typecheck
./node_modules/.bin/prettier --check src/server/restore-evidence.ts src/server/restore-private-evidence.ts tests/restore-private-evidence.test.ts docs/RESTORE-PRIVATE-EVIDENCE-2026-10-03.md
git diff --check
```

TypeScript, assigned formatting, whitespace and this document's local links pass. The first 114-test combined restore run also passed; the final 145 includes recovery/profile regression after the wrapper envelope-order review. No existing test or timeout was modified. There is no reproduced existing production defect claim: this is extraction, bounded optional capture, independent input validation and additional adversarial coverage. Exact commit/input hashes and retained log names accompany the transfer receipt. No full-system, browser, production infrastructure or owner-import qualification is claimed.
