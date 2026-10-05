# Gree source library — 2026-10-05

Research collection for the owner-requested equipment images, literature, installation and maintenance resources. **Not imported into the live application.** Source: [Gree Canada](https://greehvac.ca/shop/) and its publicly linked [Airtek resource index](https://airtekhvac.com/R32Prudoctlist.json?v=1791218913).

The [machine-readable manifest](gree-source-library.json) contains eight seeded equipment-family mappings, eight image entries (seven distinct images) and 92 technical document references: 16 manuals, 45 submittals and 31 exploded-view/parts documents. Three references were excluded: two publisher-archived Pular manuals and one FLEXX cooling-only manual. Other non-seeded equipment families and generic accessory products are not included.

| Sample family | Official product page | Document links |
| --- | --- | --- |
| Charmo | [SAMPLE-GREE-CHARMO](https://greehvac.ca/heacool_services/charmo-r32/) | 17 |
| Pular | [SAMPLE-GREE-PULAR](https://greehvac.ca/heacool_services/pular-r32/) | 12 |
| Airy | [SAMPLE-GREE-AIRY](https://greehvac.ca/heacool_services/airy-r32/) | 11 |
| Zeno | [SAMPLE-GREE-ZENO](https://greehvac.ca/heacool_services/zeno-r32/) | 13 |
| Multi-zone | [SAMPLE-GREE-MULTI](https://greehvac.ca/heacool_services/multi-zone-r32/) | 9 |
| FLEXX Eco | [SAMPLE-GREE-FLEXX-ECO](https://greehvac.ca/heacool_services/flexx-eco-r32/) | 10 |
| FLEXX Ultra | [SAMPLE-GREE-FLEXX-ULTRA](https://greehvac.ca/heacool_services/flexx-ultra-r32/) | 11 |
| Eight-way cassette (candidate only) | [SAMPLE-GREE-CASSETTE](https://greehvac.ca/heacool_services/8-way-cassette-indoor-unit-r32/) | 9 |

## Downloaded materials

The ignored local folder `private-data/gree-library/` contains a browsable `index.html`, eight image files and three PDF manuals (about 52 MB total). Images were visually inspected. File signatures and SHA-256 hashes are recorded in the manifest. Text extraction succeeded for the three PDFs; their tables/sections include installation and maintenance. No application source or runtime data changed.

Downloaded PDFs are separately published Gree Canada files:

- [charmo-service-a6.pdf](https://greehvac.ca/wp-content/uploads/2025/03/Charmo-Series-Service-Manual-UL60335R32WIFI-A.6.pdf) — not established as the current indexed revision.
- [pular-service-d2.pdf](https://greehvac.ca/wp-content/uploads/2025/03/Inverter-Pular-Series-Service-Manual-R32WIFI-D.2.pdf) — not established as the current indexed revision.
- [multi-user.pdf](https://greehvac.ca/wp-content/uploads/2025/03/Multi-R32-user-manual.pdf) — not established as the current indexed revision.

The first current SharePoint manual request returned HTTP 403. Other SharePoint binaries were not downloaded or individually checked; the manifest preserves publisher links and names, not a claim of working downloads. The direct PDFs must not silently replace those current editions.

## Attachment decisions still required

- The sample SKUs identify product families, not actual manufacturer models. Confirm model, capacity, voltage, refrigerant, language and applicable revision before assigning documents to saleable SKUs.
- The official Zeno page uses the same image as Charmo. Both FLEXX images show multiple equipment configurations. Treat these as representative family images, not proof of a supplied configuration.
- The generic sample cassette does not specify an R32 eight-way model; its eight-way resource set is a candidate only.
- No standalone current Zeno user manual appeared in the selected resource folder. Service manuals are indexed; do not invent a user guide.
- Some product-page copy/icons appear inconsistent with the R32 title. Use verified model submittals before populating specifications; no efficiency, capacity or compatibility claims were imported.
- Public availability does not establish republication rights. Downloaded vendor binaries remain ignored private review copies. Source links and bibliographic metadata are tracked; rights review is required before public image/PDF hosting.

## Application work

The [customer storefront specification](../CUSTOMER-STOREFRONT.md) records the administrator media library, customer-facing product pages and conditional order approval requested in the same discussion. These features remain implementation work. Research counts do not mark a task or product gate verified.
