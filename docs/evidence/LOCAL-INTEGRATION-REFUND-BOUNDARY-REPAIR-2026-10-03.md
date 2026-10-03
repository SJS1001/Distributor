# Local Integration refund boundary repair — 2026-10-03

This verifies the narrowly scoped Integration historical reader repair on the working tree based on published `1207c8193fc56b79408ebb232b38580f6f3b3db8`. It does not verify the qualified offline coordinator, source provenance, provider outcomes or any product gate.

Cloud repair commit `b2a198ec845b8bb636deb142f226ad84a64a0b99` excludes its original boundary delivery `0c916ca8c9f4bcd2b1dabb7da2ed51f54ddeffe3`. Root verified all transfer lengths, encoded/decoded SHA-256 hashes, the three owned paths and apply check before applying. Raw patch: 20,526 bytes, SHA-256 `4c53d62ca0251b6bf8283305411820b1f94a772a11541efb017e27ce74b575a3`.

The original local boundary replay remains retained: 23 tests, 17 passes and six assertion failures, exit 1; log SHA-256 `6926ea54056f54fc6ba518b150289423815a2465403bedfdfc3d7a6071e6eaaa`. Production repairs bind all retained checkout callbacks, immutable invoice money summaries, native checkout intent amounts/currency, historical balance arithmetic and safe retry timestamps. All original 23 assertion bodies remain unchanged; fixture helpers now derive configured currency and five additional assertions cover the repaired boundaries. Permanent full-history blockers remain explicit.

## Local verification

Direct workstation: macOS 27.0, arm64, Node v24.16.0, OpenSSL 3.5.6, SQLite 3.53.0. Synthetic native application fixtures only. No CI runner or provider request.

```sh
npx tsx --test tests/integration-offline-refund-review-boundary.test.ts tests/integration-offline-refund-review.test.ts tests/refunds.test.ts tests/refund-callbacks.test.ts tests/accounting-payments.test.ts tests/accounting-credits.test.ts tests/accounting-refunds.test.ts tests/accounting-balances.test.ts tests/checkout-observations.test.ts tests/checkout-history-proof.test.ts tests/integration-restore-dispositions.test.ts
```

Actual outcome: 186 tests, 186 passes, zero failures/cancellations/skips/todo, exit 0, 3,797.636875 ms. Private local log SHA-256 `90ce1bd2a52bfa8a6386ee9aeb01a03b06bf8ad19d4f84618f739256e8f2fa46`. Complete `npx tsc --noEmit` passes on the combined tree. These are affected checks, not a current whole-suite or browser result.

## Tested bytes

- `src/server/integration-offline-refund-review.ts`: `d3f3f66b1abcabaae8dceaa3f15649088301027b752d236983d903287944f5a7`
- `tests/integration-offline-refund-review-boundary.test.ts`: `139f32d1f1a941955b4b6bd316f7b550f6dedf69c5714472b307706b8ab6d525`
