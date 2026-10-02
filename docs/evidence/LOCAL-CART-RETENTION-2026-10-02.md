# Local durable cart save recovery receipt — 2026-10-02

Parent: `ad1ab16803508acba4953bc184792c0614156637`. The [machine companion](LOCAL-CART-RETENTION-2026-10-02.json) binds tested input hashes, delivered browser assets, commands and private logs. Environment: macOS arm64, Node 24.16.0, native SQLite and local synthetic Chromium fixtures. Direct workstation verification only; no CI runner, delegated/cloud session, provider request, workflow, PR, merge or deployment.

## Engineering added

Partial D-008/D-018/D-019/D-020 coverage: the quantity editor persists the exact submitted cart body, request key and named review descriptors before transport. One pending attempt is retained per organization/principal in a browser profile. Web Locks serialize cooperating tabs. The Orders recovery control survives reload and sign-out, displays a fixed readonly review and sends only that original attempt. Recovery does not quote or accept an order and cannot replace the retained attempt with changed quantities. Native current authority and revision checks remain decisive; server/schema/dependencies are unchanged.

Six new browser journeys exercise an actually committed lost reply followed by reload, account separation, another native writer and same-account recovery; malformed/unwritable storage and missing browser coordination with zero transport; two competing tabs refusing transport while the original lock is held; an actually committed reply with an invalid revision; replacement of retained evidence while an old review stays fixed, refusing before transport; and failed storage cleanup followed by exact recovery of the committed receipt. The historical receipt replay leaves a newer native cart at its newer revision and quantities, with zero quote/accept commands or orders. Review cancellation changes no native cart.

Review found that live storage updates initially could change an open recovery review. The component now holds the originally reviewed snapshot separately from current retained evidence and rechecks its exact key/body under the lock. The added changed-evidence journey verifies the correction. This was found during review, not a failed browser run. Initial passing checks remain separately retained; earlier receipts and failures remain unchanged.

The main editor also checks its current editor generation before starting a quote and before opening a returned quote. This is a code-reviewed cancellation boundary, not proof that submitted mutations are cancelled. Browser evidence grants no access or rollback capability.

## Actual verification

| Command | Outcome |
| --- | --- |
| `npm test` | Exit 0; 1,976 passed; zero failed/cancelled/skipped; 82,852.861791 ms. |
| `npm run typecheck` | Exit 0 on final source. |
| `npm run build` | Exit 0; existing bundle-size warning remains. |
| `npx playwright test --grep 'browser:.*(cart\|catalog\|order quantities\|customer prices)'` | Exit 0; 23 passed in 43.4 seconds. The ordinary alternation regex is recorded in the companion. |
| `npx playwright test --grep 'browser: individual unavailable item reviews'` | Exit 0; one passed in 8.0 seconds. |
| `npm run format:check` | Exit 0 on final source. |
| Changed-source React Doctor | Exit 0; five changed files scanned, zero errors, one existing App complexity warning. No clean full-project scan is claimed. |

The two final browser invocations cover 24 unique checks, including all 16 cart recovery/removal journeys, six new durable recovery journeys, catalog/customer-price paging and the existing multi-line lost-acceptance fulfillment/residency/paid-return journey. No full browser suite or isolated production-only runtime qualification is claimed. Structural document, whitespace and publication checks are recorded in the companion; structure does not pass a product gate.

## Review and limits

Self-review checks persist-before-transport, account-scoped storage, exact payload/key retention, fixed readonly recovery, same-browser lock coordination, changed evidence refusal, validated replies, definitive pre-effect validation/revision refusal versus unresolved outcomes, cleanup failure and abandoned editor follow-up. Current server authority precedes cached results; original native transaction/stock/money behavior is unchanged. Synthetic fixture additions grant no production authority.

Local storage retains customer/warehouse/product descriptors and quantities in plaintext after sign-out for the original identity. Shared-device protection/retention, cleared storage reconciliation, managed workstation residency, independent devices, non-Chromium compatibility, actual providers/devices, production security/load/recovery and human operator acceptance remain unqualified. Quote reviews and unsaved edits do not gain durable recovery in this checkpoint. An original receipt does not establish the current cart or prices. The owner-authorized original source/tests/docs snapshot excludes private stores, credentials, raw logs and generated artifacts; no third-party code or dependency is added. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system remains incomplete.
