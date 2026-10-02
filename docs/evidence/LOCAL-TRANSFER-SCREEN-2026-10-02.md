# Local transfer browser receipt — 2026-10-02

Parent: `59964148e621b7934b91b970fa00ee63a6608f9a` on `codex/local-distributor-checkpoint`. Environment: macOS arm64, Node 24.16.0, native SQLite and headless Chromium with disposable synthetic Canadian warehouse fixtures. The [machine companion](LOCAL-TRANSFER-SCREEN-2026-10-02.json) binds final tested inputs, built assets and private log hashes. Direct workstation checks only; no CI runner, delegated/cloud session, provider request, PR, merge or deployment.

## Scope

The Inventory browser now uses the existing scoped transfer page API, replacing at most twenty displayed headers instead of loading the legacy full list. Older/Newer controls retain continuation tokens only. References identify otherwise identical routes. State filters and queue refresh restart at the selected state's first page; successful commands and application Refresh reset to all states. Failed/pending reads clear old rows and actions, exact retry retains the failed cursor/filter/page trail, and navigation/filter replacement/refresh/sign-out abandons late responses. Support remains read-only. Original receipt, loss and recovery commands and the legacy API remain compatible. No native runtime, schema, dependency, license or workflow change. See [queue behavior and limits](../TRANSFER-QUEUES.md).

Four new browser journeys use forty-eight native three-unit transfers with tied timestamps: forty-five in one destination scope and three in another. Native commands create all five effective states. Checks cover phone pages of twenty/twenty/five, keyboard focus, exact failed-page and failed-filter retries, all-state projections, independent warehouse scope, empty results, read-only support and delayed reads after filter replacement/navigation/application refresh/sign-out. An original off-page receipt loses its committed response, then retries the identical body/key once; original cost, remaining quantity, one arrival record and all other transfers are conserved. Existing partial-arrival and loss/recovery browser journeys are also exercised.

## Actual outcomes

| Command | Outcome |
| --- | --- |
| `npm test` | Exit 0; 1,983 passed, zero failed/cancelled/skipped; 80,730.904333 ms. |
| `npx playwright test --grep 'browser: (phone transfer pages|transfer support filters|transfer queue abandons|partial transfer retries|administrator reconciles missing transfer)' --output /tmp/distributor-transfer-ui-checkpoint/browser-focused-artifacts` | Exit 0; five passed, zero failed; 12.4 s. This preceded the fourth restricted-support journey. |
| `npx playwright test --output /tmp/distributor-transfer-ui-checkpoint/browser-full-artifacts` | Exit 0; 149 passed, zero failed; 3.0 min, including all four new journeys. |
| `npm run typecheck` | Exit 0 on final source/tests. |
| `npm run format:check` | Exit 0 on final source/tests. |
| `npm run build` | Exit 0; existing minified bundle over 500 kB warning remains. |
| Changed-source React Doctor scan | Exit 0; zero errors, two warnings. |

React Doctor retains existing App complexity and flags the guarded loading reset in TransferQueue. Source review confirms that reset is inside `finally` and only the current request may reset it; the delayed/failed-read journeys exercise this behavior. No warning was suppressed and no clean full-project React scan is claimed. The initial selected-file scan included existing main application errors and a new missing list key, which was corrected before the zero-error changed-source scan.

The first focused browser run passed two tests and failed the off-page receipt journey because its row locator incorrectly nested the queue region inside a row. The corrected locator and generic modal's actual Continue button are used in final tests. Original failed log, trace and screenshot context remain separately retained privately.

Self-review checks bounded replacement rather than accumulation, native warehouse authority, immutable exact read/mutation retries, current versus historical custody, original quantity/cost conservation, clearing stale actions, focus and abandoned responses, and publication exclusions. Per-transfer histories remain unbounded. Derived-state scans, index/read-transaction costs, changing facts between pages, durable generic transfer-dialog recovery, physical custody/devices, production load/security/residency/providers and human acceptance remain open. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete. Runtime stores, credentials, private logs/traces and generated assets are excluded from the owner-authorized public snapshot.
