# Provider, residency and device plan

2026-09-30. Owner targets: US/Canada, Stripe, QuickBooks, major carriers/devices and customer choice of residency. All provider, hardware and product gates remain NOT VERIFIED.

## Customer choice

Organizations use their declared CA or US application region. Accounts start with strict regional processing. Customers may explicitly choose named Stripe/QuickBooks exceptions; acceptance is versioned and audited. Buyers may change their own choice; authorized staff may record it for an account. A staff acknowledgment alone is not independent evidence of customer consent.

The current choice is checked before intent creation, sends, reconciliation and payment retrieval. Withdrawal blocks subsequent requests; it cannot recall already transmitted data or in-flight requests. Native stock/orders/invoices and manual payment recording remain available. Changing the storage region requires an approved and verified migration.

Final disclosures must identify purpose, minimum fields, reviewed processing countries, subprocessors, retention/deletion and withdrawal consequences. Retain the disclosure version with acceptance. [Stripe's DPA](https://stripe.com/en-ca/legal/dpa) permits US transfers and global processing. QuickBooks and carrier processing locations need applicable vendor evidence. Region flags do not prove infrastructure, backup/log/support or processor residency.

Current carrier consent is a placeholder family `carrier`; no carrier adapter sends data. Replace it with individually named choices before enabling carriers. An umbrella exception must not silently authorize every vendor.

## Major carrier candidates

This is a proposed bounded interpretation of “all the top ones,” not a market ranking or purchase commitment. Every selected vendor/service needs its own adapter and receipts; the old single-carrier estimate needs revision.

| Candidate | Proposed qualification scope and primary source |
| --- | --- |
| UPS | Eligible US/Canada parcel and cross-border accounts/services; establish accessible APIs and authentication through the [developer portal](https://developer.ups.com/). |
| FedEx | US/Canada parcel rates, labels, cancellation, returns and tracking. The [catalog](https://developer.fedex.com/api/en-us/home.html) currently limits advanced visibility webhooks to US-based accounts; Canadian tracking cannot depend on that offering. Freight requires separate assessment. |
| USPS | US-origin postal products, including permitted international destinations; qualify OAuth, labels/tracking and account/payment access through the [current portal](https://developers.usps.com/). Not a Canadian domestic carrier. |
| Canada Post | Canada-origin shipping, manifests, customs and tracking; qualify current account/API requirements through the [developer portal](https://developer-developpeur.canadapost-postescanada.ca/devportal-portaildesdeveloppeurs/). |
| Purolator | Eligible Canadian/cross-border services; qualify [E-Ship Web Services](https://www.purolator.com/en/services/technology-solutions/e-ship-web-services) and applicable [certification requirements](https://www.purolator.com/en/services/technology-solutions/e-ship-certified-providers). |
| DHL Express | Eligible international express services from selected US/Canada origins; qualify [MyDHL API](https://developer.dhl.com/api-reference/mydhl-api-dhl-express), customs, labels and tracking. Other DHL business units need separate adapters. |

For each record origin, service, contract, currency, limits, insurance, duties/taxes and disclosure. Test rate expiry, multi-package labels, lost booking response, duplicate callbacks, cancellation after handover, returns and customs failure. Unknown bookings require reconciliation before another booking. Introduce vendors sequentially, repeating common scenarios. No accounts/access have been acquired; LTL/freight, own fleet and additional regional carriers need separate scope decisions.

## Device candidates

| Candidate | Qualification boundary |
| --- | --- |
| [Zebra DS2200, DS2208/DS2278](https://www.zebra.com/gb/en/products/scanners/general-purpose-handheld-scanners/ds2200-series.html) | Corded/cordless 1D/2D input, host layout/suffix, reconnect and duplicate reads. |
| [Honeywell Voyager](https://automation.honeywell.com/us/en/products/productivity-solutions/barcode-scanners/general-purpose-handheld/voyager-xp-1470g-general-duty-scanner)/Xenon | Exact supported model/firmware/interface, damaged labels and pairing; confirm current supplier/support terms. |
| [Datalogic QuickScan/PowerScan](https://www.datalogic.com/eng/automatic-data-capture/handheld-scanners-pc-3.html) | Select 2D-capable models for QR and linear codes; qualify warehouse range separately. |
| [Zebra ZD421](https://www.zebra.com/us/en/support-downloads/printers/desktop/zd421.html) and selected industrial printer | Exact DPI/media/driver/OS, readable stock/serial and carrier labels. |
| [Brother QL/TD](https://www.brother-usa.com/c/shop/label-makers-printers/thermal-printers-labelers/desktop) | Exact width/media/connectivity and compatible stock/shipping formats. |
| iOS Safari / Android Chrome cameras | Selected devices/browser versions, permission denial, poor light, duplicate/wrong-task scans and manual fallback. |

No physical device is qualified. Manual/keyboard-wedge input and feature-detected native browser camera input exist locally; see the [scanning runbook](SCANNING.md). Automated browser evidence uses a synthetic decoder and canvas stream. Actual camera/browser qualification and label generation/printing remain pending. Record model/firmware, cable/cradle, OS/browser, symbology and label size/material. Test actual reads and durability after handling. Text input does not prove pairing or SDK compatibility. Purchasing remains outside authorization; approved existing equipment may later supply receipts.

## Current executable provider boundary

Environment configuration supports one trusted organization binding. Use separate CA/US stores and runtimes. Binding ID, organization ID and current active staff finance principal are required; the worker re-reads regional organization and grants. Finance/support may send/reconcile effects; settlement and callback retry require finance. Admin includes these grants.

Providers default off. Scripts read exported environment variables, not `.env.example` automatically. Stripe accepts only test credentials and rejects live/connected-account events. QuickBooks uses its sandbox host and a short-lived environment token; durable OAuth/refresh/revocation and rotation remain pending. Local tests made no actual provider requests.

Following approved sandbox setup and customer choice, `npm start` serves HTTP and `npm run worker` processes one foreground batch then exits. It considers up to 20 pending effects and 20 due callbacks per binding. No schedule or background automation is installed. Keep provider access disabled for synthetic tests.

| Route | Controls/behavior |
| --- | --- |
| `POST /webhooks/stripe/:bindingId` | Raw bytes, 256 KiB limit, SDK signature verification with 300-second tolerance. Persists selected test checkout IDs/hash before 200; unsupported signed types ignored. Raw customer payload not retained. |
| `POST /api/effects/:effectId/execute` | Current finance/support session, origin and CSRF; only pending effects. Refunds require finance. Missing configuration rejects before claim. |
| `POST /api/effects/:effectId/reconcile` | Same controls; reads unknown outcomes. No match remains unknown and never triggers a new send. |
| `POST /api/effects/:effectId/refresh-refund` | Finance, origin and CSRF; reads an unknown or previously bound refund without resending. |
| `GET /api/billing/payments`, `GET /api/billing/refunds` | Finance/support; scoped original payments, native refunds and retained provider observations. Internal refunds are omitted from buyer/commercial effect lists. |
| `GET /api/provider-callbacks` | Finance/support; own organization's latest 200 receipts. |
| `POST /api/provider-callbacks/:callbackId/retry` | Finance; retries waiting/blocked/failed verification after resolving its cause. A read retry does not create a payment. |

Raw-body verification and prompt acknowledgment follow [Stripe webhook guidance](https://docs.stripe.com/webhooks). A public endpoint needs qualified HTTPS deployment; local injection is not delivery evidence. Cash requires retrieved test checkout metadata, amount/currency and successful payment intent with matching received funds/identity. Redirects do not prove payment; duplicate payment references do not add cash twice. QuickBooks reconciliation requires one document matching the Distributor effect marker, number, currency and total; exact country/tax behavior remains unqualified.

## Recovery and continuation

Sends move pending → running → completed, or unknown after lost responses. Running work abandoned for two minutes becomes unknown and is never automatically resent. Stripe lookup examines at most 1,000 sessions from the creation window; absence is inconclusive. QuickBooks accepts one invoice matching the effect marker; multiple results require review.

Callbacks move pending → processing → completed/waiting/blocked/failed. Waiting reads become due after 30 seconds; interrupted attempts become waiting after two minutes. Attempt numbers prevent abandoned workers overwriting successors. Residency/grant restrictions block verification; identity/money conflicts need finance review. UI/worker errors omit provider bodies, secrets and stack traces.

Operators use “Provider operations” and “Payment confirmations,” reconcile unknown sends and resolve causes before retrying verification. Synthetic tests cover lost responses, duplicates, stale claims and a new database connection. Actual termination during provider IO, external retries, rotation, prolonged outages/backlogs and alerting remain unverified.

Next: OAuth/secret lifecycle, accounting payments/credits/import reconciliation, actual Stripe refund qualification and notifications, buyer payment usability, individual carrier choices/adapters and physical devices. See [implementation status](IMPLEMENTATION.md), [tasks](TASKS.md), [checkpoints](CHECKPOINTS.md) and [local provider evidence](evidence/LOCAL-PROVIDER-BOUNDARY-2026-09-30.md).


## Credited cash refunds

Finance first credits eligible invoice units, then requests a refund against one original payment. Pending/unknown reservations count against credited cash and that payment's unrefunded amount. Requests do not move stock or add a second credit. The Billing screen shows retained native requests and provider observations; manual payments require a separate unique bank repayment reference. Recording manual evidence is not independent proof of bank settlement.

For Stripe payments, finance queues one immutable refund intent, then sends the pending operation using its stable effect idempotency key. The test-only adapter retrieves the original settled PaymentIntent and verifies test mode, identity, received amount and currency before creating or reading a refund. The request sends only the payment identity, integer amount and internal effect/refund metadata. [Stripe creation documentation](https://docs.stripe.com/api/refunds/create) describes that interface; [refund objects](https://docs.stripe.com/api/refunds/object) have statuses `pending`, `requires_action`, `succeeded`, `failed` or `canceled` and do not themselves expose a live-mode flag.

Only a matching provider refund changes native cash. `succeeded` completes the native refund; `pending`/`requires_action` retain an unknown cash outcome and its reservation; `failed`/`canceled` reject it and release the reservation. Observations remain immutable, including stale statuses ignored after success or a terminal failure. A later bank failure can reverse an earlier completed refund while retaining both observations, consistent with [Stripe refund handling](https://docs.stripe.com/refunds). Operators must reconcile the bank/customer outcome before any new repayment.

A lost send response remains unknown and is never automatically resent. “Check provider outcome” reads the original intent. A known refund is retrieved by its exact provider identity. An unbound lookup examines at most ten pages of 100 refunds for the original payment and requires one matching effect marker; duplicates or an exhausted search require review. No match proves neither failure nor safe resend. See [Stripe refund list pagination](https://docs.stripe.com/api/refunds/list). A new request/key must not be used to bypass unknown-outcome recovery.

The bounded worker polls previously bound unresolved statuses at least 30 seconds apart. Unknown sends require explicit reconciliation; succeeded/failed/canceled outcomes are not periodically polled. Finance can use “Refresh refund status” for later changes, including bank returns. Refund webhook processing, automatic late-failure notification, requires-action instructions and real customer payment/refund browser journeys remain pending. The existing webhook endpoint only processes test checkout events.

Fresh active finance grants and regional identity are checked before and after I/O. Current named Stripe consent is required before queue-cache access and each outbound call. If consent is withdrawn during a call, its already received outcome may be retained; subsequent reads are blocked. A restored provider hold blocks calls and completion. A token fences abandoned send/read workers; the runtime clears leases older than two minutes and marks abandoned sends unknown, requiring a read. Matching money, permanent provider binding, native state, observations, effect and audit/event changes commit together.

The [local refund receipt](evidence/LOCAL-STRIPE-REFUNDS-2026-10-01.md) covers mocked SDK calls, synthetic runtime/HTTP checks, real child-process lease contention and the manual refund UI. No actual Stripe request or bank repayment occurred. Refund/payment lists and observation history are currently unpaged; production load/indexing/retention/upgrade/recovery, policies, tax/currency/provider consent terms and infrastructure residency remain unqualified. OAuth/secrets, accounting cash/credits and actual provider qualification remain open. All tasks/gates remain NOT VERIFIED; direct workstation verification and local commits only, without CI runners.
