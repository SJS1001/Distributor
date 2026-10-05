# Issue draft: Category destinations with remembered page tabs

Current status: read-only verification confirms [issue #2](https://github.com/SJS1001/Distributor/issues/2) is OPEN and authored by `sjsmithbot`. The earlier no-matching-issue observation is superseded. The draft and delivery notes below are retained as historical records; no duplicate issue is needed. Local category/page sub-tab implementation is preserved uncommitted, with the latest exact verification recorded in HANDOFF.md. Broader acceptance and release scope remain separate. Existing issue #1 covers saved filters and historical charts only.

## Proposed issue body

The owner requested one sidebar destination for each category, with its related pages displayed as tabs. Local implementation now provides permission-filtered category navigation, per-category remembered page selection during the current session, keyboard controls and horizontal tab scrolling on narrow screens.

Sales & customers opens Orders, Customers and Catalog. The same structure applies to Workspace, Stock & fulfillment, Finance and System & controls. Existing navigation cancellation and stale-read safeguards remain in place.

Implementation is uncommitted over `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703`; the changed navigation inputs are `src/web/workspace.tsx`, `src/web/main.tsx`, `src/web/style.css` and `tests/workspace-overview.test.ts`. Typecheck, production build and five focused component checks passed. Manual synthetic-demo checks covered category switching, remembered selection, keyboard activation and a 390-pixel mobile viewport. The build retains its existing large-bundle warning.

Delivery impact: the local navigation slice is implemented, but publication/release and broader role, accessibility and workflow acceptance would add work beyond these focused checks. This enhancement does not close any of the frozen 44 tasks or ten product gates, all of which remain NOT VERIFIED. Track publication/release scope separately; preserve the local demo and avoid expanding this issue into saved filters, historical trends or the separate, unratified claims-summary contract.

Suggested remaining work:
- Confirm the release/publication scope and any change to the frozen completion baseline with the owner.
- Complete the agreed broader navigation acceptance before a release claim.
- Publish only under the repository's authorized scope and identity policy; no CI, PR or merge is implied.

## Historical delivery status (superseded by issue #2)

These historical notes are not a current approval request or blocker. The tracking issue exists; no duplicate creation or new issue-intake approval is pending.

No GitHub mutation was attempted. The request to create an issue came from a coordination thread; it does not itself add direct human authorization for external publication or messaging that thread. The owner directly authorized this local navigation implementation. This draft preserves the exact proposed public issue without treating a coordination request as an owner decision.

Historical next action was event-driven on authorization for publishing this tracking item. Issue #2 now exists, as recorded at the top; no issue-creation action or approval is pending. Before any future GitHub mutation, verify GET /user is `sjsmithbot`. No timed job or due-time promise has been created. Broader qualification still requires authentic infrastructure/provider/business evidence; focused UI checks do not replace it.

## Direct owner follow-up: section sub-tabs (historical checkpoint)

The owner subsequently requested actual page sub-tabs in place of “On this page” shortcuts. That reversible local UI implementation is complete, with keyboard/accessible-panel support and focused navigation checks; see UI-UX-REVIEW-2026-10-04.md and the private section-tab receipt. Publication and full role/workflow acceptance remain separate from this local change. This draft has no delivery/provider failure: GitHub issue creation was not attempted because the request to publish it came from a coordination thread, not direct human authorization for that action. No current GitHub identity verification or write-access assertion is made. Existing issue #1 covers a different deferred feature.
