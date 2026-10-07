# Portal journey verification — 2026-10-07

The [journey assessment](../reviews/portal-journeys-2026-10-07.md) covers eight public/customer/staff tasks and records implemented discoverability, focus, recovery and transaction handoffs. This is engineering acceptance of named journeys, not a competitive UX ranking, provider qualification or product-gate approval.

## Tested source and workstation

Source `b347c779ea127a2d0fa579356c3fe8d507b4d227` was committed/pushed to the authorized `codex/local-distributor-checkpoint` branch; the remote SHA matched. Frozen production manifest: **428 files**, SHA-256 `583a96b07a7040e71d4de754813bd3a3fc8e543c5a69bfdcbbee7b75434deb20`. Source/test/config manifest: **1,018 files**, SHA-256 `ee05e080d22fa80926b2fbb4f3acdaadc7de0711388a66f7d0bfe53a9696f6bf`. Both remained unchanged through final regression and source commit.

- Native unit tests: **6,096/6,096**, 154.3 seconds; no failures, skips or cancellations. Subsequent receiving-only UI changes did not change backend/shared/schema/packages.
- Final default browser regression: **343/343**, 8.1 minutes.
- Receiving: **6/6** Chromium/WebKit, including held dashboard refresh and immediate navigation, exact native saved/confirmed revisions, unchanged stock before confirmation, exact stock after confirmation and account/site authority.
- Enrollment: **18/18** Chromium/WebKit at 1440/390/320px, including real synthetic application→approval→invitation→activation→buyer login, scoped denial, error/result focus, revoke/replacement and clipboard fallback.
- Customer RMA: **4/4** Chromium/WebKit, including owned serial request, lost response, staff authorization, buyer status, wrong-account exclusion and prerequisite guidance. Native warranty tests also pass **30/30**.
- Catalog recheck: **8/8**; storefront recheck: **5/5**; remaining navigation: **25/25**. Integration: **7/7 per engine** Chromium/WebKit, including 320px fulfillment guidance routing. Suites use their configured viewports; these counts do not claim every test ran in every viewport/engine.
- Typecheck, production build, formatting, planning and diff checks pass. React Doctor: **91/100**, three advisory warnings: two enrollment maintainability warnings, and a busy-reset warning whose actual code already uses guarded `finally` cleanup.

Private general receipts/manifests/traces are under `local-evidence/portal-journeys-2026-10-07/`; enrollment receipts under `local-evidence/enrollment-journey-2026-10-07/`; live acceptance under `local-evidence/portal-journey-2026-10-07/`. All are excluded from Git. Only synthetic local data was mutated in workstation acceptance.

## Historical failures and repairs

The first full run passed **338/343**. Three assertions still followed the old product button or assumed receipt confirmation stayed on the drafts screen. They now follow exact product management and Inventory→Receipt drafts while retaining native ID/revision/serial/bin/cost/custody assertions. Two trace failures were caused by concurrent verification suites sharing Playwright's output directory; the final run used sequential auxiliary fixtures and isolated outputs. The failed log and available traces remain retained; the shared-output collision had removed the two affected trace files.

Independent review then identified a real receiving continuation race: navigation could cancel refresh before the exact returned draft was visible. Save and confirm now retain the returned native draft summary/ID/revision synchronously. The focused held-refresh/immediate-navigation regression and full suite pass afterward. Earlier local fixture/selector/layout failures and their corrected rechecks also remain retained. No failed receipt is reclassified as a pass.

## Existing pilot release

A clean Git archive of the source built Linux/amd64 image `registry.fly.io/distributor-ca-sjs1001:journeys31-20261007`, registry digest `sha256:807680e2b18fb1ad5913c3e5d377b758a205575ce8936477dc79f7de8537989b`. Offline production hashes matched **428/428**.

Code-only update succeeded on existing Toronto Machine `817052c44d9028`. Configuration comparison found **only the image changed**: startup, environment, services, volume and resources preserved; still one Machine in `yyz`, volume `vol_re1jk0pykok3pdd4`. HTTPS health returns **200 / ok / CA**. Running production source parity passed **428/428**. Schema31 CA fingerprint `faecb731c45c86a1dff0d8e7a96ac7786df2426068189fd505dad3d6200a8d76`, integrity and foreign keys pass. Pre-acceptance counts remain 27 products, 10 accounts, 10 applications, 28 orders and 21 invoices, with 31 sessions / 31 detail rows. Final text-only HTTPS acceptance passed **18/18** at `2026-10-07T16:48:38.631Z` (completed `16:49:07.398Z`, 28.767 seconds).

The initial verification helper upload used an SFTP shell command that did not upload the files; the resulting missing-helper failures are retained. Explicit SFTP put uploaded the helpers, after which source/runtime verification passed. This was a verification transport failure, not an application or schema failure.

Final HTTPS scope: Chromium 153.0.8010.12 and WebKit26.6 × guest/admin/buyer × 1440/390/320px. Guest checks injected a GET503 then retried real application availability, fields, focus and sign-in entrances. Admin checks covered receiving/receipt/fulfillment navigation and safe existing application-review Escape focus. Buyer checks covered visible Request RMA, dialog/Escape focus, readable statuses and staff 403 boundaries. All 72 page-overflow assertions passed; zero page errors or attempted business writes. Twelve authenticated contexts logged out 200, six guest contexts returned 401 on logout and all 18 subsequent session reads returned 401. Production CSP remained unchanged; no screenshots were taken.

All six admin combinations explicitly record the existing-PO Receive delivery dialog as unavailable: no suitable open PO exists in the pilot. Its native save/confirm flow is covered by synthetic tests; no live sample was created. Invitation issuance, replacement and activation are also synthetic-only. The first live receipt (`16:46:51Z`) passed 12/18; the six guest failures came from a private harness exact province-label selector. Only that harness was corrected, and the final 18/18 recheck passed with production source unchanged. Both receipts remain retained. Final private receipt: `local-evidence/portal-journey-2026-10-07/live-verification-2026-10-07T16-48-38-631Z-b347c779ea12.json`.

Post-acceptance read-only runtime verification again passed: schema31 CA, integrity ok, zero foreign-key violations, 27 products, 10 accounts, 10 applications, 28 orders, 21 invoices and 31 sessions / 31 detail rows. These values exactly match the pre-acceptance receipt.

The previous schema31-compatible catalog image remains retained: `catalog31-20261007`, digest `sha256:693ef3126a4675e9127496024b368bbb8a7e8d2677eddaae9ff83f2437efa418`. Earlier schema30 image/database pair and encrypted restore-verified archive remain retained; an old schema30 image alone cannot safely open schema31.

## Practical limits

Live acceptance permits only login/logout writes, blocks business mutations, takes no screenshots and preserves production CSP. Enrollment activation/invitation replacement and stock/return/order transactions use native commands in synthetic workstation fixtures; live checks do not create pilot business data.

Actual pilot SKUs still need explicitly matched product photos; the imported manufacturer library is a different lineup. Invitation delivery and return instructions remain manual. Payment, accounting and carrier access are disabled. Physical devices, native pickers/software keyboards, assistive technology, representative-user task observations, live providers, operational recovery and residency qualification remain unverified. No product gate is advanced by this release.
