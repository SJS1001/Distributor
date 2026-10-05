# Canadian contractor enrollment

The public site accepts an application for a staff-reviewed Canadian CAD customer account. This is an application to buy, not instant commercial approval. The HTTP host selects one organization through trusted `ENROLLMENT_ORGANIZATION_ID`; omitted configuration disables submissions and activation. Startup refuses a configured organization outside the CA/CAD profile. Applicants cannot choose an organization, role, customer account, price tier, credit limit or residency exception.

## Operator workflow

1. The applicant provides business name, contact name, email, business phone, province, optional business number and notes, and acknowledges review. Do not request a personal SIN, identity documents or payment details. No password is collected during application.
2. An active administrator opens the application queue and verifies the business and intended contact through the distributor's own review process. Approval explicitly records the price tier, credit limit in CAD cents, reason and the administrator's current password. Approval creates exactly one customer account with native strict residency and no provider exceptions. Rejection creates no account.
3. Approval returns one 24-hour activation token once. The administrator manually hands the intended applicant the site link `https://<canonical-host>/#activate=<token>` using an appropriate verified contact channel. There is no email delivery provider, automated email verification or claim of successful delivery. The invitation is a bearer credential: give it only to the reviewed contact.
4. The activation page clears the fragment and retains the token only in component memory. Activation sets a 14–256-character password and creates only a buyer associated with the approved account. The buyer then signs in through the normal login flow.
5. If delivery fails, the response is lost or the token expires, refresh the queue and reissue the invitation after reauthentication. Reissue invalidates every prior token and retains the same customer and reviewed terms. Revocation also requires a reason and reauthentication. Used invitations cannot be reissued. Password changes, administrator deactivation/demotion or other security-revision changes invalidate the retained approval authority; a currently authorized administrator may reissue.

Approval is final for the pending application. Existing identities are not silently linked or converted. A rejected email cannot automatically reapply, and the current queue has no application deletion/reopen or retention purge operation. Changed customer terms, a customer hold or changed residency conditions stop activation; reissue does not override those checks. Staff must resolve the commercial condition through the owning native workflow. These are pilot operating limits, not automated underwriting or identity verification.

## HTTP contract

All API responses use `Cache-Control: no-store`. Mutations require the exact configured Origin. Administrative endpoints also require a valid session, native security setup and CSRF token; approval/rejection/reissue/revoke verify the password again inside the write transaction. Failed outer password attempts retain native durable throttling.

| Endpoint                                           | Contract                                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/enrollment/config`                       | Public `{enabled,country:"CA",currency:"CAD",approvalRequired:true}`.                                                                                                                              |
| `POST /api/enrollment/applications`                | Public fields in `src/shared/enrollment.ts`; `202 {received:true}` for new, duplicate and existing-identity submissions. No application ID/status or identity membership is disclosed.             |
| `GET /api/enrollment/applications?after=<id>`      | Administrator queue, 20 records plus next cursor, organization scoped. No token or token hash is exposed.                                                                                          |
| `POST /api/enrollment/applications/:id/decision`   | `{decision,currentPassword,reason,tier?,creditLimit?}`. Approve requires explicit terms; returns status and one-time activation token/expiry. Repeated decisions refuse to create another account. |
| `POST /api/enrollment/applications/:id/invitation` | `{action:"reissue"\|"revoke",currentPassword,reason}`. Reissue returns replacement token/expiry once.                                                                                              |
| `POST /api/enrollment/activate`                    | `{token,password}`. Success `{activated:true}`; invalid/expired/revoked/replayed or no-longer-authorized invitations share a generic response. No automatic session.                               |

Administrative mutations intentionally do not retain a replayable plaintext-token receipt. On an ambiguous response, refresh and reissue rather than replaying approval. Public request schemas reject additional authority fields; bodies are bounded to 8 KiB for applications/reviews and 2 KiB for activation.

The server stores only a SHA-256 digest of a random 256-bit token, its finite expiry and the approving administrator's security revision. Customer creation, invitation issuance/consumption, buyer creation and audit effects use the same immediate SQLite transaction. Separate processes racing one token cannot create two buyers. Passwords and tokens are excluded from audit payloads; invitations use URL fragments rather than request paths or query strings.

## Capacity and ingress

Durable one-hour limits are 10 application attempts or 30 activation attempts per qualified address, with global limits of 100 and 300 respectively. Malformed bodies consume an accepted attempt. Requests rejected by a peer limit do not consume the remaining global budget. Expired counters are pruned and counter storage is capped at 1,024 rows. Application storage is capped at 5,000 rows, including reviewed records; a full store returns the same unavailable result irrespective of email membership. These fixed pilot limits may need an explicitly reviewed operational change for higher volume; there is no CAPTCHA or mail provider.

Default address qualification is the socket peer; arbitrary forwarded headers are ignored. The parent runtime has a separate opt-in Fly ingress qualifier (`enrollmentFlyProxy`), requiring a valid single Fly client IP and a deployment reachable exclusively through Fly's HTTP handler. Qualify ingress before enabling it. A reverse proxy without qualified per-client addressing shares one peer allowance. The enrollment module hashes qualified addresses before storing counters.

## Schema and workstation evidence

Schema 24 adds only `enrollment_applications`, its queue index and `enrollment_limits`. Identity continues to own customer/user writes. Existing schema 23 files require the normal explicit source-hash-qualified clone upgrade; startup never mutates a previous schema. Follow the existing schema/hosting runbooks, preserve the source backup, and replace the runtime file only during the parent-controlled offline rollout.

`tests/schema-version-twenty-three.json` was captured from the actual archived source commit `bfb82337ea6938088283610c0e8c18a4373ff837`, independently of the new DDL. The old fingerprints are `58e54e9707cbfdb8a1c20559f4cf7ab8aae827a6ca601843f48f1df8e06a8148` (reporting disabled) and `90a8fb975571d8c284d2e95959c12eb5f4b1665c776475ffc783feb7cc44936d` (enabled).

2026-10-05 workstation verification on the uncommitted schema24 implementation: enrollment focused suite initially 14/14, including independent-process replay and second-connection password races; Identity regression 9/9; existing schema21/22 paths 9/9; full migration plus frozen schema23 suite 113/113; TypeScript check passed. A further capacity-membership regression was added during final self-review; the final receipt is in HANDOFF. Browser and actual hosting verification belong to the parent/frontend receipts. Synthetic tests do not certify business identity, delivery, live data residency, providers or product acceptance gates.
