# Local shipment status queues — 2026-10-02

Status: PASS for the recorded synthetic engineering scope. Full system incomplete; all 44 tasks and 10 product gates remain NOT VERIFIED. Partial D-008/D-026/D-028/D-036 and REQ-03/REQ-16 coverage only.

## Tested version and environment

Local parent `cc3b49269fc6cf46391d5832e2348c44eb99e464` plus exact candidate and 339 tested input hashes in [the companion manifest](LOCAL-SHIPMENT-FILTERS-2026-10-02.json). Companion SHA256: `cbccd55a349856556d2d2dc8e7a51a196f90e25c0e95de229afa235a7d157776`. Direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, synthetic SQLite stores, loopback HTTP and headless Chromium. No actual provider/device request, customer data, CI runner, cloud session, push/PR or deployment.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1742/1742; two new tests |
| Focused shipment paging/delivery | PASS, 18/18 |
| Production-build Chromium | PASS, 74/74 |
| Revised focused queue/history browser regression | PASS, 2/2 |
| Typecheck, formatting and production build | PASS, exit 0 |
| Isolated production-only install/startup | PASS, 207 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

Native packed, shipped and void filters use the fulfillment state. Delivery filters use the latest organization-scoped recorded revision, with handed-over or collected defaults for shipped rows without history. A shipped filter includes every native handover regardless of its latest recorded delivery outcome. The API validates the exact optional status and rereads active identity, password restrictions, buyer account and warehouse grants before accessing the cursor. Scope and filter apply before the 21-row database result limit.

Synthetic fixtures independently exercise all ten states, superseded revisions, foreign history with a matching shipment ID, 43 matching shipments with tied creation times and 80 unrelated warehouse rows. Twenty/twenty/three continuation pages return each expected matching row once across actual SQLite/application restart. An accessible cursor remains a creation boundary after it leaves the selected status; changing site grants denies a former cursor. Invalid direct values and malformed/repeated HTTP queries fail. Private history descriptions do not enter the queue projection; reads conserve native fulfillment records.

The production-build phone journey creates a native synthetic carrier handover and separate manual delayed observation. It exercises status selection, empty results, failed first-page retry, superseded filter responses, refresh/sign-out continuation fencing, preserving unrelated pending dashboard sections and phone width. Native stock, order and invoice facts remain unchanged by queue reads. Separate history interaction verifies focus restoration after paging and closing the dialog.

## Evidence and limits

The manifest binds command timestamps, exit codes, log hashes, tested source/configuration, unchanged historical receipts/notices, production assets and isolated runtime inputs/commands. Initial nonexistent-command fixture failure and the full-suite history focus failure, its independent reproduction and both failed traces remain privately retained. Refresh had removed the original dialog opener during history paging. The correction preserves current rows until the dashboard replacement. Only the web UI changed after the backend check; its original input map is retained, all backend/configuration/fixture bytes are unchanged, and revised type/format/browser/runtime checks bind the final UI bytes.

No schema, dependency, license, workflow, native write or carrier call changes. This is a live creation-key queue, not a snapshot: older shipments entering the status may appear later, newer matches need refresh, and loaded rows can become stale. Returned database rows are bounded; query scan/sort/lock cost, large site scopes, total accumulated browser rows and other unpaged dashboard collections remain unqualified. Manual observations do not prove physical delivery or carrier truth. Actual providers, devices, residency, commercial/tax rules, production security/load/recovery and operator acceptance remain pending. See [the queue procedure](../FULFILLMENT.md#filter-the-shipment-queue).
