# Canada Post warehouse runtime and HTTP operations — 2026-10-01

**PASS within captured workstation regression scope. Full system incomplete; all 44 tasks and 10 gates NOT VERIFIED.** Partial D-027/D-036, REQ-03/REQ-16/REQ-19, CH-05/CH-07/CH-08/CH-09. Reviewer: Codex self-review; independent provider/security/operator acceptance remains outstanding.

Parent `655e948` on `codex/local-distributor-checkpoint`. Candidate captured 2026-10-01T22:28:58.614805+00:00. The [companion](LOCAL-CANADA-POST-RUNTIME-2026-10-01.json) binds 256 application/configuration/test inputs, preserved historical evidence, 170 unchanged dependency license/notice files and private command/log hashes. No schema/dependency/license changes. The [runbook](../CARRIER-BOOKINGS.md#canada-post-warehouse-runtime-and-http-operations) records configuration, routes and remaining operating limits.

Environment: direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, disposable native SQLite and Chromium. Original synthetic native order/packing records, injected creation/manifest clients and original PDFs; no actual provider/account/credential/device/live data. Configuration checks inject a transport that fails if called. Browser results cover existing regression journeys; grouped warehouse UI is not implemented or tested by these 52 journeys.

| Check | Observed result |
| --- | --- |
| `npm test` | PASS 1209/1209, exit 0; 28 new runtime/API tests |
| Focused runtime/configuration/native/protocol | PASS 407/407, exit 0 |
| `npm run test:e2e` | PASS 52/52 with production build, exit 0 |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |

Expected and observed: startup is off unless explicit common and Canada Post flags, test-application acknowledgment, regional organization, exact inventory warehouse, shipping point/account/company/credentials and domestic mappings are supplied. Malformed/extra fields are refused with sanitized errors. Construction performs no provider I/O and configuration captures values. A test marker cannot establish credential class or provider geography on the shared gateway.

Trusted runtime registrations retain exact organization/warehouse/configuration and bound method receivers. A two-member group creates each member once, reviews the exact closed manifest and transmits once; stock/order/shipment/invoice snapshots remain unchanged while exact integration bookings become booked. Mutating registration objects/method handles after construction cannot redirect execution. Wrong warehouse/configuration/organization and fresh revoked user/site/password authority are refused before provider hooks. Generic individual Canada Post sends/reconciliation are disabled.

Group history returns 20 entries plus cursor, retaining canceled groups in ID order. Cursor warehouse/isolation is checked; active membership becomes null after unsent cancellation and serialized views contain no private bytes. The current exact routes enforce same-origin authenticated session, CSRF on writes and bounded exact schemas. Group preparation/cancellation use existing idempotency receipts. A two-member HTTP journey prepares/replays, creates, reviews/transmits and downloads a private no-store hashed PDF; absent sessions are refused. An entirely unsent group can cancel with processing disabled.

Lost member and manifest replies return sanitized 500 and leave durable unknown outcomes. Subsequent create/transmit is refused with 409 and no second write. Explicit read-only reconciliation uses the retained identities and confirms existing effects; counters show one member write, one manifest write and recovery reads only. Retained document/group/history access remains available while processing is off. Fulfillment handover remains separate and owner-controlled.

Preserved failures: initial type check used an invented configuration Actor missing required fields; replaced with an inventory-owned trusted organization/warehouse read. Initial tests used a spaced pickup postal code, wrong security column and the minimal prepare result as a full group view; corrected fixtures to the supported exact contract. A later access fixture updated an absent security row; corrected to insert/upsert. The older generic carrier parameterization expected individual Canada Post dispatch; updated it to assert grouped-only refusal and zero hooks. Final lost-response test initially expected 409 on the first transport error; corrected to the existing sanitized 500 contract, retaining explicit unknown-state, subsequent 409 and no-resend assertions. All intermediate logs remain private and hash-bound; temporary artifacts have no archival guarantee.

Self-review inspected current principal/warehouse selection, frozen receiver/configuration capture, no fallback/individual dispatch, server-owned fingerprints, exact HTTP schemas/session/CSRF boundaries, bounded scoped pagination, unsent cancellation, private downloads, native conservation and lost-response read-only recovery. Counts establish regression within this captured scope only.

Remaining: warehouse batch selection/group controls and browser recovery/private-document UX; explicit scoped stale-claim procedures; actual carrier credential class/account/protocol/service/fee/terms/residency qualification. Other account writers remain unfenced; aggregate deadlines/lease timing, real regional infrastructure, physical printing/devices, security/load/retention/restore targets and operator acceptance remain unqualified. Direct workstation checks and local commits only; no CI runner/job/workflow, delegation/cloud source transfer, push/PR, actual provider request/account, deployment/publication/purchase/live data or OPUS/UB integration.
