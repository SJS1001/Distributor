# System audit and refinement — 2026-10-07

## Scope and acceptance

Owner authorized iterative implementation across public, customer and administration experiences, including architecture, security, correctness, workflow wiring, hierarchy, visual consistency and accessibility. Baseline: `6471e00f5128fc0d85487a8ff81813342b855c57`, workstation synthetic fixtures. Production is unchanged. No deployment, CI, PR, provider operation or product-gate advancement is authorized by this review.

Each finding needs a concrete trigger, observed consequence, owner, correction and verification. Reviews trace visible actions through API authorization, native operations, persistence and subsequent reads. Opening a panel alone does not establish workflow completion. Failed checks remain retained privately. Independent reviewers challenge corrections before closure.

Acceptance requires: no unresolved critical/high findings; reproduced defects corrected with meaningful regression checks; task handoffs preserve exact records, drafts and reviewed revisions; keyboard and narrow-screen paths remain usable; primary actions and navigation have clear hierarchy; authorizations hold at the server boundary; and final integration passes on the identified source. User/operator acceptance, physical devices, live providers and actual infrastructure qualification remain separate evidence requirements. This document cannot certify “world class” by itself.

## Review lanes

- Security: sessions, account/site/role isolation, command boundaries, uploads/downloads, outbound destinations, errors and sensitive data. Detailed register: `SYSTEM-SECURITY-2026-10-07.md`.
- Domain: receiving, stock custody, ordering, fulfillment, invoicing/payment, return eligibility, warranty, repair, replacement and credit. Detailed register: `SYSTEM-DOMAIN-2026-10-07.md`.
- Experience: all page entrances, task hierarchy, consistent components, actionable states, refresh/retry, responsive geometry and complete workflow handoffs. Detailed register: `SYSTEM-UX-2026-10-07.md`.
- Integration: cross-lane corrections, architecture implications, regression results, versioned evidence and independent challenge.

## Iteration 1

Production dependency advisory scan reports zero known vulnerabilities on the baseline; this is a dependency signal, not a security verdict. Full browser baseline startup collided with the separately running preview on port 3125. No application tests ran in that attempt. Preview was paused for the isolated broad suite; the failed startup log is retained privately.

| ID | Candidate / consequence | State | Owner |
|---|---|---|---|
| SYS-001 | Workspace Refresh may leave customer summary, contacts and purchasing rules stale after another staff member changes them. Billing terms already receives the shared refresh epoch and is excluded. | Corrected; cross-engine refresh, revision and recovery checks pass | Experience |
| SYS-002 | Confirmed repaired-original handover gap: repair followed by restock removes sold custody and permits resale rather than returning the original to its customer. | Corrected; native custody/cost and cross-engine lost-reply handover checks pass | Domain / Integration |
| SYS-003 | Confirmed P1: generic inspection can release an active returned serial from quarantine into allocatable stock, bypassing claim disposition. | Corrected; native bypass and disposition regression checks pass | Domain |
| SYS-004 | Confirmed P2: rotating email addresses bypasses anonymous login admission limits and repeatedly invokes synchronous password hashing. | Corrected; rotating identifier, persistence, saturation and concurrency checks pass | Security |

## Subsequent challenge and correction

Independent challenge reproduced a two-connection account-slot capacity race. Admission now reserves the account slot atomically and rechecks capacity when recording failures after hashing; authenticated reauthentication reserves its failure slot without consuming login budgets. Independent domain review also caught a missing `repair.handover` inventory-cost movement classification; the carrying-value oracle now proves the approved current value leaves stock without rewriting acquisition cost. Integration found retained pricing requests losing their visible frozen form after reload; authorized reads now restore the exact original request and reviewed revision for inspection and retry. Claim activity now presents readable repair custody fields instead of the internal entitlement envelope.

Earlier broad browser runs exposed stale harness expectations for removed customer Saved filters, public Sign in, receiving entry labels and consolidated customer pricing history Refresh. Corrections preserve the underlying action/history assertions. One run was invalidated by deleted old bundle assets during concurrent builds; it was stopped, its evidence retained, and subsequent browser runs use a frozen build. The intermediate `index-BL21wcHE.js` / `index-BNY86wVX.css` run completed with 328 passing checks and 15 failures caused by obsolete navigation and selector expectations; the behavioral assertions were retained when correcting those selectors. A later full-suite startup timed out under concurrent full-native CPU load without running any application check; the final run was started after native completion.

The final correction adds complete, scoped purchasing recovery across reloads and a shared command sender that coordinates competing tabs, persists before transport and conditionally clears only the exact attempted payload. A currently denied pricing read hides retained form and retry controls. These corrections received cross-review and have expanded browser regressions. The frozen `index-i4JWelsH.js` / `index-BNY86wVX.css` broad browser run completed with 342/343 passing. Its final sold-serial case reached a legitimate login refusal after other tests exhausted the shared loopback peer budget. Running that case alone on a fresh fixture passed; the test now has a dedicated seeded native/HTTP fixture isolated from unrelated login traffic without weakening production limits or its business assertions. The final HistoryList correction uses `index-CJgo2XAO.js` / `index-BNY86wVX.css`.


## Further challenge: current history authority

SEC-02 (P2) was identified after the first final frozen build: customer record history retained previously loaded rows and a paging cursor after a current 403/404. The native read correctly denied access, but the interface still displayed prior private records. The correction clears rows and the cursor on current 401/403/404 while preserving them for transient network/5xx failures. Cancelled reads cannot clear a newer result. Security and domain reviewers independently inspected the correction. New cross-engine cases first retain a page after 503, retry its exact cursor successfully, then assert that denied access removes private links, table and Load more while retaining a readable error and Retry. Final verification passed all 28 recovery/history cases across Chromium/WebKit on `index-CJgo2XAO.js`.

## Operator acceptance and subsequent iterations

Local evidence is necessary but does not establish that real staff and customers find the workflows intuitive. The next operator review should exercise the working preview against these outcomes, with usability observations recorded as reproducible findings:

- Staff receives a supplier delivery, distinguishes draft from committed stock, and locates the receipt and exact serial history without instruction.
- Staff creates a product, publishes real photographs, configures the customer's amount and quantity minimums, and confirms the customer sees the intended product and terms.
- A customer selects equipment, completes an order, follows its approval/fulfillment status and locates the resulting invoice without duplicate or ambiguous entrances.
- A customer registers installed equipment, distinguishes return eligibility from warranty coverage, submits the appropriate request and understands the next step. Staff can complete inspection, replacement, credit or repaired-original handback with the correct custody and financial result.
- Staff and customers can recover from refresh, temporary failure and an uncertain committed response without lost drafts, substituted records or duplicate effects. Keyboard and phone navigation remain usable.

The owner can review layout and terminology in the local preview now; realistic volume, physical devices, real provider handoffs and production infrastructure require their own authorized environments. Large composition files and scanner maintainability advisories remain documented architecture risks. No reviewer consensus can substitute for owner/operator acceptance, and no synthetic receipt establishes production readiness. New concrete observations feed the same reproduce, correct, regression-check and independent-challenge loop rather than a blanket polish declaration.

## Final integration receipts

All checks use synthetic workstation fixtures, with no production mutation. The final production-source manifest contains 439 TypeScript/TSX/CSS files, SHA-256 `f54ccd3e31935ea76f7752c279a0ebf4c59a134ee2eec2c2e360f18374c7d276`, stored privately with per-file hashes. Final bundle: `index-CJgo2XAO.js` / `index-BNY86wVX.css`.

| Check | Version and actual outcome | Limits |
| --- | --- | --- |
| Full native suite | 6,134/6,134 passed before the final reauthentication reservation correction | Final affected identity/MFA/session paths separately passed 25/25 afterward; final boundary checks passed 17/17. This is not one post-change full-native receipt. |
| Broad browser suite | Frozen `index-i4JWelsH.js`: 342/343 passed | Last case hit shared-fixture login admission; isolated fresh-fixture run passed on `index-CJgo2XAO.js`. The dedicated fixture case passed with production authentication and limits intact. Historical failure retained. |
| Page-by-page traversal | Final `index-CJgo2XAO.js`: 2/2 passed, Chromium/WebKit | Each engine: 15 admin and six customer destinations, 80 surfaces, 240 width checks, 130 safe recorded actions at 1440/390/320 px. These safe entrances alone do not prove every possible mutation. |
| Recovery and current authority | Final `index-CJgo2XAO.js`: 28/28 passed, Chromium/WebKit | Prior 24/24 recovery and 2/2 readable repair activity passed on `index-i4JWelsH.js`; the final receipt verifies the added history authority correction. |

Private logs retain failed startup, stale-asset, stale-selector, test fixture and genuine application-defect iterations. Type/build/format/planning/diff checks pass at the recorded final build; final documentation/test-only changes are checked before publication.

The final affected customer-record journey also passes on Chromium and WebKit (five cases per engine), after updating its old residency assertion to select the existing Data location tab. Its initial stale-tab failure is retained privately. The existing standalone WebKit journey also lacked the HTTP-fixture CSP adjustment used by the other suites: trace confirmed HTTPS asset upgrades against a plaintext loopback server. Its test-only document interception now removes that one directive; production headers remain unchanged. The failed/interrupted run is retained. Final React Doctor reports 33 warnings and zero errors: component size, dependency/performance and semantic advisories remain documented. The history async-clearing advisory was manually cross-reviewed: clearing is guarded by the request's abort signal, and account routes remount the component; this scanner signal does not demonstrate stale-response clearing. No suppression was added.

Within this bounded review, cross-review agrees the confirmed findings have meaningful corrections and no unresolved critical/high finding has been demonstrated in the inspected scope. The next iteration is owner/operator acceptance of the preview, then any newly observed findings. This is a qualified engineering conclusion, not universal security assurance or a world-class declaration.
