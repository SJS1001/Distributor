# Canada Post warehouse browser controls — 2026-10-01

**PASS within captured workstation regression scope. Full system incomplete; all 44 tasks and 10 gates NOT VERIFIED.** Partial D-027/D-036, REQ-03/REQ-16/REQ-19, CH-05/CH-07/CH-08/CH-09. Reviewer: Codex self-review; independent provider/security/operator acceptance remains outstanding.

Parent `d49e5a0734854d0909d5123b6bcaa1f19af97e38` on `codex/local-distributor-checkpoint`. Candidate captured 2026-10-01T22:45:19.078249+00:00. The [companion](LOCAL-CANADA-POST-UI-2026-10-01.json) binds 259 application/configuration/test inputs, historical evidence, 170 unchanged dependency license/notice files and private command/log/artifact hashes. No schema/dependency/license changes. Operating details: [carrier runbook](../CARRIER-BOOKINGS.md#canada-post-warehouse-browser-operations).

Environment: direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, disposable native SQLite and Chromium. Synthetic native orders/packing, injected creation/manifest clients and original PDFs. No actual provider/account/credential/device/live data. Synthetic HTTP failures and held responses explicitly exercise uncertain outcomes and stale reads.

| Check | Observed result |
| --- | --- |
| `npm test` | PASS 1214/1214, exit 0; five new candidate/group-review tests |
| Focused candidate/group-review tests | PASS 5/5, exit 0 |
| `npm run test:e2e` | PASS 55/55 with production build, exit 0; three new Canada Post browser journeys |
| Focused Canada Post browser journeys | PASS 3/3, exit 0 |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |

Expected and observed: authenticated candidate reads return 20 bookings plus continuation, exclude other carriers/canceled/active-group bookings, retain valid cursors after grouping and release canceled memberships. Current organization/site authority and retained review hashes precede address disclosure. Exact HTTP schemas, no-store responses, missing authentication, foreign records, malformed queries and revoked site grants are checked. Retained group booking reviews preserve immutable member order and native stock/order/invoice/shipment reads create no writes.

Phone browser journeys hold a Toronto read while switching to disabled Ottawa and verify the late result cannot change the selected warehouse. Candidate failures can retry; 23 candidates and 22 canceled history groups page beyond the first 20 without overflow. Selection across pages produces one exact immutable two-member preparation. A lost committed reply retries with the same command payload/key and retains one group. Refreshing the warehouse before changing selection explains that it does not cancel any already committed group.

Each injected creation writes once then loses its reply. Fresh group review exposes unknown state and offers read-only recovery, with two member writes and two recovery reads. Closed membership requires a separate manifest review; refreshing clears that review and its transmission control. Manifest transmission writes once then loses its reply; fresh unknown review recovers the existing manifest without a second write. Tampered private PDF hash refuses download; a correct response downloads bytes with the expected SHA-256. Both retained labels remain accessible. Stock/orders/invoices/native shipments are unchanged by group/provider operations; physical handover remains separate.

Read failure clears group provider/cancellation controls until a fresh review succeeds. Processing disabled hides member creation while permitting reasoned wholly unsent cancellation. A lost committed cancellation is observed as canceled on refresh without a second cancellation; candidates become selectable again. Navigation closes the group view. Opening the selected shipment's ordinary carrier review displays its active group and links back to the correct warehouse. Closed views and warehouse/session/navigation changes abort reads or discard late results; no page errors are observed.

Preserved failures: initial candidate test expected a nonexistent site error code; corrected to the actual FORBIDDEN contract. Type checks exposed a local response variable shadowing DOM document and invented tracking/reference fields; corrected to the shared contract. Retained group tests initially compared creation order against immutable member-ID order; corrected expected ordering while retaining exact review comparisons. Two initial browser timeouts exposed the selector's missing explicit accessible name; added its aria-label. A later browser assertion exposed a manifest div lacking region semantics; changed it to a named section. All intermediate logs and browser traces are retained and hash-bound privately; original behavioral assertions and timeouts were preserved. Temporary private artifacts have no archival guarantee.

Self-review inspected fresh ownership/authority and review-integrity reads, bounded cursor scoping, exact idempotent preparation, current group guards, unknown-only lookup, no resend/individual Canada Post dispatch, explicit manifest review/reset, read-abort/lifetime handling, bounded hash-checked private downloads and native conservation. Regression counts apply to this captured synthetic scope only.

Remaining: scoped stale-claim operating procedures; actual carrier credential class/account/protocol/service/fee/terms/residency qualification. External account writers remain unfenced; aggregate deadlines/lease timing, real regional infrastructure, physical printing/devices, independent security/load/retention/restore targets and operator acceptance remain unqualified. Direct workstation checks and local commits only; no CI runner/job/workflow, delegation/cloud source transfer, push/PR, actual provider request/account, deployment/publication/purchase/live data or OPUS/UB integration.
