# Organization ledger authorization candidate

D-027/G7/G8 engineering work. All 44 tasks and ten gates remain NOT VERIFIED. This native service is a synthetic-tested sandbox candidate; actual Intuit authorization, vendor terms and residency have not been qualified.

`application.providerCredentials.ledger.authorization` owns a separate organization connection for stock-cost journals. It never converts a buyer account’s acceptance or tokens into organization authority. A current unbound finance worker, exact sandbox company/client/callback binding, expected credential revision, configured encryption key and retained organization permission are required to begin. The returned Intuit URL carries a random ten-minute state value; only its digest and the exact organization permission stamp are retained.

An explicit `complete(binding, attemptId, clientSecret, callbackUrl)` validates the exact callback address, single bounded parameters, state and approved company before claiming the attempt. It exchanges the code once, then reads that sandbox company’s CompanyInfo and checks its ID. The current worker, provider hold, credential revision, permission and claim are checked before outbound requests and again when tokens commit. The organization vault encrypts tokens in its own namespace; installation, completion metadata and audit commit together. Callback URLs, codes, secrets and tokens are never written to attempt metadata or audits.

Only one caller can claim an attempt. Cancellation, a new explicit begin, independent credential changes, consent withdrawal, deadline expiry or a late response prevent installation. Failed or interrupted transmitted exchanges become `unknown` and require inspection and a new explicit connection; the service does not automatically resend. Status and cancellation remain available without the key or current provider permission, subject to the initiating binding and current finance worker. Key rotation covers organizations with pending attempts even when they have no credentials, refuses active exchanges and cancels pending attempts. Restore invalidates pending and exchanging organization attempts.

Schema 13 adds integration-owned organization attempt storage. Exact earlier schemas require the [reviewed fresh-file upgrade](SCHEMA-UPGRADES.md); no automatic in-place migration is authorized. Independent published-version-12 fixtures preserve stock-journal history and all older records across CA/US and both reporting profiles.

The protected operator authorization CLI below is connected. Organization browser callback/session flow and remote revocation remain unconnected. Existing buyer authorization remains separate. No startup request, background polling, live provider call, CI runner, workflow, deployment or account is introduced. The preview has providers disabled. Actual sandbox authorization/company verification, cancellation/revocation outcomes and regional infrastructure remain to be qualified.

See the [native service receipt](evidence/LOCAL-ORGANIZATION-AUTHORIZATION-2026-10-03.md) and [operator CLI receipt](evidence/LOCAL-ORGANIZATION-AUTHORIZATION-CLI-2026-10-03.md). Tests use the existing native service and outbound HTTP seams with synthetic provider responses; they do not prove external provider behavior or product acceptance.

## Protected operator authorization

Use `npm run provider:ledger-authorize -- begin|complete|status|cancel` with exactly one action and a protected noninteractive JSON file on stdin. Configure `DATABASE_PATH`, `DATA_REGION`, `PROVIDER_BINDING_ID`, `PROVIDER_ORG_ID`, `PROVIDER_WORKER_USER_ID`, `QUICKBOOKS_REALM_ID`, `QUICKBOOKS_CLIENT_ID` and `QUICKBOOKS_REDIRECT_URI` through the operator's protected environment. These values identify an organization finance worker and exact approved sandbox company/client/callback. Buyer account IDs and buyer permission cannot authorize this connection.

| Action | Exact stdin fields | Additional configuration | Behavior |
| --- | --- | --- | --- |
| `begin` | `revision`, `authority` | Current `PROVIDER_ENCRYPTION_KEY` | Rechecks the exact reviewed organization ledger permission and expected credential revision; returns the private Intuit URL and attempt ID. No provider request. |
| `complete` | `attemptId`, `callbackUrl` | `PROVIDERS_ENABLED=true`, `QUICKBOOKS_CLIENT_SECRET`, current `PROVIDER_ENCRYPTION_KEY` | One explicit sandbox code exchange and CompanyInfo proof under native current-authority fences. Returns redacted completion metadata. |
| `status` | `attemptId` | No encryption key or client secret | Reads metadata for this exact binding under current finance authority. No authorization URL or provider request. |
| `cancel` | `attemptId` | No encryption key or client secret | Cancels a pending/exchanging attempt locally under current finance authority. No remote revocation or provider request. |

Capture `authority` separately with the existing protected `provider:credentials ledger-permission` operation described in [organization credential controls](ORGANIZATION-LEDGER-CREDENTIALS.md). Review its exact organization/company/region/terms/choice revision before using it. Do not substitute current permission automatically after it changes. `revision` is the reviewed organization credential revision, initially zero only when no prior binding exists.

Protect input/output files with mode 600 and a private operator directory. The begin result contains a one-time authorization state in the URL; preserve it privately while the operator explicitly approves the intended sandbox company. Capture the full callback address from that approved interaction and supply it only in protected stdin. This CLI does not host or automate a browser callback receiver. Never put callback URLs, codes, encryption keys or client secrets in arguments, committed files, public receipts or shared logs. Synthetic local verification does not authorize an actual provider interaction.

For example, with the protected environment already configured and separately reviewed private input files:

```sh
npm run --silent provider:ledger-authorize -- begin < /private/operator/begin.json > /private/operator/begin-result.json
npm run --silent provider:ledger-authorize -- status < /private/operator/status.json
npm run --silent provider:ledger-authorize -- complete < /private/operator/complete.json
npm run --silent provider:ledger-authorize -- cancel < /private/operator/status.json
```

These are separate explicit operations, not an automatic sequence. Protected stdin is limited to 32,768 raw bytes and valid UTF-8; completion callbacks are limited to 16,384 bytes. Malformed object shapes, surplus fields/arguments and invalid basic values refuse before opening the store. Errors expose a domain code and generic guidance, never input secrets. Status/cancellation deliberately ignore an ambient encryption key so invalid or unavailable keys do not prevent metadata inspection or local cancellation. Current finance authority and initiating binding still apply after provider permission withdrawal.

On a failed or interrupted completion, inspect status before taking any further action. An `unknown` exchange may already have consumed its code; never automatically resend that code. Cancellation cannot undo an issued provider exchange or remotely revoke tokens. Review a new explicit connection or the still-pending remote-revocation procedure as appropriate. Actual sandbox authorization/company proof, supported browser/operator behavior and regional processor qualification remain open.
