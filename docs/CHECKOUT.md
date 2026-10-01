# Invoice checkout access

Local engineering for D-020/D-024 and CH-07/08. All tasks and product gates remain NOT VERIFIED. This interface uses retained Stripe test session evidence; actual Stripe/customer qualification remains open. Current work permits direct workstation verification and local commits only.

## Buyer and finance use

In Billing, the provider operations row shows the original invoice number, frozen checkout amount/currency and current access message. A ready checkout exposes an **Open secure checkout** button. Clicking performs a fresh authenticated, account-scoped `GET /api/effects/:effectId/checkout`; the response uses `Cache-Control: no-store`. Current real identity/grants, password requirements, native invoice balance, exact intent identity/money, current named Stripe acceptance/terms and restore hold govern access. Only the scoped buyer, finance or administrator can obtain the URL. Support/commercial may review status but cannot launch.

The generic effects list contains no checkout URL, including for administrators. The launch response accepts only HTTPS on `checkout.stripe.com`, without credentials or a non-default port, and the browser repeats that validation before same-tab navigation. Leaving Billing cancels an outstanding read. Opening checkout records no payment and makes no provider request.

| Display | Meaning and next action |
| --- | --- |
| Ready | Retained session is open/unpaid, its expiry is in the future and frozen money matches the current invoice. The click rechecks these facts. |
| Pending/running/unknown | No verified current launch. Finance sends a pending intent or reconciles an unknown outcome through existing controls. Never resend an unknown outcome automatically. |
| Balance changed | Native balance differs from frozen session money; finance must review. Current implementation does not replace or revise that intent. |
| No amount left to pay | Native balance is zero or lower. This can follow payment or credit; it does not prove Stripe settlement. |
| Checkout finished | Session is complete or payment status is no longer unpaid. Finance verifies settlement using the existing signed callback/reconciliation path. Complete/unpaid never records cash. |
| Expired | Provider reports expiry or the retained deadline passed. Current implementation has no reviewed renewed-session flow. |
| Unverified | Legacy/malformed evidence, unsupported URL, or incomplete refresh blocks the old link. Finance may refresh exact session evidence. |
| Blocked | Current permission/terms or restore state prevents access. Review the indicated restriction. |

## Refresh and recovery

Finance, support or administrator may select **Refresh checkout status** for a completed checkout. `POST /api/effects/:effectId/refresh-checkout` accepts no fields, requires authenticated CSRF/origin controls and uses the configured adapter. The test SDK retrieves the exact bound session ID; identity, effect metadata, mode, test status, amount/currency, provider status/payment status and expiry must match supported contracts. It does not create a new session or cash.

The durable token claim is shared with existing operation recovery. While refreshing, the old link becomes unavailable. Another connection cannot acquire the same claim; recovery invalidates an abandoned token and fences its late result. Lookup failure preserves the original binding and blocks launch until successful verification. A missing session becomes unknown without an automatic send. A changed session identity fails. A late transactional event failure rolls back the replacement result and hides the old link. Results observed from an authorized read may be retained after consent withdrawal during I/O; withdrawal still blocks subsequent access and provider requests.

Pending checkout sending checks native identity/money before the claim and again through the adapter guard immediately before creating the session. This narrows the race with concurrent native payments; the provider and native database do not share an atomic transaction.

## Qualification limits

Launch checks the latest retained provider evidence, not instantaneous upstream state. Refresh stores the latest mutable projection plus a metadata event; it is not a complete immutable provider-observation archive. Legacy results lacking status/expiry fail closed and require an exact refresh. A withdrawn choice cannot recall a URL already received or upstream processing. No renewed-session or amount-revision operation exists yet, and the original one-intent-per-invoice key remains in force.

The [local receipt](evidence/LOCAL-CHECKOUT-ACCESS-2026-10-01.md) covers synthetic HTTP/SDK/browser checks and competing application connections, not actual Stripe requests, OS termination for this new refresh flow, real devices or independent buyer/finance acceptance. Generic operation process recovery has separate historical evidence. Production history/index/load/locking/clock/upgrades/security/retention/recovery/residency and actual provider contracts remain unqualified. Stop old writers before upgrades; mixed versions are unqualified. Signed callback cash handling is described in [the provider runbook](PROVIDERS.md).
