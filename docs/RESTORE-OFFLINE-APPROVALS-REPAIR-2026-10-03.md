# Strict offline Ed25519 validation repair — 2026-10-03

Base: `f33ee83315c9e4f7654b723bc0c5abe53064c801`. This delta changes only the
approval module, its focused tests, its original historical report and this new
repair report. Prior approval/envelope/Platform commits and exact deltas remain
preserved. No envelope, phase, database, native consumer or client changes.

The owner requested Astra/High under the canonical security/adversarial rule;
runtime model/reasoning settings remain unverified because they are not exposed.
No nested execution, background job, CI/runner, provider IO, dependency changes,
PR, push or deployment. All task/product gates remain **NOT VERIFIED**.

## Retained failure and diagnosis

Root reports that the unchanged adversarial test
`noncanonical Ed25519 scalar and synthetic weak-point forgeries are refused`
failed with a missing expected exception in its weak-point loop at original line 820. Runtime: Darwin arm64, Node v24.16.0, OpenSSL 3.5.6. Its preceding `S + L`
refusal passed. Root's private `restore-combined-focused.log` contains 367 tests,
365 pass and two failures; the other native-restore failure belongs to root and
is outside this repair. That log was reported by root, not copied or executed
here; no local possession/hash or repaired macOS result is claimed.

Cloud reproduction of the original test on unchanged production passed 1/1,
157.864401 ms, on Linux x64, Node v24.19.0/OpenSSL 3.5.7. This discrepancy means
the previous host's `crypto.verify` refusal was insufficient evidence of our own
strict boundary. The previous verifier checked SPKI algorithm/encoding but not
the compressed public point, signature R point or scalar range itself.

Two new deterministic tests were added **before** production repair and both
failed, 0/2 in 255.460441 ms: the roster fingerprint accepted the identity point;
and malformed R reached a synthetic permissive native verifier and was accepted.
The latter replaces only the test process's native verify function, synchronizes
ESM bindings, and restores it in `finally`. No production injection seam exists.
Both red logs are retained. The entire original adversarial test was compared to
the base commit and remains byte-for-byte unchanged, including all assertions.

## Minimal structural guard

The approval module now validates public A and signature R before native
verification. It decodes each fixed 32-byte compressed point, rejects noncanonical
y/sign encodings and points off the curve, and rejects the full small-order
subgroup by testing whether three doublings yield the identity. It independently
enforces `0 <= S < L`. Native `crypto.verify` still evaluates the signature
equation; the guard grants no authority.

Primary reference: [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html), sections
5.1.1, 5.1.3, 5.1.4 and 5.1.7, consulted 2026-10-03. Field modulus, point
decompression, projective doubling and scalar limit follow that specification.
Low-order exclusion is an explicit stricter local policy, not an assertion that
the RFC mandates it. The implementation is original bounded TypeScript using the
published mathematics; no third-party implementation or dependency was copied.

All arithmetic handles public data only: 32 fixed byte-decoding steps, modular
exponentiation with 255 iterations and fixed public exponents, followed by three
doublings. Field operands are reduced after arithmetic; inputs cannot select
curve parameters, loop counts or exponents. Constants derive from the Ed25519
parameters at module initialization. Exact exported 44-byte SPKI DER/prefix is
checked before extracting A. Existing canonical PEM/base64 and length bounds
remain enforced. BigInt operations are not represented as constant-time secret
operations; no secret arithmetic or signing is introduced.

The guard establishes canonical on-curve non-small-order points, not a separate
prime-subgroup membership proof for arbitrary mixed-order points. Native crypto
remains responsible for the signature equation; this is not a replacement
Ed25519 implementation or an exhaustive qualification of every crypto backend.
It removes host-dependent acceptance for the explicit malformed/low-order/scalar
classes covered here. Registry, person association, current trust, expiry,
operations qualification and write permissions remain wholly outside its scope.

## Added adversarial coverage

- Complete eight-element torsion subgroup, independently generated using Python
  affine Edwards addition and a point of order eight; frozen hex fixtures cover
  orders 1, 2, 4 and 8 and both nonzero-x signs.
- All 19 out-of-field y encodings, each sign bit, invalid sign bits when x is
  zero, and three off-curve encodings. The roster fingerprint rejects these
  without needing a signature or native verify result.
- Invalid R points and `S = L`, `L + 1`, or `2^256 - 1` rejected with **zero**
  calls to an explicitly permissive synthetic native verifier.
- Valid negated public point accepted structurally while its substituted-key
  signature fails; `S = 0` and `S = L - 1` reach the native equation verifier.
  A synthetic rejecting verifier proves the guard does not replace that check.
- Existing independent signature/fingerprint fixtures, valid generated keys,
  roster maximum, input detachment and original weak-point assertion retained.

The original same-message signatures and summary fingerprints remain unchanged
for accepted inputs. No skipped cases, relaxed bounds or host-specific skips.

## Foreground commands and outcomes

```sh
node --import tsx --test --test-name-pattern='noncanonical Ed25519 scalar' tests/restore-offline-approvals.test.ts
node --import tsx --test --test-name-pattern='roster decoding|permissive native' tests/restore-offline-approvals.test.ts
node --import tsx --test tests/restore-offline-approvals.test.ts tests/restore-offline-envelope.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/restore-offline-approvals.ts tests/restore-offline-approvals.test.ts docs/RESTORE-OFFLINE-APPROVALS-2026-10-03.md docs/RESTORE-OFFLINE-APPROVALS-REPAIR-2026-10-03.md
git diff --check
```

First command: original cloud 1/1 pass before repair. Second: 0/2 deterministic
red before repair. First combined repaired run: 33/33 pass, 1103.894636 ms.
After adding boundary/positive-path coverage, final combined run: **34/34 pass**,
zero failed/skipped/cancelled, 1273.329194 ms. Full TypeScript, assigned formatting
and whitespace checks pass. Dependencies were reused through a temporary symlink
removed before commit. Native crypto test mocks restored; no process/server
left running.

| Retained cloud log                   | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| Original unchanged test              | `f2dbd94aabfa06871b003975349ccfa8a6cae21faab366c5cb721a3242a3eb97` |
| New guard tests, pre-fix red         | `e10ea4ad02e7a914d152907da31741b866c9258d25d3f32abf056267c5e8053f` |
| First repaired combined run          | `311c3949ce41752751e9faf833cc5eadf2b3507caf74b71d7d91fca43a1ffdb2` |
| Final combined run                   | `357c999412bfa67e6a980bd5fdeaabdb45779199954c00545c1e1c48bb429926` |
| TypeScript (empty successful output) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Original delivered approval diff remains 47,259 bytes, SHA-256
`506e040733516b5d8384b6b82294e5dc6ca442f023bce7c5e0e58edf23c2dfd8`;
its gzip remains SHA-256
`7c5e157e0371f0d6204a5eb13ccb95272c1b92ec7aad9ee390d3aafef6a67530`.
Root must apply/review this separate owned repair delta and replay on its target
runtime. No repaired macOS or full 367-test suite pass is claimed here.
