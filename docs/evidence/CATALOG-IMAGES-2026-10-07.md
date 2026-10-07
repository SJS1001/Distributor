# Catalog entry and images — 2026-10-07

The owner reported missing real product photographs and an unclear path for adding products, uploads and image URLs. The current pilot has 27 native products, eight published document links and zero image resources, confirmed by a read-only inventory. The separately imported GREE.ca library contains a different manufacturer lineup. No exact-model match is inferred, and no pilot product or photograph is changed by this release. The owner's catalog direction remains pending.

## Implemented behavior

- Staff workspace has a prominent **Catalog · Add products** shortcut; authorized staff public navigation has **Manage catalog**.
- **Add product → Create product & add images** opens the exact returned product's Images tab. Failed dashboard refresh or product reads do not recreate the product; reads have an explicit retry.
- Existing product names expose **Images & documents**. Administrators have a prominent **Add image** control, upload, approved manufacturer URL and a browsable GREE.ca image picker. Changing the library family clears a previously chosen URL.
- Image links accept absolute HTTPS on `cdn.shopify.com`, without credentials or custom ports, through one shared client/server validator. No server fetch, schema migration or browser CSP expansion. Linked images retain zero content bytes and render with no referrer; failed images retain the placeholder. Other image hosts require file upload.
- Draft/retired resources remain hidden from buyers. Publication still requires administrator permission, explicit distribution evidence and reviewed model metadata. Commercial staff can create products and read resources; image mutations remain administrator-only.

## Workstation verification

Frozen production manifest: **425 files**, SHA-256 `a21fec47488cc684e6016b0c97da4bcca9ad5e0ee418c053af5d97f810d2ea44`. Source/test/config manifest: **1,004 files**, SHA-256 `8e9958b6181d2a1a03cb78cb65677bb5e4e23de970e7a3bd13fb94c7a6884825`. Private logs/manifests are ignored under `local-evidence/catalog-images-2026-10-07/`.

- Full unit suite **6,096/6,096** passed, no skips, failures or cancellations (163.25s). Backend/shared code was frozen throughout; final frontend opener capture has its own later browser pass.
- Catalog media, lifecycle, add-on and availability focused tests **29/29** passed. Existing storefront browser suite **5/5** passed, including binary upload/publication, buyer access and retirement.
- New catalog-management browser suite **8/8** passed: Chromium and WebKit creation, exact-ID/retry, admin/commercial/buyer permissions, initial and management dialog focus, 320px fit, explicit library selection, draft privacy and linked-image publication/rendering. Remote image bytes are synthetic in these local tests; they do not prove a real product match or publisher uptime.
- WebKit's local HTTP fixture initially failed because `upgrade-insecure-requests` upgraded script requests to HTTPS. The fixture removes that directive only on its synthetic local HTTP responses. Production HTTPS headers are unchanged. Earlier failed receipts remain private.
- TypeScript, build, formatting, planning-structure validation and `git diff --check` passed. Vite retains its existing large-chunk advisory; planning checks do not verify product gates.
- React Doctor **88/100**, ten advisory warnings, no error diagnostics. Source review found no remaining actionable defect. The dialog effect intentionally captures the mount-time opener; native dialog cancel/keyboard handling covers its pointer-backdrop handlers. Image error state resets when the resource revision changes, and product notices clear on product navigation. File state is required for the async upload handler. Complexity/duplication and the preexisting small JPEG-marker lookup remain advisory; this is not a clean diagnostics claim.

## Release status and limits

Source `2b654409c27a1b1827e256f3d7f96252509cd6d8` was committed and pushed to the authorized `codex/local-distributor-checkpoint` branch; the remote SHA matched. The clean committed archive built `registry.fly.io/distributor-ca-sjs1001:catalog31-20261007`, digest `sha256:693ef3126a4675e9127496024b368bbb8a7e8d2677eddaae9ff83f2437efa418`. All 425 source/package hashes matched offline and on the existing Toronto Machine `817052c44d9028`. Compared with its previous configuration, only the image changed; volume, startup, environment, services and resources were preserved.

HTTPS health returned 200/CA. Read-only runtime checks passed schema31, reports-enabled fingerprint `faecb731c45c86a1dff0d8e7a96ac7786df2426068189fd505dad3d6200a8d76`, integrity ok and zero foreign-key violations. Business counts remained 27 products, 10 accounts, 10 applications, 28 orders and 21 invoices. The previous schema31 image remains compatible; the retained schema30 image/database pair and encrypted restore-verified archive remain available for reconciled recovery.

Final text-only HTTPS acceptance passed **12/12** at `2026-10-07T16:03:33.509Z`: Chromium153 and WebKit26.6, admin/buyer at 1440/390/320px. Catalog shortcuts, create-dialog Escape/focus restoration, existing Images shortcut, image choices, a real publisher photograph load, library family reset and buyer management exclusion passed. Zero page errors, horizontal page overflow or attempted blocked writes. Every authenticated context signed out with logout200 and subsequent session401. Production CSP, including `upgrade-insecure-requests`, remained unchanged. No live screenshots or business mutations were performed. Private receipt: `local-evidence/catalog-images-2026-10-07/live-verification-2026-10-07T16-03-33-509Z-2b654409c27a.json`.

No CI, PR, merge, new infrastructure, provider activation or catalog-data publication occurred. Real publisher loading is a point-in-time browser check, not proof of product matching or continued availability. Actual product matching, physical-device/native picker acceptance and operating/provider gates remain unverified.
