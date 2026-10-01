# UPS sandbox protocol — local engineering receipt

Date: 2026-10-01. Status: **PASS for the bounded local checks below**. Partial D-027/D-036 engineering relevant to CH-01/CH-07/CH-09, REQ-03/REQ-16/REQ-19 and G5/G7. All 44 tasks and 10 product gates remain **NOT VERIFIED**. No actual carrier, hardware, human acceptance or production readiness is claimed.

Parent: `4a5671f7fb875d4ca7c6f5f01990eb61b60170f7`; branch `codex/local-distributor-checkpoint`. The [companion content record](LOCAL-UPS-SANDBOX-2026-10-01.json) binds 222 application/test/configuration/license inputs captured at 18:03:01 UTC, final documentation, actual command records/log hashes and 145 unchanged historical evidence files. All captured inputs were compared with current bytes before receipt creation. Parent agent implementation and self-review only; no independent reviewer or human sign-off. A subsequent local commit contains this receipt; content hashes identify the tested candidate without a self-referential commit field.

## Environment and scope

Direct workstation commands in `/Users/stevensmith/Documents/Distributor`: macOS 27.0 arm64, Node v24.16.0, npm 11.13.0; repository-pinned dependencies and disposable native SQLite fixtures. No dependency, schema or lockfile change. No CI runner/job/workflow, cloud checkout/source transfer, push/PR, provider request/account, deployment, purchase, live customer data, publication or OPUS/UB integration. All UPS transport is an injected synthetic `fetch`; the fixed CIE URL is asserted but never contacted by these checks.

The original `UpsSandbox` client is available only through explicit trusted injection. Normal server/worker startup binds no carrier. Configuration selects one organization/account, client credentials, registered shipper and exact service mapping. Customer choice still needs a named UPS exception and current native authority. The carrier coordinator supplies the deeply frozen intent and checks the exclusive durable claim before the single shipping write. No environment toggle or browser credential provisioning is added.

## Expected and observed behavior

- Domestic US and Canadian single-parcel fixtures map integer grams/millimeters to exact KGS/CM strings and selected service/account. Two actual synthetic warehouse stock paths use their reviewed physical origin separately from the registered account contact. Booking alone preserves native stock/order/invoice/shipment records. Separate physical handover issues the original serial from the correct warehouse and creates one invoice; retry retains one effect.
- Authentication and serialization precede the synchronous write guard. The transport allows one shipping POST, with no redirects or automatic write retry. Invalid/mismatched review, organization, shipment, service, parcel or contact rejects before I/O. Withdrawing the named customer choice during token retrieval prevents the shipping write.
- Shipping results need successful matching context, one canonical tracking number, matching shipment identifier and canonical bounded GIF bytes. Wrong identifiers, multiple packages, invalid encoding/signature/dimensions/trailer and oversized labels reject.
- A lost successful response leaves durable unknown state across application/database restart and blocks another send. Read-only recovery independently queries exact opaque reference/account/destination, requires the returned reference and one package, then matches the recovered label's tracking number. Foreign reference, missing result or foreign label remains unknown through repeated reconciliation and never enables another purchase. Recovery and label reads preserve native stock/money until separate handover.
- Failed HTTP status, redirects, wrong media type, invalid JSON, oversized headers/streams, failed streams and malformed token are bounded and sanitized without leaking injected provider secrets/text. Private HTTP GIF download returns exact bytes/hash metadata, attachment/octet-stream and no-store headers; anonymous or currently inactive principals are denied.

These are synthetic transport/database/HTTP assertions. The restart test reopens the application and SQLite database; it does not kill a real UPS/network process. Existing process-contention cases run in the full backend suite. GIF checks provide limited structural integrity, not decoding, rendering, malware or physical print acceptance.

## Commands and actual outcomes

| Command | Actual outcome | Recorded command duration |
| --- | --- | --- |
| `./node_modules/.bin/tsx --test tests/ups-sandbox.test.ts tests/carrier-bookings.test.ts` | Final focused PASS 103/103, zero failures/cancel/skip/todo, exit 0 | 3.693 seconds |
| `npm run typecheck` | Final PASS, exit 0 | 0.494 seconds |
| `npm test` | PASS 737/737, zero failures/cancel/skip/todo; reported 21154.034917 ms, exit 0 | 21.309 seconds |
| `npm run format:check` | PASS, exit 0 | 6.073 seconds |
| `npm run build` | PASS, exit 0 | 0.476 seconds |
| `python3 scripts/verify_plan.py` | PASS, exit 0 | 0.085 seconds |
| `git diff --check` | PASS, exit 0 | 0.014 seconds |

Planning link/traceability and whitespace checks ran after receipt creation and are recorded in the companion. No frontend changes: browser checks were not rerun for this checkpoint. The preceding payment-page receipt's 48/48 browser result is historical, not current UPS qualification. New private GIF behavior is checked through native HTTP injection.

The first focused run failed 96/98 and the first type check failed: the restart fixture cleanup retained the closed application object, and the HTTP test omitted the required origin and did not await server creation. The fixture now retains its original object and updates the reopened application; HTTP construction supplies the required origin and is awaited. The corrected intermediate 98/98 pass precedes added durable-unknown/two-origin coverage; the final 103/103 pass supersedes it. Initial type-only output and unsuccessful patch attempts are historical, not final verification. After the implementation commit, committed-byte verification failed because the initial 223-entry manifest also included ignored `src/.DS_Store` workstation metadata. That entry was excluded from the 222 application-input bindings; the original private capture remains preserved. This changed only evidence, not tested code. Failed and intermediate logs/result records remain under `/tmp/distributor-ups-checkpoint`; private temporary storage has no archival retention guarantee.

## Protocol and license references

Official public schemas were read as protocol documentation. Original code and synthetic GIF bytes were authored here; no SDK, generated schema, vendor implementation or source sample was imported. The actual UPS API documentation license was read: MIT, copyright 2023 UPS-API. Publication rights and vendor account/API terms require separate qualification.

| Reference | SHA-256 of privately read bytes |
| --- | --- |
| [Shipping and label recovery](https://github.com/UPS-API/api-documentation/blob/main/Shipping.yaml) | `a42db9786f314063ddfa9e7b3bad8ec87abc808bd1bfb6228e629ae0df910c49` |
| [Tracking](https://github.com/UPS-API/api-documentation/blob/main/Tracking.yaml) | `e4eb800e6deaaaaa492ff67ef882585ba0098fcd974b28dbe14641b471258893` |
| [Client credentials](https://github.com/UPS-API/api-documentation/blob/main/OAuthClientCredentials.yaml) | `d4ef6748d4acd21c9196551f36440efafefb065f0bf800c3c40057e3860ca8d3` |
| [License](https://github.com/UPS-API/api-documentation/blob/main/LICENSE) | `6d52916b6e525abd227b7f1d36c1cfa910c76d528568d2a8e44121d58b9e964f` |

## Remaining work and validity

Actual UPS account/service access, response fields/correlation, recovery behavior, fees, vendor terms/processing residency, credentials and lifecycle require separately authorized sandbox qualification. Reference/context is correlation, not UPS write idempotency. Tracking's default limited search window cannot prove that an absent shipment never existed. Missing/ambiguous results require investigation while retaining unknown state. No rate, cross-border/customs, multiple-parcel, void/refund, delivery retrieval, warranty booking or additional carrier protocol is supplied here.

Real scanners/printers, regional infrastructure, production security/load/upgrade/recovery/retention and warehouse/finance operator acceptance remain open. Changed client/coordinator/HTTP/configuration/contracts, dependencies or fixtures invalidate the affected local checks. Real provider qualification must exercise the relevant integrated scenarios at the exact candidate; this receipt cannot pass a product gate or complete the full system.
