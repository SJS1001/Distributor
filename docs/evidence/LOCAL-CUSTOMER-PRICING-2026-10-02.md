# Local customer pricing engineering receipt

Date: 2026-10-02. Candidate based on local parent `8513777`; exact parent, final input manifest and command/log hashes are in the [machine receipt](LOCAL-CUSTOMER-PRICING-2026-10-02.json). Direct macOS arm64 workstation checks use synthetic SQLite facts, loopback HTTP and production-build Chromium. All 44 tasks and 10 product gates remain **NOT VERIFIED**.

## Behavior checked

Buyer dashboard products resolve the current assigned customer's tier prices instead of always returning base prices. Staff quantity editing fetches prices for the selected customer independently of the staff dashboard. The catalog returns an explicit public projection, preserves zero overrides and base fallback, calculates exact unit tax, refuses mixed currency and rechecks current persisted authority before even empty results. See [the ordering procedure](../CUSTOMER-PRICING.md).

Ten new backend cases cover CA/US customer prices, account isolation, exact public fields, inactive/foreign products, unrelated staff roles, missing/inactive/foreign principals, forced password changes, independent application price/grant changes, reassignment and restart, zero overrides, fallback tax rounding, quote drift, immutable accepted money and strict session/no-store HTTP behavior. Synthetic base price 10,000 cents and standard tier 8,199 cents produce 1,066 cents unit tax at 1,300 basis points. Two quoted units total 18,530 cents and retain that accepted amount after a price change to 9,100 cents and restart. A 150-cent fallback produces 20 cents tax; a zero tier override remains zero. These fixture rates are not qualified tax rules.

Two phone-width Chromium journeys use separate buyer, partner and administrator sessions to exercise private account prices, selected-account staff prices, saved cart reload, new quote prices after native price drift, acceptance, failed preparation with exact-selection retry and discarded preparation responses after navigation. Navigation during a pending modal read is dispatched programmatically; this does not claim background pointer clicks are available through the modal. The complete existing browser suite also runs.

## Results and version limits

| Check | Observed result |
| --- | --- |
| Complete backend suite | 1,884 passed, zero failures; includes ten new pricing cases |
| Earlier focused pricing/catalog-authority cases | 16 passed, zero failures; precedes the final independent-application staff-role test |
| Complete production-build Chromium suite | 88 passed, zero failures; includes two new journeys |
| Earlier selected Chromium suite | 3 passed, including the existing multi-line ordering journey |
| Type and formatting checks | Exit 0 |
| Production-only isolated runtime installation | PASS; CA/US startup twice, PDF/ZPL generation and encrypted backup/restore |
| Changed React Doctor scan against parent | Exit 0; one existing App complexity warning |
| Full React Doctor scan | Exit 1; 212 findings, 41 errors and 171 warnings; broader findings remain open |

All 380 captured source/test/script/configuration inputs match the final tested bytes. Runtime verification identifies 217 copied inputs, 69 absent development-only packages and 27 child commands. A reduced comparison replaces only `application.ts` with the unchanged parent's source while retaining candidate dependencies; the minimal buyer dashboard case fails with 10,000 instead of 8,199 cents. This reproduces the dashboard symptom, not ten distinct prior defects or a full prior-release test.

Initial fixture accessor/type mistakes, missing test Origin, unassigned dashboard assumptions, authorization-denial audit assumptions and browser currency-label mismatches were corrected without weakening native commands. Their original failures, browser traces, superseded successes and full/changed React diagnostics remain private under `/tmp/distributor-customer-pricing-checkpoint`. The buyer dashboard still fails closed for missing assignment in its existing sold-unit reader. Denied HTTP reads append an authorization audit; the business-fact conservation test explicitly excludes that expected audit and checks it separately.

Historical receipts and third-party notices are preserved. Private temporary files can be removed by machine cleanup; hashes identify observed evidence, not durable product acceptance. Structure/whitespace and committed-byte audit results are recorded in the machine receipt and handoff.

## Review and outstanding work

Self-review checked fresh identity/password/role/customer authority before reads, organization predicates on catalog-owned joins, exact price/tax fields and rounding, zero/fallback behavior, account changes across independent applications/restart, no business mutations on denied reads, native quote/acceptance authority, saved quantities, exact retries and canceled-response fencing. No schema, dependency, license or workflow change.

Catalog/cart collections, SQL cost, immediate-transaction contention, full catalog editing at scale and inactive saved-cart lines remain unqualified. Pricing, cart and dashboard reads are separate and can become stale; preparation cancellation does not cancel submitted order mutations. Internal catalog readers retain their existing business responsibilities. Staff visibility policy, broader React findings and actual country tax/provider/device/production/residency/operator acceptance remain open.

This is partial D-008/D-018/D-019/D-020 and REQ-03/REQ-12/REQ-13 engineering. It does not verify complete task acceptance or G3/CH-07. Work is local only: no CI runner, cloud session, delegation, provider/device request, push, PR, deployment or publication was started.
