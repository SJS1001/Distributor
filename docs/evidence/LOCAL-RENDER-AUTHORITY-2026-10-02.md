# Committed render authority — local engineering receipt

Status: partial local PASS, 2026-10-02. Automated workstation review; no human acceptance or product gate verification. All 44 tasks and 10 gates remain NOT VERIFIED. Scope: partial D-019/D-020/D-031 engineering, REQ-12/REQ-13/REQ-17.

## Candidate and environment

Parent `019a20e` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-RENDER-AUTHORITY-2026-10-02.json) records 392 final source/test/configuration hashes, three production assets, commands, timestamps and retained private artifacts. Verification ran directly on macOS arm64, Node v24.16.0, npm 11.13.0, Chromium and production React/Vite bundles with synthetic local HTTP/SQLite fixtures. No CI runner, delegated session, external provider or physical device was used. Backend, schema, dependencies and workflows are unchanged; earlier backend/runtime results remain historical.

## Change and independent outcomes

Order and claim queue request fences now update refs in a layout effect after React commits the screen inputs. A render that suspends and is abandoned cannot replace the visible queue's source or active state. Existing committed navigation, refresh and filter cancellation remain in place. The shared Modal was extracted unchanged from the application entry point apart from moving its busy and close refs into the same commit phase. Escape follows the visible dialog's current busy state and close action; committed updates still take effect.

The fixture uses the actual production hooks and Modal with React startTransition and Suspense. A held queue response completes after React attempts an uncommitted source or inactive update while the old screen remains visible. With the parent ref assignments all four queue cases stay at `initial · busy`; with the fix each shows `initial,continued · idle`, including after the suspended update is canceled. The parent dialog cases either block Escape using an uncommitted busy state or invoke the uncommitted close action. The fix invokes the visible close action. Two additional cases verify committed busy and callback changes, including Escape becoming available after committed busy clears.

The test bundle is served only through intercepted browser-test URLs and is never included in product dist. Modal extraction was compared with the parent function after normalizing whitespace and reversing the ref change: behavior matches exactly. Actual installed Vite license text was read (MIT); Vite is an existing development dependency, no vendor implementation was copied and no dependency change was made. Existing font and third-party notices remain retained.

## Verification and retained failures

- Corrected parent reproduction: exit 1, six behavioral failures and two committed-update passes. All four queue failures show the pending visible response being discarded; both dialog failures show uncommitted state controlling Escape.
- Final complete production-build Chromium: 110/110 pass, including eight new render cases and existing real queue, cancellation, keyboard, scanner, ordering, money and recovery journeys.
- Final TypeScript and formatting: exit 0.
- Changed-file React scan against parent, including untracked files: exit 0, seven files, no reported issues. This is not a clean full-project result.
- Full React scan: exit 1, 37 errors and 177 warnings across 380 scanned files. Four render-ref errors are removed compared with the previous checkpoint's 41 errors; unrelated findings remain. Existing custom-dialog, state/effect and App warnings are not resolved by extraction. Production build retains its large-chunk warning.
- Initial parent fixture build assumed Vite returned one output object instead of an array. The next run's four queue failures were ambiguous role=status locators, while both dialog cases reproduced the defect. The first fixed focused run was 6/10: four queue locator failures, two new dialog passes and four existing queue passes. The harness now uses a named queue status and declares UTF-8. Original logs, bundles, error contexts and traces are preserved; they are not misrepresented as behavioral proof. The corrected parent run and final full run establish the red/green result.

Private artifacts remain under `/tmp/distributor-render-authority-checkpoint`; the machine receipt binds their hashes. No backend/runtime re-verification or product acceptance is inferred from these UI checks.

## Owner-authorized repository snapshot

The owner first requested all work committed, then explicitly requested committing to the GitHub repository. This supersedes the earlier local-only restriction for the current Distributor source/test/documentation snapshot. Repository rules, README and decisions record that authorization. Read-only GitHub checks confirm the public SJS1001/Distributor repository, push permission, Actions enabled and zero workflows; local and historical tracked paths contain no Actions workflows. No CI workflow, runner registration, repository-setting change, PR, merge or deployment is part of this push.

Before publication, 1,929 historical blobs (131,380,437 bytes) and new files were checked for selected high-confidence credential patterns; none matched. No historical tracked private-data, local-evidence, environment-secret, database, private-key or backup paths were found. Private verification bundles/logs/traces, node_modules, dist and runtime data remain excluded. This scoped review is not a complete security/license audit. No product license is selected; OPUS/UB/private customer source and broader redistribution are not authorized.

## Validity and limits

The fix changes UI request authority and keyboard actions; native commands still own role/account/site, money, stock and custody authorization. Queue accumulation, database scan/lock costs, broader React diagnostics, other browser engines and actual provider/device/production/residency/operator qualification remain open. Synthetic suspension demonstrates React scheduling behavior; it does not establish operational throughput or product acceptance. Full-system implementation remains incomplete, with the rough engineering estimate still 45% remaining.
