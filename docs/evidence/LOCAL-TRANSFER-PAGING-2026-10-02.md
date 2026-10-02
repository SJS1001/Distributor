# Local transfer paging API receipt — 2026-10-02

Parent: `f5c7270897a08f44d796fc3029fd965a4bacfcfa` on `codex/local-distributor-checkpoint`. Environment: macOS arm64, Node 24.16.0, native SQLite and disposable synthetic CA/US fixtures. The [machine companion](LOCAL-TRANSFER-PAGING-2026-10-02.json) binds tested input and private log hashes. Direct workstation checks only; no CI runner, delegated/cloud session, provider request, PR, merge or deployment.

## Scope

Added inventory-owned `transferPage` and authenticated `/api/transfers/page`: at most twenty headers, current organization/site authority, live custody-state filtering before the SQL limit, creation-time/insertion-order traversal and purpose/version/scope/filter-bound canonical tokens. Original custody detail projection is shared with the legacy full-list operation. The existing browser and `/api/transfers` retain full-list behavior; browser page/filter/retry integration is pending. No schema, dependency, license, workflow or stock/money mutation changes. See [API behavior and limitations](../TRANSFER-QUEUES.md).

Seven new tests exercise tied headers and restart in CA/US, all five live states derived from native receipt/loss/recovery commands, changed-state continuation anchors, SQL scope and twenty-detail expansion, forged/current/revoked grants, empty sites, malformed or missing/foreign cursor anchors, legacy receipt projection, read conservation, HTTP session and strict query validation. Header-time and visibility fixtures explicitly modify synthetic inventory-owned records; these do not establish physical custody or migration qualification.

## Actual outcomes

| Command | Outcome |
| --- | --- |
| `npm test` | Exit 0; 1,983 passed, zero failed/cancelled/skipped; 80,148.894042 ms. |
| `npx tsx --test tests/transfer-queue.test.ts tests/transfers.test.ts tests/transfer-loss.test.ts tests/inventory-authority.test.ts` | Exit 0; 22 passed, zero failed/cancelled/skipped. |
| `npm run typecheck` | Exit 0 on final source. |
| `npm run format:check` | Exit 0 on final source. |

No browser/build/React scan or isolated production runtime rerun is claimed for this server/API checkpoint. The first focused invocation failed two fixture recovery assertions by using the transfer ID instead of the returned loss ID. Corrected fixture runs passed; the original failed log remains separately retained privately. Historical receipts and failures remain unchanged.

Self-review checks fresh native authority, parameterized owning-module SQL, scope and effective-state filtering before limits, scoped anchor lookup, exact retry/cost/quantity behavior retained by legacy transfer checks, per-read conservation and staged publication boundaries. Per-transfer histories remain unbounded; query/index/full-scan costs, read writer reservations, changing facts between pages, browser controls, production load/security/residency, actual providers/devices and human acceptance remain open. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete. The owner-authorized public snapshot excludes runtime stores, credentials, private raw logs and generated assets.
