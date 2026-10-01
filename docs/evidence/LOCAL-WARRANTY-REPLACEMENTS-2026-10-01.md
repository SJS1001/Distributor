# Local warranty replacement collection — 2026-10-01

Partial D-030–D-033/G6 engineering evidence only. All 44 tasks and 10 gates remain NOT VERIFIED; the full-system goal is incomplete. Reviewer: Codex automated synthetic checks without human/operator acceptance. Parent local commit `653f0cd` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-WARRANTY-REPLACEMENTS-2026-10-01.json) binds the tested source, tests and configuration by SHA-256; see [the runbook](../WARRANTY.md).

Warranty now approves same-product serialized replacements for customer collection. Inventory owns the hold and custody; warranty owns approval/history and original invoice/coverage lineage. Reserved serials cannot fulfill ordinary orders, transfers or a competing replacement. The old serial stays quarantined until collection, when the scanned replacement leaves warehouse stock and the approved old-unit scrap/restock disposition applies atomically. Cancellation releases the hold without changing the return. Immutable history retains both cancelled and successful attempts.

The provisional engineering policy permits inspected/repair claims with usable same-product stock and explicit inherited original coverage. No new sale, shipment, invoice, credit or payment is fabricated. The warranty return-credit operation rejects reserved/handed-over replacement remedies. General invoice-level finance credits remain separate operations; this checkpoint does not qualify their reconciliation/remedy policy or claim that all finance credits are globally blocked.

## Direct workstation checks

Final check results will be recorded here after the current candidate completes regression. Tests run on macOS arm64 with Node 24.16.0/npm 11.13.0, synthetic SQLite fixtures and loopback Chromium. No CI runner is used.

## Final direct workstation checks

Environment: macOS arm64, Node 24.16.0, npm 11.13.0; synthetic SQLite fixtures and loopback headless Chromium, without CI runners.

- `npm run typecheck`, `npm run format:check` and `git diff --check`: PASS.
- `npm test`: 132 PASS (including all seven replacement checks), zero failures/cancellations/skips/todos, 8651.160958 ms.
- `npm run test:e2e`: production build PASS (281 ms), all 18 Chromium journeys PASS (29.9 s total; replacement journey 1.4 s).
- `python3 scripts/verify_plan.py`: PASS; final structure/link counts and preserved historical evidence comparison are in the machine receipt. This verifies documentation structure only.

## Observed behavior

Seven new Node checks exercise durable retry/restart, inherited original invoice/date across two replacements, exact stock holds, cancellation/history, scrap/restock, buyer ownership/privacy, current role/site/account/organization authority, invalid payloads/scans/revisions, and HTTP session/origin/CSRF/exact shapes. Separate real child processes compete for one replacement serial, then cancellation versus collection at revision 1: exactly one attempt commits in each race. Injected late final audit failures roll back holds/movements/claim/history/decisions/money/receipts/audit together. A safe unchanged retry then commits. Maximum 2,000-character handover evidence is retained and retried without a new movement.

The synthetic resale check returns/restocks the replacement and ships it through an ordinary order to a different account. Current inventory sold custody supersedes historical shipment/replacement ownership: the former buyer's sold-unit list is empty, their new claim rejects, and the current buyer's claim references the new invoice. Replacement chains retain the original invoice and coverage end without extending dates.

The new browser journey creates a separate three-serial product, synthetic customer, sale and inspected return. Cancellation by another operation invalidates an open collection dialog; the stale attempt rejects. A second reservation loses its committed response and retries with an unchanged key. A wrong serial rejects before stock changes; correct collection also loses its committed response and retries the same key. Reload retains one cancelled and one handed-over attempt, each at revision 2. The old unit is scrapped, replacement is sold with zero stock, spare remains available, and original orders/shipments/invoices are unchanged by replacement operations. The successor claim dialog offers the current replacement serial and omits the old serial. Automated staff operation does not prove real collection or human acceptance.

## Preserved attempts and review correction

- Initial typecheck found an implicit-any shipment projection; corrected. A later test typecheck found nullable browser retry keys; corrected with assertions for keys established by the intercepted requests.
- Earlier focused replacement checks passed 6/6 (1185.44425 ms). Adding a stock-transfer check first omitted its required current unit revision; the boundary rejected STATE. After supplying the revision, the expected ALLOCATED code was wrong: the transfer boundary correctly rejected STOCK. The fixture expectation was corrected; expanded checks pass 7/7.
- An earlier focused replacement browser journey passed; it did not supersede the subsequent typing or expanded fixture failures. Final source/configuration hashes and regression results identify the actual reviewed candidate.
- Intermediate full regression before the final evidence-length correction passed 132 Node checks (10650.947792 ms), build (196 ms) and 18 Chromium journeys (42.1 s total; replacement 1.5 s). These are superseded by the final regression.
- Code review found that 2,000-character collection evidence was passed to a history reason limited to 1,000. Collection now stores a bounded action reason while retaining the full evidence on the terminal replacement record. The final Node check explicitly retains/retries maximum-length evidence. This was found by review; no failing execution is claimed for that boundary before correction.

Historical receipts remain unchanged. Browser/runtime outputs and session material remain ignored. No dependency or license changes were introduced. The referenced standing handover file and project memory index were absent in this environment; repository instructions and the latest handoff were used.

## Limits and execution policy

Carrier replacement shipping, substitutes/manufacturer procurement, actual manufacturer custody/communication, authenticated attachments, coverage eligibility/expiry/transferability and human operator/finance approval remain open. Collection is a recorded synthetic workflow, not proof of physical delivery. Claim/replacement/case history is unpaged; production volume/indexing/retention, upgrades/fault/recovery/residency, security and approved business/source policies remain unqualified. Provider OAuth/secrets/refunds/accounting, MFA/recovery, actual devices and other product acceptance remain incomplete.

Current instruction permits local commits and direct workstation checks only. No local/self-hosted/cloud CI job, workflow, runner registration, push, PR, source publication, deployment, purchase, actual provider request/account, live data or OPUS/UB integration occurred. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification; no runner was used for this checkpoint. No fresh remote-access claim is made.
