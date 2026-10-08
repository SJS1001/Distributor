# Distributor domain audit and repair receipt — 2026-10-07

Audited baseline: `6471e00f5128fc0d85487a8ff81813342b855c57`. The verification below applies to that baseline plus the coordinated, uncommitted 2026-10-07 source and tests in this workstation checkout. The parent system review records the final integrated version and browser/security evidence. This receipt does not qualify a deployment or change any product checkpoint from **NOT VERIFIED**.

Owner scope: whole native domain workflow and integrity review, followed by authorized fixes and independent challenge of the security lane. This lane owned inventory, warranty, their application composition, inventory cost movement integration, and the new `system-domain-*` tests. HTTP/IAM and shared/web contracts were coordinated with their respective owners; concurrent work was preserved. No provider call, CI job, deployment, purchase, or external data ingestion was performed.

## Confirmed findings and dispositions

### P1 — Generic stock commands bypassed customer return custody

At the baseline, `src/server/inventory.ts:1375`–`1427` permitted generic inspection to change a received customer serial from quarantine to usable without asking the warranty owner whether the claim retained custody. Reproduction: ship `S1`; submit, approve and receive its claim; generic `stock.inspect` marks it usable; a second customer order allocates `S1` while the first claim remains received. Supplier return and generic serial-loss approval likewise could consume that stock outside the owning claim. Quarantine was represented as a condition, but the generic condition mutation had no claim-custody guard.

The new custody regression failed before the correction because the expected denial did not occur. The correction injects Warranty's task-shaped `assertGeneralStockMutation` into Inventory at `src/server/application.ts:233`; the owning claim query is `src/server/warranty.ts:150`. It runs inside the same SQLite transaction as the mutation and denies physical release while a claim is received, inspected or repairing. Generic inspection, count/quantity adjustment, supplier return, transfer dispatch and approved serial loss invoke the guard. A shortage report/rejection and same-site bin relocation retain custody; the latter changes the stock revision, so a prior handover review becomes stale. Warranty's own inspection, repair, restock and scrap transitions remain operative. There is no foreign-table query or write in Inventory.

Regression evidence: `tests/system-domain-warranty-custody.test.ts` covers all three active custody states, denied mutations without retained effects, serialized quantity correction refusal, serial-loss report/approval/rejection, and the owning restock/scrap paths.

### P2 — A repaired original serial had no customer collection completion path

The baseline repair disposition retained the original returned serial as stock/quarantine, quantity one. Restock, scrap and replacement were available, but collection of the customer's repaired original equipment was absent. Restocking made it available for resale and caused sold-serial coverage lookup to fail on its stock state. Existing replacement and disposition tests did not prove an original repaired-unit handback. This contradicted the native repair journey in PLAN and CH-06; it was an incomplete business operation, not merely a missing label.

The correction adds `Warranty.repairReview` and `Warranty.handoverRepair` at `src/server/warranty.ts:2166` and `2201`. Review resolves the claim's exact serial and stock revision without relying on a loaded stock page. Handover requires current warehouse/admin authority and current site scope, repairing claim state, no credit or active replacement, the reviewed stock revision, exact serial, recipient and retained evidence. The same command transaction changes inventory to sold custody/quantity zero, completes the claim as disposed/repair, appends immutable owner history and records the permanent command receipt. Exact replay rechecks current authority; conflicting payloads and second remedies fail.

Inventory's owning operation is `src/server/inventory.ts:3747`. Original shipment, invoice, customer ownership, installation registration, ordinary-return start and warranty end remain retained; no new order, invoice, credit or replacement is generated. The history stores a versioned structured receipt and the entitlement basis using the existing immutable warranty decision store, so no schema migration is needed. Restart and repeated repair read that retained ownership evidence. A repaired replacement retains its replacement ownership and inherited warranty basis. Staff claim projection exposes `repairHandover`; the buyer projection omits recipient, collection evidence and repair reason. HTTP routes, strict inputs and the shared web contract were implemented by the coordinated lanes.

Regression evidence: `tests/system-domain-repair.test.ts` covers original and replacement serials, exact/conflicting retries, second-remedy exclusion, stale revisions, incorrect scans, required evidence, canceled replacement handling, current-role/site/deactivation enforcement on cached replay, restart, repeated repair, preserved registration, buyer privacy and rollback when either the history audit or command-receipt audit fails.

### Iteration 2 — Repair handover needed cost/control interpretation

Independent postimplementation cost/reconciliation checks rejected the new movement as unsupported because the shared movement-sign registry did not yet recognize it. The integration correction is `src/server/inventory-costs.ts:55`: `repair.handover` is a negative inventory custody movement. The new regression checks the exact quantity/value reduction and zero stock/sales/billing reconciliation issues. A separate valuation case proves that acquisition cost 6,000 is retained while an approved carrying value of 4,000 is removed exactly at collection. This is a correction discovered during iteration of the new feature, rather than a baseline finding.

### Independent security cross-review — Login storage-cap race corrected

The security lane's initial admission correction counted a prospective account row under the SQLite lock but released that lock before password hashing and the eventual failure-row insert. An independent deterministic reproduction used two Application instances against one SQLite file, with the second login interleaved during `scryptSync`. Starting one row below the declared 8,192-row cap produced 8,193 rows. Arithmetic reservation was insufficient across connections.

The security owner changed admission to insert a zero-failure account reservation in the admission transaction. The same independent reproduction then retained exactly 8,192 rows. The owner additionally challenged a successful same-account login clearing that reservation while another principal takes the slot; failure recording now rechecks capacity in its atomic insert/update SQL. This lane reviewed that final guard and ran the seven security admission tests, including both deterministic interleavings. Existing-row failures still increment atomically; absent rows cannot be recreated past capacity. No IAM source was edited by this lane.

## Architecture and workflow coverage

The main native composition remains a modular application with module-owned stores and task-shaped operations. Platform command receipts, authorization-before-replay, SQLite writer transactions, inventory reservation/state checks and bounded integer inputs are the governing mechanisms. Cross-module operations call their owners rather than writing foreign tables. This review found the custody gap at the generic Inventory/Warranty boundary; it did not find a reason to split modules merely because files are large.

| Journey                                       | Reviewed integrity boundary                                                                                                                | Evidence and limits                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplier receipt → stock                      | Procurement receipt joins inventory and incoming-order owner operations in its transaction; retained receipt and serial/cost evidence      | Native path review; receiving browser qualification belongs to the integrated parent review                                                                                     |
| Stock → allocation                            | Availability excludes quarantine and native reservations; shortage/partial allocation and order changes retain owning reservation controls | Native path review; active customer-custody mutations newly tested                                                                                                              |
| Pick → pack → handover                        | Fulfillment owns state and exact scanned quantities; stock and invoice effects join the handover transaction                               | Native path review; existing authority/replay patterns examined, not a fresh exhaustive fulfillment acceptance run                                                              |
| Invoice → payment/refund                      | Billing owns exposure, original lines, credits and refund capacity; input bounds and control arithmetic retained                           | Reconciliation regressions run for CA/US, original opening evidence, rejected/completed refunds, currency drift and oversized integers; no live Stripe/QuickBooks qualification |
| Return → inspect → repair/restock/scrap       | Warranty owns active claim custody and explicit disposition                                                                                | New guard and repaired-unit regressions; owning existing disposition/history regressions rerun                                                                                  |
| Replacement → collection → later claim/repair | Real stock reservation and ownership chain retained without new sale                                                                       | Existing replacement tests include separate-process assignment/cancel-versus-collection races; new repaired replacement and inherited coverage tests                            |
| Stale/retry/failure                           | Revision checks, permanent command receipts, current authority and transaction rollback                                                    | New original repair cases plus existing warranty registration/history/replacement and valuation cases                                                                           |
| Stock/value reconciliation                    | Original acquisition movement interpretation plus retained adjusted carrying value                                                         | New handover movement/value oracle; existing partial transfer, loss, recovery, relocation, count and rounding cases rerun                                                       |

Integer review retained the existing distinction between bounded business numbers and exact aggregate calculations: quantities/prices/revisions are validated at their native boundaries; tax and control sums use integer/BigInt arithmetic with explicit supported-range checks. The added handover creates one quantity-minus-one movement and relies on the existing owning valuation pipeline; it introduces no floating-point monetary calculation. HTTP serial length 160 and revision maximum 1e9 match the native persisted-stock input bounds.

## Workstation verification

Environment: macOS workstation, Node `v24.16.0`, project dependencies, isolated synthetic SQLite fixture databases. The tested source includes the coordinated in-progress corrections; baseline historical receipts remain distinct.

Command:

```sh
node_modules/.bin/tsx --test tests/system-domain-repair.test.ts tests/system-domain-warranty-custody.test.ts tests/warranty-registration.test.ts tests/warranty-replacement.test.ts tests/warranty-decisions.test.ts tests/reconciliation.test.ts tests/inventory-valuations.test.ts
```

Outcome: **67 passed, zero failed/skipped/canceled**. Seven cases are new domain regressions. The rest independently challenge retained warranty, reconciliation and valuation behavior.

Additional independent verification:

```sh
node_modules/.bin/tsx --test tests/system-security-login.test.ts
npm run typecheck
```

Outcome: **7 security admission tests passed**, and standalone TypeScript checking passed. The independent two-connection cap reproduction also returned `{maximum:8192,actual:8192,nested:true}` after the correction. The temporary reproduction files contain synthetic data and are not repository artifacts.

The final audit pass reviewed transaction placement, task-shaped ownership, exact replay/current authority, required scans/evidence, original/replacement entitlement identity, buyer receipt projection, cost interpretation and failure rollback. No remaining confirmed blocker was found in these owned backend corrections. This scoped result does not certify every repository journey, physical collection evidence, live providers, residency, carrier hardware, production restore/cutover, or operating-policy qualification. Parent browser and HTTP verification must be considered separately; all product gates remain NOT VERIFIED.
