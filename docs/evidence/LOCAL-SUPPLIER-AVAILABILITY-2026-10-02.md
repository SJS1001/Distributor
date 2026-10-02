# Local supplier purchasing availability — 2026-10-02

Tested candidate: published parent `42cf8924a1d124655aac21095d05c6439b780d3f` plus the source/test changes bound by SHA-256 in [the machine receipt](LOCAL-SUPPLIER-AVAILABILITY-2026-10-02.json). Branch: `codex/local-distributor-checkpoint`. Environment: direct macOS arm64 workstation, Node v24.16.0; fresh synthetic CA/CAD and US/USD SQLite stores and production Chromium assets. No CI runner, workflow, provider request, PR, merge or deployment was started.

## Actual results

| Check | Command | Result |
| --- | --- | --- |
| Complete native suite | `npm test` | 1,966 passed; zero failed/cancelled/skipped |
| Focused native/schema/recovery | `npm exec -- tsx --test tests/supplier-availability.test.ts tests/schema-upgrade.test.ts tests/supplier-search.test.ts tests/recovery-profiles.test.ts` | 70 passed; zero failed/cancelled/skipped |
| Purchase browser regression | `npx playwright test --grep 'browser:.*(purchase\|supplier paging)'` | 9 passed |
| Additional earlier browser check | `npx playwright test --grep 'purchase review\|purchase supplier\|supplier search\|purchase entry'` | 1 passed |
| TypeScript | `npm run typecheck` | Exit 0 after fixture corrections |
| Build | `npm run build` | Exit 0; existing large-bundle warning retained |
| Formatting | `npm run format:check` | Exit 0 |
| Planning structure | `npm run verify:plan` | Exit 0; 44 tasks, 10 gates and 1,098 local links checked |
| Whitespace | `git diff --check` | Exit 0 |
| React scan | `npx react-doctor src/web/purchase-entry.tsx --verbose --no-score --no-supply-chain --no-cache --output-dir /tmp/distributor-supplier-availability-checkpoint/react-doctor` | Exit 0; two warnings, zero errors |

The React findings concern the existing large PurchaseEntry component and evaluation of its initial supplier expression on every render. The latter now searches at most twenty initial dashboard descriptors. Both are retained without suppression; no clean full-project scan is claimed.

## Tested boundaries

- Commercial/admin supplier changes require a current revision, an actual state transition and a reason. Native scope/current authority checks precede cached command replies. Reusing a key with altered details refuses; persisted demotion and forged role/organization cannot authorize a change.
- Suspended suppliers refuse new purchase orders. Exact existing order retries, original saved receipt confirmation and original-cost supplier returns remain available. Explicit resumption allows new orders. Synthetic CA/US restart checks conserve these facts and immutable actor/reason history.
- HTTP checks exercise unauthenticated refusal, strict unknown-field/type/length validation, stale revisions, no-store responses and all 43 retained changes through twenty-change pages.
- A late event insertion failure leaves neither a change nor command result. Retrying the same request after the fixture fault is removed commits once.
- Schema version 7 adds only procurement-owned supplier availability history. Independent literal version-six DDL/fingerprints come from the published parent. Version-one through version-six upgrade fixtures cover both regions and reporting profiles. Version-six nonempty shipment snapshots are retained; missing availability history remains empty. Current fresh-file clones retain supplier state, reasons and exact retry receipts. Older encrypted archives continue to refuse implicit recovery.
- Nine existing production Chromium journeys qualify purchasing/receipt/return regressions, search paging, current scope, cancel/navigation and exact lost-response recovery. They do not exercise supplier suspension/reactivation browser controls, which are not implemented in this checkpoint.

## Retained failures and limits

Earlier red tests recorded missing supplier state and a missing HTTP route. Subsequent private failures concerned actor field naming, stock cost assertions, SQL row typing, an inspection import, HTTP response type inference and a test trigger outside its owner prefix. Corrected fresh results are recorded separately; original logs are retained under `/tmp/distributor-supplier-availability-checkpoint` with hashes in the machine receipt. The first documentation check ran before its linked machine receipt existed and failed that missing link; the completed package subsequently passes. No full browser-suite rerun is claimed.

Dedicated supplier management/history UI, reviewed suspension purchase-editor recovery, competing supplier-change/purchase process qualification, encrypted recovery with nonempty availability history, real supplier policy/operator acceptance, production load/security/residency and actual provider/device qualification remain outstanding. Supplier pages add bounded per-descriptor status lookups; no production query/lock cost is qualified. Existing stores need an explicit reviewed fresh-file upgrade. No new dependency, license, copied private source or workflow was added. All 44 tasks and 10 gates remain NOT VERIFIED; the full system remains incomplete.
