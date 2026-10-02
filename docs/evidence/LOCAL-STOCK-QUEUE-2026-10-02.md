# Local stock and replacement search engineering receipt

Date: 2026-10-02. Candidate based on local parent `c5b2afc`; exact parent, final input manifest and command/log hashes are in the [machine receipt](LOCAL-STOCK-QUEUE-2026-10-02.json). Direct macOS arm64 workstation checks use synthetic SQLite facts, loopback HTTP and production-build Chromium. All 44 tasks and 10 product gates remain **NOT VERIFIED**.

## Behavior checked

Inventory returns at most twenty current scoped records per page, applies serial/bin/product/warehouse/condition filters before its SQL limit, and separately calculates full positive usable availability. Warranty replacement search resolves the returned product through inventory's owning API and pages eligible serials independently of dashboard stock. See [the interface and procedure](../STOCK-QUEUES.md).

Ten new backend cases cover bounded rows and complete totals; deterministic traversal/restart and a changed live anchor; literal search, filters and native reservation balances; warehouse scope before limits/aggregates and current grant changes; malformed, foreign and search/purpose-bound cursors; persisted roles/password restrictions; original claim product and off-page eligible replacement custody; session/strict HTTP validation; independent grant revocation/restart with native fact conservation; and exclusion of held, wrong-product, nonusable or in-transit replacements. Current claim state and native reservation guards remain authoritative.

Four new phone-width Chromium journeys cover full Overview totals, exact failed-page retry, keyboard focus, off-page stock inspection, superseded filter/navigation/refresh/sign-out responses, independent replacement pagination/search, discarded dialog responses and native off-page replacement reservation. The complete existing browser suite also runs. Older synthetic conservation helpers explicitly traverse stock pages; off-page custody actions use the actual Inventory search. The product dashboard stays bounded. Programmatic keyboard navigation/refresh/sign-out checks exercise cancellation while a dialog is open; they do not claim the modal permits background pointer clicks.

## Results and version limits

| Check | Observed result |
| --- | --- |
| Complete backend suite | 1,874 passed, zero failures |
| Stock and master import backend cases | 19 passed, zero failures, including ten new stock cases |
| Complete production-build Chromium suite | 86 passed, zero failures, including four new journeys |
| Type and final formatting checks | Exit 0 |
| Production-only isolated runtime installation | PASS; CA and US startup twice, PDF/ZPL generation and encrypted backup/restore |
| Changed React Doctor scan | Exit 0; existing App complexity warning and one reviewed false positive |
| Earlier full React Doctor scan | Exit 1; 214 findings, 41 errors and 173 warnings; superseded candidate |

The final manifest identifies 375 source/test/script/configuration inputs. Backend, focused and runtime runs precede only final legacy browser-oracle/search adaptations and test formatting; all production and backend-test inputs match their tested bytes. The final complete browser command builds production assets and uses final browser test bytes. Formatting after the type check changes only layout. Chromium coverage does not qualify other browsers or physical devices.

Changed React diagnostics include the existing App complexity warning. The replacement selector's loading reset is inside `finally` behind a controller identity guard; the reported outside-finally reset warning is a reviewed false positive. Stable callbacks resolved its effect dependency warning. Earlier full diagnostics and their failures remain preserved; no clean full scan is claimed.

Original synthetic SQL/identity/type errors, intermediate browser locator/modal/projection errors, full-suite stock-oracle/search failures, the final formatting failure and superseded successes remain private under `/tmp/distributor-stock-queue-checkpoint`. No native conservation assertion was removed. No reduced parent reproduction was run for this checkpoint. Historical receipts and third-party notices are preserved. Machine receipts and the handoff record local structure/whitespace and committed-byte checks. Private temporary files can be removed by machine cleanup; hashes identify observed evidence, not durable product acceptance.

## Review and outstanding work

Self-review checked current persisted authority before reads, organization and site predicates before SQL limits, authorized anchors before live filtering, literal serial/bin matching, native allocation/replacement balances, claim/product/site/state custody, strict HTTP fields, canceled response fencing, exact retries, required replacement selection and keyboard focus. Each page is transactional; dashboard summary and other collections are separate reads. No schema, dependency, license or workflow change.

Limits bound returned records only. Accumulated browser rows, SQL/summary scans, immediate-transaction writer contention, other collections and existing internal full-stock reads remain unqualified. Stable identifier continuation is live: insertions before its boundary require refresh, and loaded quantities/custody may become stale. Existing staff visibility policy, broader React diagnostics, actual providers/devices, infrastructure residency, production security/load/recovery and operator acceptance remain open. This is partial D-008/D-013/D-016/D-032/D-033 and REQ-03/REQ-07/REQ-10/REQ-17 engineering; it does not complete D-039 or pass a product gate.

Work is local only. No CI runner, cloud session, delegation, provider/device request, push, PR, deployment or publication was started.
