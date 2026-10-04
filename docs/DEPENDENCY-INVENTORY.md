# Reproducible dependency notice inventory

Recorded 2026-10-04 for D-002/D-037. The [locked inventory](licenses/LOCKED-INVENTORY-2026-10-04.json) covers every non-root package entry in the current npm lockfile and hashes actual installed package manifests and separately named notice files. The script reads files without executing dependency code or making network requests. It reports missing required packages, incomplete installed packages, version/name discrepancies and missing declared licenses; those discrepancies give the CLI a nonzero exit status. It refuses linked package directories/manifests and Windows separators in locked package paths, and skips linked notice files. Run it against a stationary installation; these checks do not protect against concurrent filesystem replacement.

Run from the repository:

```sh
node scripts/verify_licenses.mjs > local-evidence/dependency-inventory.json
node --test scripts/verify_licenses.test.mjs
```

The committed snapshot is specific to macOS arm64 and lockfile SHA-256 `9f40578e1ae7c3556f5d40c22b47b4e6f4ffb72dbdf8ad14c3ce80973a90e206`. It records **226 locked packages, 148 installed, 78 uninstalled optional packages, 159 named notice files and zero discrepancies**. Independent executions produced identical snapshot bytes. Eight fixture tests pass: exact-byte hashes, required/optional distinctions, mismatched installed versions, nested scoped ownership, linked-file/path refusal, incomplete optional packages, linked-manifest refusal and platform-independent Windows-separator refusal. The latter two regressions first failed on the previous script and now pass; the original six-pass receipt remains historical. No dependency version or runtime application behavior changed.

Five installed packages lack separately named notices. The [primary-source provenance review](research/DEPENDENCY-PROVENANCE-2026-10-04.md) checks their exact published artifacts plus dijkstrajs and the canvas wrapper, and gives a recommendation for each:

| Package                               | Next qualification action                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @esbuild/darwin-arm64 0.28.2          | Retain the pinned parent MIT notice; qualify compiled Go/runtime dependency notices for the actual distribution.                                                       |
| @napi-rs/canvas-darwin-arm64 1.0.9    | Retain wrapper and pinned Skia notices; qualify the actual archives, Rust crates, codecs and enabled native components.                                                |
| @pdf-lib/fontkit 1.1.1                | Obtain the exact published source/build mapping and fork grant; reconcile the existing embedded third-party notices.                                                   |
| @rolldown/binding-darwin-arm64 1.2.12 | Retain the pinned root and third-party notices; qualify complete native/crate distribution coverage.                                                                   |
| abstract-logging 2.0.1                | Preserve the exact README reference and recovered historical service inputs; qualify the actual grant/distribution notice without inventing a rendered copyright year. |

Dijkstrajs's exact upstream notice and current OSI MIT reference are traced separately in that report. Its original copyright/reference/disclaimer remains unchanged. The new pinned Skia and rolldown notice texts supplement the [existing retained notices](THIRD-PARTY-NOTICES.md).

The [external-reference follow-up](research/LICENSE-REFERENCE-FOLLOWUP-2026-10-04.md) recovers abstract-logging's referenced author record and MIT template from a service source snapshot preceding npm publication, retaining the original inputs unchanged. Historical deployed/rendered responses remain unverified. Additional exact Fontkit archive/source-map/release inspection did not recover its missing source/grant relationship.

This inventory records artifact identity and attribution gaps; it does not certify redistribution rights. Named-file hashes do not scan embedded bundle comments, establish native binary provenance, verify attestation signatures, retain every notice in a distribution or cover the 78 uninstalled platform packages. A production-only installation produces a different local inventory, and other operating systems/architectures require their own actual files. The full transitive/native license review and Distributor product license remain unresolved; no task or gate is marked verified.
