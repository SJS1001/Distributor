# Local supplier availability browser receipt — 2026-10-02

Parent: `7953511f1d243abdc3aae92668e7f6c0a5936fbf`. Candidate: source/test/configuration SHA-256 inputs and production assets in the [machine companion](LOCAL-SUPPLIER-AVAILABILITY-UI-2026-10-02.json). Environment: macOS arm64, Node 24.16.0, local Chromium, synthetic Canadian native HTTP/SQLite fixtures and production Vite assets. This is direct workstation verification, with no CI runner, workflow, cloud/delegated session, real provider request or deployment.

## Change and actual verification

Purchasing adds searchable twenty-row supplier pages, commercial/admin reviewed suspension/resumption with reasons and revisions, reader history in twenty-change pages, and original key/body recovery after lost replies and reload. Stale reviews require explicit refresh; failed refresh stays blocked and retries that refresh. New purchase review checks current availability. A definitive native suspension refusal releases only its uncommitted attempt and restores original purchase quantities/costs; a cached committed purchase remains recoverable after suspension.

| Command | Actual outcome |
| --- | --- |
| `npm test` | Exit 0; 1,966 passed, zero failed/cancelled/skipped; 83,234.665 ms. |
| `npm run typecheck` | Exit 0 on final source. |
| `npm run build` | Exit 0 on final source; existing bundle-size warning remains. |
| `npm exec -- playwright test --grep 'browser:.*(purchase\|supplier paging\|supplier availability)'` | Exit 0; 13 passed in 18.4 seconds. |
| Four new supplier browser journeys | Exit 0; four passed in 10.9 seconds before the combined regression. |
| `npm run format:check` | Exit 0 on final candidate. |
| `npm run verify:plan` | Exit 0 on final documents. |
| `git diff --check` | Exit 0. |

The new phone journey traverses 20/40/43 supplier rows, loses an actually committed suspension response, reloads and retries the exact request once, then explicitly resumes. The stale-revision journey injects a concurrent native change, verifies refusal, a failed refresh and successful same-mode retry; an actual warehouse principal reads 20/40/43 changes with a failed continuation retry and refreshed twenty-row history. Purchase journeys distinguish an uncommitted transport failure followed by native suspension refusal from a lost actually committed reply followed by suspension: only the first permits correction, retaining two units at 1,234 cents each; the second recovers the original single order with identical key/body. Prior purchase entry, queue, supplier paging and handover checks also pass.

## Diagnostics and preserved failures

Selected-file React Doctor commands use `--verbose --no-score --no-supply-chain --no-cache`. Supplier availability exits zero with four warnings, purchase entry exits zero with one large-component warning, and supplier picker exits zero clean. Main application exits one with 30 errors and 21 warnings. Scanning the exact parent main source reproduces those counts; diagnostic rule/severity/source-line multisets for all errors match. These existing main-application findings remain unresolved; a clean full-project React result is not claimed. Private comparison JSON and diagnostic logs are hashed in the companion.

The initial four browser failures are preserved, with copied traces, under `/tmp/distributor-supplier-browser-checkpoint/browser-initial-traces`: an implicit disabled textarea label was not found, native test transport omitted required Origin, and two purchase input locators were ambiguous. Explicit textarea labeling, required test Origin and role-based exact input selection corrected them. Later focused and combined runs pass; failures are not overwritten or represented as passes. A baseline scan outside the repository was refused by the tool; the corrected ignored local baseline scan supplies the comparison above.

## Review and limits

Self-review covers fresh native authority and idempotency, browser attempt persistence before transport, current revision checks, malformed/unknown reply retention, exact committed replay after suspension, definitive no-effect refusal before editing, cursor/refresh distinction, aborted or closed views and original purchase cost continuity. Publication includes original source, tests and documentation only. Private runtime databases, credentials, diagnostic logs, trace archives, assets and baseline copies remain ignored/local; dependency, license, schema and workflow files are unchanged.

No full browser suite rerun is claimed. Cross-device or cleared/copied browser storage, production directory/history scale and SQL costs, independent supplier-change/purchase races, encrypted recovery with nonempty availability history, retention policies and actual operators remain unqualified. Real provider/device acceptance, production infrastructure residency, migrations, security/load/recovery and human product acceptance remain open. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete. The owner authorized this source/test/documentation snapshot's normal GitHub branch push; no PR, merge or CI execution is part of this receipt.
