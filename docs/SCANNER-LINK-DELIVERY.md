# Internal scanner-link delivery

The scanner entrance supports QR, copy and device sharing without a messaging
provider. Authenticated staff can also use a server-managed email/SMS adapter
when an organization-specific relay has been separately configured and qualified.
The pilot has no configured live messaging provider. Local synthetic tests are
not evidence of actual email or SMS delivery or Canadian provider residency.

## Operator behavior

The scanner link opens the phone reader; the link does not authenticate its
recipient or grant inventory permissions. Staff must sign in and use the scanner
inside receiving, picking or another native task to change stock.

Internal delivery accepts a recipient and email/text channel, never a caller
supplied URL or message. Text numbers must use international format. Only current
staff with complete required security setup can send. Customer accounts cannot.

The interface distinguishes provider acceptance from confirmed delivery. A lost
or ambiguous result is retained as unknown and is never automatically resent.
A reload can check the exact same attempt. QR and device sharing remain available.
Invalid recipient validation permits correction before an attempt is dispatched.

## Optional relay contract

Server configuration uses these settings:

| Setting | Meaning |
| --- | --- |
| `SCANNER_LINK_RELAY_URL` | Fixed HTTPS relay endpoint, without URL credentials, query or fragment |
| `SCANNER_LINK_RELAY_TOKEN` | Secret bearer credential, provisioned outside source control |
| `SCANNER_LINK_ORGANIZATION_ID` | The sole organization authorized for that relay |
| `SCANNER_LINK_CHANNELS` | Explicit comma-separated `email` and/or `sms` |

The relay receives a fixed scanner template, channel, recipient and scanner URL,
with a stable attempt identifier in `Idempotency-Key`. It must honor that key.
Its bounded JSON response has a `state` of `accepted`, `confirmed` or `rejected`.
HTTP errors, redirects, malformed/oversize responses and timeouts are ambiguous;
they do not establish failure or delivery. The local audit stores a masked
recipient and a request hash rather than the raw recipient.

There are per-user and per-organization send limits. Outbound recovery holds and
current permissions are checked before transport. Adding credentials does not
qualify vendor terms, processing location, retention or real delivery. Complete
that review and an authorized provider test before enabling a live relay. Keep
secrets out of logs, artifacts and the repository.
