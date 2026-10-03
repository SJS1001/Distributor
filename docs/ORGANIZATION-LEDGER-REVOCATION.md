# Native organization QuickBooks revocation

Partial D-034/D-036/D-039 engineering. All 44 tasks and ten product gates remain NOT VERIFIED. This is a native sandbox operation for the separate organization stock-cost journal credential scope. Dedicated protected operator commands invoke it explicitly. Authenticated task-shaped HTTP controls now expose explicit revocation, receipt reads and offline evidence review. Dedicated Billing controls now present fixed original review, explicit confirmation, durable receipt recovery and offline external evidence review; no startup invocation or polling worker invokes it. The buyer-account revocation command cannot substitute. The preview keeps all provider connections disabled.

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

The [local receipt](evidence/LOCAL-ORGANIZATION-REVOCATION-2026-10-03.md) binds source/test hashes and direct workstation verification. All provider responses are intercepted synthetic requests. Actual vendor sandbox outcomes and grant-wide revocation semantics, external evidence truth, process/clock/storage faults at production scale, key custody, residency, security and human operator/release qualification remain open. No CI runner, workflow, deployment, PR or merge was used.

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

## Authenticated organization HTTP controls

Dedicated organization configuration (`QUICKBOOKS_LEDGER_BROWSER_AUTH_ENABLED=true` and the separate `LEDGER_*` binding) exposes the following routes. The default remains disabled; configuration and provider activation still require separate qualification. Requests cannot select another company, worker, client, buyer account, secret or token. JSON writes are bounded to 32 KiB, reject surplus fields and require current same-origin/CSRF authorization.

| Operation | Exact request | Behavior |
| --- | --- | --- |
| `POST /api/quickbooks/organization/revocation` | `receiptId`, original ready credential `revision`, exact organization `authority` | Disable before one explicit sandbox request; retain the same receipt for exact replay |
| `GET /api/quickbooks/organization/revocation?receiptId=…` | One receipt identifier, no other query fields | Read scoped retained metadata offline |
| `POST /api/quickbooks/organization/revocation/review` | `receiptId`, current disabled `revision`, explicit `resolution`, nonempty bounded `evidence` | Record external outcome evidence offline without reactivating credentials |

Every operation checks the configured original worker and the current unbound finance/admin login in the same organization. Password-change and required-MFA enrollment restrictions apply to both HTTP and native browser calls. Revocation rechecks that initiating live login before sending and after the awaited response. Logout, session invalidation, role change or newly unmet security requirements retain uncertainty instead of accepting a late confirmation. Browser audit records identify the actual finance user; operator calls retain worker auditing.

Receipts are organization finance history, unlike login-private OAuth authorization attempts. A fresh authorized finance login can recover an original receipt or review its externally established outcome; it cannot resend an unresolved operation or replace its original binding/revision/permission stamp. Offline reads/review need no vault key or current provider permission and remain available after withdrawal or during a restore hold. The dedicated configured browser object must remain available for these reads; disabling that configuration refuses all three HTTP operations. The hold and disabled credentials remain intact.

The [local HTTP receipt](evidence/LOCAL-ORGANIZATION-REVOCATION-HTTP-2026-10-03.md) records direct workstation synthetic checks. This supplies backend controls. The dedicated Billing presentation described below adds local synthetic browser coverage; actual Intuit/operator/security/residency qualification remains pending. No live provider request or product gate acceptance is claimed.


## Billing organization revocation review and recovery

Unbound finance/admin users see a separate organization QuickBooks revocation panel in Billing. The default-disabled configuration displays its refusal; the local preview keeps that configuration disabled. A fresh review freezes the configured sandbox company, public binding, ready credential revision, original organization permission and complete historical disclosure. An unchecked explicit confirmation is required before the one request. Browser review never grants provider activation authority.

The exact original identifier/body and disclosure are retained in organization-scoped browser storage and read back before transport, under a same-profile Web Lock. An uncertain or malformed reply preserves that evidence. Reload, sign-out and fresh finance login recover through an explicit receipt read, never an automatic write. An exact 404 with unchanged ready credentials/permission offers the same original identifier/body for a fresh explicit confirmation; other errors or scope drift refuse. An observed `unknown` receipt is never offered another provider revoke.

When storage is missing, enter the original receipt identifier and select **Read original organization revocation history**. The UI reads scoped server history, checks the configured company/binding and original organization stamp, verifies the immutable historical disclosure hash, and retains the reconstructed original scope before presenting the receipt. No provider call is made. Missing/malformed history and damaged existing browser evidence are not replaced. Browser evidence contains no tokens, client secrets or session cookies; evidence references must still exclude secrets and customer information. Same-origin scripts and browser profiles remain part of the browser storage trust boundary.

External outcome review starts from a fresh receipt and current disabled credential revision, even after consent withdrawal. Choose whether external evidence confirms provider revocation, supply a bounded reference, inspect the frozen outcome/reference/revision, and separately confirm **Record organization revocation evidence**. Active `sending` claims must expire before review. This native offline task sends no provider request and leaves credentials disabled and restore holds intact. `provider-unconfirmed` releases the local revocation fence without asserting upstream revocation; `provider-confirmed` records an operator confirmation, distinguished from `provider-response`.

A lost review response retains the exact body. Recovery reads first; if still unresolved with the same disabled revision, it offers the retained review for an explicit identical retry. A terminal read is labeled as the observed receipt outcome: metadata lookup cannot prove that this browser's exact evidence reference was recorded. Reconcile that reference with the audit history before acknowledging it. Conflicting terminal resolution or revision refuses recovery rather than replacing evidence. **Acknowledge terminal organization revocation receipt** removes only the verified matching local record under a lock; server history remains.

Competing-tab storage changes invalidate frozen reviews and abort pending browser reads. Navigation/unmount aborts the client view and prevents late replies from changing a later screen; a submitted native operation may still finish, so retained evidence remains necessary. Locks cover one browser profile; native receipts/revision fences remain authoritative across profiles and processes. Disabled Web Locks, unavailable/damaged storage, mismatched metadata/disclosure and current authorization failure refuse another submission.

The [browser receipt](evidence/LOCAL-ORGANIZATION-REVOCATION-BROWSER-2026-10-03.md) records synthetic workstation journeys and retained failures. These controls do not qualify actual provider grants/outcomes, external evidence truth, browser/host compromise, regional infrastructure, human review or product gates. No provider execution worker or automatic reconnect/revocation loop is added.
