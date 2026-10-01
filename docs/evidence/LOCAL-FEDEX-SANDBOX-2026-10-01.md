# FedEx sandbox protocol — local engineering receipt

Date: 2026-10-01. Status: **PASS for the bounded local checks below**. Partial D-027/D-036 engineering relevant to CH-01/CH-07/CH-09, REQ-03/REQ-16/REQ-19 and G5/G7. All 44 tasks/10 product gates remain **NOT VERIFIED**. No actual carrier, device, human acceptance or production readiness is established.

Parent: `b862cec5062d7fb0ee1368fb8871b6574ad3502d`; branch `codex/local-distributor-checkpoint`. The [companion content record](LOCAL-FEDEX-SANDBOX-2026-10-01.json) binds 231 application/test/configuration/license inputs captured at `2026-10-01T19:20:09.222269+00:00`, final documentation, actual commands/log hashes and 153 unchanged historical evidence files. Captured inputs and historical evidence match current bytes. Parent agent implementation and self-review only; no independent reviewer or human sign-off. A subsequent local commit contains this receipt; content hashes identify the tested candidate without a self-referential commit field.

## Environment and scope

Direct workstation commands in `/Users/stevensmith/Documents/Distributor`, macOS arm64, Node v24.16.0, npm 11.13.0, repository-pinned dependencies and disposable native SQLite fixtures. No dependency, schema or lockfile change. No CI runner/job/workflow, delegation, cloud checkout/source transfer, push/PR, actual provider request/account, deployment, purchase, live data, publication or OPUS/UB integration. Injected synthetic fetch asserts the fixed sandbox URL without contacting FedEx.

The original client requires explicit trusted injection; normal server/worker startup binds neither client nor credentials. Exact organization/account/country/service/residential/pickup configuration is captured and frozen. US residential destinations require Home Delivery; Canadian ground can be explicitly residential. Sender payment and drop-off or an already scheduled pickup are explicit; no pickup scheduling is supplied.

## Expected and observed behavior

- Four US/Canadian first/second warehouse fixtures use actual native stock transfer/packing paths and the reviewed physical origin. Whole grams map to kilograms and millimeters round upwards to whole centimeters. Conservative rounded local parcel bounds and bounded ASCII/phone/postal fields reject before transport. Booking alone preserves native stock/order/shipment/invoice facts. Separate native handover sells the original serial and issues one invoice; retry retains one effect.
- Altered organization/shipment/review hash/provider/service/country, unsupported contacts/parcels and malformed/coerced/sparse/duplicate configuration reject. Captured configuration resists subsequent caller mutation. Opaque transaction/reference values vary with organization/account/booking/review and contain no native identifiers; they provide correlation, not provider write idempotency.
- Authentication/serialization precede the sole synchronous native write guard. Missing guard rejects before authentication. Guard denial retains its native error code. Revoked customer choice or current principal deactivation during authentication prevents shipping. A matching result after a choice change during the authorized operation is retained. No shipping retry or redirect occurs.
- Results must return exact transaction, service, one shipment/parcel, numeric tracking, package sequence and customer reference, plus one canonical bounded inline base64 PDF for that tracking without a URL or asynchronous job ID. Twenty-four synthetic result faults retain durable unknown state and block repeat purchase. HTTP/authentication/media/JSON/header/stream faults are sanitized and bounded; advertised oversized streams are canceled before consumption.
- Lost synchronous response remains unknown across application/database restart. Reconciliation rejects `CARRIER_RECOVERY_UNSUPPORTED` without authentication or shipping calls. New purchase, cancellation, replacement and manual handover stay blocked; claims clear and native facts remain unchanged. No absent result or operator override can authorize repurchase. This proves safe blocking, not a recovery capability.
- HTTP dispatch resolves the retained provider with multiple registered clients; the wrong adapter fails the test if called. Private label download returns exact authored PDF bytes/hash, attachment/octet-stream and no-store headers; the fixture PDF parses as one page. Anonymous/inactive users and client-selected provider overrides reject. These are synthetic label and native HTTP assertions, not actual FedEx rendering, safety or printer qualification.

## Commands and actual outcomes

| Command | Actual outcome | Recorded command duration |
| --- | --- | --- |
| `npm test` | PASS 819/819, zero fail/cancel/skip/todo; reported 23815.148292 ms, exit 0 | 24.057 seconds |
| `./node_modules/.bin/tsx --test tests/fedex-sandbox.test.ts tests/ups-sandbox.test.ts tests/carrier-bookings.test.ts` | PASS 172/172, zero fail/cancel/skip/todo; reported 12573.724333 ms, exit 0 | 12.673 seconds |
| `npm run typecheck` | PASS, exit 0 | 1.080 seconds |
| `npm run format:check` | PASS, exit 0 | 7.352 seconds |
| `npm run build` | PASS, exit 0 | 0.504 seconds |
| `python3 scripts/verify_plan.py` | PASS, exit 0 | 0.085 seconds |
| `git diff --check` | PASS, exit 0 | 0.011 seconds |

Planning and whitespace checks passed after receipt creation; their command records are bound in the companion. No frontend change: browser checks were not rerun. The preceding warranty checkpoint's 49/49 browser result is historical, not current FedEx acceptance. Recorded concurrent command durations are not production performance measurements.

The first focused execution failed before tests because it imported nonexistent `AppError`. After correction to `DomainError`, the integrated 45/49 focused failure and type failure exposed coordinator `id` versus adapter `bookingId` expectations and a nullable reference assertion. Those fixture contracts were corrected. Intermediate focused 170/170 and corrected type passed before phone/header stream cleanup. The first captured final candidate passed backend 818/818 and focused 171/171 plus type/format/build; self-review then added rejection of a missing guard before authentication and its regression. Those earlier passes are intermediate. The revised final candidate above includes the guard check and passed backend 819/819 and focused 172/172. All failed/intermediate records and original candidate captures remain private; no failed result is counted as passing.

## Protocol references and self-review

Official public schemas/documents were read for field contracts. Original code and authored PDF fixture were written here; no vendor SDK/generated schema/implementation/sample was imported and no FedEx documentation license or provider terms are inferred. Shipment required fields, sender-payment shape, synchronous output, package references and PDF fields were checked against the public schema. Protocol access and reference echoes still require real qualification.

| Reference | SHA-256 of recorded reference bytes |
| --- | --- |
| [Official reference](https://developer.fedex.com/wirc/json/api_groups/Ship/Shipment-Resource.json) | `ca566c332814b194d8044af2c9ef9c1dd090ed1b6495c27f4b79e8eda562db3f` |
| [Official reference](https://developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html) | `65006b8678d84f577b0de50ee09a7d5162d4c5842e2f08c99831a3c6c9186156` |
| [Official reference](https://developer.fedex.com/wirc/json/api_groups/APIAuthorization/APIAuthorization-Resource.json) | `7dd4c508dffc3bc35c5d98dac40b0b87a1087fb74cb8caf76b8f680be430a970` |

Self-review covered current authority/write timing, frozen identity/configuration, response bounds/redaction, exact correlation, preserved native stock/money ownership, default-disabled startup and uncertain recovery. It found and corrected the missing-guard check before the revised final capture. The companion binds reference metadata and the retained shipment schema; raw temporary logs/references in `/tmp/distributor-fedex-checkpoint` have no archival retention guarantee.

## Remaining work and validity

This partial domestic ground single-parcel client cannot safely recover a lost synchronous original label. A qualified recovery protocol and provider/operator reconciliation are required before activation. Actual accounts/service/address eligibility, credential lifecycle/rotation, transaction/reference echo, shipment-date behavior, fees, vendor terms/customer authority/residency and sandbox protocol qualification remain open. Other requested carriers, cross-border/customs, multiple parcels, rates, void/refunds, delivery retrieval, warranty bookings and real hardware remain open.

Production infrastructure/security/load/upgrade/recovery/retention and warehouse/finance/buyer/operator acceptance remain unqualified. Changes to the client/coordinator/HTTP/configuration/contracts/dependencies or fixtures invalidate affected checks. Full product completion and product gates require their actual integrated criteria; this local engineering receipt cannot establish them.
