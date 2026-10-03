# Evidenced bulk quantity-error corrections

D-013/D-034/D-036/D-039 engineering continuation, 2026-10-03. Inventory owns an append-only correction to a retained acquisition or physical-count error. Original receipt/movement quantity and acquisition cost remain preserved. Separate finance approval changes current physical quantity and records its carrying-value effect on an explicit open accounting date. All tasks and product gates remain NOT VERIFIED; actual physical and accountant evidence still require qualification.

## Select and prepare the original error

Current organization finance principals, including administrators, need a current warehouse grant and no required password change. The stock layer must be nonserialized, physically in stock, and have an evidenced valuation policy. Eligible retained source movements are nonzero `receipt`, `opening`, `count` or `quantity.correction` records belonging to that exact organization/layer with the same original acquisition cost. Delivery, transfer and serialized discrepancies need their owning custody workflow.

Read `GET /api/stock/:unitId/quantity-review?sourceMovementId=...`. The immutable review binds organization, region, currency, unit revision/custody/quantity/cost, retained source, current reservations, carrying position and exact policy revision/hash. Currency and residency are separate settings; this operation performs no conversion.

Prepare `inventory.quantity.prepare` with the exact `unitId`, `sourceMovementId`, `reviewHash`, unique permanent `reference`, `targetQuantity`, `postingDate`, `reason`, `physicalEvidence` and `accountantEvidence`. Target quantity is an integer from zero through 100,000, must differ from current quantity and cannot consume reserved stock. The real calendar date must be on or after policy effectiveness and strictly after its closed-through date. This is an explicitly evidenced open-period correction; it does not reopen or restate a closed period.

Preparation has no stock or accounting effect. Only one ready correction may exist for a stock layer, and a retained reference cannot be repurposed after rejection or approval. Preserve the exact idempotency key/body and review before transport. The [fixed-review Inventory interface](INVENTORY-QUANTITY-UI.md) selects retained sources, freezes preparation and separate decisions, and retains exact uncertain attempts. Its contribution receipt identifies mocked checks; native HTTP/browser-contract checks and full native browser journeys have separate integration evidence.

## Independently approve or reject

Read `GET /api/stock/quantity-corrections/:correctionId` and review the retained original evidence. A different current finance principal submits `inventory.quantity.decide` with the exact `correctionId`, `reviewHash`, `decision` (`approve` or `reject`) and `reason`.

Approval rechecks stock, reservations, carrying position and current policy against the original snapshot. A changed order reservation, stock revision or policy stales the review. Approval atomically appends `quantity.correction`, retains the original acquisition unit cost on the signed physical movement, retains the independent decision and carrying effect, and records the command receipt. A reduction proportionally allocates the current carrying value with integer allocation. When a valuation position exists, an increase uses its established carrying-value basis, including after reaching zero; otherwise it uses original acquisition cost. For example, a retained basis of 4,001 minor currency units for six units gives a 2,000 carrying-value increase for three added units while the original unit cost remains unchanged. A zero target is permitted when nothing is reserved. Rejection retains preparation and decision without an effect.

Accounting export uses the approved explicit posting date and retains the correction identity/hash. Full-history evidence validation also runs behind an existing export cursor: missing, malformed, orphaned or inconsistent correction evidence refuses export rather than silently dropping a movement. Previously prepared accounting packets and journal inputs remain immutable. No QuickBooks journal is sent by this operation.

## History, retries and restore

`GET /api/stock/:unitId/quantity-corrections?after=...` returns at most twenty records with a unit-bound continuation. Current role, organization, security and site authorization govern reads and cached command receipts. An exact preparation retry returns the original prepared snapshot even after a later independent decision; it does not replace that snapshot with the current record or create another movement. A decision retry retains the original terminal effect.

Damaged retained JSON, policy/source bindings, hashes, arithmetic or decision/effect identity fail closed with `QUANTITY_INTEGRITY`. Single-record and paged history reads reconcile complete owning evidence in the same transaction, including history before a cursor. Pagination bounds returned records, not the cost of that reconciliation; production scale and contention remain unqualified. The shared shape guard includes zero remaining stock and independent decision records. Restore/provider holds prohibit correction writes, including cached command retries.

Schema 17 adds inventory-owned correction storage alongside platform-owned restore-release storage. Use the reviewed [fresh-file upgrade](SCHEMA-UPGRADES.md) for exact older supported stores; preserve the original. Synthetic isolated recovery and reconciliation are engineering checks, not production activation or actual residency evidence. Actual error classification, approved accounting treatment, physical custody, provider delivery, operator acceptance and production scale remain unqualified.
