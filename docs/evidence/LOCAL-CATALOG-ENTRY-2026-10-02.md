# Local catalog and saved-cart paging — 2026-10-02

Local engineering only, partial D-008/D-018/D-019/D-020 and REQ-03/REQ-12/REQ-13. All 44 tasks and 10 product gates remain NOT VERIFIED. Parent `0d490be` on `codex/local-distributor-checkpoint`; exact candidate inputs and command times/hashes are in the [machine receipt](LOCAL-CATALOG-ENTRY-2026-10-02.json). Workstation macOS arm64, Node 24.16.0; synthetic fixtures only. No workflow, CI runner, delegation, provider/device request, remote write, PR, deployment, publication, account or purchase.

## Result and owning boundaries

Catalog pages select at most 21 active organization-owned product/selected-tier rows and return twenty public descriptors, enriched with exact integer tax. Search uses literal case-insensitive SKU/name matching. Orders reads one unique customer/warehouse cart and resolves at most 100 selected identities through the catalog owner in the same transaction. Active off-page saved items retain quantities; independently resolved inactive items require the existing explicit removal choice. No direct foreign-module writes, schema, dependencies, license or workflow changes.

The saved-cart queue selects at most 21 scoped headers, parses the returned twenty and exposes product/unit counts. Current account/site filters bind its cursor. Persisted role/password/account authority precedes empty results and cursor lookup. Buyers cannot widen their account using supplied roles or foreign identifiers. Cart reads do not mutate business facts; HTTP denial retains normal deny audit.

The editor retains selected quantities across catalog pages/search and renders off-page selections separately. Failed reads preserve the page/basket and retry the exact request; abandoned reads cannot reopen the editor. Queue resume preselects the owning customer/site and then loads the exact current cart. Accepted off-page order labels use their immutable line descriptions. Native saved revisions, pending exact-save recovery, fresh quotes, stock/credit checks and immutable acceptance remain authoritative.

## Workstation verification

- Complete backend: 1,890/1,890 pass, including six new catalog/cart cases.
- Complete production-build Chromium: 100/100 pass, including three new journeys; earlier focused backend 6/6 and browser 3/3 also pass with version limits below.
- Final reviewed type and formatting checks exit zero.
- Isolated production-only runtime passes: 219 copied inputs, 27 child commands, 69 development-only packages absent; synthetic CA/US startup twice each, PDF/ZPL outputs and local encrypted backup/restore. Expected disabled CLI refusals are asserted by the harness.
- All 388 final source/test/configuration inputs and three delivered production assets match the receipt. Structure and whitespace checks are recorded there when complete.

The complete backend run covers final production/backend-test inputs. The final browser correction changes only `tests/cart-recovery-browser-journey.ts`; its prior and final candidate manifests are retained privately. Complete browser/type/format checks rerun against corrected bytes; production/runtime/backend inputs remain unchanged. Build retains the existing JavaScript chunk warning over 500 kB.

Changed React Doctor exits zero with the existing App complexity warning; that diff scan covers nine tracked files. Full scan includes the new components and exits one with 216 findings (41 errors, 175 warnings). Two new loading-reset warnings refer to resets inside identity-guarded `finally` blocks; two state-only-in-handlers warnings refer to applied search/filter state needed for current continuation closures. Reviewed as nonblocking; no new component errors, no suppression or clean full-scan claim. Original diagnostics are retained privately.

## Preserved failures and version limits

Private artifacts: `/tmp/distributor-catalog-entry-checkpoint`. Reduced-parent focused tests fail because the new methods/routes are absent; this is not evidence of separate prior security defects. Early expanded backend test expected FORBIDDEN for missing buyer assignment but received NOT_FOUND; cart paging now rejects missing assignment explicitly before customer lookup. Initial browser launch lacked the local `tsx` PATH; the invocation was corrected. A later cart-resume test expected the quantity editor before continuing through the existing preparation dialog; its expectation was corrected. Early backorder label/quantity fixture corrections and all superseded logs remain retained.

First complete browser run passes 99/100. The older oversized-quantity recovery test expected a server alert, but the new editor's native HTML maximum prevents submission first. The corrected test asserts that invalid browser input is blocked, deliberately removes only the maximum constraint for the test, then exercises the actual native refusal and correction without weakening the server guard. The original error context and trace are retained privately.

## Qualification limits

Pages are live reads, not immutable search snapshots. Catalog cursors are organization-bound product identities, not search-bound receipts; the UI repeats the applied search. Product renames/activity changes and cart update-time changes during traversal can omit/repeat records. Separate cart/catalog/dashboard reads may be stale; native commands revalidate.

Returned/header/selected bounds do not bound SQL scans, sorts, memory for corrupt persisted strings, writer contention or the complete dashboard. Legacy full-list APIs, staff catalog products and customer/site choices remain unbounded. The removal UI still shows aggregate counts rather than unavailable names or individual choices. Current staff site policy, broader React diagnostics, actual country tax rules, residency infrastructure, provider/device qualification, production load/security/restore and human operator acceptance remain open. These tests do not pass G3 or any product gate; full-system implementation remains incomplete.
