# Bounded dependency provenance review

Reviewed 2026-10-04 against the installed packages and lockfile SHA-256 `9f40578e1ae7c3556f5d40c22b47b4e6f4ffb72dbdf8ad14c3ce80973a90e206`. This supplements [retained notices](../THIRD-PARTY-NOTICES.md); it does not select a Distributor license, certify redistribution compliance or verify a product gate. Source, tests, dependency versions and existing notices were unchanged. No CI, provider operation or full test replay was performed.

## Artifact checks

For each package below, downloaded the exact npm tarball into memory, calculated SHA-512 and compared it with both registry and lockfile integrity. Compared every regular tarball file byte-for-byte with its installed counterpart: all matched. This establishes artifact identity, not rights or reproducible builds. Registry metadata and decoded npm SLSA statements were read as primary-source evidence; their signatures/certificate chains were **not independently cryptographically verified**.

| Exact package | Compared regular files | Upstream mapping and notice finding |
| --- | ---: | --- |
| dijkstrajs 1.0.3 | 7 | Registry `gitHead` equals tag `v1.0.3`; actual incomplete notice matches that commit. |
| @pdf-lib/fontkit 1.1.1 | 17 | No registry `gitHead`; no standalone license in exact tarball. Exact source mapping remains open. |
| @esbuild/darwin-arm64 0.28.2 | 3 | Registry `gitHead`, tag and decoded provenance identify one commit; platform tarball has no license. |
| @napi-rs/canvas 1.0.9 | 10 | Registry `gitHead`, tag and decoded provenance identify one commit; wrapper MIT notice matches it. |
| @napi-rs/canvas-darwin-arm64 1.0.9 | 3 | Decoded provenance identifies the same canvas commit; platform tarball has no license. |
| abstract-logging 2.0.1 | 4 | Registry `gitHead` identifies source; license is linked in README rather than a standalone file. |
| @rolldown/binding-darwin-arm64 1.2.12 | 3 | Decoded provenance identifies a source commit; platform tarball has no license. |

Exact registry records: [dijkstrajs](https://registry.npmjs.org/dijkstrajs/1.0.3), [fontkit](https://registry.npmjs.org/@pdf-lib%2ffontkit/1.1.1), [esbuild platform](https://registry.npmjs.org/@esbuild%2fdarwin-arm64/0.28.2), [canvas wrapper](https://registry.npmjs.org/@napi-rs%2fcanvas/1.0.9), [canvas platform](https://registry.npmjs.org/@napi-rs%2fcanvas-darwin-arm64/1.0.9), [abstract-logging](https://registry.npmjs.org/abstract-logging/2.0.1), [rolldown platform](https://registry.npmjs.org/@rolldown%2fbinding-darwin-arm64/1.2.12).

## dijkstrajs: external MIT reference identified

Exact release commit `49ad1ecd5c519281ee3c4711bb78db4d96e19c83` contains the same [LICENSE.md](https://github.com/tcort/dijkstrajs/blob/49ad1ecd5c519281ee3c4711bb78db4d96e19c83/LICENSE.md) as the installed and retained copy: SHA-256 `c46324e45a005413535a6fb7a97e9eacd3cc6bf30335b7d5c10b8ee3af9e60c2`. It identifies Wyatt Baldwin, 2008, MIT licensing and the historical OSI MIT URL, but omits the permission paragraph.

The [current OSI MIT text](https://opensource.org/license/mit) supplies the standard grant and inclusion condition associated with that reference. The old HTTPS URL returned 403 in this review; its historical response was not recovered. This narrows the gap to retaining the referenced standard terms alongside the unchanged package copyright/notice. Do not replace the notice, substitute copyright holders into a template or describe a newly drafted grant as upstream text. Complete package provenance/distribution qualification remains open.

## Fontkit: exact release-source gap remains

The exact tarball has MIT package metadata and a README license statement, plus the previously retained embedded Node/Joyent, base64-arraybuffer and Brotli notices. Registry metadata supplies no `gitHead`, and the [fork tags](https://api.github.com/repos/Hopding/fontkit/tags?per_page=100) checked contain no `v1.1.1` release tag. The inspected default-branch commit `72b8e42bd6a398d496a63a6d483eabeed43861fb` declares **1.1.0**, not the installed 1.1.1, in its [package manifest](https://github.com/Hopding/fontkit/blob/72b8e42bd6a398d496a63a6d483eabeed43861fb/package.json); its tree has no root license. Test-font license files are not a software grant.

Recommendation: obtain the published 1.1.1 source/build mapping and fork grant from the maintainer, then reconcile bundled dependency notices against that build. An upstream foliojs license or current branch's MIT label alone does not close the fork/release gap. Preserve the existing metadata, README and embedded notices unchanged.

## esbuild: source mapping found; binary obligations still need coverage

Commit `609683d892977362a0f99026cb74b96263d728a9` equals tag `v0.28.2` and npm `gitHead`. Its [MIT license](https://github.com/evanw/esbuild/blob/609683d892977362a0f99026cb74b96263d728a9/LICENSE.md) matches the existing [retained esbuild notice](../licenses/runtime/esbuild-MIT.txt), SHA-256 `b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681`. The [decoded provenance source](https://registry.npmjs.org/-/npm/v1/attestations/@esbuild%2fdarwin-arm64@0.28.2) names that commit and a tarball subject digest matching the downloaded artifact.

This supports retaining the parent notice with the platform executable despite the platform package's missing copy. It does not establish complete native notices: the pinned [go.mod](https://github.com/evanw/esbuild/blob/609683d892977362a0f99026cb74b96263d728a9/go.mod) includes `golang.org/x/sys` commit `c0bba94af5f8`; Go runtime/toolchain and compiled dependency coverage need a distribution-specific check. No reproducible binary build or toolchain inventory was performed.

## Canvas: wrapper, native publication and Skia distinguished

Commit `b2723ffae4e74e8c9df752902b137ec4061530e9` equals tag `v1.0.9` and wrapper npm `gitHead`. Its [MIT license](https://github.com/Brooooooklyn/canvas/blob/b2723ffae4e74e8c9df752902b137ec4061530e9/LICENSE) matches the retained wrapper notice, SHA-256 `8802fecf9da4367bc23bcf20b21cc143785fc6c92b152f3fa7fbe6ce08d344d6`. [Wrapper](https://registry.npmjs.org/-/npm/v1/attestations/@napi-rs%2fcanvas@1.0.9) and [native package](https://registry.npmjs.org/-/npm/v1/attestations/@napi-rs%2fcanvas-darwin-arm64@1.0.9) statements identify that same source and match their tarball digest subjects. Native binary SHA-256: `d88cb94e049adb94980449461a155bc849cd4889a870434a1059d28f26612aec`.

The release [tree](https://api.github.com/repos/Brooooooklyn/canvas/git/trees/b2723ffae4e74e8c9df752902b137ec4061530e9?recursive=1) pins Google Skia at `a9c42c9fce77cd748805df0ec67ef5718800b1e9`. Its [BSD license](https://github.com/google/skia/blob/a9c42c9fce77cd748805df0ec67ef5718800b1e9/LICENSE), Copyright 2011 Google Inc., requires reproduction in binary distribution materials. An unchanged [copy is retained](../licenses/provenance/skia-a9c42c9-LICENSE.txt), SHA-256 `5f787c1dee3c56547f09ccc2906ab5f5293c4d8dd6c8654e573216c38e908dbd`.

This is a source pin, not proof that every linked Skia archive was rebuilt from it. The [release workflow](https://github.com/Brooooooklyn/canvas/blob/b2723ffae4e74e8c9df752902b137ec4061530e9/.github/workflows/CI.yaml), [Skia build script](https://github.com/Brooooooklyn/canvas/blob/b2723ffae4e74e8c9df752902b137ec4061530e9/scripts/build-skia.js), [Skia DEPS](https://github.com/google/skia/blob/a9c42c9fce77cd748805df0ec67ef5718800b1e9/DEPS) and [Rust manifest](https://github.com/Brooooooklyn/canvas/blob/b2723ffae4e74e8c9df752902b137ec4061530e9/Cargo.toml) expose additional native components. Recommendation: qualify the actual distributed build's archives, Rust crates, codecs and enabled Skia third parties; retain their applicable notices before binary distribution. The wrapper's MIT label cannot cover that whole graph. Other platform binaries were not examined.

## Additional installed packages without standalone notices

**abstract-logging 2.0.1:** release [README](https://github.com/jsumners/abstract-logging/blob/80dfaef91ee87008f4ed2b6e78921d383bccd406/Readme.md) matches installed bytes and explicitly links [James Sumners' MIT page](https://jsumners.mit-license.org/). That page returned 403, so its text/copyright could not be independently recovered. Retain the actual README reference and obtain a pinned original grant before claiming complete notice coverage; do not invent the year or copy another author's MIT notice.

**@rolldown/binding-darwin-arm64 1.2.12:** [decoded provenance](https://registry.npmjs.org/-/npm/v1/attestations/@rolldown%2fbinding-darwin-arm64@1.2.12) names commit `45e407b177f5885d04a9795f37f8be71d91f6f17` and the matching tarball subject. Its [root LICENSE](https://github.com/rolldown/rolldown/blob/45e407b177f5885d04a9795f37f8be71d91f6f17/LICENSE) identifies VoidZero Inc. & Contributors, 2024-present, and references separate third-party terms. Retained unchanged [root license](../licenses/provenance/rolldown-45e407b-LICENSE.txt), SHA-256 `23ecfff35a5a2e80d92142f75228912c3b1abc4b5a8337a821ff4397e2f9f734`, and [pinned THIRD-PARTY-LICENSE](../licenses/provenance/rolldown-45e407b-THIRD-PARTY-LICENSE.txt), SHA-256 `a877291d800ed43692f3f9ae09d8e01cc6f7293ad39d43896059c188ffbb8b7c`. The root file's original default-branch link remains unchanged; the companion copy was fetched from the exact commit. These improve attribution but do not certify complete native/crate distribution coverage.

## Result and limits

Two absent platform-package notices now have exact upstream source/parent-license evidence (esbuild and rolldown). Canvas has a native publication-source link and an additional pinned Skia notice. Dijkstrajs has a traceable external MIT reference. Fontkit's exact source/grant and abstract-logging's inaccessible external grant remain unresolved. None of these observations closes the full transitive/native redistribution review. Existing notice files remain intact; the three new notices contain only original upstream text.
