# Distributor UI/UX review — 2026-10-04

The previous interface made everyday work hard to distinguish from configuration: a flat navigation list, repetitive panels, tall filters and a dashboard of counters with little context. This pass gives the application a clearer operational structure and a consistent visual hierarchy.

The subsequent [UI/UX book research](UI-UX-BOOK-RESEARCH-2026-10-04.md) maps seven complementary design books to source-grounded recommendations, with priorities, data dependencies and completion criteria. It is a research backlog, not another implemented design pass.

## Findings and changes

| Category | Priority | Finding | Implemented improvement |
| --- | --- | --- | --- |
| Navigation | High | Everyday and administrative destinations had equal prominence in a flat list. | Grouped navigation: Workspace; Sales & customers; Stock & fulfillment; Finance; System & controls. Existing permission filtering is retained. |
| Page organization | High | Long screens require considerable scrolling to reach related work. Billing began with integration setup. | Actual section sub-tabs on Orders, Inventory, Purchasing and Billing show one panel at a time. Inactive panels retain form state; keyboard controls switch and focus the selected tab. |
| Dashboard accuracy | High | Open returns counted a loaded page of claims as though it were a complete total. | Removed that misleading counter. Order bars and the invoice donut use complete, access-scoped server aggregates. Recent orders explicitly identify the limited set displayed. |
| Visual hierarchy | Medium | Similar panels and broad controls made pages difficult to scan. | Navy navigation, restrained blue actions and amber accents, original SVG icons, clearer type hierarchy, compact queue filters and consistent tables. |
| Graphics and guidance | Medium | The dashboard offered little context or direction, especially with no records. | Linked workflow steps, actionable metric cards, order activity bars, invoice balance distribution, original parcel illustration and an order-entry empty state. Zero records remain visibly zero. |
| Responsive navigation | Medium | A dense navigation list and filters were poorly suited to phone widths. | Expandable mobile menu, responsive page and section tab rows, stacked filters and responsive dashboard cards/charts. |
| Focus behavior | Medium | Billing's initial provider metadata read moved focus to the revocation panel. | Initial metadata loading preserves focus; explicit operator actions retain their existing focus restoration. |

Charts include numeric text and accessible names; decorative icons are hidden from assistive technology. Charts do not invent sales trends or use paginated records as totals. CAD/USD formatting is explicit on the dashboard. No new asset or chart dependencies were introduced.

## Verification and limits

### Scope classification at checkpoint

- **Baseline usability/correctness support:** preserve role and data-access boundaries; prevent paginated records being presented as complete totals; retain numeric chart alternatives and keyboard access; repair Billing's initial focus jump; keep existing operations usable on narrow screens. These changes support existing requirements but do not independently verify a task or acceptance gate. Removing the inaccurate Open returns counter does **not** implement complete access-scoped Open returns totals; that remains an identified accuracy follow-up.
- **Completed owner-requested design additions:** navigation categories, visual styling, original icons/parcel graphic, workflow links, dashboard charts and page/section tabs. Preserve this reversible local work. Its implementation does not expand or close the frozen 44-task acceptance baseline.
- **Deferred new enhancements:** saved filters and dated historical trend aggregates. Neither is implemented or delegated. Tracked in [Distributor issue #1](https://github.com/SJS1001/Distributor/issues/1), independently verified OPEN with author `sjsmithbot` on 2026-10-04. The issue requires delivery-impact review and explicit baseline-change authorization before implementation. Do not duplicate or dispatch this deferred work.
- **Completion impact:** this pass improves presentation and selected interactions; all 44 tasks and ten acceptance gates remain NOT VERIFIED. The remaining recommendations below are a review backlog, not an instruction to extend implementation automatically. Infrastructure/provider/business qualification remains separate.

Distributor's repository-specific GitHub-hosted runner exception remains in force. Current execution restrictions still prohibit starting CI or adding workflows; no policy change is made by this checkpoint.

Reviewed against baseline `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703` plus this working-tree UI change. Direct workstation TypeScript checking, production build and four focused component checks cover aggregate totals versus paginated records, honest zero states, role-specific dashboard controls and permission-filtered navigation. No broad business-flow qualification is implied.

Manual checks use the existing synthetic CA/CAD demo at `http://127.0.0.1:3000`: desktop overview and billing; 390 × 844 mobile navigation; Inventory warehouse filtering (Ottawa zero, Toronto three); section shortcut keyboard focus; opening/cancelling Prepare order; and Refresh. Private screenshots remain under ignored `local-evidence/demo-preview-2026-10-04-ff7a733a/`. Exact changed-source hashes and outcomes are retained in that directory's UI review receipt.

The build retains its existing large JavaScript chunk warning. This is a focused design and interaction pass, not a complete accessibility certification, screen-reader audit or production usability study. Product gates remain unchanged. No CI runners, provider transactions, deployment, PR or merge was used.

## Recommended next improvements

| Category | Recommendation | Reason |
| --- | --- | --- |
| Dense work screens | Consider focused subpages for the remaining long accounting and administration workflows. Inventory row actions and three accounting groups now expand on demand. | The deeper workflows still contain more controls than most daily tasks require. |
| Data exploration | Add saved filters and explicitly scoped, dated server aggregates for trends. | Operators need repeatable views; historical charts require reliable time-series data. |
| Product language | Review technical provider/recovery copy. Refresh now confirms “Workspace refreshed.” | Several deeper screens still expose implementation terminology. |
| Accessibility | Conduct keyboard and screen-reader journeys with representative warehouse, finance and buyer users. | Component checks and a phone layout check cannot establish end-to-end accessibility. |
| Performance | Further Inventory/Billing splitting is deferred under [issue #3](https://github.com/SJS1001/Distributor/issues/3), pending agreed scope and measured targets. Operations health, Audit history, Event reporting and Reconciliation already load on demand locally. | The initial JavaScript download is smaller, but the main chunk still exceeds the build warning threshold. |

Preserve the independent source-of-truth operations and authorization boundaries while improving these screens. Provider setup, real infrastructure and business qualification remain separate work.

## Three follow-up design iterations

The owner requested another two or three passes. Three additional iterations are implemented locally over the same baseline:

1. **Dashboard hierarchy:** condensed the introduction and four totals into a segmented band; moved Recent orders above the charts; replaced the numbered workflow strip with a compact Quick access panel. Existing charts and the original parcel illustration remain. Totals still use access-scoped aggregates and zero states remain honest.
2. **Dense screens:** labeled Book, Reserved and Available quantities separately; added text-backed condition badges; put Inventory row actions inside keyboard-operable disclosures. Grouped accounting controls into QuickBooks connections, Inventory costs and Stock journals disclosures, retaining their existing handlers and permission guards.
3. **Interaction and mobile polish:** removed inactive completed-pagination buttons in the stock, order, invoice and purchase queues and added “All results shown” status text. Preserved pagination focus restoration. Made shared table scroll regions keyboard reachable, refined mobile spacing and corrected Refresh feedback.

After the final source edits, direct workstation TypeScript checking and the production build passed, as did all four focused workspace-overview component checks. The existing large-bundle warning remains. Manual verification used the synthetic CA/CAD demo: desktop Overview, Inventory and Billing; keyboard expansion of stock actions and QuickBooks groups; movement-history close returning focus to its trigger; Ottawa/Toronto stock filtering showing zero/three records; and Refresh displaying “Workspace refreshed.” At 390 × 844, Overview, Inventory and Billing had a document width of 390 pixels. The Inventory table remained independently scrollable and ArrowRight scrolled its focused region. Provider connections remained disabled. The temporary viewport override was reset and the desktop Overview left open.

Current source hashes, outcomes and desktop/mobile screenshots are retained in ignored `local-evidence/demo-preview-2026-10-04-ff7a733a/ui-iteration-receipt.json` and its adjacent images. Earlier evidence is preserved. These are targeted design and interaction checks, not a broad regression run or accessibility certification. All 44 tasks and ten product gates remain NOT VERIFIED. Deferred issue #1, infrastructure qualification and provider work remain unchanged. The edits are local and uncommitted; no CI, PR, merge or deployment was used.

## Open claims total — contract inspection

The complete total remains unimplemented. The approved queue contract in `docs/CONTRACTS.md` supplies at most 20 currently accessible claims and a continuation. `Application.dashboard` returns those records and `claimNext`; it has no complete claim aggregate. The shared queue type defines state and cursor filters only. Warranty has a legacy unpaged `list(actor)`, but this projects claim histories and is not a dashboard aggregate contract.

The previous “Open returns” card counted both warranty and return claims, excluding only `rejected` and `disposed`, within the loaded first page. Both the completeness and the label were therefore misleading. Removing that card preserves honest presentation but does not supply the missing metric.

**Smallest unblocker:** the owner/product lead and backend contract owner confirm a metric and additive read contract. Recommended proposal: label **Open claims**, count both claim types with states other than `rejected` and `disposed`, and apply fresh organization, account and warehouse/current-custody authority. Warranty would own a read-only `claimSummary(actor)` returning an open count, exposed through an additive dashboard field and shared type. This is a proposal, not an approved or implemented contract. If the intended metric is return-only, explicitly select that type and retain the “Open returns” label instead.

After the definition is accepted, bounded implementation should verify more than 20 claims, both claim types, terminal states, zero results, and current role/account/site/organization/revocation boundaries. Do not count pages in the browser or load every projected claim history to calculate a total. No source or API change was made during this inspection. Saved filters and dated historical trends remain deferred in issue #1.

## Category navigation follow-up

Owner-requested category destinations now replace individual sidebar pages. Each category opens a consistent row of page tabs: Sales & customers contains Orders, Customers and Catalog; Stock & fulfillment contains Inventory, Purchasing and Returns; Finance contains Billing and Reconciliation; System & controls contains its six existing pages. Workspace contains Overview. Categories and tabs retain permission filtering. Returning to a category restores its last selected accessible page during the current workspace session; reload starts a fresh session. Existing navigation cancellation and stale-read safeguards are preserved.

Tabs expose navigation semantics and the current page. Arrow keys and Home/End move focus; Enter/Space activate the focused destination. The longer tab row scrolls independently on narrow screens. Direct workstation TypeScript checking, production build, five focused component checks, scoped formatting and whitespace checks passed. The initial strict-TypeScript array-access errors were fixed before the final successful checks. The existing large-bundle warning remains.

Manual checks in the synthetic CA/CAD demo verified category switching, remembered Customers selection after visiting Finance, keyboard focus/activation and the six-page System row at 390 × 844: document width 390, tab width 354 and scroll width 839. End focused Security and scrolled the tab strip without navigating. The viewport override was reset and Sales/Orders left open. Exact current source hashes, outcomes and screenshot are retained privately in `local-evidence/demo-preview-2026-10-04-ff7a733a/ui-category-tabs-receipt.json`. Earlier receipts remain historical. No business-flow qualification, CI, PR, merge, deployment or provider transaction occurred; product gate status is unchanged.

## Owner follow-up: section sub-tabs

The owner requested replacing the “On this page” shortcuts with actual tabs. Orders, Inventory, Purchasing and Billing now display a secondary tab row below their category page navigation. Only the selected panel is visible; inactive panels remain mounted to preserve local form and filter state. Role/data guards still determine available sections. Arrow keys, Home and End activate and focus tabs; panels have linked accessible labels. Transfer arrival/loss/recovery editors move with Transfers so their actions stay visible. Billing groups credits, documents, payments and refunds with Invoices, and billing profiles with Account aging.

Local verification: TypeScript and production build pass, six focused rendering checks pass, and whitespace is clean. Browser inspection covered all 13 section tabs, keyboard switching, retained order-state filter and a 390px viewport with no page overflow and 44px tab targets. The demo remains open on Inventory. Private receipt: `local-evidence/demo-preview-2026-10-04-ff7a733a/ui-section-tabs-receipt.json`. Existing build size warning remains. No business transactions were submitted and no broad role/workflow acceptance is claimed. This owner-requested local presentation change does not verify any of the 44 tasks or ten product gates.


### Replacement shortcut correction

The Canada Post warehouse-group shortcut from a replacement now opens the Shipments sub-tab in Orders. A focused actual-browser regression reproduced the hidden target before the fix and passed afterward with the selected warehouse and keyboard focus visible. Seven component checks, TypeScript and build pass; the existing bundle warning remains. Exact private evidence: `local-evidence/workspace-shortcut-receipt.json`. Earlier full browser journeys need category/section navigation updates before their historical results apply to this UI. No product acceptance, publication or provider qualification is implied.

### Inventory recovery while queues are unavailable

Corrected role-filtered Inventory sub-tabs so Transfers and Cycle counts remain reachable before supplemental reads complete or after they fail. Retained recovery no longer depends on loading the queue. Added unavailable-queue copy without implying an empty result. A synthetic browser regression verifies delayed-load review/focus continuity, corrupt-count warning visibility, failed-load access and exact transfer retry without duplicate stock. Together with the existing replacement shortcut check: 2/2 focused browser checks pass; typecheck/build/formatting pass. Existing bundle warning remains. Broader browser navigation migration is still outstanding; no product gate or production qualification is inferred. Private receipt: `local-evidence/inventory-subtabs-receipt.json`.

### Transfer workflow navigation checks

Migrated the existing arrival, dispatch, loss and found-stock recovery journeys through actual category/page/sub-tabs and the Stock action disclosure. All 32 synthetic Chromium checks pass in 46.2 seconds, including delayed queue loading, retained review/focus, account and authority changes, interrupted responses, cross-tab coordination and exact stock recovery. Complete TypeScript, scoped formatting and whitespace checks pass. Private receipt: `local-evidence/transfer-navigation-receipt.json`. No application source changed in this migration; remaining browser journeys still need navigation updates. Issue [#2](https://github.com/SJS1001/Distributor/issues/2) is verified OPEN for this navigation checkpoint; broader acceptance and release remain separate from the preserved local implementation.

### Inventory queue and history checks

Thirteen additional existing browser checks now pass through category/page/sub-tabs: four transfer paging/access checks, seven stock/count/replacement checks and two stock-history checks. Coverage retains phone layouts, original-cost paging, exact retries, restricted warehouse scope, superseded/abandoned responses, stock conservation and focus restoration into the expanded action menu. TypeScript, scoped formatting and whitespace pass. No application code changed in this migration. Exact private receipt: `local-evidence/inventory-navigation-receipt.json`; wider browser migration and product acceptance remain outstanding.

### Purchasing workflow checks

Twenty-one existing synthetic browser checks pass through the new Purchasing sub-tabs, covering multi-line purchase entry, saved receipt drafts, receipt history, supplier availability and supplier returns. Tests explicitly switch panels before interacting or asserting absence, retaining interrupted-response recovery, warehouse/finance scope, exact paging and native cost/stock assertions. Complete TypeScript, seven-file formatting and whitespace pass. No application source changed in this migration. Private receipt: `local-evidence/purchasing-navigation-receipt.json`. Wider navigation migration and product acceptance remain outstanding.

### Billing and provider navigation checks

Forty-seven additional existing synthetic browser checks pass with explicit Billing sub-tabs and accounting disclosures:31 invoice/PDF/cost-correction scenarios and16 QuickBooks connection/revocation scenarios. Includes US/Canada permission choices, current-authority changes, lost replies, exact retries, retained reviews and focus restoration. The delayed background billing-profile load is checked for DOM presence while the Accounting review stays visibly open. Complete TypeScript, eleven-file formatting and whitespace pass. No application code changed. Private receipt: `local-evidence/billing-navigation-receipt.json`; broader journey migration and actual product qualification remain incomplete.

### Journal and correction workflow checks

Migrated nine existing browser suites through the visible Accounting sub-tab and its Stock journals or Inventory costs disclosure. All 66 synthetic Chromium checks pass, covering separate approval, permission withdrawal, cancellations, successors, interrupted replies, exact retained recovery and reconciliation across US/Canada cases. Existing financial, authority and visibility assertions remain unchanged. TypeScript, eleven-file formatting and whitespace pass. Application source did not change. Exact private receipt: `local-evidence/journal-navigation-receipt.json`. Remaining Inventory/carrier/shared journeys and full product acceptance remain incomplete.


### Inventory details workflow checks

Six existing suites now use explicit Inventory sub-tabs and the visible Stock action menu: serial history/dossier, bin moves, count policy/recovery, valuation and native quantity correction. Initial49 checks yielded46 passes and3 outdated bin display assertions; after updating those assertions, all6 bin checks passed in14.3s. The other43 checks were unchanged and passed initially. Exact quantity, value, source, role/independent approval, retry, focus and abandoned-response coverage is preserved. TypeScript, nine-file formatting and whitespace pass. No application source changed. Private receipt: `local-evidence/inventory-details-navigation-receipt.json`; initial failures/traces retained. Carrier and shared workflow migration and broader product qualification remain outstanding.

### Final shared navigation checks

Fourteen additional distinct synthetic workflows pass: security/MFA, provider consent/history, phone order history, catalog entry and cart recovery, off-page removal, and sold-serial claim selection/cancellation. The sold-serial check initially targeted a closed mobile sidebar; the corrected test opens Menu before category navigation. Business and request-cancellation assertions remain intact. Complete TypeScript, changed-file formatting and whitespace pass. Application source/build remain unchanged. Exact private receipt: `local-evidence/shared-final-navigation-receipt.json`; initial failure retained. The identified shared navigation migration is complete; no fresh full-suite or product-gate acceptance is claimed.

### Secondary pages load on demand

Operations health, Audit history, Event reporting and Reconciliation now download only when opened under their existing role guards. A loading status preserves navigation; a failed download offers explicit Reload workspace because browsers retain failed module imports. Main production JavaScript falls from 834.21 KB to 818.96 KB (gzip 212.26 to 209.33 KB). This is a measured bundle reduction, not a measured latency improvement; the large main-chunk warning remains.

Seven production Chromium checks pass, including an aborted chunk, explicit reload, absence of secondary chunks at login/Overview, all four destinations, existing navigation/recovery, audit/event retry and cancellation, and phone operations/reconciliation. TypeScript, build, scoped formatting and whitespace pass. Exact private evidence: `local-evidence/deferred-pages-receipt.json`; initial failures retained. Product qualification and larger Inventory/Billing splitting remain open.
