# Canadian Gree sample pilot — 2026-10-05

The owner explicitly selected **Seed the current pilot**. Fictional records now live in the real Canadian pilot database at https://dstrbtr.ca/, not an isolated demo. These records affect its stock, orders, accounts and reports. Do not use their totals as real business balances or reset the database after real activity begins.

## Contents

- Eleven sample products: eight Gree equipment entries and three generic HVAC accessories. Family names were checked against the [Gree Canada catalog](https://greehvac.ca/shop/); sample SKUs are not manufacturer part numbers or engineered equipment matches.
- Two sample warehouses, three fictional contractors and one fictional supplier.
- Twelve purchase orders, including an incoming 12-unit delivery with two units received into quarantine. Six units were committed to a customer backorder before partial receipt.
- Four sales orders, including a completed collection, invoice and fictional manual payment, plus open orders and a backorder.
- CAD sample prices, a 10% contractor tier discount and a 13% example tax setting. All prices, stock, serials, credit limits and payments are fictional. They are not approved commercial terms or manufacturer pricing.

The seed uses native commands in `src/demo/gree-pilot-seed.ts`. It refuses a store containing catalog, customer or warehouse records. Each command commits separately: run only on an offline candidate, validate, then activate it with the application writer stopped. It is not a reset operation or a general live-store importer.

## Access and gaps

Distributor staff and customers use the same `/#sign-in` page; the authenticated role determines the workspace. The sample buyer belongs only to Maple Leaf Heating. Credentials are retained in the ignored, protected local file `private-data/fly-ca/sample-customer-access.txt`; a password change is mandatory at first login. No credentials belong in this document or Git.

Buyers can browse their tier-priced catalog and place orders for their own customer account. **Per-customer product purchasing approval is not implemented.** Current account approval and tier pricing do not limit which active products an approved buyer can buy. An explicit entitlement policy must be enforced by the backend at browsing, cart, quote and order acceptance before claiming that restriction.

Scanning is implemented in the existing web application, not a separate native scanner app. `src/web/scan-input.tsx` provides keyboard-scanner input, browser-supported camera barcode scanning, confirmation and manual fallback. Receipt, picking and other serial/bin forms use it through the shared modal. Actual device/browser qualification remains outstanding.

## Version and verification

The unchanged deployed image digest is `sha256:deb84b82401f50a064f1b44c6ba478d18371cc7f4f07e3f0b95c747ed997edb9`, from the Canadian launch source checkpoint `46f4b62`. This increment changes data and adds the seed source/test; it does not change the deployed UI, API or schema (24).

Before activation, the application writer was stopped, an encrypted backup was created and the original store was cloned. Candidate integrity and foreign-key checks passed. All 19 preexisting non-counter rows were preserved; the audit and inventory cost sequence counters advanced and matched their ledgers. The original database and sidecars remain in the protected volume rollback directory. The encrypted pre-seed backup is also retained locally with its key stored separately. Never restore it over subsequent real activity without a reviewed recovery plan.

The focused local integration test passed (1/1): stock, incoming quarantine, buyer account isolation, tier pricing, buyer cart/quote/order acceptance after password change, and reseed refusal. TypeScript checking passed. Live HTTPS checks confirmed the homepage, CA health, distributor access to all 11 products, the buyer's required password change, unauthenticated refusal and logout invalidation. The live check did not place extra orders or change the buyer password.

Historical verification failures are retained in ignored local evidence: an initial test used the wrong stock-state field; strict candidate comparison initially rejected the two legitimate sequence counter changes. A full comparison then established that only those counters changed among preexisting rows, with ledger validation added. A scanner browser replay was blocked before running tests by an occupied auxiliary port 3200; no fresh scanner browser pass or physical-device qualification is claimed. No product gate, full-suite acceptance or live provider qualification follows from this seed.
