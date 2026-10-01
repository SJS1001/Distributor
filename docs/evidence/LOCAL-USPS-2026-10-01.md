# USPS TEM domestic label engineering — 2026-10-01

**PASS within captured local regression scope. Full system incomplete; all 44 tasks/10 gates NOT VERIFIED.** Partial D-027/D-036, REQ-03/REQ-16/REQ-19 and CH-05/CH-07/CH-08/CH-09.

Tested candidate captured 2026-10-01T23:20:28.939852+00:00 on `codex/local-distributor-checkpoint`, parent `c0c793d5edc3a22659d8e000e98481e94e4760fa`. The companion JSON records parent/branch/candidate time and SHA-256 for 265 application/configuration/test inputs, 183 unchanged historical evidence files, 170 unchanged dependency license/notice files and retained private commands/logs. Original new implementation and fixtures; no schema, dependency, SDK or vendor-code change. Procedure and protocol references: [USPS runbook](../CARRIER-BOOKINGS.md#usps-tem-domestic-labels).

Environment: direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, disposable native SQLite and injected original synthetic HTTP responses. Test labels are original one-page PDF fixtures; the maximum-size case pads a valid original PDF with trailing whitespace and checks it still opens. All provider-bound requests go to injected transports. Existing browser journeys use Chromium and synthetic data; they do not exercise actual USPS transport or new USPS-specific browser behavior. No provider account or request, credential provisioning, purchase or printed label.

| Captured check | Observed result |
| --- | --- |
| Focused USPS protocol/configuration/native/HTTP tests | PASS 55/55, exit 0 |
| `npm test` | PASS 1283/1283, exit 0 |
| `npm run test:e2e` | PASS 59/59 plus production build, exit 0; existing regression journeys |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| Planning/local links | PASS: 44 tasks, 10 gates, 11 scenarios, 14 decision sheets, 22 requirements, 122 Markdown files/707 local links; structure only |
| `git diff --check` | PASS, exit 0 |

Expected and observed: default startup constructs no client. Explicit enablement captures exact organization, EPS parties, domestic mapping and mailing day without I/O. Missing acknowledgment, malformed identifiers, sparse/empty mappings, extra browser/startup fields and unqualified domestic shapes are refused. OAuth is requested once, followed by payment authorization once and exactly one label POST after the synchronous current native guard. Label requests negotiate multipart/form-data; authorization negotiates JSON. Captured numeric units round upward and request fields select PDF/customer packaging/no return or extra services. Matching payer and label-owner identities are required; unknown/duplicate roles, wrong EPS/MID/CRID, missing owner or explicit insufficient funds prevent label purchase. Documented extra rate-holder parties and mapped priority/machinable configuration are exercised.

Native coordination retains private booked tracking/PDF without stock/order/shipment/invoice effects. Current customer withdrawal during authorization prevents the label write. Mutation of supplied configuration/intent during an awaited response cannot reroute the captured request. An injected lost label reply produces sanitized CARRIER_TRANSPORT and unknown state. Real database close/reopen retains that outcome. Send replay, cancellation, replacement and native physical handover are refused. Unsupported lookup/reconciliation makes no provider call and consumes no USPS reprint. Native snapshots stay equal.

Bounded multipart handling accepts attachment and form-data PDF parts, quoted boundaries and folded canonical base64. Original fixtures reject wrong destination/recipient/tracking, duplicate metadata/headers, a third part, truncated delimiters, invalid padding/PDF, URL content, unexpected JSON, redirects, wrong/oversized declared length, actual oversize and an optional mismatched correlation echo. The 1 MiB PDF bound succeeds without recursive matching. Oversized stream cancellation is observed. Malformed OAuth expiry/token/MIME/UTF-8 prevents downstream requests. None of these failures issues a second label or retains invalid label bytes.

The actual configured HTTP runtime follows the retained USPS provider, rejects dispatch overrides before I/O and refuses send replay. Current authenticated private no-store retrieval returns the exact original PDF and SHA-256; unauthenticated/inactive principals are denied. The PDF opens with one page. Browser regression is existing common application coverage; no UI change or physical-device acceptance is claimed.

Preserved earlier failures: initial TypeScript check reported indexed-array/regex-match nullability; corrected explicit bounds-established assertions. Subsequent type/focused checks passed. Self-review added EPS party matching, optional key/name correlation, actual restart/HTTP checks and a maximum PDF case, removing recursive base64 matching. It also caught inherited JSON Accept on label requests, corrected multipart negotiation and added assertions. First full/backend/browser runs are retained as superseded because final inputs changed; corrected final runs bind the current captured inputs. No existing assertion was weakened. Private logs are hashed, not erased or overwritten.

Self-review inspected trusted default-disabled configuration, captured input/credential lifetime, fixed TEM gateway, exact payer/owner roles, final current guard, one label write/no retry, sanitized errors, bounded parsing/canonical private bytes, current HTTP authority and durable unknown native conservation. Historical evidence and notices match. This is synthetic engineering verification, not independent review or product acceptance.

Remaining: actual USPS enrollment/account/EPS/credential/protocol/service/rate/fee/residency qualification; origin-local mailing-date horizon and immutable account/configuration/date binding across pending restart; complete provider proof/correlation and lost-response adjudication/recovery; rates/adjustments, cancellation, tracking callbacks, international/customs/territory/military/extra-service/return support where required; actual printed labels/devices, human operators and independent security/load/retention/restore acceptance. USPS reprint is finite/stateful and is not presented as read-only recovery. Local refusal bounds are not universal USPS eligibility. Private temporary logs have no archival guarantee. Work remains incomplete.

Direct workstation/local commits only; no CI/cloud/delegation/provider request/push/PR/deployment/publication/purchase/live data or OPUS/UB integration. All product gates remain NOT VERIFIED.
