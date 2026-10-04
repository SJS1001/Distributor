# Runtime and recovery wiring

Owner direction, 4 October 2026: complete host-independent code wiring and correctness checks now; defer connecting servers and actual infrastructure/provider qualification. This changes the sequence of work, not product-gate acceptance.

Distributor has a Node/Fastify backend, SQLite persistence and a React frontend. The backend owns identity, permissions, catalog, procurement, inventory, ordering, fulfillment, billing, warranty, carriers, provider credentials, accounting handoffs and recovery. The frontend uses the backend's authenticated `/api` routes; development Vite proxies them to port 3000, and the production server serves the built frontend. See [runtime installation](RUNTIME.md) and [implementation status](IMPLEMENTATION.md) for startup and existing limitations.

## Shared composition

`src/server/runtime-application.ts` is the executable composition point. API startup, provider and event workers, bootstrap/demo, credential and authorization operators, ledger revocation, stock-journal transport and the restore operator all use `createRuntimeApplication`. Existing environment settings for those entrypoints are preserved. The isolated application created inside backup restoration deliberately continues to use unconfigured `Application`; it cannot inherit active authority from a source deployment.

`src/server/deployment-host.ts` is the one reviewed static source location for a later host implementation. It currently returns `undefined`. There is no environment-selected module, dynamic import, JSON-selected callback, HTTP activation endpoint or fabricated production adapter. Trusted programmatic callers can inject a typed `RestoreRuntimeConfiguration` for controlled composition. Tests inject synthetic hosts only.

Configuration independently supplies the restore activation adapter and current approver loader, native maintenance-disposition authority, and the five fixed offline host boundaries: failed refund, original journal cancellation, copied original lease retirement, Canada Post member cancellation and paid checkout. The composition connects each coordinator to its actual database and owning modules. Construction does not invoke host controls, provider calls or trust loaders. Native operations retain their existing evidence, current-principal, signature, source-fence and COMMIT checks. Trust is loaded when checked, never cached by composition.

Activation and offline execution remain disabled when their host boundary is absent. Read-only retained-result recovery remains available without a host: it uses current native principals and retained native receipts, makes no external call and cannot enable execution. Execute operations own their outer transaction; the dispatcher wraps only native recovery reads in a transaction.

## Protected operator entrypoint

`npm run recovery:operate -- <action>` accepts one action on argv and one bounded UTF-8 JSON object on noninteractive stdin. Specify an existing single-link regular `DATABASE_PATH` and explicit `DATA_REGION=CA` or `US`. A read-only schema inspection rejects empty, incompatible or wrong-region stores before application construction. The operator checks the pathname's device/inode before and after opening it. Trusted stationary files and ancestor directories remain required; these checks do not defeat a malicious filesystem administrator.

For read-only status, for example:

```sh
printf '{}' | DATABASE_PATH=/approved/private/candidate.db DATA_REGION=CA npm run --silent recovery:operate -- release-status
```

Keep signed requests and evidence references in protected input files or an approved input channel; do not place evidence, tokens, signing keys or credentials in command arguments. The operator does not load signing keys. Input is limited to 1 MiB, depth 32 and 20,000 values; unknown action/fields, accessors, proxies, malformed strings and unsafe property names are rejected before native/host invocation. The CLI validates the request before opening the store.

| Action                                                                                                                | JSON fields                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `release-status`                                                                                                      | Optional `id`; omitted ID inspects the current unresolved/released record |
| `release-prepare`, `release-activate`                                                                                 | `input`: original `{id,dossier,approvals,manifest}`                       |
| `release-approve`                                                                                                     | `id`, `approvals`: independent release approvals                          |
| `release-rollback`, `release-supersede`                                                                               | `id`                                                                      |
| `offline-failed-refund`                                                                                               | `executor`, `envelope`, `approvals`, `manifest`, `reference`              |
| `offline-original-cancellation`                                                                                       | `preparer`, `executor`, `envelope`, `approvals`, `manifest`, `reference`  |
| `offline-original-lease-retirement`                                                                                   | `preparer`, `executor`, `envelope`, `approvals`, `payload`                |
| `offline-canada-post-member`, `offline-checkout-paid`                                                                 | `preparer`, `executor`, `envelope`, `approvals`, `manifest`               |
| `offline-failed-refund-recover`, `offline-canada-post-member-recover`                                                 | `executor`, `envelope`                                                    |
| `offline-original-cancellation-recover`, `offline-original-lease-retirement-recover`, `offline-checkout-paid-recover` | `preparer`, `executor`, `envelope`                                        |

Actor values are native principal locators, not supplied grants. Each underlying operation validates the current actors and its own exact evidence shapes. The dispatcher cannot select arbitrary owners, queries or functions. Release output includes identifiers, state, phase, revision and hashes; offline output includes action, status and result hash. Private dossiers, signatures, receipts, filesystem paths and evidence bodies are excluded from routine output. Errors print a fixed message and a domain error code; inspect retained native state before retrying an uncertain operation.

The restore operator preserves the existing reporting profile and suppresses constructor housekeeping for expired MFA enrollment and customer/organization authorization attempts, as well as audit-order/clock, inventory manifest/cost-sequence, legacy delivery-history and refund-notice backfills. Normal service startup keeps that housekeeping. Expiry and authority checks at use remain enforced. Status/recovery must not quietly change a captured candidate; expired enrollment material still requires separately controlled erasure before returning the candidate to ordinary service.

## Deferred connections

Shared code composition and operator dispatch do not supply real fencing or routing. Implement the selected deployment's adapter and authoritative current-trust/native/offline host services at the static composition point after authentic hosting and authority inputs exist. Then qualify source/candidate writer exclusion, current provider evidence through COMMIT, delayed controls, revocation, interruption, confidential files, actual CA/US processing locations and server operation. The current Purolator contract, actual providers/devices, remaining dependency rights/native distribution and business/load/release acceptance remain separate outstanding work. No server deployment, provider request, CI runner, PR or merge is part of this increment.
