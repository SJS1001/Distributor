# Organization credentials for stock journals

D-009/D-034/D-036/D-039 engineering work. The native vault now supports a separate organization-owned QuickBooks sandbox credential binding for `stock-cost-journal`. It shares the existing encrypted vault, key rotation and held-restore invalidation. The native journal queue and an explicitly invoked, disabled transport now use this scope. No polling worker or provider revocation is connected. Dedicated default-disabled login-bound authorization HTTP controls now exist; their callback UI remains pending. All tasks and gates remain NOT VERIFIED.

## Scope and current authority

Use `app.providerCredentials.ledger` with a binding containing `id`, `orgId`, `workerUserId`, `realm` and `clientId`. The realm is a decimal string beginning with 1–9, at most 40 digits. The company and client are immutable after creating a durable binding. A new company/client requires a separately reviewed binding. The worker must remain an active, unbound finance staff member or administrator without a required password change.

Organization and buyer credentials may share the same external binding ID while retaining independent records, revisions and token material. Organization IDs are derived within a reserved namespace; buyer credential, authorization and revocation APIs refuse that namespace. Authenticated encryption binds the organization, internal binding, company, client, revision and organization journal purpose. Copying ciphertext from a buyer binding, another organization or another revision does not grant access. These are native boundaries, not protection from an operator who controls the process, keys and database.

Installation and token access require the exact prospective [organization permission stamp](ORGANIZATION-LEDGER-RESIDENCY.md) for the current company and accepted terms. Every field is compared, including purpose, environment, region, disclosure hash and choice revision. Buyer consent cannot substitute. Withdrawal, terms replacement or a new choice blocks an old stamp. Reacceptance creates a new stamp and never revives old effect authority. A recovery hold blocks installation and access even if consent history still reports eligible acceptance.

`ledger.status(binding)` returns only external binding ID, revision, state and refresh start time; it rechecks the current worker. `ledger.install(binding, revision, tokens, authority)` installs against the exact observed revision, with atomic encryption, audit and consent checks. `ledger.disable(binding, revision)` removes local material and supersedes refresh ownership against the exact revision. Disable remains available to a current qualified worker after withdrawal or during a recovery hold, without a decryption key. It does not confirm provider revocation. Audit failure rolls back installation or disable.

## Refresh and recovery

`await ledger.access(binding, clientSecret, authority)` checks current authority, accepted consent and recovery hold before returning a cached token or claiming refresh. It snapshots caller-owned binding and stamp before asynchronous work. One durable claim permits one refresh exchange across independent applications and OS processes. Tokens never appear in status, audit, command receipts or CLI output.

Refresh rechecks authority before exchange and within the atomic acceptance transaction. The exact claim and credential revision must still be current, the clock must not precede the claim, and the response must arrive within 90 seconds. Withdrawal, changed terms/role, disable, replacement or restore hold refuses a late token. A stale response cannot overwrite a newer installation. Ambiguous or interrupted refresh removes local material for its own claim and requires reviewed reconnection; it never automatically resends the rotating refresh token. Network transport uses the existing sandbox OAuth protocol, whose provider behavior still requires separate qualification.

The existing key rotation includes both scopes, refuses stale keys and preserves scope-authenticated encryption. Encrypted isolated restore erases both scopes' token material while retaining consent and history, and keeps the provider hold. No recovery command authorizes this scope to send. In-flight provider processing cannot be recalled by a later local withdrawal or disable.

## Protected operator CLI

The existing `npm run provider:credentials -- ACTION` supports these additional actions:

| Action | Input and result |
| --- | --- |
| `ledger-status` | No operation body; metadata only |
| `ledger-permission` | No operation body; captures the exact current prospective permission stamp |
| `ledger-install` | Protected non-TTY stdin JSON with exactly `revision`, `tokens`, `authority`; returns metadata |
| `ledger-disable` | Protected non-TTY stdin JSON with exactly `revision`; returns metadata |

Configure `DATABASE_PATH`, regional `DATA_REGION`, `PROVIDER_BINDING_ID`, `PROVIDER_ORG_ID`, `PROVIDER_WORKER_USER_ID`, `QUICKBOOKS_REALM_ID` and `QUICKBOOKS_CLIENT_ID` through the operator's protected environment. Installation additionally requires the current `PROVIDER_ENCRYPTION_KEY`. Token bundles contain access/refresh tokens and their absolute expiry times, including the original hard expiry. Follow the existing [runtime packaging](RUNTIME.md) and [provider operations](PROVIDERS.md) controls. Never put tokens, encryption keys or client secrets in command arguments or committed files.

Stdin is bounded to 32 KB; extra arguments or unknown operation fields refuse. Permission capture and installation are separate operations: installation rechecks current permission atomically. These four actions perform no provider IO and do not require outbound provider processing to be enabled. They authorize no queue, provider account or live delivery. Existing buyer browser authorization and remote revocation controls cannot act on the organization scope.

## Limits and next dependency

Offline token installation does not independently establish the provider account/company, token provenance, consent representative authority, actual residency or current vendor terms. Separate [native organization authorization and protected operator completion](ORGANIZATION-LEDGER-AUTHORIZATION.md) now exchange sandbox codes and verify synthetic CompanyInfo before installing this scope. Login-bound HTTP authorization and local disconnect now exist; dedicated callback UI, remote revocation and actual company/provider qualification remain open. Strict residency requires a qualified compatible path; selecting a region or accepting named exceptions does not establish actual infrastructure or processor residency.

The [native journal queue](STOCK-JOURNAL-DELIVERY.md) now supplies immutable reviews, permanent references, exclusive leases, current source/approval/mapping/period fences, correction ordering and append-only observations. The [explicit disabled transport](STOCK-JOURNAL-TRANSPORT.md) now binds this vault to issued operations with expected-revision token access and synchronous current-revision checks inside native journal transactions. Synthetic interruption and late-response checks are recorded separately; actual provider behavior remains unqualified. Native access alone does not authorize a journal write. Organization native authorization/operator completion and reviewed journal permission replacement now have separate controls and receipts. Login-bound authorization HTTP/local disconnect now exist; dedicated callback UI, remote revocation and actual consent/company/provider qualification remain pending. The [local receipt](evidence/LOCAL-ORGANIZATION-LEDGER-CREDENTIALS-2026-10-03.md) records this vault's historical synthetic verification; no CI job, live provider IO, account, PR, merge or deployment was created.
