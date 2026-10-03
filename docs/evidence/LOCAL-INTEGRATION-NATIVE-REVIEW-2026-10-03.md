# Local Integration refund and native-history review

Date: 2026-10-03. Root workstation replay on parent `0a89dfc435767c7737cdb693200f80c6aaa9f842` plus only the independently transferred Integration review and native-history boundary deltas below. Environment: Darwin arm64, Node v24.16.0, SQLite 3.53.0. Synthetic native temporary SQLite applications; direct workstation commands, no CI or provider IO. All 44 tasks and ten product gates remain NOT VERIFIED.

## Exact transferred changes

- Integration `9ae4fce4fbd520a48483e976b2834e81f2b36526`, excluded cloud parent `d6f8818a34626caf164769d196ecd9b27abb5799`: exactly Integration composition, new owning review, new native tests and [historical cloud report](../INTEGRATION-OFFLINE-REFUND-REVIEW-2026-10-03.md). Raw patch 65,949 bytes, SHA-256 `2be74c94782d0047ad1cbfa126b33e6279eaf015569e6ad04b8cf2c997eb51a9`; compressed 16,914 bytes, SHA-256 `a31ce05443e4dac904f3a19680c9a5efe425ea5882db642dd431b01505594a33`. Root independently verified three encoded chunks, complete compressed/decompressed identities, exact ownership and applicability before applying.
- Native-history `84334df169d67b35814d0eedb5100576c732ed02`, excluded cloud parent `198e1d0d058c4fa4b8c0693088c18026c1beed23`: exactly new boundary tests and [historical cloud report](../RESTORE-OFFLINE-NATIVE-HISTORY-BOUNDARY-2026-10-03.md). Raw patch 27,051 bytes, SHA-256 `3ee462e28bdc3c09d38780fa26ceea93002ba7f3e893a29df2fe79509f7ad70f`; compressed 7,875 bytes, SHA-256 `48883dcc8ec7c8583da865ba350d9896f1b965da9ea6680c5f2a76c1987f1f30`. Root verified both encoded and decoded chunks, full compressed/decompressed identities, ownership and applicability. No production changes from this second delta.

Cloud reports and their retained original reds remain historical evidence. Root did not apply either parent wholesale or modify the delivered tests to obtain these outcomes.

## Workstation outcomes

```sh
npx tsx --test tests/integration-offline-refund-review.test.ts tests/refunds.test.ts tests/integration-restore-dispositions.test.ts tests/billing-offline-refund-review.test.ts tests/integration-offline-refund-evidence.test.ts
npx tsx --test tests/restore-offline-native-history.test.ts tests/restore-offline-native-history-boundary.test.ts tests/restore-offline-phase.test.ts tests/restore-offline-phase-boundary.test.ts
npx tsc --noEmit
```

- Integration/refund replay: **95/95 pass**, zero failures, cancellations, skips or todo; 3,011.803792 ms, actual process exit 0. Private log `local-evidence/cloud-quantity-ui-2026-10-03/integration-review-local-final.log`, SHA-256 `7f6c49548fe40a74b641ca8ce04cb10a24a9bef7b36689ff289dbf9fbe1d8a74`.
- Native-history/phase replay on the current repaired phase implementation: **61/61 pass**, zero failures, cancellations, skips or todo; 1,590.896875 ms, actual process exit 0. Private log `local-evidence/cloud-quantity-ui-2026-10-03/native-history-boundary-local-final.log`, SHA-256 `f251088210a4e7dc70bc763b772873303b98a1cffbbe2e4ba9d3ef870ce220c3`.
- Complete TypeScript after both deltas: actual exit 0. This receipt does not extend the earlier 3,027-test checkpoint to the current source or claim a fresh whole-suite/browser outcome.

Exact tested inputs:

| Input                                                 | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| src/server/integration-offline-refund-review.ts       | `fde9c873185b18bf94ffa2e0dfe953088e559b487235b6e426ed920907dfeab8` |
| src/server/integration.ts                             | `53c35a2869849262fa45d7113d3f03f494bb834cf4822a1cd21e94f4623338fb` |
| tests/integration-offline-refund-review.test.ts       | `e4067845087eeec860bccd6f348dc6003793232b2ada35ae3303838d4f204a85` |
| tests/restore-offline-native-history-boundary.test.ts | `cd2b5754f04ff57492fa3a55df28e70193a0ab59f7354e98cb1173effeaf6e52` |
| src/server/restore-activation.ts                      | `ae42b61b40d2c28c2abfd9ac5c949b6511628b4ea534234f04877c0b724be7a2` |
| src/server/restore-offline-phase.ts                   | `397a65ceab3d6a51eed3ffed49e78be7883da45cebad3455a9f0f5a2cc220c92` |

Private transfers, patch files and logs are retained with mode 0600 and excluded from publication.

## Practical limits

The Integration API refreshes current native staff authority on the existing writer transaction and returns detached frozen owner facts. Its production delta contains SELECTs and a narrow composition method; ordinary mutations and provider state machines are unchanged. It always retains explicit missing Billing-complete-history, Platform-receipt-history and unattributable-inbox blockers at this prerequisite profile, even though root now has a separately integrated Billing reader. There is no qualified source fence, external approval authority, offline outcome importer, native cash change or activation.

Integration preflights collection counts and selected large JSON columns before materializing them. Other string columns and the aggregate/encoded result are checked after materialization; this receipt does not establish a universal allocation bound before reading all columns. Independent cloud review owns additional adversarial tests; root owns any production repair and future composition. Complete source/provider interval history and authenticity cannot be inferred from hash consistency, local rows or a copied restore hold.

The native boundary tests add complete 1,000-row terminal/unresolved history, aggregate UTF-8 preflight, real native isolation writer behavior, rollback/restart, ownership and competing-connection checks. They establish historical read behavior only. Original phase failures and their [root repair receipt](LOCAL-OFFLINE-PHASE-BOUNDARY-REPAIR-2026-10-03.md) remain separate and preserved. Durable schema18 storage and the qualified mutation coordinator are still pending integration; no infrastructure, provider or product acceptance is asserted.
