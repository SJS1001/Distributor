# Latest committed release deployed — 2026-10-08

The owner explicitly requested deployment before further Orders layout work. Committed application source `d0886bc8381e6f6ab5dc0a64462485a84915c4bc` is now serving at https://dstrbtr.ca/. This supersedes the schema32 icon-toolbar release. Public, administration and customer layout updates, warranty registration and separate return policy, and the whole-system audit corrections are included. The newly requested Orders fulfillment-button/info-bubble change has not been implemented and is not part of this release.

## Release identity and installation

- Image: `registry.fly.io/distributor-ca-sjs1001:audit33-20261008`
- Registry digest: `sha256:3ac59426fd5d144168dbbe018336c94a9d9f2f9da4b69de658d7f9e2b4011e32`
- Machine: `817052c44d9028`, Toronto `yyz`; existing encrypted volume retained.
- Schema: 33, CA, event reports enabled; fingerprint `a0d3fbcc81da4d138eb9d4be40483775796fa937d9d18094274b744eab71509c`.
- Final Machine configuration differs from the original only in image. Integrations remain disabled; existing secrets and pilot access configuration are retained. No new Machine, provider, CI job or remote builder was created.

The image was built locally for Linux/amd64 from a clean Git archive of the full source SHA. All 536 source, package, runtime/license and compiled files match the running Machine. Of these, 513 source/package/license/entrypoint files match the clean committed archive; all 23 served HTML/build assets match image bytes. HTTPS `/api/health` returns `ok`, CA, and the Machine service check passes.

## Backup, migration and preservation

Application writers were stopped for a maintenance window. An encrypted schema32 backup was downloaded and restored using the pinned old image with Docker networking disabled. Restored integrity, foreign keys, recovery hold and session invalidation checks passed. Protected keys, archives, database copies and detailed artifacts remain excluded from Git.

A native schema32→33 upgrade created a separate candidate. All 5,877 existing rows across 195 tables were preserved, with only the required schema-version/fingerprint update. Six newly introduced warranty tables were empty. Constructing the new Application without startup maintenance changed no rows. The original database and committed sidecar bytes remained unchanged throughout candidate validation. Candidate integrity and foreign keys passed before activation and again on the active database after startup.

- Upgrade receipt SHA-256: `cbba49b291526a30c51560f1452643dfa0692501e61d005519b097b14789f573`
- Pre-activation source database SHA-256: `8cd76d25e4464dcb4cf05d68ca6e20e6d66a19badf124c23cd086f01433a170d`
- Activated candidate SHA-256 before application writes: `237d5052d7cabc3e6e62a5f3bc86818f912b160a22f5bd3b0001f5f59ef0f41c`
- Encrypted backup SHA-256: `835ec8ba09827abb4c6ac095dd5b60a1736a44e19ec609d86efbc3dd8d201a70`

The old database and sidecars are retained at `/data/rollback-schema32-icons-20261008` with the matching `icon-toolbar32-20261007` image/digest. An image-only downgrade is unsafe after this schema upgrade. Reconcile post-activation activity before restoring the matching old database/image pair; never overwrite newer business data blindly.

One backup preflight attempt occurred before the maintenance Machine had finished restarting and reported no started VM. No backup or database change happened on that attempt; its log is retained. The subsequent preflight and isolated restore passed. A status invocation using an unsupported `--json` flag also failed without changing the deployment; final status was obtained through `flyctl status --json`.

## Verification and limits

Fresh workstation checks on this committed source: typecheck, both schema33 upgrade/recovery configurations (2/2), and warranty registration/return-policy browser journeys in Chromium and WebKit (2/2) pass. The broader source audit and its qualified historical results remain in [the system review](../audits/SYSTEM-REVIEW-2026-10-07.md); those are not represented as freshly rerun live business mutations.

Actual HTTPS verification traversed all 15 administration and 6 customer pages in Chromium and WebKit at 1440px and 390px: 84 checks, no JavaScript errors, no horizontal overflow, and no attempted business writes. Sign-in/sign-out and signed-out session boundaries passed. Mutating API requests were blocked except login/logout. Public HTTPS acceptance also passes 24 checks across both engines and widths: carousel pause/next/previous, product entrance, catalog, application, customer/staff sign-in and activation entrances. These checks verify rendering and navigation; they do not submit live applications or activations.

This deployment verifies the existing Canadian pilot, not infrastructure residency qualification or a product gate. Physical devices, real providers and operator acceptance remain unverified. Live business mutations such as receiving, shipping or submitting warranty claims were deliberately not performed; their evidence comes from isolated workstation fixtures. Demo/seed records remain in place.
