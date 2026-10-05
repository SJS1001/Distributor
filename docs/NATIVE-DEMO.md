# Native Distributor demo runtime

This local runtime serves the actual `dist` build of `src/web` and forwards requests to the actual `Application` and `createHttp`. It does not copy screens or implement an alternative API. Each browser receives a separately seeded temporary SQLite database and independent native users, passwords, authentication sessions and random encryption keys. All role-authorized pages and native operations remain the original code. The seed is fictional, and this runtime does not verify product gates or deployment readiness.

## Run locally

Use the repository's Node 24.16.x runtime and installed dependencies:

```sh
npm run build
npm run demo:native
```

Open `http://127.0.0.1:3200/demo`. Supply a fictional company name and choose CA/CAD or US/USD, choose a payment scenario, then enter as one of the sample roles. The `/demo` controls also show private generated credentials for the ordinary native sign-in form, switch roles through native login, and erase the current workspace. Password changes and MFA enrollment are real native operations in the isolated demo; if a changed credential or enrolled factor prevents the sample role switch, use native sign-in or reset the demo.

The native interface has its own unchanged authorization rules. An administrator can inspect all pages; buyer and staff roles demonstrate actual scoped restrictions. Independent finance reviewer credentials support review duties. Switching roles clears demo-origin Distributor browser drafts and logs out the previous native session. Reset permanently discards this demo's fictional records; it does not operate on any existing application database.

Region selection affects business configuration and currency. It does not select infrastructure or establish physical data residency. No real customer, payment, credential or operational data should be entered into this fictional workspace.

## Isolation and lifecycle

- A cryptographically random, HttpOnly, SameSite=Strict selector chooses an in-memory instance. Native `distributor_session` authentication is then independently checked inside that instance. Native credentials and session cookies from one instance cannot authenticate in another.
- A signed, short-lived bootstrap cookie plus same-origin CSRF protects onboarding. Reset and role selection require the existing instance's separate CSRF token and exact configured Origin. Native writes retain the original Origin, CSRF, role, revision and idempotency checks.
- Temporary databases are created in owner-private operating-system temporary directories, outside the source checkout. Normal reset, expiry and graceful shutdown close the native server/database and remove the directory. An abrupt process or host termination can leave a temporary directory requiring operator cleanup; no cross-restart workspace recovery is provided.
- Defaults are eight simultaneous instances, thirty minutes idle expiry, four hours absolute lifetime, six hundred requests per IP per minute, five creation attempts per IP per minute and at most one thousand tracked IP buckets. Active requests retain leases so expiry/reset cannot close their database during an operation; their slot is retained until cleanup completes. Expiry immediately prevents new access even while an earlier request finishes.
- Request bodies pass as raw buffers into native Fastify injection. Response status, Set-Cookie, download metadata and raw bytes are preserved. The gateway enforces `Cache-Control: no-store` and `Referrer-Policy: no-referrer` after forwarding so inner headers cannot weaken workspace privacy. The outer size limit accommodates native five-MiB evidence uploads; native route-specific size limits still apply.
- The selector and native session are bearer cookies. Protecting the browser and HTTPS connection remains essential: possessing an entire visitor's cookie set is not a separate identity boundary. Credentials appear only in that visitor's no-store control response. Request logging is disabled.

## External operations and hosting limits

The runtime does not import environment-configured providers, carriers, OAuth/browser adapters, restore host wiring or an existing `DATABASE_PATH`. No real external transport is enabled. The demo injects a per-workspace fictional Stripe processor into the existing `ProviderRuntime`; a serialized one-second worker runs native queued effects and durable callback settlement. The selected workspace scenario simulates a paid, unpaid or expired checkout. Paid scenarios settle the balance without a checkout URL or card entry; pending-refund and failed-refund scenarios begin with a paid checkout. Native credit/refund requests can refund these fictional payments. The SDK is used only for offline webhook signing and verification; the native signature, identity, amount, grant, residency and duplicate checks remain active. Failed callback delivery is retried. Worker shutdown completes before database disposal.

Maple Workshop starts with explicitly fictional Stripe and QuickBooks disclosures and recorded customer exceptions, which can be withdrawn using the native residency controls. This is demonstration data, not vendor qualification or permission for real processing. The other customer starts without that exception. Demo processor results and signing secrets belong to one temporary workspace and disappear on reset or process exit. Revoking the demo administrator's finance authority stops its worker.

Live carrier transports remain disabled. Per-workspace offline adapters now simulate UPS, FedEx, USPS, Purolator and DHL booking through the native carrier runtime, with a clearly named DEMO_GROUND service and PDF labels marked SIMULATED / NOT VALID FOR SHIPPING. Canada Post uses a per-warehouse offline client for native grouped creation and manifest confirmation; its manifest PDF is also marked simulated. Labels do not ship stock or invoice: the warehouse must complete native handover. Native country, customs, permissions, customer residency choices and review checks still apply. Maple Workshop has fictional carrier permissions; Lakeside remains strict. These generic simulations do not qualify provider-specific API behavior, service availability, rates, customs acceptance or real tracking.

QuickBooks invoice, payment, credit, credit application, refund expense and refund application operations now use an isolated fictional accounting ledger through the native provider worker. Native invoice balance reads reflect those simulated postings. Use fictional mapping IDs such as demo-customer, demo-item, demo-tax and demo-bank; no Intuit connection is required. Native permissions, customer consent and accounting preparation checks still apply. Accounting synchronization does not create native cash receipts. OAuth/company authorization, cost/stock journal transport, email delivery and protected operator procedures are not simulated by this adapter.

Onboarding offers successful payment/refund, unpaid checkout, expired checkout, pending refund and failed refund scenarios. The choice applies to the workspace; reset to choose another. Pending refunds remain pending when refreshed, and unpaid checkouts can be closed through native controls. There is no hosted card-entry form or interactive card-decline response. Seeded manual payments are not fictional Stripe transactions; use a newly simulated checkout to exercise Stripe refunds. These are bounded demonstrations, not provider protocol qualification. Actual external delivery, real money movement and qualified restore hosting remain unverified.

`DEMO_HOST`, `DEMO_PORT`, `DEMO_ORIGIN` and `DEMO_SECURE_COOKIES` are the only launcher configuration inputs. The default binds to loopback. Non-loopback binding and nonlocal public origins require an HTTPS origin and secure cookies. This validation prepares a configuration boundary; it is not deployment authorization or a production hosting design. Remote hosting still needs explicit approval and qualification for TLS, ingress, abuse protection, process isolation, resource/storage limits, egress controls and cleanup. Proxy headers are not trusted; behind a proxy all visitors may share a rate bucket until a separately reviewed configuration exists. No deployment, provider account, secret configuration, CI runner, workflow or PR is created.

## Focused verification

Latest accounting/payment-scenario increment: [source-bound receipt](evidence/LOCAL-DEMO-PROVIDERS-2026-10-05.md). The combined provider/gateway checks passed 28/28, with a browser journey through scenario selection and all 15 pages.

Earlier carrier increment: [source-bound receipt](evidence/LOCAL-DEMO-CARRIERS-2026-10-05.md). Offline booking, private PDF labels, grouped manifests, handover/invoicing and native permission/isolation checks have focused local coverage.

Earlier payment/privacy pass: [source-bound receipt](evidence/LOCAL-DEMO-PAYMENTS-2026-10-05.md). Five payment simulation checks and seven gateway checks passed across focused runs; these include actual demo HTTP-to-worker settlement, native refunds, withdrawal/revocation, retry/idempotency and forced gateway privacy headers. No full acceptance or browser rerun is implied.

`npx tsx --test tests/native-demo-gateway.test.ts` exercises actual two-visitor native authentication and data isolation, native product creation, CSV download, invoice PDF hash verification and a 300-KiB warranty evidence upload/download, credential/session replay refusal, Origin/CSRF/reset negatives, byte-preserving forwarding and all Set-Cookie headers, a request larger than the ordinary API limit, expiry/reset leases, absolute lifetime, instance capacity, creation/request rate limits and remote HTTP refusal. Proxy-specific byte tests use an explicit synthetic inner handler and do not claim provider or document qualification. Full native screen journeys and provider behaviors require their own evidence.


Browser check: `npx playwright test --config tests/native-demo-browser.config.ts` passed onboarding, all 15 native pages, seeded incoming allocation visibility, independent-browser isolation, buyer page restrictions, role switching and reset with no page errors. These checks and the six native gateway checks passed on 2026-10-05; they are focused coverage, not verification of all command outcomes. An initial browser locator typo and a real demo-notice CSS collision were corrected before the passing run. Build and TypeScript checks passed; Vite still reports the existing large main-bundle warning.

The source inventory is reproducible with `npx tsx scripts/demo-parity-inventory.ts`. [Coverage register](DEMO-FUNCTIONALITY-MATRIX.md) lists all 133 commands and 313 method/path pairs and separates source representation from live-provider/operational qualification.

Default port 3200 avoids the workstation's existing unrelated listener on 3100. From any shell, the full launcher command is:

```sh
cd /Users/stevensmith/Documents/Distributor
npm run build
npm run demo:native
```
