# Administration and customer layout — 2026-10-07

The owner authorized extending the approved public design to administration and customer workspaces. This receipt covers local implementation and isolated workstation verification. It does not describe a production release or advance a product gate.

## Changes

- Compact shared title/action row, adjacent accessible Search/Refresh/Cart icons, tighter filters and tables, and consistent spacing across workspace pages.
- Staff destinations are nested under expandable sidebar groups. Current destinations remain visible; the redundant second page-navigation row and duplicate Catalog shortcut are removed. Task tabs remain inside pages, with a redundant single-tab row suppressed.
- Shop starts with the product grid. Removed the oversized spotlight and duplicate manufacturer promotion; the product library remains accessible from navigation. Product images, documents, prices, search dismissal, cart and minimum-order behavior remain intact.
- Customer Account uses Overview & terms, Data location and Sign-in security tabs, including keyboard, history and reload support. Returns remains a primary destination. Overview/Reports use grouped views; occasional return/fulfillment guidance is expandable while primary workflow actions remain visible.
- Removed workspace demonstration banner and repeated customer identity/currency text. Customer identity uses the account name. Seed data remains unchanged, and actual capability/residency limitations remain visible where relevant.

No backend, schema, provider, dependency, production CSP or deployment changes.

## Evidence

Base commit `321bdca`. Final 22-file implementation/test manifest SHA-256 `bb5355f19cbb1509114abcc975f5e861f291b517fef455b47b997e1d8fd75cc8`; manifest and historical/final logs retained in ignored `.local/workspace-layout-review/`. Built Vite assets were exercised against isolated native Fastify/SQLite fixtures using workstation Playwright Chromium/WebKit.

47 focused browser checks passed:

| Suite                   | Passed | Coverage                                                                             |
| ----------------------- | -----: | ------------------------------------------------------------------------------------ |
| Workspace navigation    |      5 | Role-specific page/group navigation                                                  |
| Workflow reports        |      5 | Grouped reports and catalog lifecycle                                                |
| Storefront              |      8 | Cart, search dismissal, resources, publication and availability                      |
| Returns                 |      4 | Customer requests and navigation, Chromium/WebKit                                    |
| Receiving               |      6 | Delivery workflow, Chromium/WebKit                                                   |
| Customer minimum orders |      2 | Amount and quantity policies, Chromium/WebKit                                        |
| Catalog management      |      8 | Create product, image publication and access, Chromium/WebKit                        |
| UI integration          |      7 | Account tabs, sessions, claims, order focus and mobile details                       |
| Workspace layout        |      2 | Chromium/WebKit desktop/mobile geometry, nested navigation, Account history/keyboard |

The layout suite checks six customer destinations and five additional staff destinations at 1440, 390 and 320 pixels, without horizontal page overflow or page errors. The first Shop product is above 440 pixels, and the desktop order queue is above 420 pixels. Internal-browser desktop administration and customer views were inspected. The local preview has isolated synthetic records, including a product without a photograph; this is not evidence about production catalog images.

23 focused native tests pass for overview/navigation, storefront schema, fulfillment and delivery. Typecheck, formatting, build, whitespace and planning checks pass. Build retains the existing large-chunk advisory. React Doctor scored 89/100 with nine advisory findings: component complexity/size, existing prop-driven state resets, and small breadcrumb lookup/key patterns. These were reviewed without identifying a correctness defect; maintainability warnings remain. The final change after that scan removes the duplicate Shop manufacturer component; build and Shop/layout suites were rerun.

## Corrections and retained failures

Initial typecheck/unit failures exposed a view-index guard and an obsolete removed-tab import; corrected. Parallel browser runs initially shared an output directory and encountered trace cleanup collisions; final runs use unique output directories. Old assertions referenced removed Catalog/Account controls and a heading covered by the open search popover; replaced with current navigation and a genuinely outside click target. The new layout test initially used the wrong helper export; corrected. The Account integration test initially used an incorrect tablist name; the final seven checks pass. A mobile navigation gap found in review was corrected and verified in both engines. Initial logs remain retained, not overwritten by passing receipts.

## Limits

No production deployment, live business mutation, provider qualification, physical-device qualification or assistive-technology/user study was performed. The full repository test suite was not rerun; these are scoped regression results. Public layout verification from the preceding receipt remains historical. No CI jobs, PRs, merges or infrastructure changes were made.
