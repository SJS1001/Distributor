# Local import authority checkpoint

Date: 2026-10-02. Engineering evidence only; all 44 tasks and 10 product gates remain **NOT VERIFIED**. Partial D-008/D-035 and REQ-03. See the [machine receipt](LOCAL-IMPORT-AUTHORITY-2026-10-02.json), [import procedure](../IMPORTS.md#current-import-authority), [user access](../USER-ACCESS.md#current-import-authority) and [implementation status](../IMPLEMENTATION.md).

## Version and environment

Parent `2da3c80` on `codex/local-distributor-checkpoint`. Candidate source/tests/docs and 352 final tested inputs are hashed in the machine receipt; the [handoff](../HANDOFF.md) records the committed version and audit. Direct macOS arm64 workstation checks use synthetic SQLite, loopback HTTP and local production-build Chromium. No CI runners, cloud sessions, actual provider/device requests, live data, deployment or publication.

## Changed behavior

Opening-stock, customer/catalog master and unpaid-document import reports reload current active persisted administrator grants and required-password state. Preview and approve/reject commands reauthorize before saved results and effects inside their existing atomic command transaction. Native frozen source manifests, exact controls, fingerprint checks, permanent mappings and permitted retries retain their existing behavior.

Sixteen authority tests cover all four import kinds: absent/foreign/deactivated principals, administrator demotion, forced password changes, supplied administrator forgery, actual promotion with stale caller roles, independent connection grant changes and real database/application restart. Tests exercise lists, saved/new preview keys, saved/new approved and rejected results, and fresh pending decisions. Denied operations conserve owning migration/customer/catalog/stock/money/order and platform command/audit/event facts. Valid approvals and rejection retries preserve their original results across later reauthorization.

The first twelve tests failed against the unchanged parent modules and passed after the fix. The final expanded suite independently failed 16/16 against the unchanged parent modules in an isolated private copy and passed against the final candidate. Older tests used invented reviewer identities; they now assert denial and use real persisted reviewers. A reviewer-seeding fixture initially altered an import user-count baseline; seeding before that baseline preserves its original conservation assertion. These failures remain retained. No production guard was relaxed.

The first direct Playwright invocation failed before tests because its web server could not find the local tsx binary in the shell PATH. Using npm exec provides the declared binaries; the final three workflows passed without a source or dependency change. Logs and original failures remain private under `/tmp/distributor-import-authority-checkpoint`.

## Captured verification

| Check | Outcome |
| --- | --- |
| Expanded unchanged-parent reproduction | 16/16 fail, retained independently |
| Focused imports including authority | 42/42 pass; 16 authority cases |
| Full backend | 1823/1823 pass |
| Production-build Chromium imports | 3/3 pass: customer/catalog, opening stock, unpaid documents |
| Typecheck, format, build | Exit 0 |
| Isolated production-only installation/runtime | PASS: 209 copied inputs, 69 development-only packages absent, 27 child commands; CA/US each start twice, output PDF/ZPL and locally restore encrypted backup |
| Structure/local links and whitespace | Commands/outcomes retained in machine receipt |

All final tested input hashes, command timings/log hashes, production assets, runtime receipt, historical evidence and license notices are bound in the machine receipt.

## Limits

This is partial authorization engineering. Other module/internal APIs and independent approval policy remain to audit. Import history is capped at fifty batches; separate queries do not establish coherent snapshots. Actual source rights/freeze/control reconciliation, cutover, providers/devices, regional infrastructure, operating policies, production security/load/recovery and operator acceptance remain unqualified. Other browser workflows were not rerun. Full-system work remains active.
