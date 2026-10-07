# Portal journey review — 2026-10-07

The owner requested an assessment of the public sign-up website, customer portal and administration portal: visible tasks, intuitive workflow, correctly placed controls, alignment and actual end-to-end behavior. This review extends the earlier [74-finding review](ui-ux-fixes-2026-10-07.md) and the verified [catalog release](../evidence/CATALOG-IMAGES-2026-10-07.md). It does not substitute feature presence or a historical test for current acceptance.

## Assessment criteria

The assessment uses observable practices: visible status and next steps, task language, recognizable controls, consistent navigation, error prevention, recoverable failures, scoped records and focus after dialogs. These correspond to the [Nielsen Norman Group usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/). Responsive checks use the W3C [reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), including 320 CSS-pixel page fit and separately scrollable data tables; form checks use [error identification guidance](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html).

A best-in-class claim would additionally require observed representative users completing their tasks, measured completion/error rates, actual assistive technology and physical-device checks, and qualified operational providers. These are not established by this engineering review. Findings below are specific gaps rather than a certification or competitive ranking.

## Demonstrated gaps and remediation

| Journey gap | User impact | Implemented remediation |
| --- | --- | --- |
| Buyer returns navigation was hidden; the entry was inside Account. | Customers could not readily find how to request an RMA. | Visible Returns & warranty navigation, Request RMA action, eligible-serial guidance, human-readable status/next steps and exact saved request confirmation retained after refresh failure. |
| Receipt creation, saved draft review and stock evidence required manual screen changes. | Staff could confuse catalog SKUs with received physical equipment or stop before confirmation. | Receive equipment entry, Receive delivery beside the purchase order, exact saved-draft handoff, review/confirm and exact returned stock-record evidence. |
| Packing and handover had no short explanation at the task entrance. | Staff could mistake packed equipment for a completed shipment and invoice. | Pick → pack → actual handover guidance with reachable Shipments, explicitly distinguishing packing from invoicing. |
| Enrollment availability errors had no retry; application/activation results left focus behind. | Guest applicants could be stranded or miss their result. | Retry checks application availability; application and activation results/errors receive keyboard focus; activation continues to customer sign-in. |
| Staff invitation dialogs lost the pointer opener on Escape; opening then canceling replacement removed the displayed invitation. | Staff could lose navigation or the only available link before its replacement existed. | Preserve the existing invitation until a successful replacement; focus returned invitation and actual dialog opener. |
| Final order confirmation used a generic Continue button and Saved notice. | Buyers could miss the distinction between quantity review and committing an order. | Explicit Accept order / Resubmit for review action and exact order-specific next step, retained even when dashboard refresh fails; native terms and approval rules remain authoritative. |
| Actual pilot products have no image resources and differ from the imported manufacturer library. | Shop still shows placeholders without a verified product-photo association. | Deployed product/image entry and explicit library selection; model association awaits owner catalog direction. No mismatched image is silently attached. |

## Journey coverage

| People and task | Native journey checked | Evidence and practical boundary |
| --- | --- | --- |
| Prospective contractor | Public discovery → customer pricing entrance → application → staff approval → private invitation → activation → buyer login. | Enrollment service/HTTP and browser tests exercise real local commands and scoped buyer access. Invitation delivery is manual; email ownership and automatic email delivery are not claimed. Focused native journeys pass; final frozen regression and live receipt pending. |
| Buyer ordering | Shop → product/price → cart → scoped quote/review → acceptance → Orders. | Existing default browser suite covers multi-line acceptance, exact lost-reply retry, account boundaries, stored cart recovery and phone layout. Current final regression pending. |
| Buyer invoicing | Own invoice/balance/PDF → payment entry and recorded outcomes. | Existing native browser assertions cover issued totals, balances, credit/refund boundaries and original document publication. Synthetic provider responses do not qualify real Stripe or accounting behavior. Current final regression pending. |
| Buyer RMA | Returns & warranty → owned sold serial → request → staff review → customer authorization/status. | Dedicated new browser journey uses native claims, duplicate/lost-reply recovery and wrong-account denial. Authorization does not supply a carrier label, return address or automatic refund. Focused native journeys pass; final frozen regression and live receipt pending. |
| Catalog staff | Catalog → create exact SKU → Images & documents → upload/approved URL/library → reviewed publication → buyer visibility. | The earlier 6,096-unit / 8 catalog-browser / 5 storefront-browser and 12-combination live receipt belongs to source `2b654409`. Current catalog browser recheck passes 8/8. Real publisher loading is point-in-time; exact product association remains pending. |
| Purchasing and warehouse staff | Create/select PO → record actual SKU/quantity/serials/bin → save draft → review/confirm → exact receipt/stock evidence. | Dedicated new browser checks assert stock unchanged before confirmation, exact serial/bin/cost/condition/lineage afterward, and current role/site authority. Quarantine requires subsequent inspection; opening stock is a separate reviewed import. Focused native journeys pass; final frozen regression and live receipt pending. |
| Warehouse and finance staff | Allocated order → scan pick → pack quantities → collection/carrier handover → invoice only for shipped quantities. | Existing default native browser journeys cover serial/bulk fulfillment, partial packing/void, short picks, exact retries and invoice conservation. New guide routing/320px checks extend the integrated browser suite. Current final regression pending. |
| Administration | Assigned customer/terms/contacts → application review → scoped staff access/session controls and audit history. | Existing customer-record, enrollment, session and integrated suites exercise role boundaries, current authority and exact retries. No CI, new provider accounts or new infrastructure are part of this review. Current final regression pending. |

## Task entrances and handoffs

- **New customer:** public website → Apply for trade account → staff reviews the application → staff copies the private invitation and sends it to the verified recipient → customer activates → Continue to customer sign-in. Application acceptance alone does not create an approved ordering account. Failed availability reads offer Retry.
- **Customer order:** Shop → select equipment → Cart → edit quantities → review the quote and terms → Accept order. If verification is required, Orders → Approval requests shows the request; resubmission says Resubmit for review. A committed order is identified even if the subsequent dashboard read fails.
- **Customer return:** Returns & warranty → Request RMA → select an owned sold serial → load/review coverage → explain the issue and evidence reference → submit → follow the readable status. Staff authorization is separate from receiving, inspection, credit and replacement. Confirm return instructions with the distributor before shipping equipment.
- **New product:** Catalog → Add product → Create product & add images → the exact new product’s Images tab → upload, approved image URL or explicitly chosen manufacturer library resource → reviewed publication. Shop’s staff shortcut reaches Catalog. Product creation does not add physical stock.
- **Equipment delivery:** Inventory → Receive equipment → choose/create the supplier purchase order → Receive delivery → record SKU, quantity, bin and serials → Save draft → Review and receive saved delivery → Receive stock → Inventory shows the exact receipt and stock-record history buttons. Drafts survive interrupted refreshes. Stock stays unchanged until confirmation; quarantined stock requires inspection before allocation.
- **Order fulfillment:** Orders → allocated order Actions → pick → pack → Review packed shipments → record actual collection/carrier handover → the invoice reflects only the handed-over quantities. Packing alone does not create an invoice.

Task actions appear next to the affected record or at the relevant page entrance. Narrow layouts retain readable control labels and separately scrollable tables. Escape returns focus to the clicked opener; task transitions focus their destination. Native authorization, scope and revision checks remain authoritative.

## Operational limits

The pilot still has no product-image associations for its 27 synthetic SKUs. The imported GREE library describes a different lineup; matching a photo requires explicit model direction. Product/image entry works, but inventing those matches would misrepresent the equipment.

Private invitation delivery and customer return instructions remain manual operating steps. Stripe, QuickBooks and carrier access remain disabled in the pilot. Their synthetic engineering paths do not establish live payment collection, ledger posting, booking or delivery. Representative-user observation, assistive technology and physical-device acceptance remain unverified. These limits prevent an unconditional best-in-class or complete operational acceptance claim.

## Verification state

Implementation and final frozen verification are underway. This document will record the tested source, environments, actual outcomes and unresolved limitations after acceptance. Private synthetic screenshots, traces, runtime data and receipts remain ignored under `local-evidence/portal-journeys-2026-10-07/`; live acceptance is text-only and blocks business mutations.
