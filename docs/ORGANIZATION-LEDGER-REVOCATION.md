# Native organization QuickBooks revocation

Partial D-034/D-036/D-039 engineering. All 44 tasks and ten product gates remain NOT VERIFIED. This is a native sandbox operation for the separate organization stock-cost journal credential scope. Dedicated protected operator commands invoke it explicitly. No HTTP route, browser control, startup invocation or polling worker invokes it yet. The buyer-account revocation command cannot substitute. The preview keeps all provider connections disabled.

## Exact scope and request

The owning vault exposes `providerCredentials.ledger.revocation.revoke(binding, receiptId, credentialRevision, authority, clientSecret)`. The binding identifies one organization, original unbound finance worker, sandbox company and OAuth client. Authority is the exact separately reviewed current organization permission stamp. A fresh call requires current persisted worker grants, provider access without a recovery hold, the current vault key and an exact ready credential revision. Buyer consent or a matching buyer identifier grants no organization authority.

One transaction captures the refresh token in process memory, disables the local credential and advances its revision, cancels this binding's pending/exchanging authorization attempts, stores a `sending` receipt and records its audit. An audit/storage failure rolls back these changes before any provider request. The token, client secret and provider response body are not persisted in the receipt, durable command or audit. JavaScript token strings remain subject to process-memory custody; this is not proof of secure erasure.

After another current-authority/claim check, the operation makes one POST to `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`, with Basic client authentication and a JSON token body. Redirects reject. Only HTTP 200 with a response body bounded to 65,536 bytes can confirm; the body is discarded. Request timeout is 20 seconds and the local claim lasts 90 seconds. These are application bounds, not vendor service guarantees. The endpoint and request shape were checked against [Intuit's published sandbox discovery](https://developer.intuit.com/.well-known/openid_sandbox_configuration) and [Intuit's OAuth helper](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Core/OAuth/OAuth2/OAuth2LoginHelper.php). No SDK code was copied and no actual Intuit call is qualified.

Final confirmation rechecks current permission, worker, key, hold, claim and the exact disabled revision. Withdrawal, a hold, revision drift, late replies, interruption, rejected/oversized responses and transport errors retain uncertainty. An error while saving uncertainty can leave `sending`; either state retains the reconnect fence. There is no automatic resend. Same receipt/binding/original revision/authority returns its retained outcome; altered inputs conflict. A different receipt cannot revoke the same credential revision again. Exact replay requires a syntactically valid client-secret argument but reads no token and contacts no provider.

## Status, review and reconnect

`ledger.revocation.status(binding, receiptId)` returns only scoped metadata, the original permission stamp and confirmation source. Current original worker authority is still required; the vault key and current provider permission are not required for this offline read.

`ledger.revocation.review(binding, receiptId, currentDisabledRevision, resolution, evidence)` reviews `unknown`, or `sending` after its deadline. Resolution must be `provider-confirmed` or `provider-unconfirmed`, with nonempty bounded operator evidence. The current disabled revision must match, including an advanced revision after restore. This command makes no provider request. It records the review and audit atomically; exact historical replay requires the same revision, resolution and evidence even after a later reconnect. A provider-response confirmation cannot be replaced by operator evidence.

| State | Meaning and next action |
| --- | --- |
| `sending` | One request was claimed; retain uncertainty until it finishes or the claim expires. |
| `unknown` | Upstream outcome is unresolved; obtain external evidence and review. |
| `confirmed` | Distinguish `provider-response` from `operator-evidence`; credentials remain disabled. |
| `released` | Operator evidence releases this local fence without asserting provider revocation; credentials remain disabled. |

Unresolved organization receipts block credential installation/access, new organization OAuth, journal credential-version fences and key rotation. Status, cancellation and local disconnect remain available offline under their own authority checks. Terminal review permits a separately approved fresh connection; it does not reactivate old tokens, grant new organization permission, resend anything or release a recovery hold. Late OAuth completion cannot install tokens after the cancellation. A late revocation response cannot overwrite an operator review.

## Upgrade and recovery

Schema 14 adds dedicated integration-owned organization revocation storage and an index. Public organization binding IDs are retained separately from vault-internal namespaced credentials and buyer receipts. [Reviewed fresh-file upgrades](SCHEMA-UPGRADES.md) preserve existing records and add empty missing storage; normal startup refuses exact older schemas. Independent version-13 fixtures captured from published parent `0d0c91014f0565f4df4b31c82609a548dc75ba42` preserve nonempty organization authorization attempts in CA/US and both reporting profiles. Partial/lying layouts reject without source mutation or destination publication.

[Encrypted isolated restore](RECOVERY.md) changes copied organization `sending` receipts to `unknown`, clears claims, disables/discards copied credentials and advances their revisions. Current offline review uses the restored disabled revision and retains the provider hold. Historical terminal receipts remain history. Current recovery refuses old versions 1–13 archives rather than silently migrating them.

The [local receipt](evidence/LOCAL-ORGANIZATION-REVOCATION-2026-10-03.md) binds source/test hashes and direct workstation verification. All provider responses are intercepted synthetic requests. Dedicated HTTP/browser exposure, actual vendor sandbox outcomes and grant-wide revocation semantics, external evidence truth, process/clock/storage faults at production scale, key custody, residency, security and human operator/release qualification remain open. No CI runner, workflow, deployment, PR or merge was used.

## Protected operator commands

Use `npm run provider:ledger-revoke -- <revoke|status|review>` with the current schema-14 store and protected noninteractive UTF-8 stdin, bounded to 32 KiB. No additional arguments are accepted. Set exact `DATABASE_PATH`, `DATA_REGION`, `PROVIDER_BINDING_ID`, `PROVIDER_ORG_ID`, `PROVIDER_WORKER_USER_ID`, `QUICKBOOKS_REALM_ID` and `QUICKBOOKS_CLIENT_ID`; preserve the configured event-reporting profile. No buyer account or callback URI substitutes for organization authority. Filesystem access is privileged; this is an operator interface, not a browser authorization mechanism.

| Action | Exact protected input fields | Behavior |
| --- | --- | --- |
| `revoke` | `receiptId`, `revision`, `authority` | One explicit sandbox request under the inspected ready credential revision and complete separately reviewed organization permission stamp |
| `status` | `receiptId` | Read retained scoped metadata offline |
| `review` | `receiptId`, `revision`, `resolution`, `evidence` | Record externally established outcome against the current disabled credential revision, offline |

For `revoke`, additionally configure the current `PROVIDER_ENCRYPTION_KEY`, `QUICKBOOKS_CLIENT_SECRET` and explicitly `PROVIDERS_ENABLED=true`. This flag is an application refusal boundary, not permission to activate a provider. Default-disabled or missing/invalid secret configuration rejects before opening the store. Exact replay still needs explicit CLI enablement and a syntactically valid secret; use `status` while outbound access is disabled. Revoke requires the complete nine-field `LedgerAuthority` returned by the separate organization permission review: provider/purpose/environment, organization/region/company, permission revision and disclosure ID/hash. Never reconstruct it from buyer consent.

`status` and `review` ignore ambient encryption keys and need neither secrets nor enabled providers; current original worker and binding authority remain mandatory after withdrawal or during a restore hold. Review accepts only `provider-confirmed` or `provider-unconfirmed` and a nonempty evidence reference of at most 2,000 characters. It leaves credentials disabled and the hold intact. Unknown, missing, surplus, malformed or oversized fields/UTF-8 are refused before application construction. Credential and permission revisions must be inspected, not copied from examples. Errors omit input/provider bodies. Never include tokens, keys, secrets or customer data in evidence, command arguments, shell history or published files.

The protected command checks use independent child processes and intercepted HTTP in CA/US; production installation separately checks default refusals. These are workstation protocol checks, not actual provider qualification or verified residency.
