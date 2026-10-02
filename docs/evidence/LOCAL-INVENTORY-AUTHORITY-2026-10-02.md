# Local inventory authority — 2026-10-02

Status: PASS for the recorded synthetic engineering scope. Full system incomplete; all 44 tasks and 10 product gates remain NOT VERIFIED. Partial D-008/D-015/D-017 and REQ-03/REQ-09/REQ-11 coverage only.

## Tested version and environment

Local parent `5a837c3366399b907d2a44e5877538784c79e39d` plus candidate and 346 tested input hashes in [the companion manifest](LOCAL-INVENTORY-AUTHORITY-2026-10-02.json). Direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, synthetic SQLite, loopback HTTP and production-build headless Chromium. No actual provider/device/customer calls, CI/cloud session, push/PR or deployment.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1766/1766; eight new inventory authority tests |
| Expanded inventory/transfers/loss/counts/serial/accounting/domain/import checks | PASS, 54/54 |
| Affected production-build browser journeys | PASS, 4/4 |
| Typecheck, format and production build | PASS, exit 0 |
| Isolated production-only install/startup | PASS, 209 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

Public warehouse names, transfer destinations, mapped warehouse lookup, stock, purchase origin, serial trace and transfer lists reload the active persisted principal, role and warehouse grants and check required password changes. Warehouse creation, inspection, transfer dispatch, arrival, loss approval and loss recovery do the same inside the existing immediate command transaction before cached-result return or native effects. Supplied role and site fields cannot restore revoked access. A completed dispatch retry checks the original source grant even after the stock arrives elsewhere; arrival retries check the original destination grant. Actual warehouse stock/trace scope, other existing staff visibility, buyer/commercial catalog names and authorized transfer destination names remain intact.

Eight new tests cover persisted role/site changes, forged grants, absent/foreign/deactivated principals, required password changes, all six command boundaries with prior and fresh keys, inspection grant revocation and completed transfer retry authority after independent connection changes and SQLite restart. Denied operations preserve independent owning facts across seventeen inventory and five platform tables. Existing partial/damaged arrival, serial identity, quantity/cost, loss/recovery, cached receipt, late-write rollback and separate-process stock/import contention assertions still pass. Old fixtures now use actual persisted staff/admin users and independent database conservation reads after authority revocation.

Four existing browser journeys exercise partial/damaged transfer retries, separate source/destination operators scanning a serial, administrator transfer loss/recovery and serial loss review/recovery history. Browser source did not change; other browser journeys were not rerun. Production build assets are unchanged by the later test-only fixture corrections.

## Retained failures and limits

The companion binds command timestamps/exit codes/log hashes, tested source/configuration, historical receipts/notices, production assets and isolated runtime commands/inputs. Original independent reproduction failed all seven initial tests before the inventory fix; original locations predate formatting. The eighth inspection grant test was added later and is not claimed as a pre-fix reproduction. Initial focused checks passed 26/30 because old fixtures trusted invented users or supplied role/site changes and expected foreign data lookup before identity rejection. The first full backend run passed 1763/1766: one conservation oracle read stock through a password-restricted user, one role test changed the supplied actor rather than persisted authority, and concurrent imports used absent invented reviewers. Fixtures now use independent owning-store reads and actual persisted users. Explicit denial, conservation, retry and concurrency assertions remain. All failed logs are privately retained and hashed; no production authority or concurrency guard was relaxed.

No schema, dependency, license, workflow or provider change. Internal task-shaped startup, availability, receiving, reservation, picking and warranty APIs are outside this change. Existing count/serial review paths already refresh custody authority. Public lists/history remain unbounded and do not share a coherent authorization/data/dashboard snapshot. Other module boundaries, MFA/session/worker enforcement, production scope/scale/contention/retention, operating/tax policies, providers, infrastructure residency, physical devices, other browser engines, production recovery/upgrades and operator acceptance remain unqualified. See [inventory operations](../SCANNING.md#current-inventory-authority).
