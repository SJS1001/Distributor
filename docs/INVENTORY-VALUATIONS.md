# Evidenced inventory carrying-value adjustments

D-013/D-034/D-036/D-039 engineering continuation, 2026-10-03. Valuation changes carrying value through an inventory-owned compensating record. Original unit acquisition cost, original movement cost and physical quantity remain preserved. All 44 tasks and ten product gates remain NOT VERIFIED. Use synthetic isolated stores for rehearsal; actual accounting basis, recoverable values, finance evidence and regional operation still require qualification.

## Establish and review a policy

Current organization finance principals, including administrators, use **Inventory → Stock valuation** on a granted stock row. Read operations recheck persisted role, account scope, password-change requirements and warehouse grants. Policies belong to the organization/product and retain immutable revisions. Supply an established accounting basis, method, effective date, closed-through date and finance evidence. Specific identification also requires non-interchangeability evidence: a serial number alone does not establish it. Supported method declarations are specific identification and FIFO receipt layers; this control does not change acquisition costs or migrate an established method.

Review the fixed policy snapshot and explicitly confirm it. Ordinary maintenance cannot change the established basis, method or effective date, or reopen a closed period. This is an evidenced customer policy, not an automatic accounting recommendation or independent accountant certification.

## Prepare and independently decide

The current review binds organization, data region, configured currency, exact stock revision/quantity/acquisition cost/custody, carrying position and policy revision/hash. Region and currency are separate organization settings; a Canada-resident USD organization remains Canada-resident and no currency conversion occurs here. Only physically held or in-transit stock with positive quantity can be valued.

Supply a unique retained reference, write-down or reversal, target carrying value in integer minor units, explicit open posting date, reason, value evidence and accountant evidence. A write-down must decrease current value. A reversal requires a retained decrease, increases current value and cannot exceed remaining original acquisition cost. Dates must be real calendar dates, on or after policy effectiveness and strictly after the closed-through date.

A fixed review contains no editable fields. Confirming prepares a ready record without changing stock or carrying value. A different current finance principal then reviews the original record and approves or rejects it with a reason. Approval rechecks the exact current stock/policy/position; stale prepared evidence refuses approval. Rejection preserves the historical preparation. Approval atomically records a zero-quantity value movement, carrying position/effect, stock revision, independent decision and command receipt. The accounting handoff uses the explicit valuation posting date rather than the later decision timestamp.

History returns at most twenty records per page, with unit-bound continuation. Original preparation, independent decision, reference and review evidence remain available after disposal to authorized principals. No journal is automatically sent to QuickBooks and no provider permission is inferred from a valuation.

## Retain and recover the exact attempt

Before transport, browser confirmation saves one exact organization/principal attempt containing the original idempotency key, body, fixed snapshot and fingerprint. Web Locks coordinate tabs; storage read-back checks prevent replacing another retained attempt. An unknown/lost/malformed reply retains that evidence. Reload and use **Recover exact valuation attempt** under the same current principal. Policy/preparation recovery submits the original body/key; decision recovery first reads the original native record and accepts only the matching terminal decision, avoiding another decision request.

Damaged, empty, mismatched or inaccessible storage blocks replacement writes. There is no discard bypass. Closing a submitted review or abandoning a response cannot undo native effects and preserves recovery evidence. Identity, hash and exact decision/reason checks prevent treating an unrelated reply as success. A fixed review is not durable until confirmation persists it. Finance/operator reconciliation is required when the retained evidence or current authority cannot be verified.

## Preserve value through custody changes

Inventory-owned carrying effects follow shipments, customer/supplier returns, bulk splits, relocation, transfers, loss and found-stock recovery. Integer allocation gives the split child its proportional floor and preserves the remainder on the parent, conserving total value. Recovery returns the value associated with the retained loss, not a newly invented acquisition. Original acquisition totals and signed physical movement totals are reconciled separately from carrying totals. Historical journals keep their original immutable inputs and outcomes.

Full valuation reconciliation streams raw movement rows but retains maps of valued positions/effects/splits. Its memory and scan time can grow with valued history; production scale remains unqualified. The current export still requires complete reconciliation before a bounded selected movement window. This is not a constant-memory or production-load claim.

## Schema and recovery

Schema 16 adds five inventory-owned tables: policy revisions, valuations, carrying positions, movement effects and split lineage. Normal startup requires the exact current regional/reporting profile. Use the reviewed [fresh-file schema upgrade](SCHEMA-UPGRADES.md) for exact versions 1–15; preserve the original source. Older encrypted archives are refused by current [recovery](RECOVERY.md), rather than silently migrated. Current encrypted isolated restore preserves valuation history and positions, checks native reconciliation and retains the durable provider hold. Valuation policy/preparation/decision commands refuse that hold.

Native/API [bulk quantity-error correction](INVENTORY-QUANTITY-CORRECTIONS.md) and a [durable restore lifecycle](RESTORE-ACTIVATION.md) are implemented in the current schema-17 continuation. Quantity browser controls, infrastructure writer fencing/routing, any required owning-module post-cutoff imports, actual finance/provider/device/residency/security/load/recovery/operator acceptance and release qualification remain open. Synthetic browser/native checks are engineering evidence only. CI jobs/workflows, provider calls, deployment and product-gate acceptance are not authorized by this procedure.

See the [local engineering receipt](evidence/LOCAL-INVENTORY-VALUATIONS-2026-10-03.md) for exact tested inputs, outcomes and retained historical failures.
