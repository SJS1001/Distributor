# Shop icon toolbar restoration — 2026-10-07

The owner identified an earlier same-day change: Search, Refresh and Cart icons together, with Search opening a dropdown that dismisses when focus moves outside. The exact source was found in `f8a0aa05b60bd2bbadf22c8c089e193fad88e63f`, on `claude/sync-launch-distrubtr-f11d7d` in the separate sync-launch worktree. The running Toronto pilot still served the preceding text-button/full-search layout. The frontend and backend share the same Fastify deployment; this was a source/release divergence.

Selectively restore the breadcrumb toolbar, original SVG drawings, compact search dropdown and page-description currency note. Preserve current photographs, customer amount/quantity minimums, native cart/quote/order operations and scoped catalog routes. Saved carts remain under Orders. No hidden 270-product catalog import, price/data changes, public-home redesign or backend changes from the other worktree are included.

## Workstation verification

Current release candidate is based on `bac171660d59b80b87145b98d7cf5a0b59c559cf`. Typecheck and Vite build pass. Focused browser results against its compiled assets:

- Storefront: 8/8 Chromium and 8/8 WebKit, including toolbar adjacency, accessible names, 44px controls, dropdown toggle/focus/outside/Escape behavior, search/category retention, refresh, cart badge and existing cart/quote paths at 1440/390/320px.
- Catalog management: 8/8 across Chromium/WebKit, including staff entry, private image draft/publication and buyer restrictions.
- Catalog discovery: 1/1 per engine, category pagination, scoped routes/history and saved carts through Orders.
- Customer minimums: 2/2 across Chromium/WebKit, persisted amount/quantity policies, isolation, progress and refusal under changed policy.
- Shop hierarchy/Reports: 2/2 per engine; final WebKit recheck passes after the HTTP fixture correction below.

Initial WebKit storefront run failed all three new toggle checks: Safari moved pointer focus to the page before click, dismissing and reopening Search. The trigger now retains pointer focus inside the disclosure; final full-engine rechecks above pass. Failed logs/traces remain privately retained.

An additional WebKit Shop fixture run failed before sign-in: its HTTP-only synthetic server retained `upgrade-insecure-requests`, causing assets to be requested over nonexistent TLS. That fixture now removes only this directive, matching the existing storefront fixture. Production CSP is unchanged. Failed fixture receipts remain retained.

React Doctor reports 90/100, zero errors and four advisories in existing storefront state-reset/complexity patterns, reviewed without unrelated refactoring. Prettier, diff whitespace and planning-structure verification pass. These are current scoped checks; older full-suite receipts remain historical, and no product/provider/device gate is advanced.

## Live baseline and release

Before release, direct read-only backend checks confirm schema32 CA/reports fingerprint `4b0f11ab922ddabaea19dd21b56ecb7bde515c7aba2797e1d47559b6d31dc354`, integrity ok, zero foreign-key violations and all eight published image hashes. Minimum policy table currently has zero rows. Private table digests and the complete original Machine configuration are retained under ignored `local-evidence/icon-toolbar-2026-10-07/`.

Release and actual HTTPS acceptance were pending at the source checkpoint; the following final receipt supersedes that pending status.

Source `dd85199c6dea9fef1403601105a555d0854d302f` is running on the original single Toronto Machine `817052c44d9028` as `icon-toolbar32-20261007`, digest `sha256:8035e4a6dff5b6ac9803826e94337b650fe87f92eb366e362a4fe82976a0798c`. The image was built locally from a clean committed Git archive and pushed without CI. Fresh complete Machine configuration comparison confirms that only the image changed; startup, environment, services, resources and the original volume are preserved. All backend/shared/package hashes match the preceding release. No migration or business-data write was performed.

All 498 production files match offline and on the running Machine. This manifest includes 434 source/package files plus 64 runtime/provenance/license documents; its SHA256 is `b90a858f029b5fad20ff44dfb08e07d6765a98fd874e1b75bbd4746df2c8ef0d`. Public HTTPS JavaScript `index-uskE4T3n.js` and CSS `index-dlWU71u5.css` match the clean image byte for byte. HTTPS health returns ok/CA. Runtime verification at `2026-10-07T18:41:35.294Z` confirms the unchanged schema32 fingerprint, integrity ok, zero foreign-key violations and all eight native published image hashes. Of 195 table digests compared with the baseline, only session-detail metadata changed; business table digests are unchanged. The minimum policy table still has zero rows, so customer thresholds await staff configuration.

Actual browser acceptance used the owner's existing HTTPS Shop tab: adjacent icon controls and CAD description are visible; Search opens with input focus, dismisses on outside click, outside keyboard focus and Escape with trigger focus restored; an Airy query returns the single corresponding product from the running backend, and clearing the query restores the catalog. Refresh completes with the workspace confirmation, and Cart opens the empty cart and closes back to Shop. The visible Airy photograph loads, the deployed JavaScript URL matches the checked asset and no console errors were recorded. These checks create no order, inventory, minimum-policy or catalog mutation. Private screenshots and receipts remain under the ignored evidence directory. Current scoped workstation browser checks total 32; broader historical full-suite results are not presented as rerun here.

The previous `photos-minimums32-20261007` image is a compatible schema32 rollback option. Provider, physical-device, operational and unmatched-product-photo qualification limits remain unchanged; no product gate is advanced.
