# Local offline history and refund comparison — 2026-10-03

Reviewed increment on published parent `f63d99ee9e51b050a21b27d2265b95eb31883239`. Environment: macOS arm64, Node 24.16.0/OpenSSL 3.5.6, synthetic identities/provider assertions and temporary native SQLite. Direct workstation verification only. All 44 tasks and ten product gates remain NOT VERIFIED.

## Tested inputs and result

| File                                              | SHA-256                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| src/server/restore-activation.ts                  | `ae42b61b40d2c28c2abfd9ac5c949b6511628b4ea534234f04877c0b724be7a2`     |
| src/server/integration-offline-refund-evidence.ts | `c724b9c63baeda6a6f36e6ee1cda63a488f88e7a7e7a7e7a09cf95c8c6d4c58ade9d` |
| tests/restore-offline-native-history.test.ts      | `7473024523215057b4385fcdf5eaa5416c9abc088ed688d0a918a95c1c537056`     |
| tests/integration-offline-refund-evidence.test.ts | `a1589fb735b6700b1bd5f4ca5aa4484eda4cebd7ec366994928a17d2d9e5a371`     |

```sh
npx tsx --test tests/restore-offline-native-history.test.ts tests/restore-offline-phase.test.ts tests/restore-activation.test.ts tests/restore-activation-boundary-review.test.ts tests/restore-native-dispositions.test.ts tests/recovery.test.ts tests/integration-offline-refund-evidence.test.ts
npm run typecheck
```

Combined replay: **133/133 pass**, zero failures/cancellations/skips/todo, 4,978.53175 ms, exit 0. Private log SHA-256: `de9c5f4da1273918c53ee9fc9ae2da9c4374bf30ccaf986951ca9b3f26a80769`. Complete TypeScript: exit 0. Nine new native-history tests and fourteen comparator tests are included. The earlier 3,027-test full native receipt covers its previous published source, not this increment. No full browser replay is claimed here.

## Native history contract

`RestoreActivation.offlineReleaseHistoryInTransaction()` requires the existing writer transaction and a retained raw recovery generation. Fixed Platform-owned reads include terminal rolled-back and superseded releases; the result is detached and deeply frozen. Native row digest/version/head checks precede pure phase classification. No grant, signature, dossier or external authority is returned.

SQLite checks the count and UTF-8 byte budget before JavaScript materializes complete records: at most 1,000 releases, 8 MiB per record and 64 MiB total. Excess history is refused, never paginated into an apparent complete result. Malformed JSON yields a bounded `RESTORE_STATE` error without echoing retained bytes. Tests cover restart, uncommitted visibility and rollback, terminal history, rehashed malformed edges/bindings, digest/head mismatch, malformed JSON, record/count limits and a refused foreign-owner deletion.

The journal fixtures are synthetic native records, not fully qualified restore dossiers. Privileged deletion/copying, actual infrastructure isolation and independently qualified generation/source authority remain unresolved. A retained history projection cannot establish those facts.

## Comparator review and preserved failures

Root verified the exact cloud `44e3ad5d2618bb6322709c9c45466b26c83518b9` three-file delta: 52,181 raw bytes, SHA-256 `765aa046cac656a798e455abbcf33078be5e5470da1d4cc2833bbe0585a93f03`. Its original report and cloud outcomes remain in [the comparator report](../INTEGRATION-OFFLINE-REFUND-EVIDENCE-2026-10-03.md).

An unchanged new Canadian USD assertion first reproduced a false refusal (13/14 pass). The first repair was too broad and failed the existing unsupported US/CAD assertion (13/14 pass). The narrowed repair accepts CA/CAD, CA/USD and US/USD while preserving that US/CAD refusal and exact native currency agreement; no FX is performed. Final dedicated replay passes 14/14. Both original red logs remain private and retained.

Malformed retained JSON separately reproduced an unbounded native `SyntaxError` (7/8 pass). Root replaced it with the bounded refusal, then added the oversized UTF-8 record preflight case. The final combined result above covers both repairs.

The comparator checks consistency of supplied assertions only. It authenticates no provider/source, establishes no exhaustive history or current authority, and performs no native owner mutation. Qualified offline coordination, durable storage and same-writer owner review/import remain outstanding. No CI, provider IO, PR, merge or deployment was performed.
