# Local customer document inbox checkpoint

Date: 2026-10-01. Parent local commit: `2d7a20d`. Bounded D-025 engineering candidate; all 44 tasks and 10 gates remain NOT VERIFIED. Exact tested source hashes and observed checks are in the [machine receipt](LOCAL-BILLING-INBOX-2026-10-01.json). See [the billing runbook](../BILLING-DOCUMENTS.md).

Finance publication references their own reviewed original PDF request, exact immutable bytes/customer and reason. Buyers download only their own account's publication and separately confirm receipt using their own prepared request and exact content hash. Receipt does not imply agreement/payment. Withdrawal retains prior evidence and original documents; republication uses a new identity and new personal confirmation. No financial/stock/shipment mutation occurs through these operations.

## Environment and scope

Direct workstation checks on macOS arm64, Node 24.16.0, synthetic SQLite WAL stores and installed Chromium. The eight new Node tests cover invoice/credit originals, immutable totals/bytes, separate prepared/confirmed states, same/new-key retry, restart, withdrawal/republication, current role/account/organization checks before cached results, foreign personal receipts, explicit wording/hash controls, late audit rollback, corrupt stored bytes, competing publication/confirmation and withdrawal/confirmation processes, and HTTP session/origin/CSRF/key/schema controls. The regression browser suite covers the previously existing journeys; no dedicated publication/confirmation browser journey or actual customer acceptance is claimed.

No CI runner job, workflow, registration, push, PR, deployment, provider request/account, live data or OPUS/UB integration was used. Only local commits are authorized. Existing unrelated runner processes elsewhere on the workstation were left untouched.

## Preserved failures

Initial type checking failed because spreading a generic SQLite row hid publication ID/state types and an HTTP test supplied an `unknown` payload outside Fastify's injection type. Added an explicit publication type and object payload type. Initial focused tests had seven passes/one failure: a cached JSON acknowledgment had a normal object prototype while the fresh SQLite result had a null prototype. Normalized returned acknowledgments. A subsequent focused run still had seven passes/one failure when list history's SQLite prototype was compared with the normal command response; the test now compares a spread of that history row without changing any fields. Final focused checks passed all eight tests. These intermediate results are superseded, not counted as successful evidence.

## Limits

No proof that an operator physically reviewed a PDF or that a real customer received/read it is inferred. New inbox browser lost-response/confirmation/cancellation coverage, human wording/legal/channel approval, email, original source-file migration, provider accounting/refunds and operational security, retention, pagination, schema upgrades, physical residency, load/fault/restore qualification remain pending. Existing prepared direct downloads remain distinct from portal confirmation. This local checkpoint is reviewable work in progress and does not complete the full system or verify a product gate.
