# Local captured refund projection receipt

Exact tested code/test/report commit `d8e30aac7974455e687ff7d3db145d322f8310e8`, based on published `fdd47c64cda43841ee330bf21a77fe8ee3a61a71`. All658 frozen inputs match committed blobs. [Input manifest](LOCAL-REFUND-NATIVE-PROJECTION-2026-10-03.json), SHA256 `286917994011f0439a5ad64b5a8300e693952682c47e34d3f6adcb421f221e49`. Direct workstation Darwin arm64, Node24.16.0, SQLite3.53.0, OpenSSL3.5.6; synthetic isolated databases, no CI or provider IO.

Full native regression3886/3886pass, zero failures/cancellations/skips/todos,97797.050459ms, exit0. Five affected suites203/203pass,260.971417ms,exit0, including26 new projection cases. Complete TypeScript, owned Prettier and whitespace checks pass. Cloud report retains its earlier eight baseline failures; root has no failed projection replay. Cloud requested Astra/high; effective setting unverified.

The reviewed cloud return4908cad90aef66176458883e6d6e7a1b402a9d87 at excluded e8829bb778e4fe9a9b0ee9752afa5e0d0fae7c40 was independently captured: raw30790bytes SHA256d08e3f7da7b4dab7b12e6e40c2708d48c88801fbb442e0091ff6c5c3e1031663, gzip9203bytes SHA2569fb81b250e058c3ecfd0375c0ddad6d940919c13c1996f8ee6bd003369701a3f. Encoded/decoded chunks, compression, raw patch, exclusive three paths, applicability and final file hashes all verified. No cloud parent imported. [Historical cloud report](../RESTORE-OFFLINE-REFUND-NATIVE-PROJECTION-2026-10-03.md).

The comparison now returns the strict captured refund request and candidate history, detached and frozen, preserving existing digest/body bytes and fixed single-use private parser behavior. Tests use actual private capture, remove input files after capture and check no reopen, clearing of captured buffers, hostile inputs, mismatches, all three native currency profiles and golden existing hashes. These are captured assertions, not provider truth, provenance or import/retry/release authority. Static qualified root composition and Integration result recovery remain incomplete. All product gates remain NOT VERIFIED; accepted baseline D-001–D-041 unchanged and optional042–044 deferred. Technical/infrastructure, finance/product, providers/logistics and QA/operators still own their documented real qualification and acceptance inputs.

Ignored local logs:

| Log                                          | SHA256                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `projection-return-focused-2026-10-03.log`   | `7d5e00672e22e8000915db581014f29b7c823149fe99c23eae5eb141c76e756b` |
| `projection-return-full-2026-10-03.log`      | `ef33e5b4c1d52eb0694de418e53cff9e6d4ceee8caea221aa9603c0df536c1ad` |
| `projection-return-typecheck-2026-10-03.log` | `8a702e6f87c8a6ca129035a44568229aa0a0ce49ce48d85c056ac1c3a87c0c57` |

Self-review: complete exact source/new test/report delta reviewed; old tests, schema, dependencies, private parser and public routes preserved. No private input or runtime files published. Closing documentation has a separate structural check; structure alone cannot qualify any product gate.
