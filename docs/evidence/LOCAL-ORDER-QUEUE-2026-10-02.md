# Local order queue — 2026-10-02

Status: PASS for recorded synthetic engineering scope. Full system incomplete; all 44 tasks and 10 product gates remain NOT VERIFIED. Partial D-008/D-019/D-020 and REQ-03/REQ-12/REQ-13 coverage only.

## Tested version and environment

Local parent `20ab4e1a35b35fb12f1868afad244177669df6f7` plus exact candidate and 344 tested input hashes in [the companion manifest](LOCAL-ORDER-QUEUE-2026-10-02.json). Direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, synthetic SQLite, loopback HTTP and production-build headless Chromium. No actual provider/device/customer calls, CI/cloud session, push/PR or deployment.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1752/1752; ten new tests |
| Focused orders/domain/accounting balances | PASS, 26/26 |
| Full production-build browser | PASS, 76/76 |
| Focused phone order queue | PASS, 2/2 |
| Typecheck, format and production build | PASS, exit 0 |
| Isolated production-only install/startup | PASS, 209 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

Order pages apply fresh active/password authority, organization, buyer account or warehouse sites and exact native open/closed state before fetching at most 21 headers. Only twenty visible headers receive the existing line/reservation projection. Creation time plus identifier gives stable descending tied-time boundaries. Current-scope cursors remain usable after their order leaves a filter; former scopes fail. Each page holds one SQLite transaction for authority, headers, lines and reservations. An independent connection cannot update a header during line enrichment; it succeeds after that transaction ends. Native state and histories remain conserved by these reads.

Synthetic database checks independently cover 63 matching orders plus 80 unrelated-site records, twenty/twenty/two filtered continuation across actual application/SQLite restart, 103 orders across six pages, only visible-header enrichment, grant/account changes, forged/disabled/password-restricted principals, empty site scope, foreign organization/cursor refusal and invalid direct/HTTP queries. Native acceptance, two distinct partial collection shipments and native cancellation demonstrate actual open/closed transitions. Newer creations require refresh; public reservation deadline/overdue summaries remain present. The dashboard displays twenty orders and retains aggregate counts for the full authorized scope.

Production-build phone checks use 45 tied-time scoped orders and unrelated customer records. They cover exact failed continuation retry, 20/40/45 loaded rows, failed state filtering/retry, 15 closed and 30 open rows, full open-order count, pagination focus, exact oldest-page amendment history and closing focus. Held real HTTP responses exercise superseded filters, navigation, refresh and sign-out fencing; a later login starts from twenty orders. These paging fixtures do not claim actual accepted order or physical fulfillment evidence.

## Retained failures and limits

The companion manifest binds command timestamps/exit codes/log hashes, current source/configuration, unchanged historical receipts/notices, production assets and isolated runtime commands/inputs. Initial shared-state type error, aggregate-object assertions, wrong browser route and nondisplayed-description assertion remain privately retained with failed traces and pre-route-fix source. The first full backend run passed 1747/1749: fresh read authority exposed two older fixtures using an absent buyer and restricted actor. Revised tests retain explicit access denial, use a persisted scoped buyer and independently compare native owning headers/lines after password revocation. No authorization was relaxed. All final checks use the same unchanged 344 inputs.

No schema, dependency, license, workflow or provider change. The queue is live, not a session-wide snapshot; loaded rows can become stale, newer creations need refresh and older state changes can appear later. Page and count snapshots are separate. Internal full-list reads remain unbounded and now require current authority. Header limits do not qualify per-order line/history size, database scan/sort/lock cost, site scope size, browser accumulation or other dashboard collections. Immediate read transactions may contend with writers. Actual operating/tax policies, providers, infrastructure residency, physical devices, other browser engines, production security/load/recovery and operator acceptance remain pending. See [the queue procedure](../ORDER-QUEUES.md).
