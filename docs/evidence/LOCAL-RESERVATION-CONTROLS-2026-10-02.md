# Local reservation and packing controls — 2026-10-02

Status: PASS for the recorded synthetic engineering scope. Full system incomplete; all 44 tasks and 10 product gates remain NOT VERIFIED. Partial D-023/D-036 coverage only.

## Tested version and environment

Local parent `219caab9537930afcd00c65c9a5e8e4b3cd268c9` plus the exact candidate and 338 tested input hashes in [the companion manifest](LOCAL-RESERVATION-CONTROLS-2026-10-02.json). Companion SHA256: `efaba23ffe542cef4e1b494aa42248f7462e53122a63f589442a09f1304f393c`. Direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, synthetic SQLite stores, loopback HTTP and headless Chromium. No actual provider/device request, customer data, CI runner, cloud session, push/PR or deployment.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1740/1740; 37 new tests |
| Focused reservation/sales/reconciliation/receipt regression | PASS, 91/91 |
| Updated production-build phone reconciliation journey | PASS, 1/1; other browser journeys not rerun |
| Typecheck, formatting and build | PASS, exit 0 |
| Isolated production-only install/startup | PASS, 206 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

Before implementation, deleting an outstanding native allocation left stock and billing controls healthy and did not report the recorded order promise mismatch. The independently failing test is retained. Current owning order/inventory projections add exact quantity, cancellation, remaining allocation, stage and current usable-stock facts; reservation comparison performs no SQL or writes.

CA/US native journeys exercise partial bulk packs and handover, void, unpick, cancellation and actual application/SQLite restart. Serialized short picks and explicit expiry retain picked/packed commitments correctly. A fully released historical reservation stays healthy after its unit is transferred. Existing sales tests cover return/replacement history without treating the original closed sale as a current stock promise.

Independent faults check missing orders/lines/units, mismatched product/site, unusable or in-transit stock, order allocation drift, excess promises, invalid retained ranges/stages and unsafe 64-bit inputs. Product-level comparisons detect offsetting allocation drift. Active packs check missing/wrong-scope/not-picked allocations, duplicate lines and combined quantities exceeding remaining allocations across separate packs. Malformed private packing JSON is diagnosed without echoing its contents.

Native warranty holds share unit capacity with ordinary reservations. Valid holds remain healthy; missing, damaged or nonserialized held units and conflicting ordinary promises produce discrepancies. Foreign organization units/allocations/holds cannot alter native controls or their hash. Exact large comparison totals and full issue counts are preserved while only the first hundred details leave the server; serials and private fixture descriptions are absent.

Whole-store snapshots prove diagnostic reads do not mutate retained business data. A separate SQLite writer is locked during the new owning projection. Reservation drift invalidates a reviewed control hash; original saved report bytes survive the drift and actual restart. The updated phone journey renders the added order/packing codes, saves and downloads their exact original bytes, retains earlier dated reports after payment, refuses stale saves/tampered downloads and discards failed/abandoned reads.

## Evidence and limits

The manifest binds command timestamps, exit codes, log hashes, tested source/configuration, unchanged historical receipts/notices, production assets and isolated runtime input/command evidence. Initial expanded fixture failures, missing bulk serial type error, Playwright PATH invocation failure and later stale browser refresh assertion are retained with the failing browser trace. Only that browser assertion changed after the full backend run; all backend source and fixture inputs stayed unchanged, and the final type/format/browser checks use its revised bytes.

This adds checks to the existing report shape and issue collector without a schema, dependency, license or workflow change. Existing saved reports retain their original dated bytes and check scope. Agreement does not establish physical custody or actual pick accuracy, actual bank/provider balances, commercial/tax correctness, coordinated corruption, production security/residency/load/recovery or operator acceptance. Whole scan/IMMEDIATE lock and memory costs grow with current units, allocations, holds and retained history; peak costs and storage policy remain unqualified. No automated correction or provider replay is provided by reconciliation. See [the operating procedure](../RECONCILIATION.md).
