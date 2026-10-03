# Local Billing offline review — 2026-10-03

Root reviewed and applied only the three-file cloud delta `63bfcd43efaa44e30324009f4a93119969e41046`, excluding its parent. Raw patch: 54,899 bytes, SHA-256 `dd50afc5afcaee1a37b1d5dc64f3c98cf51baec0cda9324c914f5e883a31b875`. Both gzip chunks and compressed hash were independently verified before application. Local parent is published `04bfc62521569a4ff9febcaa4a200844d7988d93`.

The new Billing-owned read-only operation requires an existing native writer transaction and current scoped finance/password authority. It returns detached immutable invoice/payment/credit/refund/mapping/observation/notice facts, native capacity and a deterministic facts hash. It reads Billing and fresh IAM operations, performs no writes, and grants neither first-slice eligibility nor mutation/provider authority. Imported opening documents explicitly refuse rather than disappear from totals. The [cloud implementation report](../BILLING-OFFLINE-REFUND-REVIEW-2026-10-03.md) preserves its own outcomes and initial fixture failures.

## Exact tested inputs

| Input                                         | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `src/server/billing-refunds.ts`               | `40c2e398636f7487969f8c79289bab925a178afd6c84470e4afdda6919490943` |
| `tests/billing-offline-refund-review.test.ts` | `69e86aaeead1156012e3d128f8dd1ba441ee2d87e5a128ff6ea9f5014226da7f` |

Direct workstation environment: macOS/arm64, Node v24.16.0, OpenSSL 3.5.6. No CI runner or live provider IO ran.

```sh
npx tsx --test tests/billing-offline-refund-review.test.ts tests/billing-authority.test.ts tests/refunds.test.ts tests/refund-history.test.ts tests/refund-notices.test.ts tests/refund-callbacks.test.ts tests/payment-history.test.ts tests/accounting-refunds.test.ts tests/accounting-credits.test.ts tests/accounting-payments.test.ts tests/integration-offline-refund-evidence.test.ts
npm run typecheck
```

Actual native test process exit 0: 143/143 pass, zero failures/cancellations/skips/todo, 4,016.531625 ms. Complete TypeScript exits 0. Private log SHA-256 `884bf5ba3c7cdc4a1cc4f1332313e1d1c1fb19c1a7fc8457d75f667996bc8c06`; private transfer/runtime artifacts remain excluded from publication.

The collection byte check currently follows native row materialization and canonical serialization; this receipt does not establish a pre-materialization allocation bound. A separate cloud adversarial review is examining that boundary and retained-history invariants. This focused synthetic/native replay does not verify full current browser regression, qualified offline mutation, provider/infrastructure residency, complete source authenticity or a product gate. Task and gate acceptance states remain unchanged.
