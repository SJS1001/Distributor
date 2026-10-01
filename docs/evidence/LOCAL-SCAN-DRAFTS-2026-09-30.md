# Local scanning and receipt draft evidence

Date: 2026-09-30. Scope: bounded local D-008/D-014/D-017 engineering candidate; all tasks/product gates remain NOT VERIFIED. Parent commit: `4792d54`. Exact final source/check hashes are in the [machine receipt](LOCAL-SCAN-DRAFTS-2026-09-30.json).

Procurement owns saved receipt evidence and immutable revision history. Saving incomplete serial scans changes no stock/PO receipt quantity. Current warehouse/site authorization precedes cached command results. Exact SKU, original purchase identity, quantity, new serials and current revision guard final confirmation. Confirmation calls the shared owning receive operation inside one command transaction; stock, original cost, PO receipt, draft version and audit commit or roll back together. Discard retains its evidence and permanent delivery-reference identity. See the [runbook](../SCANNING.md).

Native camera input is explicitly requested and feature-detected. Detected values require operator acceptance before entering the form. Manual/wedge fallback remains available. Multiple different labels and duplicate serial candidates are rejected; valid detection, cancellation, late permission responses, background/page exit and unmount release camera tracks. No preview upload or offline draft implementation exists.

## Environment and checks

Direct workstation commands on macOS arm64, Node 24.16.0/npm 11.13.0; disposable synthetic SQLite/WAL stores and locally installed Chromium. No Actions, local/self-hosted or cloud CI runner job, workflow or registration was used. No push, PR, deployment, external provider request/account, live data or OPUS/UB integration occurred. The owner requested local-only commits.

- Seven targeted receiving tests passed (1041.072625 ms), including restart, current role/site/organization checks, exact retries, immutable identities, stale/invalid scans, competing direct receipts, real separate-process contention and injected late-write rollback.
- Full Node suite passed: 103 tests, zero failures/cancellations/skips (7815.471125 ms).
- Type checking and formatting passed. Final production build/full browser and planning structural results are recorded in the machine receipt.
- Two focused browser checks passed (2.4 seconds): saved incomplete scans, reload/resume, explicit camera acceptance, wrong SKU/multiple labels/duplicate serial guards, and lost save/confirmation response with the same retry key; unsupported/denied camera access, Enter suffix and canceled pending permission with released late streams.

Final checks passed: `npm run typecheck`, `npm run format:check`, seven focused receipt tests (1041.072625 ms), all 103 Node tests (7815.471125 ms, zero failures/cancellations/skips), production build (70 ms), and all 14 Chromium journeys (22.1 seconds). The final planning/link validator and candidate/historical hash comparison are recorded in the machine receipt.

Independent synthetic oracle: quantity two at original cost 6,000 CAD cents each yields two quarantine units valued at 12,000 cents, one PO receipt and exactly two received units. Saved draft v1/v2 creates no stock. Confirmation creates received v3 once; retry with a new key and original preconfirmation revision returns the same receipt. Separate processes confirming one draft return one permanent result; competing drafts for the final quantity produce one winner and one over-receipt rejection. Injected final audit failure leaves no stock, receipt, PO change or received draft version.

Browser decoding and permissions are synthetic. The harness returns predefined label values and provides a canvas MediaStream with tracked cleanup, rather than reading physical barcode pixels or opening a physical camera. Automated browser evidence establishes application behavior only. Existing workflows run in the full regression suite; no human operator acceptance is inferred.

## Preserved failures

- Initial typecheck failed with duplicate imported receipt types and test typing/projection errors. Removed duplicates and made test/history fields explicit before passing checks.
- First focused Node run: two passed/five failed (1284.60025 ms). Draft confirmation nested a command transaction. Extracting the shared private owning receipt operation kept one outer transaction and resolved the failure.
- Second focused Node run: six passed/one failed (1131.532083 ms). The test expected an incorrect stock-state/movement name; corrected it to the actual quarantine condition and receive movement. The third run passed all seven.
- First focused browser run: camera fallback passed; receiving timed out at 60 seconds because its locator used “Observed SKU” instead of “Observed SKU on delivery.” Second run: one pass/one failure (8.3 seconds), because the test's alert substring was inadvertently changed with the field locator. Restored the distinct error-message assertion; third run passed both without changing application behavior.
- A structural check during documentation assembly reported missing links to this not-yet-created receipt; the final check follows creation of both receipts.

## Unresolved qualification

CH-01/CH-05/CH-07/CH-08 and G2/G5 remain unverified. Real cameras/browser versions, scanner pairing/firmware/suffixes, label generation/printing/readability, warehouse connectivity/custody and approved serial rules are outstanding. Native BarcodeDetector availability is limited; manual fallback is required. This receipt does not prove production schema upgrades, large-data queries, scale/fault/recovery targets, provider/device/residency certification, offline operation or full-system completion. All 44 tasks/10 gates remain NOT VERIFIED. Historical evidence is retained unchanged.
