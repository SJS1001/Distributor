# Local organization revocation browser receipt — 2026-10-03

Tested parent `189f1f2741d4423df6aa998cb9a7465b43930807`, branch `codex/local-distributor-checkpoint`, Node 24.16.0 on macOS arm64. The [machine receipt](LOCAL-ORGANIZATION-REVOCATION-BROWSER-2026-10-03.json) binds 568 tested source/test/configuration inputs, 288 production runtime inputs and privately retained evidence hashes. Direct workstation checks use synthetic disposable CA/US stores and intercept every provider request. No CI runner or actual provider call is involved.

| Command | Actual outcome |
| --- | --- |
| Final production Chromium suite | 311/311 in 5.4 minutes; exit 0 on the final repaired source |
| Focused native organization/browser-seam/HTTP checks | 68/68; zero failures/skips/cancellations/todo; 5,163.18275 ms |
| Empty stored-evidence regression | Initial failure reproduced missing refusal; final focused check passes 1/1 in 18.2 seconds |
| TypeScript, format and production build | Pass on final source; existing bundle-size warning retained |
| Isolated production runtime | Pass CA/US; all 288 copied inputs matched; 69 development-only packages absent; 35 retained command outcomes including expected refusals |
| Whole-project React Doctor | Exit 1; 52/100; 48 errors and 276 warnings; diagnostics retained, baseline not clean |

Eight new synthetic browser journeys exercise CA/US lost revoke replies with exactly one committed provider request and fresh finance-login receipt recovery; unknown provider outcome with offline external review after withdrawal and a lost committed review reply; explicit same-identifier/body retry only after a verified missing original receipt; competing-tab invalidation and abandoned navigation; malformed committed responses, corrupt and empty stored evidence without replacement; exact retained external review retry when its first request never reached the server; and original scoped history lookup from a new browser profile followed by local-only acknowledgment. The final full suite runs the added empty-evidence refusal on the repaired source.

Each review fixes the organization/company/binding/permission/disclosure and current credential revision. Browser evidence is read back before transport under same-profile Web Locks. Uncertain outcomes read original history first and never automatically resend. External review retains disabled credentials and restore holds. Server receipt lookup exposes the observed terminal outcome, but does not prove that this browser's exact evidence reference was recorded; the UI requires reconciliation with audit history before acknowledgment. Independent profiles/processes still depend on native authority/revision/receipt fences.

React Doctor's new-component findings were inspected against actual source: four `no-impure-state-updater` errors classify manually invoked `run(async ...)` callbacks as React state updater functions, although those callbacks are passed to the ordinary async operation wrapper and never to a React setter. One loading-reset warning points to the guarded `finally` reset. These five are interpreted as scanner false positives; two size/complexity warnings remain maintenance limitations. The full project is not declared statically clean.

Native/schema/dependency/license bytes are unchanged. A hash comparison proves 299 native implementation/test/fixture inputs identical to the published HTTP checkpoint. Its 2,432/2,432 full native result is historical evidence, not a fresh full native run for this browser slice. Focused 68/68 checks above are fresh. Runtime verification independently installs production dependencies, checks both disabled regional boundaries, renders PDF/ZPL profiles and performs isolated encrypted restore; expected refusal commands exit 1 and are validated by the harness.

The initial absent-control, incorrect component props, external-review and original-history failures, narrower green runs, the first 311/311 full browser result before the empty-evidence repair, the empty-evidence red log, and superseded runtime evidence remain privately retained under ignored `local-evidence/organization-revocation-browser-2026-10-03`. The empty-evidence failed trace was overwritten by the subsequent focused test invocation; its red log remains. Raw logs, synthetic stores/generated assets and sign-in data are excluded from publication.

The owner-requested frontend remains running at `http://127.0.0.1:5173/` (session 35082), with backend `http://127.0.0.1:3000/api/health` (session 69896). Fresh frontend/direct/proxied health checks return HTTP 200/CA. The private sign-in remains mode 0600 and its contents were not read. Both services use a separate private synthetic CA store with providers/carriers/browser authorization disabled; leave both running.

Actual provider grants/outcomes, external evidence truth, browser/host compromise and retention, regional infrastructure/key custody, devices, finance/security/load/recovery/operator/release qualification remain open. All 44 tasks/ten gates remain NOT VERIFIED; the full system remains incomplete. No workflows, new delegated session, PR, merge or deployment were used.

Planning structure/local links pass: 44 tasks, ten gates, 261 Markdown files and 1,483 local links. This checks document structure only.
