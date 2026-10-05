# Customer record frontend — focused workstation receipt

2026-10-05, local macOS workstation, synthetic temporary fixture databases, built production React assets served by real native HTTP application. Verification used the uncommitted integrated candidate based on `11aabaf`; the final source and corrected browser helpers were committed as `8e2e219`. Lane edits after the source freeze only corrected browser login helpers and refreshed screenshot assertions. No live customer data or provider operations were used.

## Changed frontend and tests

- `src/web/customer-record.tsx`, `customer-record.css`: compact searchable directory, dedicated selected-company header and six tabs (Overview, History, Terms, Pricing, Notes, Contacts); scoped bounded history, actual billing terms, durable contacts with exact uncertain-attempt recovery.
- `src/web/main.tsx`: dedicated staff customer route; preserves buyer Account controls and global price-approval/provider settings. Existing terms dialogs and per-company actions reused.
- `src/web/navigation.ts`, `workspace-breadcrumbs.tsx`: validated customer/tab URL, reload/back/forward and directory breadcrumbs. Legacy Customers purchasing-section bookmark explicitly resolves directory.
- `src/web/customer-pricing.tsx`, `purchasing-rules.tsx`: optional selected-only wrappers reuse existing selected-account controls and recovery.
- `tests/customer-record-browser-{server,journey}.ts`, `customer-record.playwright.config.ts`: synthetic two-company fixture and four focused journeys.
- Existing helper adaptations: `tests/customer-pricing-browser-journey.ts`, `record-notes-browser-journey.ts`, `record-notes-recovery-browser-journey.ts`, `price-overrides-browser-journey.ts`, `storefront-browser-journey.ts`.

## Actual outcomes

`npm run build` and `npm run typecheck` passed after final source edits. Vite retains its existing large-chunk warning.

Focused Playwright configs passed: customer-record **4/4**, customer-pricing **1/1**, record-notes **2/2**, record-notes-recovery **8/8**, price-overrides **1/1**, storefront **4/4**; **20/20** total across separate runs.

Customer journeys verify six tabs, selected pricing without multi-account selector, URL/reload/back/forward, actual fourteen-calendar-day billing edit, contact persistence, private notes, scoped empty order/invoice/payment history, company isolation, unknown record denial, buyer Account separation and legacy purchasing bookmark. Phone test verifies 390px page has no horizontal overflow, Contacts tab scrolls into viewport, current breadcrumb is Contacts and actual Contacts tab owns focus before screenshot.

Contact recovery journey commits the save then drops its response; subsequent retry returns401; reload and another-company route preserve the original attempt without showing it on the other company. Final retry sends the identical payload/idempotency key, resolves successfully and retains exactly one row.

Private local screenshots (synthetic data): `/tmp/distributor-customer-record-desktop-top-1723.png`, `/tmp/distributor-customer-record-phone-top-1723.png`. These are workstation review artifacts, not committed binary evidence.

## Retained failures and limits

Initial journey failed on an incorrect accessible link name (decorative arrow is hidden), then on an incorrect existing dialog reason/action selector. Both test selectors corrected before passing run. One final screenshot rerun overlapped storefront's default Playwright output directory and encountered ENOENT trace-artifact collisions; isolated output directories produced clean final passing runs. Storefront's historical deliberately crossed login entrances no longer reflected the reviewed public authentication flow; helper now enters buyer/customer and staff/admin correctly, all four journeys pass.

Invoice history displays invoice numbers and balances; no canonical invoice-detail URL currently exists. Order history links use existing order detail route. This receipt exercises empty account-scoped history UI; backend paging/security/durability evidence is recorded separately in `CUSTOMER-RECORD-BACKEND-2026-10-05.md`. No broad product acceptance, live provider/residency qualification, deployment, PR, commit or CI action is claimed by this lane.

Full-page visual capture initially translated fixed/sticky elements from a scrolled viewport into the screenshot (floating skip link and shifted sidebar). Runtime diagnostics confirmed activeElement Contacts, scrollY374, full selected-company+Contacts breadcrumb, and unfocused fixed skip link at y=-85..-38.5 with translateY(-93). Final screenshots explicitly reset scrollY0 and await two rendering frames, preserving Contacts focus; final four journeys pass. The final uniquely named1723 desktop/phone screenshots were visually inspected and show complete breadcrumbs without the capture overlay/sidebar gap. A separate phone viewport image is `/tmp/distributor-customer-record-phone-viewport-1723.png`. No production CSS was changed for this screenshot artifact.
