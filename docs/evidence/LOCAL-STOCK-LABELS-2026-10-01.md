# Local stock QR label evidence

Date: 2026-10-01. Scope: bounded D-017 engineering candidate, not product acceptance. Parent local commit: `edfda92`. Exact source/configuration/license hashes and final check results are in the [machine receipt](LOCAL-STOCK-LABELS-2026-10-01.json). All 44 tasks and 10 product gates remain NOT VERIFIED.

Inventory owns identity-only 100 × 50 mm QR PDFs, immutable rendition bytes and permanent prepared-request receipts. Serialized QR data is the exact serial; bulk QR data is the exact SKU. Complete human identity is printed without normalization or shortening. Deliberate copies repeat one identity; unsupported control characters, glyphs or layouts reject preparation. No stock, movement, bin, cost or money changes. Prepared does not prove printing or attachment. See the [scanning runbook](../SCANNING.md).

Current identity, role, warehouse grants and stock revision are checked before cached results and after asynchronous rendering. Rendering runs outside the SQL transaction; rendition, receipt, command and audit commit atomically. Bytes are SHA-256 checked before responses. Lost browser responses retain the same retry key for the same unit/version/copy count. History uses current site grants and returns at most 200 entries. A new key records another request while sharing the original immutable bytes for identical facts.

## Environment and observations

Direct commands on the owner's macOS arm64 workstation, Node 24.16.0/npm 11.13.0, disposable synthetic SQLite/WAL stores and installed local Chromium. No local/self-hosted or cloud CI runner job, workflow, runner registration, push, PR, publication, provider request/account, live data, deployment or OPUS/UB integration was used. The owner reaffirmed local commits only.

The six label tests independently parse and rasterize PDFs with PDF.js/canvas and decode whole-page pixels with jsQR at 203 and 300 dpi. Cases include short and maximum-length serials, French and decomposed Unicode, bulk SKU, deliberate copies, complete text and page/text bounds. They also cover restart retries, request conflicts, invalid copies, current role/site/organization denial, stock revision changes, rendering principal/stock changes, late-write rollback, concurrent asynchronous requests in one process, cached corruption, HTTP JSON/CSRF/origin/key controls and revoked sessions. No separate-process label race or physical hardware certification is claimed.

The new browser journey reviews identity/copies, discards a committed PDF response, retries with the same key, verifies one prepared receipt and SHA-256, independently extracts both downloaded PDF pages and confirms unchanged stock. Existing billing downloads and other workflows remain in the full regression suite. Final observed commands/counts/durations are recorded in the machine receipt.

## Preserved failures

Initial type checking exposed QR byte-segment and CommonJS decoder typings. QR byte input now uses UTF-8 Buffer and the test imports the installed decoder function through its NodeNext-compatible type boundary. Intermediate unsuccessful type corrections are superseded, not counted as passes.

The initial vector-cell renderer passed 203 dpi but failed independent QR decoding at 300 dpi (first focused run: five passed/one failed, 1859.594542 ms). An intermediate cell-overlap adjustment still failed. Its synthetic [PDF](LABEL-FAILED-VECTOR-CELLS-2026-10-01.pdf), [203 dpi image](LABEL-FAILED-VECTOR-CELLS-2026-10-01-203.png) and [300 dpi image](LABEL-FAILED-VECTOR-CELLS-2026-10-01-300.png) are retained as failed artifacts. The final renderer embeds a lossless monochrome PNG with a four-module quiet zone; the focused six-test run passed at both resolutions (4326.273375 ms) before final regression checks. No successful physical printing is inferred from raster decoding.

The first full browser run passed 14 journeys and timed out in the new journey (1.4 minutes): the test requested a navigation button named Stock while the actual button is Inventory. Corrected the test and runbook name without weakening application checks. This failed run remains part of the history.

## Limits and remaining work

Actual printer drivers/media/material, scanner/camera firmware and browser versions, damaged labels, real print/read quality, operator acceptance, pairing, GS1/industry encoding and any selected offline requirements remain unqualified. Large production histories/retention/storage quotas, schema upgrades, independent process contention, crash/power-loss testing and operational targets remain pending. Exact device/serial/business policies and source/distribution rights require review; see [third-party notices](../THIRD-PARTY-NOTICES.md). Full-system implementation is incomplete. No product gate or human sign-off is inferred from these checks. Historical evidence remains unchanged.
