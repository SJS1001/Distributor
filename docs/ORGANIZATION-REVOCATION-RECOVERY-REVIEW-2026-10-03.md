# Organization revocation recovery review — 2026-10-03

## Result and ownership boundary

**Deterministically reproduced parent remount defect; no production fix applied.**
The initial dashboard's final supplemental read changes the revocation panel's
React key, discarding an already displayed explicit recovery review. The exact
uncertain review remains in browser storage. Fixing the key/initial snapshot
lifecycle requires ROOT-owned `src/web/main.tsx`; changing it was explicitly
excluded from this assignment. The delivered regression intentionally remains
red until that parent repair. Do not treat this package as a passing repair.

Baseline is exactly `9c8c91a1fd8b619b66ec1de8783aca4313386912` on
`codex/local-distributor-checkpoint`, in the separate `Distributor-restore-review`
checkout. The restore repair, original `e33ad405a97479f42e59aca30f21054da9323f19`
package and earlier accounting work remain preserved. This delta changes only
the assigned existing journey scenario and this new report. Production
`organization-revocation.tsx`, its contract, main, fixture/server/spec, native
revocation, platform/schema, dependencies and shared tracking remain unchanged.

Read repository instructions, README, PLAN, DECISIONS, HANDOFF, the organization
revocation contract/runbook and relevant source/tests. The supplied canonical
owner rule requests stronger capability for credential recovery diagnosis.
Requested Astra/High remains unverified: effective model/effort are not exposed.
No nested executor or model change was attempted.

## Original failure and local reproduction

ROOT reported the retained full production run as 325/326 in 7.7 minutes, failing
the external-evidence text assertion after reload in the journey originally at
line 455. ROOT retains that original log, error context, trace and hashes
privately. This session has not inspected or replaced those artifacts.

An unchanged focused local run failed in the same journey, at the next checkbox
(original line 532) after the evidence text had briefly passed. The trace shows:

| Trace monotonic time (ms) | Event                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| 11973.292                 | Exact external-review POST attempted and aborted by the test before the server |
| 12194.960                 | Explicit recovery configuration GET                                            |
| 12212.129                 | Original receipt GET succeeds                                                  |
| 12204–12236               | Evidence-reference assertion completes successfully                            |
| 12243.016                 | Initial dashboard's final `/api/security` GET                                  |
| 12255.350 / 12255.514     | Two fresh organization authorization/configuration GETs after remount          |
| 12247 onward              | Confirmation checkbox disappears; operation times out                          |

The same production component correctly retains before transport, uses a Web
Lock, checks storage equality and operation ownership, and aborts on unmount.
`recover()` restores the exact unresolved review only after current configuration
and a matching receipt. It neither confirms upstream revocation nor resends it.
The parent then destroys that correctly recovered component instance.

Source chain in the baseline: `main.tsx` initially publishes `setData(d)` so
recovery screens are available before supplemental reads; after `/api/security`
it calls `setEventViewEpoch(value => value + 1)`. The revocation key includes
that epoch. Unmount aborts pending work and loses component-local `review` and
`receipt`; the new instance only refreshes configuration and retained storage.
That explains the reported configuration/disabled-revision/retained-ID-only view.

## Deterministic assigned regression

The original scenario now binds reload to the actual failed review POST, the
failure alert, and an exact retained `kind: review` payload matching the captured
POST. An enabled recovery button alone did not establish that transition; it was
already present for the earlier revoke. The local red trace did reach the review
POST, so premature retention is not claimed as the proven cause of that failure.

After reload the test intercepts only the final dashboard `/api/security`
response. It explicitly reads the retained receipt and first proves the external
review is visible. It then releases that response and waits for **Billing
identities and terms**, rendered by the completed parent snapshot. Storage must
still match byte for byte and the reviewed evidence must remain visible. This
last assertion deterministically fails on unchanged production. There is no
sleep, timeout increase, assertion weakening or retry-until-green loop.

The test retains the existing unchecked-confirmation, exact retry body, two local
evidence POSTs and only one provider-revoke POST assertions. Those final success
assertions remain unreached in this red run. The same-file competing-tab/late
navigation test still exercises genuine interruption and passes in the final
focused run. A synthetic retained-review attachment is captured for contract
inspection; raw artifacts remain outside Git.

## Proposed ROOT-owned patch (not applied)

The smallest candidate is to avoid advancing component refresh epochs when the
**initial** partial dashboard finishes. Deliberate refreshes with an existing
snapshot still invalidate views. At the baseline `refresh()` completion:

```diff
-    setEventViewEpoch((value) => value + 1);
+    if (data) setEventViewEpoch((value) => value + 1);
     setExtra(e);
```

`data` is the snapshot captured by this invocation, already used earlier in the
same function to distinguish initial loading. ROOT must review this against its
current main changes and verify initial recovery, deliberate refresh, navigation
and actor changes across affected panels. It is an untested proposed parent
patch, not part of this commit. An alternative narrowly stable revocation key
must preserve intentional refresh and actor-scoping behavior. Do not compensate
inside the credential component by auto-confirming, accepting late responses or
silently auto-replaying retained operations.

## Commands, environment and actual outcomes

Node 24.19.0, Linux/root, Chromium 153.0.8010.0 at the existing
`/tmp/quantity-chromium`; pinned repository dependencies reused unchanged.
Production bundle built from the unchanged baseline frontend. The existing
large-bundle warning remains.

Initial default Playwright invocation failed because its shell could not find
`tsx`; the explicit Node invocation then timed out starting the entire fixture
collection within its unchanged 30-second startup limit. Both setup failures are
retained. The focused harness subsequently imports the existing
`organizationQuickBooksBrowser` fixture and uses the exact synthetic fetch stub
from `tests/browser-server.ts`, refusing all other outbound requests. It runs
only the existing 3220–3234 fixture servers, not replacement production behavior.
The scratch Playwright config uses one worker, the existing 60-second test limit,
5-second assertions, retained traces and the same production journey import.
No repository fixture, config or spec was edited.

```sh
./node_modules/.bin/vite build
./node_modules/.bin/playwright test --config=/tmp/org-revocation-playwright.config.ts --grep 'organization browser revocation retains a review that never reached' --reporter=line
./node_modules/.bin/playwright test --config=/tmp/org-revocation-playwright.config.ts --grep 'organization browser revocation retains a review that never reached' --output=/tmp/org-revocation-deterministic-results --reporter=line
./node_modules/.bin/playwright test --config=/tmp/org-revocation-playwright.config.ts --grep 'organization (CA browser revocation|US browser revocation|browser revocation)' --output=/tmp/org-revocation-final-results --reporter=line
node --import tsx --test tests/organization-revocation.test.ts tests/organization-revocation-http.test.ts
node --import tsx /tmp/org-revocation-contract-check.mts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check tests/organization-revocation-browser-journey.ts docs/ORGANIZATION-REVOCATION-RECOVERY-REVIEW-2026-10-03.md
git diff --check
```

| Check                                       | Actual outcome                                            |
| ------------------------------------------- | --------------------------------------------------------- |
| Production build                            | Pass; existing bundle-size warning                        |
| Original focused journey                    | 0/1; recovered review disappears before checkbox          |
| Controlled ordering, focused journey        | 0/1; evidence disappears after parent snapshot completion |
| Final organization browser group            | 4/8 pass, 4 fail, 43.4 seconds, exit 1                    |
| Native organization revocation and HTTP     | 40/40 pass, 5620.893073 ms, exit 0                        |
| Browser recovery contract                   | Eight checks pass on exact retained synthetic review      |
| TypeScript, assigned formatting, whitespace | Pass                                                      |

The three other final browser failures are unchanged journeys: US lost-response
recovery, original-request retry after no commit, and malformed-response/damaged
storage. They fail while opening the initial review; their individual root
causes were not established or repaired in this bounded assignment. They are not
reclassified as passes or automatically attributed to the proven reload defect.
ROOT's full-suite integration remains necessary.

The foreground contract script validates the actual retained disclosure, exact
parse/serialize round-trip and unresolved receipt match, then verifies refusal
of wrong organization, wrong binding, surplus payload, tampered disclosure and
conflicting terminal resolution. It performs no transport or writes. Its input
is the 1,830-byte synthetic attachment in the final failing trace.

## Retained evidence

All filenames below are under `/tmp`; traces and contexts are outside Git.

| Artifact                                   | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `org-revocation-focused-baseline.log`      | `3662865b1a724c93fc12941d79fd7e8bdaf0e4d34d53915e20dcca722aa85c80` |
| Original focused trace                     | `6dbaa4cdfc787be5b383e0ca6725f413ca19f177e2682d07a3d7055b814b0cf1` |
| Original focused error context             | `192d4da526b1702e4c942c037857048dde3c34c4f6b7f9e7ec6dd4c4d1df6fa4` |
| `org-revocation-deterministic-browser.log` | `2fef62c4bac1d36b710e89344a2b596688370b8b296db54e8fe6ee479ac609da` |
| Controlled-order trace                     | `520924a96d22bf7ccdd57568da60a64dc215611f9adac62d4d3cf75eb5930e3e` |
| `org-revocation-focused-final.log`         | `3a048ba28594dc6a0b800b3e166ec961d733b42a74e5e6c205ed5ee4e09fc3d6` |
| Final target trace                         | `c5783bcd7d39729aa12eab5dc8cd4c8193fe226ecbc9fb351ff76dc7649be635` |
| `org-revocation-native-http.log`           | `3fdd33f670d084b20bd518dc5d1ca584aca99953596ec78c0f3326acd00da753` |
| `org-revocation-contract-check.log`        | `7e6ba300e278b4b6810c7379e306692b77990a57115ba8a49160d0f60fbfb98e` |

The original default-launch failures remain in `org-revocation-original-browser.log`
and `org-revocation-baseline-browser.log`. Exact patch bytes are transferred as
ordered base64 chunks of deterministic gzip, with raw patch and compressed
SHA-256/byte counts and per-chunk decoded hashes. Only this new delta is included.

All test processes finished and all organization fixture ports 3220–3234 were
confirmed closed. No real provider I/O, CI runner, deployment, PR/push/merge,
account, secret, dependency/workflow change, nested executor or background
reminder/automation was used. No subscription was created. Actual infrastructure
and all task/product gates remain **NOT VERIFIED**.
