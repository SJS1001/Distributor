# Local replacement carrier booking verification — 2026-10-02

Status: PASS for the recorded local synthetic engineering scope. Full system incomplete; all 44 tasks and 10 product gates remain NOT VERIFIED. Partial D-027/D-030/D-036 coverage only.

## Tested version and environment

Local parent `0e92f6079ec48f88944dabbf3b7b38a0854bfe6b` plus the exact candidate and 331 tested input hashes in [the companion manifest](LOCAL-REPLACEMENT-CARRIER-2026-10-02.json). Companion SHA256: `51c3ce9c5ae23ce480c92d365847d0b4f679f7385c5d5af3b7a1a99df90ef5ed`. Direct macOS arm64 workstation with Node 24.16.0/npm 11.13.0, synthetic SQLite stores, loopback HTTP and Chromium against a production Vite build. No actual carrier, scanner/printer or external customer data was used. No CI runners, cloud sessions, deployment, push or PR.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1650/1650, 22 new replacement carrier tests |
| Full production-build browser (`npm run test:e2e`) | PASS, 74/74; new phone replacement booking/dispatch journey |
| Focused carrier/Canada Post/warranty tests | PASS, 490/490 |
| Typecheck and formatting | PASS, exit 0 |
| Isolated production-only runtime install/startup | PASS, 203 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

The replacement coordinator reads native warranty/inventory snapshots and stores its target in the integration namespace. Preparation and unsent cancellation preserve native stock, orders, shipments, invoices and money. Repeated preparations recover one receipt; canceled reviews admit an explicit linked successor. Public views/events carry native replacement IDs. No order, allocation or fulfillment shipment is fabricated.

Current grant/site, role, active-state and password restrictions precede cached preparation, scoped history and private labels. Claim, approval, held-unit/returned-unit custody, customer choice and restore drift refuse adapter entry. Late drift at the required one-write guard produces uncertainty with no provider write. Unknown outcomes survive restart, block cancellation/collection/dispatch and cannot be repurchased; exact read-only lookup recovers one synthetic proof.

Dispatch requires the exact scanned serial, provider, tracking, recipient and reviewed address. Wrong bindings preserve native facts. Successful dispatch applies native replacement custody/disposition once, retaining original invoice and entitlement; restart/retry preserve the private label. A sales credit hold does not create a new-sale restriction on this warranty remedy. A late audit failure rolls back native custody/disposition while retaining booked proof. The injected Canada Post creation/manifest client requires confirmed membership before dispatch and retains the private label afterward.

HTTP coverage checks strict target fields, session/CSRF, exact retry, organization/cursor scope and reviewed multiline address. The 390-by-844 Chromium journey covers lost committed preparation response with the same key/payload, private downloaded label bytes, retained history, close-focus restoration, rejected wrong tracking, separate exact dispatch, unchanged original billing, terminal private labels, no page errors and no horizontal viewport overflow.

The manifest retains command timestamps, exit codes/log hashes, runtime inputs/child commands, exact matching private/current production assets, prior evidence and license notices. Initial password-security, pre-manifest tracking and event-reader fixture failures remain retained privately; production checks were not weakened. The browser server-start timeout is also retained. It occurred during concurrent verification; resource contention is an inference, not a proved cause. The unchanged browser command/configuration passed when rerun after the other checks terminated.

## Limits

Synthetic clients and phone fixtures do not qualify actual carrier replacement protocols/services, vendor terms, customs declarations, labels/printers or delivery authenticity. Default-disabled provider bindings, reviewed configuration and named customer choices remain required. Canada Post creation/manifest support still requires an injected client; this change does not register a production client. Unsupported provider recovery, carrier void/refunds and booked/unknown correction remain unresolved.

This change supports one held same-product serialized unit, with separate native dispatch. It does not establish substitute products, procurement, multiple packages or consolidated tracking. Current claim/approval/custody changes invalidate the frozen booking and block dispatch; no override bypasses that refusal. Explicit history pages contain at most 20 records; synchronous locks, scan cost, retained bytes and loaded history require production volume/index/latency qualification.

Local restart and existing broader recovery checks do not establish power/disk recovery, actual infrastructure residency, production security/load, agreed RPO/RTO, real devices or human acceptance. No schema, dependency, license or workflow change. See [replacement operation](../WARRANTY.md#review-a-replacement-carrier-booking) and [carrier boundaries](../CARRIER-BOOKINGS.md#replacement-booking-targets). This evidence authorizes no live integration or release.
