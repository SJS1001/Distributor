# UI/UX book research and Distributor recommendations

Research date: 2026-10-04. Review basis: commit `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703` plus the existing, uncommitted UI changes. Recommendations below are proposals, not implemented features or verified usability outcomes.

Subsequent owner authorization: “Implement all recommendations.” Implementation and its verification limits are tracked separately in [UI/UX recommendation implementation](UI-UX-IMPLEMENTATION-2026-10-04.md). The research and its original deferrals below remain as the historical basis.

Distributor's strongest next improvement is to organize each screen around the operator's next decision. The category → page tab → section sub-tab structure is worth keeping. The remaining friction is deeper: dashboard links lose task context, some work screens lead with policy, and recovery messages expose engineering concepts before explaining the business outcome.

## Research method and limits

The shortlist favors complementary books for a transactional business application: understandable navigation, complex workflows, visual hierarchy, forms, data communication and accessibility. “Best fit” is an editorial judgment for Distributor, not a universal ranking. Research used author/publisher descriptions, available contents and excerpts; it was not a cover-to-cover reading of seven books. Applications to Distributor are this review's inferences, grounded in the source observations below.

The local browser returned a connection-refused error for `127.0.0.1:3000`. Its retained accessibility snapshot is not fresh visual evidence. Findings therefore use current source and the [existing design review](UI-UX-REVIEW-2026-10-04.md); no new screenshot inspection, user study, accessibility certification or production qualification is claimed.

## Recommended books

| Book | Why it belongs in this shortlist | Application to Distributor |
| --- | --- | --- |
| [Don't Make Me Think, Revisited — Steve Krug](https://sensible.com/dont-make-me-think/) | Practical web/mobile usability and understandable navigation. | Make destinations and next actions predictable; use familiar operational language. |
| [The Design of Everyday Things, revised edition — Don Norman](https://jnd.org/books/the-design-of-everyday-things-revised-and-expanded-edition/) | Discoverability, constraints and feedback explain how people understand actions and outcomes. | Clearly distinguish prepared, awaiting approval, submitted, confirmed and uncertain operations. |
| [Designing Interfaces, third edition — Jenifer Tidwell, Charles Brewer and Aynne Valencia](https://www.oreilly.com/library/view/designing-interfaces-3rd/9781492051954/) | A pattern reference covering navigation, tabs, progressive disclosure, forms and mobile interaction. | Connect queues to focused record views; preserve place and context across navigation. |
| [Refactoring UI — Adam Wathan and Steve Schoger](https://refactoringui.com/) | Concrete guidance on hierarchy, spacing, typography, color and restrained decoration. | Establish a consistent density and type scale; make primary work visually dominant. |
| [Web Form Design: Filling in the Blanks — Luke Wroblewski](https://origin.lukew.com/resources/web_form_design.asp) | Research-informed treatment of forms and data entry. | Review order, receipt and adjustment forms for grouping, defaults, explanation and recovery. |
| [Storytelling with Data — Cole Nussbaumer Knaflic](https://www.storytellingwithdata.com/books) | Choosing charts and using color and annotation to explain data. | Give every chart an operational question, explicit scope and a useful drill-through. |
| [Accessibility for Everyone — Laura Kalbag](https://abookapart.com/products/accessibility-for-everyone.html) | Inclusive design spanning content, structure and implementation. | Make warehouse, finance and buyer tasks usable with keyboard, assistive technology and zoom. |

Start with Krug, Refactoring UI and Designing Interfaces for the next design pass. Use Norman for consequential actions, Wroblewski for entry workflows, Knaflic for analytics and Kalbag throughout. Older books provide principles; check current standards separately when implementing accessibility requirements.

## Preserve the useful foundation

- Keep the five sidebar categories and their permission-filtered page tabs, including Sales & customers → Orders / Customers / Catalog.
- Keep real section sub-tabs that show one panel and preserve inactive form state. Do not restore “On this page” jump buttons.
- Retain the current stock action and accounting disclosures; these already reduce visible complexity.
- Preserve explicit CAD/USD amounts, scoped totals, text alternatives for charts, honest zero/loading/error states and independent approval rules.
- Keep the restrained navy/blue/amber direction and original icons. Consistency and useful information will contribute more than adding more illustration.

## Prioritized recommendations

Effort is relative: small = bounded copy/style work; medium = interaction/state work; large = cross-layer or new data contracts. These are not delivery estimates. A source observation demonstrates implementation behavior; the resulting usability benefit remains a hypothesis until checked with users.

| Priority | Source observation | Recommended change | Completion criterion | Effort |
| --- | --- | --- | --- | --- |
| 1 | `stock-journal-original-retry.tsx` uses “retained original key and body,” “principal” and “second successor” in operator-facing recovery text. | Lead with what happened, what is unknown and the safe next action. Put technical identifiers in an expandable evidence area. | Users can explain whether the operation is confirmed and how to continue; no copy implies failure or success when the outcome is uncertain. | Small–medium |
| 1 | `overview.tsx` metric cards call `navigate(metric.page)`; “Unpaid invoices” carries no unpaid filter. “Receive stock” selects only Purchasing. | Carry the intent into the destination: correct sub-tab, matching filter and focus on the relevant queue or workflow. | Each shortcut lands at the work promised by its label, with visible scope and a way to clear the filter. | Medium |
| 1 | `main.tsx` places Count review policy and its configuration action before the cycle-count queue. | Put the queue and its primary task first; show a compact policy summary nearby and move editing to a disclosure or Administration link. | Routine counting is immediately discoverable; applicable approval duties remain visible before consequential actions. | Small–medium |
| 2 | `main.tsx` keeps the selected page in component state; `workspace.tsx` remembers category pages in memory. This navigation has no URL/history contract. | Add addressable pages and sub-tabs with Back/Forward support. Preserve useful queue context on return. | Reload and Back return to the intended authorized location; invalid or inaccessible destinations have a clear fallback; URLs contain no credentials or sensitive draft payloads. | Medium |
| 2 | Overview's recent-order identifiers are spans and its “All orders” link opens the broad destination. | Make records identifiable and directly openable; introduce a consistent focused detail view with summary, status, next action and history. | An operator opens a specific order and returns to the same filtered list position; current record authority is checked. | Medium |
| 2 | `style.css` contains operational labels at 10–11px alongside larger values and several component-specific sizes. | Consolidate typography, spacing and table tokens. Trial 14–16px body text, 12–14px secondary text and a deliberately compact desktop density. | Key labels remain readable at narrow widths and zoom; quantities, money and status use consistent alignment and meaning. These sizes are design proposals, not WCAG thresholds. | Small–medium |
| 2 | Overview leads with totals and recent records; it has staff/buyer variants but no explicit prioritized work queue. | Add a role-appropriate “Needs attention” area: blocked orders, counts awaiting review or invoices requiring follow-up. | Each item has a defined business rule, scope, authoritative count and direct destination. Zero, unavailable and inaccessible remain distinct. | Large if new aggregate contracts are needed |
| 3 | Existing charts show current order/invoice distributions; historical trend data is not supplied here. | Improve charts around decisions, using the proposals below. Keep low-value charts subordinate to active work. | Every chart answers a stated question, shows period/scope/units, has numeric alternatives and leads to its underlying records. | Medium–large |
| 3 | Complex entry/review workflows are present, but this review did not complete a fresh form walkthrough. | Conduct a focused form pass: logical groups, visible required fields, contextual help, safe defaults and error summaries linked to fields. | Entering, correcting, reviewing and resuming an order or receipt does not discard inputs or bypass fixed review and permission checks. | Medium; hypothesis to validate |
| 3 | Existing ARIA, focus styling and historical phone checks are useful but do not establish end-to-end accessibility. | Validate complete keyboard, screen-reader, zoom and touch workflows, especially nested tabs, dialogs and recovery. | Record actual task outcomes, focus order, announcements and remaining issues. | Medium; verification work |

## Concrete copy direction

Current recovery text asks users to understand implementation mechanics before deciding what to do. Proposed wording must be checked against the exact operation; a retained *preparation* is not proof that an accounting journal was posted.

| Current example | Proposed direction |
| --- | --- |
| “Review retained original retry attempt” | “Review previous attempt” with the journal/reference and preparation status shown beside it. |
| “The original retry reply could not be verified.” | “We couldn't confirm the result of this attempt. Review it before submitting again.” |
| “Recover the retained original key and body…” | Explain that the saved attempt will be checked and that a new attempt will not be created by this recovery action; put keys and payload details under “Technical details.” |

Use a consistent feedback structure: **outcome → consequence → next action**. Keep separate confirmation for stock, money, external submission and approval changes. Reducing visual clutter must not remove meaningful review.

## Charts and graphics worth adding

| User question | Best presentation for this system | Data requirement and limit |
| --- | --- | --- |
| What needs work next? | Ranked attention list with counts and text-backed severity; each row opens the matching queue. | Agreed definitions and complete, current, access-scoped aggregates. A page of records is not a total. |
| Where are orders waiting? | Horizontal bars by actionable status, with count labels and drill-through. | Reuse qualified existing aggregate states where possible. This is a status distribution, not a conversion funnel. |
| Which receivables need follow-up? | Aging bars by monetary balance, alongside customer/invoice details. | Reuse the existing aging capability only after confirming its scope, as-of date and currency. Do not relabel invoice-count proportions as money. |
| Which stock needs attention? | Exception table grouped by warehouse and condition; a small bar comparison only when it helps prioritize. | Agreed shortage/quarantine/review definitions. Low-stock thresholds must be supplied; availability alone does not establish a shortage. |
| What happened to this order or serial? | Compact event timeline with meaningful milestones and linked evidence. | Existing authoritative history, dates and status; distinguish recorded events from planned steps. |
| Are performance and sales improving? | Dated line charts with a comparison period and explicit metric definition. | Deferred historical aggregates. Do not manufacture trends from recent orders, combine currencies or show invented percentage changes. |

Use icons for record types, condition and action recognition. Keep illustrations mainly for onboarding and empty states. Use red/amber for meaningful exceptions, with text; avoid treating every status as a brightly colored badge. Never make color the only carrier of meaning.

## Category-specific direction

- **Sales & customers:** retain Orders / Customers / Catalog tabs. Make order number, customer, status and next permitted action the consistent record header. Keep entry workflows close to their queue and preserve the selected account.
- **Stock & fulfillment:** retain Inventory / Purchasing / Returns tabs and existing section sub-tabs. Prioritize receiving, locating, counting and moving stock. Show item, warehouse/bin and quantity together. Keep policy editing secondary while approval constraints remain explicit.
- **Finance:** lead with invoices, aging and pending reviews. Preserve Accounting disclosures. Separate daily collection work from provider setup and technical recovery evidence.
- **System & controls:** retain the existing destinations; use consistent settings layouts and descriptive subtitles to explain their purpose. Do not add a fourth navigation tier to solve long pages.
- **Overview:** show context and a compact totals band, then prioritized work, then supporting charts. Existing staff/buyer variation should remain; any finer role defaults must follow actual responsibilities and permissions.

## Recommended delivery sequence

1. **Clarity and visual consistency:** recovery copy, queue-before-policy layout, typography/spacing tokens and consistent primary actions. This is the best bounded starting slice.
2. **Connected workflows:** destination-aware shortcuts, addressable tabs and focused record detail with reliable return-to-list behavior. Check navigation cancellation, retained drafts and authorization alongside the presentation work.
3. **Operational insight:** agreed attention queues and purposeful charts. Historical trends and saved filters remain deferred under the existing [issue #1](https://github.com/SJS1001/Distributor/issues/1); further Inventory/Billing bundle splitting remains separately recorded under [issue #3](https://github.com/SJS1001/Distributor/issues/3). This research neither duplicates nor dispatches that deferred work.

For future validation, use representative warehouse, finance and buyer tasks: receive a purchase, find a serial, review a count, open an unpaid invoice, and recover an uncertain submission. Capture successful completion, wrong turns, time, help requests and ability to explain the result. Establish a baseline before claiming percentage improvements. No such study ran during this research.

Accessibility checks should use current guidance as well as the books. For example, WCAG 2.2 AA's target-size criterion generally specifies 24 × 24 CSS pixels or applicable exceptions, rather than a universal 44px minimum; 44px can still be a practical touch design target for warehouse controls. See [W3C's target-size explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Check keyboard use, focus, contrast, reflow and assistive technology separately; size alone establishes no conformance.

## Change record

This request produced research and recommendations only. Application code was not changed. Existing local UI work was preserved. No CI, runner jobs, provider operations, deployment, PR, merge or publication was performed. Product gate status is unchanged.
