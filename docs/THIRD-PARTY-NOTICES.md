# Billing dependency and font notices

Date: 2026-09-30. Actual installed files were read before local reuse. This inventory supplements [reuse qualification](REUSE.md); it neither selects a Distributor product license nor approves publication or redistribution of the full application. Dependency source/integrity is pinned in package-lock.json. Preserve notices when packaging third-party files.

## Runtime PDF components

| Exact component | Observed license/source | Retained notice |
| --- | --- | --- |
| pdf-lib 1.17.1 | Installed LICENSE.md: MIT, Copyright 2019 Andrew Dillon; [official repository](https://github.com/Hopding/pdf-lib) | [MIT text](licenses/billing/pdf-lib-MIT.txt) |
| @pdf-lib/standard-fonts 1.0.0 | Installed LICENSE.md: MIT, Copyright 2018 Andrew Dillon | [MIT text](licenses/billing/standard-fonts-MIT.txt) |
| @pdf-lib/upng 1.0.1 | Installed LICENSE: MIT, Copyright 2017 Photopea | [MIT text](licenses/billing/upng-MIT.txt) |
| pako 1.0.11 | Package declares MIT AND Zlib; installed LICENSE is MIT, Copyright 2014–2017 Vitaly Puzrin and Andrei Tuputcyn; bundled zlib source has separate notices | [MIT text](licenses/billing/pako-MIT.txt), [actual zlib notices](licenses/billing/pako-zlib-notices.txt), [zlib README](licenses/billing/pako-zlib-README.txt) |
| tslib 1.14.1 | Package declares 0BSD; installed LICENSE.txt is Microsoft permission/disclaimer text | [Actual text](licenses/billing/tslib.txt) |
| @pdf-lib/fontkit 1.1.1 | Installed package.json/README declare MIT; no standalone LICENSE was present. Package author Andrew Dillon; contributor Devon Govett. [Official fork](https://github.com/Hopding/fontkit). The bundle also includes other license notices. | [Package metadata](licenses/billing/fontkit-package.json), [README](licenses/billing/fontkit-README.txt), [embedded notices](licenses/billing/fontkit-embedded-notices.txt) |

Fontkit's actual bundled ES source contains Joyent/Node MIT permission text, Niklas von Hertzen's base64-arraybuffer MIT header and Google Inc. 2013 Brotli Apache-2.0 notices. Exact notice comments are retained without copied implementation code; the [full Apache-2.0 text](licenses/billing/pdfjs-Apache-2.0.txt) also applies to those Brotli notices. Calling the entire bundle MIT would omit these terms. Full bundled dependency provenance/copyright coverage, absent standalone fork license and exact npm-release source mapping remain publication qualification items. Neither refactoring nor server-side use erases obligations.

## Font asset

`src/server/assets/notosans/NotoSans.ttf` is the unmodified static `hinted/ttf/NotoSans/NotoSans-Regular.ttf` from [notofonts/noto-fonts commit ffebf8c1ee449e544955a7e813c54f9b73848eac](https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf). Git blob: `d55220958aa51eeeb85048d746eabe43d2cd9f14`. SHA-256: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.

Its [full SIL Open Font License 1.1](../src/server/assets/notosans/OFL.txt), Copyright 2018 The Noto Project Authors, is copied from the same commit's LICENSE. License Git blob: `c82d72e422e2d08c5ab439b6bac7c2177ea0c565`; SHA-256: `0dab92d0544f7b233403f14b84a663bdbfa746982eda629e7f4f9ffe1b036feb`. The source binary is unchanged; generated PDFs contain subsets. Retain copyright/license alongside redistributed fonts; the license's terms for documents and reserved names must be preserved.

An earlier Google Fonts variable candidate (commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`, binary SHA-256 `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d`) was rejected after rasterized visual inspection exposed missing glyphs despite successful text extraction. That binary is no longer a runtime asset; failed synthetic PDF/PNG evidence remains labeled in the local receipt.

## Local PDF raster components

pdfjs-dist 6.3.289 independently parses/rasterizes generated PDFs; it is now a runtime dependency for the original stock-label ZPL raster export (previously development-only). Its installed [Apache-2.0 license](licenses/billing/pdfjs-Apache-2.0.txt) and separate notices for CMaps, Foxit/Liberation fonts, ICC data, OpenJPEG, QCMS and JBIG2 are retained under `docs/licenses/billing/`. The renderer imports the installed package without copying vendor implementation into application source; shipping the installed assets still requires their respective terms. Exact license files, rather than default-branch labels, remain the source.

@napi-rs/canvas 1.0.9 now provides runtime raster output for the stock-label ZPL export as well as independent test rendering. Its installed [MIT wrapper notice](licenses/billing/napi-canvas-MIT.txt), Copyright 2020 lynweklm@gmail.com, is retained. Native platform/Skia dependency distribution remains a separate packaging review; no binary runtime deployment has been authorized. This inventory covers this checkpoint's additions, not a certified license audit of all application dependencies.

## Stock QR label checkpoint — 2026-10-01

Runtime QR encoding uses [node-qrcode](https://github.com/soldair/node-qrcode); independent development-only pixel decoding uses [jsQR](https://github.com/cozmo/jsQR). Added locked packages and their actual installed license texts were inspected and copied unchanged below. QR PDFs reuse the static Noto Sans font and PDF components already inventoried above. No project publication or complete distribution license audit is implied.

The installed dijkstrajs notice includes Wyatt Baldwin's copyright, an MIT reference/link and the disclaimer, but omits the full standalone permission grant. Its exact notice is retained. Complete license provenance and distribution qualification remain pending; a package manifest label alone does not settle that review.

The installed dijkstrajs notice identifies Wyatt Baldwin's copyright and MIT licensing and includes the disclaimer, but refers to an external MIT text instead of containing the full permission grant. Its actual notice is preserved unchanged; complete source/provenance and distribution qualification remains open.

| Added exact package | Declared license | Retained actual text |
| --- | --- | --- |
| @types/qrcode 1.5.6 | MIT | [Actual installed text](licenses/labels/@types-qrcode-LICENSE.txt) |
| ansi-regex 5.0.1 | MIT | [Actual installed text](licenses/labels/ansi-regex-license.txt) |
| ansi-styles 4.3.0 | MIT | [Actual installed text](licenses/labels/ansi-styles-license.txt) |
| camelcase 5.3.1 | MIT | [Actual installed text](licenses/labels/camelcase-license.txt) |
| cliui 6.0.0 | ISC | [Actual installed text](licenses/labels/cliui-LICENSE.txt.txt) |
| color-convert 2.0.1 | MIT | [Actual installed text](licenses/labels/color-convert-LICENSE.txt) |
| color-name 1.1.4 | MIT | [Actual installed text](licenses/labels/color-name-LICENSE.txt) |
| decamelize 1.2.0 | MIT | [Actual installed text](licenses/labels/decamelize-license.txt) |
| dijkstrajs 1.0.3 | MIT | [Actual installed text](licenses/labels/dijkstrajs-LICENSE.md.txt) |
| emoji-regex 8.0.0 | MIT | [Actual installed text](licenses/labels/emoji-regex-LICENSE-MIT.txt.txt) |
| find-up 4.1.0 | MIT | [Actual installed text](licenses/labels/find-up-license.txt) |
| get-caller-file 2.0.5 | ISC | [Actual installed text](licenses/labels/get-caller-file-LICENSE.md.txt) |
| is-fullwidth-code-point 3.0.0 | MIT | [Actual installed text](licenses/labels/is-fullwidth-code-point-license.txt) |
| jsqr 1.4.0 | Apache-2.0 | [Actual installed text](licenses/labels/jsqr-LICENSE.txt) |
| locate-path 5.0.0 | MIT | [Actual installed text](licenses/labels/locate-path-license.txt) |
| p-limit 2.3.0 | MIT | [Actual installed text](licenses/labels/p-limit-license.txt) |
| p-locate 4.1.0 | MIT | [Actual installed text](licenses/labels/p-locate-license.txt) |
| p-try 2.2.0 | MIT | [Actual installed text](licenses/labels/p-try-license.txt) |
| path-exists 4.0.0 | MIT | [Actual installed text](licenses/labels/path-exists-license.txt) |
| pngjs 5.0.0 | MIT | [Actual installed text](licenses/labels/pngjs-LICENSE.txt) |
| qrcode 1.5.4 | MIT | [Actual installed text](licenses/labels/qrcode-license.txt) |
| require-directory 2.1.1 | MIT | [Actual installed text](licenses/labels/require-directory-LICENSE.txt) |
| require-main-filename 2.0.0 | ISC | [Actual installed text](licenses/labels/require-main-filename-LICENSE.txt.txt) |
| set-blocking 2.0.0 | ISC | [Actual installed text](licenses/labels/set-blocking-LICENSE.txt.txt) |
| string-width 4.2.3 | MIT | [Actual installed text](licenses/labels/string-width-license.txt) |
| strip-ansi 6.0.1 | MIT | [Actual installed text](licenses/labels/strip-ansi-license.txt) |
| which-module 2.0.1 | ISC | [Actual installed text](licenses/labels/which-module-LICENSE.txt) |
| wrap-ansi 6.2.0 | MIT | [Actual installed text](licenses/labels/wrap-ansi-license.txt) |
| y18n 4.0.3 | ISC | [Actual installed text](licenses/labels/y18n-LICENSE.txt) |
| yargs 15.4.1 | MIT | [Actual installed text](licenses/labels/yargs-LICENSE.txt) |
| yargs-parser 18.1.3 | ISC | [Actual installed text](licenses/labels/yargs-parser-LICENSE.txt.txt) |


The ZPL checkpoint changes only dependency classification: exact package versions, resolution URLs and integrity values remain unchanged. Installed pdfjs-dist and canvas license texts were re-read and match the retained notices. A production-only offline install and native rendering are checked on macOS arm64; Linux, Windows, other architectures and full transitive/native distribution provenance remain unqualified. No deployment or publication is authorized.
