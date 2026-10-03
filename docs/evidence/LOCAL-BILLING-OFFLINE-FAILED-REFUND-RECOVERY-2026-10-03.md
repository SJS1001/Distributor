# Local exact Billing failed-refund recovery receipt

Exact tested source/test commit: `be4e09afc466be2c415a20be1ef80d485912cd2b`, based on published `fac6f11c67823822c41864ef6b9f12d4e6e4910b`. All 657 frozen inputs match that commit's blobs. [Input manifest](LOCAL-BILLING-OFFLINE-FAILED-REFUND-RECOVERY-2026-10-03.json), SHA256 `a52816295423499f1a2ab79d4295cf74689b6da924d92790ab2a8af0633f0569`. Direct workstation Darwin arm64, Node24.16.0, SQLite3.53.0, OpenSSL3.5.6; synthetic isolated native databases, no provider IO or CI runner.

## Actual outcome

- Full native regression: 3860/3860 pass, zero failures/cancellations/skips/todos, 96871.645ms, exit0.
- Five affected Billing suites: 128/128 pass, zero failures/cancellations/skips/todos, 2926.387041ms, exit0. The new recovery file contributes 24 native tests. Complete TypeScript and source/test formatting pass; whitespace passes.
- Initial new-file run: 24 total, 22 pass, 2 fail, 2483.034667ms, exit1. A mismatch fixture used a syntactically invalid payment ID, and a rollback fixture attempted a forbidden nested transaction. Corrected fixtures use a valid unequal payment ID and the actual outer native writer; the original mismatch/rollback assertions remain. Production validators were not relaxed. Original red log retained.
- Initial planning check failed because the runbook linked to this not-yet-written receipt. The original failed log is retained; closing documentation receives its own final structural check. A planning check does not verify a product gate.

## Demonstrated boundary and remaining work

The [owning reader](../../src/server/billing-refunds.ts) recovers the exact original failed observation and revision-one notice after a durable native commit and synthetic lost reply. Complete later ignored observations and notice acknowledgements remain bound to current facts. Tests cover Canada/CAD, Canada/USD and US/USD, reopen, strict current native finance authority, outer transaction, hostile input, damaged history, orphan reference collisions, pre-materialization count/UTF-8 bounds, detachment and purity. Existing unknown-state review, digest and historical test files are preserved.

This is retained Billing consistency only. A normal first-failed native provider observation can have the same shape. Root must still join the exact retained Platform receipt, Integration provenance and original captured comparison with independently qualified current trust/revocation and actual source/candidate commit fencing. No provider evidence, import provenance, retry/write or release authority follows from this reader. Integration completeness prerequisites and static root composition remain incomplete; all product gates remain NOT VERIFIED.

Technical/infrastructure owns qualified current trust, revocation, actual source/candidate commit interlock and source/residency evidence. Finance/product owns tax/terms/mappings and customer residency choices; providers/logistics owns contracts, authorized sandbox access and carrier/device qualification; QA/operators owns actual accepted cycles and numeric targets. Wake conditions are those qualified inputs. Parked items remain incomplete.

Ignored local log receipts:

| Log                                                              | SHA256                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `billing-offline-recovery-full-2026-10-03.log`                   | `f0c4ce4aeee86da3916484564584b2342b4553f8ddde8b523670bc3f95a13ca8` |
| `billing-offline-recovery-focused-2026-10-03.log`                | `afff05211e20b9c9b0f2c3ab4691412486f7640350442fddfa84e1529ed71bd5` |
| `billing-offline-recovery-initial-2026-10-03.log`                | `8a2926810cbb23870cd2823c818cf4b9953ccbd8edf852562452a8683cf46d3b` |
| `billing-offline-recovery-typecheck-2026-10-03.log`              | `8a702e6f87c8a6ca129035a44568229aa0a0ce49ce48d85c056ac1c3a87c0c57` |
| `billing-offline-recovery-format-2026-10-03.log`                 | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |
| `billing-offline-recovery-plan-2026-10-03.log` (initial failure) | `b5381c375cc87fe19019e3c7b1b957cc6b52ed047d878dd38426aff23be038d9` |

Self-review: exact owned source/test delta reviewed; no schema, dependency, public route, private input or license changes; owner boundaries and conservative refusals preserved. Current 657-input manifest matches committed bytes. Full-system acceptance and external qualification are separate outstanding requirements.
