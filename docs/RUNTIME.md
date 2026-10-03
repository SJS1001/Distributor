# Runtime installation and local verification

The API and foreground operator commands run TypeScript through pinned `tsx` 4.23.15. It is a runtime dependency; omitting development packages must not remove it. Its esbuild dependency and applicable platform binary must also be present. Node must meet `package.json`'s Node 24.16-or-later, below-25 engine range. Actual operating system, architecture and native dependency qualification remains required.

Build the browser application in a development installation:

```sh
npm ci
NODE_ENV=production npm run build
```

A separate runtime directory needs the matching `package.json`, `package-lock.json`, complete `src/` tree (including the schema baseline, shared contracts, static font and license), generated `dist/`, retained dependency/font notices and this runbook. Keep paths intact: server imports and font reads depend on their relative locations. Include `scripts/verify_runtime.mjs` if retaining the verification command, which requires development tools to rebuild the browser application. A runtime-only installation cannot run the Vite build, type checker or browser tests.

Install the locked runtime packages in that separate directory:

```sh
npm ci --omit=dev --no-audit --no-fund
```

This installation command may fetch dependencies. Preserve install scripts and optional packages: esbuild selects its executable for the actual platform, and canvas requires the matching native package. An offline installation requires those exact packages already in the npm cache. Do not copy another operating system's `node_modules` or substitute packages when the cache is incomplete. Full transitive/native provenance and redistribution review remain open; see [retained notices](THIRD-PARTY-NOTICES.md).

Export the reviewed runtime configuration; `.env.example` is a reference and is not loaded automatically. Each process needs the same database, region and optional-event schema profile. Use separate CA/CAD and US/USD stores. For an empty store, run `npm run bootstrap` with an administrator password supplied through protected stdin, then `npm start` from the runtime directory. A populated store refuses a second bootstrap. Follow [user access](USER-ACCESS.md), [schema startup](SCHEMA-UPGRADES.md), [provider configuration](PROVIDERS.md) and [recovery](RECOVERY.md) before operating on existing data. Do not use the synthetic demo for a customer installation.

`npm start` is the API and static browser server. `npm run worker` and `npm run events:worker` are separate bounded foreground commands; startup does not schedule them. Provider, carrier and browser authorization processing must remain disabled until separately authorized and qualified. Provider CLI loading is not proof of credentials, vendor acceptance or live processing. No CI workflow, service manager or deployment is installed by these instructions.

The API process runs local maintenance once per minute after startup: at most 100 expired authenticator-enrollment bundles and at most 100 expired/interrupted QuickBooks authorization attempts per buyer/organization scope per cycle. Enrollment and authorization cleanup catch storage failures independently and retries on the next cycle with a redacted message; neither contacts a provider. Startup also processes one batch under validated schema initialization. These bounds limit changed rows, not query cost; large-store throughput, clock trust and retention remain unqualified. See [authorization maintenance](PROVIDERS.md#local-authorization-expiry-maintenance).

## Repeatable workstation check

From a development checkout with locked dependencies and an already populated npm cache:

```sh
npm run verify:runtime
```

This foreground check builds a production browser bundle in its own private temporary directory without modifying the checkout's `dist/`, copies the required package inputs to a fresh private temporary directory, installs with `npm ci --omit=dev --offline`, then verifies that development tools are absent. Child processes receive a restricted environment and PATH, with provider/carrier processing disabled and no inherited database, credentials, Node preload options or workspace executable fallback. HTTP requests use only loopback. No customer store, provider, printer or CI runner is involved. npm install scripts from the existing locked dependencies still execute locally.

On the actual workstation platform it checks independent synthetic CA and US bootstrap, exact current schema inspection, disabled-provider and disabled-event-worker refusal, explicit bounded local event execution, credential/authorization CLI usage refusal, two `npm start` cycles, served browser asset hashes, authentication/session revocation, owning warehouse/catalog/procurement receipt commands and conserved stock. PDF and both ZPL densities must download through the authenticated API, match retained hashes and replay the same prepared identities after a real process restart. The runtime recovery CLI must create and restore a separately encrypted synthetic archive and expose the restored current schema/provider hold.

The check supports POSIX process groups on macOS/Linux; Windows remains unqualified. Each server must terminate without forced killing or surviving descendants. This is a small functional packaging check, not a load, RPO/RTO, crash-recovery, restore-fidelity or physical-device acceptance test. Serving a built asset does not prove browser usability; use the separate browser suite for that evidence.

Success and failure retain a private temporary installation, synthetic databases, hash-bearing receipt and command logs; the final line identifies `receipt.json`. Passwords, session tokens and backup keys are generated for the run and are not logged. A failure exits nonzero; inspect the receipt and logs before repeating. Offline cache failure is not a successful runtime check. Temporary files are not a durable evidence archive; retain approved receipts separately and remove the temporary directory when its evidence is no longer needed. All product gates remain NOT VERIFIED.

Organization-only browser authorization can start with its separately validated dedicated configuration and no buyer-provider credentials. It grants no buyer payment/accounting delivery. The organization flag remains disabled by default; the preview and isolated runtime check explicitly disable it. See [organization authorization](ORGANIZATION-LEDGER-AUTHORIZATION.md#organization-http-controls) for exact configuration, dedicated browser review and remaining actual provider qualification. [Native organization revocation](ORGANIZATION-LEDGER-REVOCATION.md) has separate schema-14 receipts and offline review, with protected operator, authenticated HTTP and dedicated Billing browser controls. Browser history recovery and offline external-outcome review retain the original receipt; startup never invokes revocation.

The production package also includes `provider:ledger-revoke` for dedicated organization revocation. The isolated runtime check exercises missing-command and default-disabled outbound refusals in each region; it makes no provider request. Protected command behavior is described in [organization revocation](ORGANIZATION-LEDGER-REVOCATION.md#protected-operator-commands).

The production package includes `provider:ledger-journal` for one explicitly selected native journal status/write/lookup operation. The isolated runtime check exercises missing-command and default-disabled write/lookup refusals in both regions, without provider IO. See [protected journal commands](STOCK-JOURNAL-TRANSPORT.md#protected-foreground-operator-commands) for bounded input, current authority, offline status and uncertainty handling.
