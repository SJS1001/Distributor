# Local purchasing authority — 2026-10-02

Status: PASS for the recorded synthetic engineering scope. Full system incomplete; all 44 tasks and 10 product gates remain NOT VERIFIED. Partial D-008/D-014/D-017 and REQ-03/REQ-08/REQ-11 coverage only.

## Tested version and environment

Local parent `17ae57de05111c7f61ce7722972f399e8d5729cb` plus candidate and 345 tested input hashes in [the companion manifest](LOCAL-PURCHASING-AUTHORITY-2026-10-02.json). Direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, synthetic SQLite, loopback HTTP and production-build headless Chromium. No actual provider/device/customer calls, CI/cloud session, push/PR or deployment.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1758/1758; six new tests |
| Focused purchasing/drafts/supplier returns/follow-ups | PASS, 28/28 |
| Affected production-build browser journeys | PASS, 3/3 |
| Typecheck, format and production build | PASS, exit 0 |
| Isolated production-only install/startup | PASS, 209 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

The purchasing owner reloads the active persisted principal, role and site grants and refuses a required password change before supplier/order/receipt reads, supplier creation, PO creation, direct receipt, administrator supplier handover and receipt draft list/history/save/confirm/discard. Command authorization happens inside the existing immediate transaction before either cached-result return or native effects. Supplier follow-up/return reads already used current authority. Supplied role and site fields cannot restore revoked access. Warehouse receipt candidates still follow current permitted stock custody after a transfer, without exposing unrelated stock.

Six new tests independently cover actual role and warehouse changes, invented/foreign/deactivated principals, forged grants, required password changes, all seven command paths with both prior and fresh keys, and completed confirmation/discard retries. A separate application/SQLite connection revokes warehouse access before restart and subsequent save/confirm/discard attempts. Independent procurement headers/lines/receipts/returns/draft versions, inventory units/movements, platform commands/audit/order/clock/events remain unchanged after denied operations. Existing native process-contention and late-write rollback tests still pass. Real authorized second staff/admin users retrieve original business receipts with fresh keys without duplicate stock effects.

The three existing production-build browser journeys exercise receipt scan save/reload/review/confirmation retry, supplier handover retry with original purchase totals, and supplier finance credit/replacement/closure/correction/history. No browser source changed and other browser journeys were not rerun.

## Retained failures and limits

The companion binds command timestamps/exit codes/log hashes, source/configuration, historical receipts/notices, production assets and isolated runtime commands/inputs. Original security reproduction failed all five initial tests; their original log locations predate formatting. Initial helper typing failed typecheck. First expanded focused run passed 25/27 because old tests trusted invented users or altered supplied roles. Fixtures now use actual persisted principals and retain explicit unavailable-principal denial, stock and idempotency assertions. The expanded denial fixture also exposed an attempted duplicate initial draft; corrected it to edit its reviewed saved revision. All failures remain privately retained and hashed. No authorization or uniqueness guard was relaxed.

No schema, dependency, license, workflow or provider change. Lists/history remain unbounded; read collections do not share a coherent authority/data/dashboard snapshot. Production contention/scale/retention and all other modules' authority boundaries are outside this checkpoint. Actual operating/tax policies, providers, infrastructure residency, physical devices, other browser engines, production security/load/recovery/upgrades and operator acceptance remain pending. See [receipt operations](../SCANNING.md) and [supplier handover operations](../SUPPLIER-RETURNS.md).
