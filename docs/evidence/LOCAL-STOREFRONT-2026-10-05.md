# Local storefront, purchasing and catalog resources — 2026-10-05

Source: base `4b2c36f8537b9dd2dac5b12559d3451b44ab1cf2` plus the current working delta. Frozen 853-input source/test/build manifest SHA-256: `6ded3bdcb9028fe4659a7af1dc4745f25b4831ec3e726e3275822877de061aaf`; every input was checked unchanged after the final run. Private manifest: `local-evidence/storefront-20261005/source.sha256`. The built Linux/amd64 image independently matched all 339 source files. Environment: direct local workstation checks, synthetic isolated SQLite stores and local browser fixtures. No CI, cloud runner, provider operation or live release is evidenced by this receipt. The deployed Canadian pilot remains outside these local checks; subsequent activation is recorded in the [live release receipt](LIVE-STOREFRONT-2026-10-05.md).

## Implemented scope

Four bounded assignments supplied customer/product purchasing policies, native conditional order review, administrator equipment resources, and the customer storefront. Schema 25 adds empty owned policy/review/resource storage; migrated buyers default to denied purchasing access until staff explicitly chooses an account policy. Enrollment approval and price tiers do not grant product entitlement. Review submission creates a retained request without accepting an order; approval rechecks current eligibility, pricing, expiry, customer terms and supply through the native transactional acceptance path.

Resources have generated IDs, draft/permission-based publication, metadata/order editing, retirement, provenance and history. Authenticated buyer metadata/bytes recheck current entitlement; HTTP delivery is private and non-cacheable. Bounded JPEG/PNG/WebP input becomes PNG. Uploaded PDFs are reconstructed into raster-only documents in a disposable bounded process, discarding the original active object graph. SQLite BLOBs keep retained metadata/history/content within one database snapshot. The buyer UI supplies storefront/product resource presentation and scoped purchasing/review activity.

## Completed local checks

| Check group | Reported outcome | Boundary |
| --- | --- | --- |
| Native purchasing and regression | 28 purchasing checks and 295 regression checks passed | Policy scope, revocation, review decisions, competing/retried acceptance and existing native behavior in synthetic stores. |
| Historical compatibility checks | 81 passed | Historical fixture/profile behavior at the checked candidate; not live migration acceptance. |
| Root HTTP, billing and schema-25 checks | 13 passed | Direct requests, current pricing/billing behavior and current schema composition. |
| Media and Gree sample checks | 11/11 passed | Service/HTTP authorization, CSRF/idempotency, draft/publish/edit/retire, malformed/oversized input, PDF active-object removal, byte integrity, entitlement revocation, coherent closed SQLite copy, family-link replay and business seed. |
| Frozen schema-24 upgrade checks | 2 passed | Exact previous-profile clone upgrade; new storage starts empty and default denial remains explicit. |
| Final storefront browser scenarios | 3/3 passed | Local browser fixture scenarios only; no physical iPhone Safari/device qualification. |
| TypeScript and production build | Passed | Local source/type and bundle checks; no deployment or universal workflow claim. |

Final frozen full suite: **5,983/5,983 passed**, zero failures/cancellations/skips/todo, 165925.014417 ms, exit 0. TypeScript, build, full formatting, whitespace and planning checks passed. Existing large-bundle warning remains. Private log: `/tmp/distributor-storefront-frozen-suite.log`. Planning checks validate structure only. The preceding 5,982/5,983 run correctly failed its rehearsal input-stability check because an existing browser test was formatted during that run; the final run began after all source/test edits were frozen.

## Failures and review limits retained

The initial broad run reported 5,981 tests: 5,923 passed and 58 failed. Those failures remain historical evidence. Fixture upgrades were required for the new explicit default-deny purchasing policy and current schema version; an acceptance test also exposed price drift that now correctly refuses an obsolete quote rather than silently accepting changed terms. Repairs and expected-behavior adjustments were validated by the focused checks above. This receipt does not convert the initial failing run into a passing one or substitute focused counts for the final broad result.

Finite independent source reviews examined new purchasing authorization, order-review atomicity, HTTP/session/CSRF wiring and schema-25 migration composition. The final bounded purchasing/wiring review found no actionable authorization, atomicity or migration defect in its inspected scope. A separate cloud contract review is identified by conversation `6ac3d991-69b8-83ea-a0b0-d69bd5955492`; that reviewer could not access the local source, so its contract feedback is not independent source verification. Neither review is security certification.

## Content and operating gaps

The optional Gree helper publishes eight official manufacturer family-page references only. They are explicitly unverified for exact model/capacity/voltage/revision, and generic accessories receive no Gree references. Gree image/manual binaries are not published or redistributed. Individual SharePoint manuals remain unverified, the first manual retrieval was publisher-denied, and redistribution permission/model matching remain unresolved. Family links do not establish manual applicability to fictional sample SKUs.

PDF reconstruction loses selectable/searchable and accessible text. Native renderer memory/process/network containment, live capacity, production backup/recovery and migration/cutover require operating qualification. Actual scanners/mobile browsers, live providers, financial policies and independent acceptance remain outside this receipt. No product task or gate is marked verified; local implementation and focused passes are not production acceptance. Subsequent live upgrade evidence is recorded separately in the linked release receipt.
