# Local demo accounting and payment scenarios — 2026-10-05

## Candidate and scope

Base HEAD `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703`, branch `codex/local-distributor-checkpoint`, with uncommitted changes. macOS arm64, Node v24.16.0. This receipt concerns the native local demo, not the published static Site or production qualification. Existing unrelated edits were preserved.

A post-verification source capture at `2026-10-05T07:47:50.981079+00:00` records 805 paths and SHA-256 `00bc37bbe4faebe983a655fed5db523c3d91638c8978462c3a0777ffa683a1f1`. The private manifest is `local-evidence/demo-providers-source-final-20261005.json`. It hashes all `rg --files src tests scripts` paths except `__pycache__`, plus existing package.json/package-lock.json/tsconfig.json/vite.config.ts. The aggregate hashes the sorted path-to-SHA-256 JSON object with compact separators. Capture followed the checks below; it is not represented as a pre-test snapshot. Source was unchanged between verification and capture, and the same manifest is checked again after documentation updates. Documentation, built assets and private logs are excluded.

## Changes and focused outcomes

- `src/demo/accounting.ts`: per-workspace offline ledger for native QuickBooks invoice, payment, credit, credit application, refund expense/application and balance reads. Parent identity, account scope, immutable retry payloads, cloned results and final authorization guards are checked. Ledger synchronization does not mutate native payment facts.
- `src/demo/payments.ts` and `scenarios.ts`: selectable success, unpaid/expired checkout and pending/failed refund outcomes. Changed account or request data cannot reuse a delivered payment effect. Pending/failed refunds do not increase native refunded totals.
- Runtime/gateway/onboarding retain the chosen workspace scenario, validate its allowed values and explain the simulated boundary. QuickBooks is bound to the existing native provider worker; fictional disclosures and customer exceptions are seeded through native operations.
- The same production UI source displays the demo notice. No second business-rule implementation or production provider configuration is loaded.

| Command | Actual result |
| --- | --- |
| `npx tsx --test tests/demo-accounting.test.ts` | Initial accounting check: 4 passed, exit 0. |
| `npx tsx --test tests/demo-accounting.test.ts tests/demo-payments.test.ts tests/native-demo-gateway.test.ts` | Expanded intermediate check: 22 passed, exit 0. |
| `npx tsx --test tests/demo-accounting.test.ts tests/demo-payments.test.ts tests/demo-carriers.test.ts tests/native-demo-gateway.test.ts` | Final combined check: 28 passed, zero failed/skipped/cancelled/todo; exit 0; 3724.59825 ms. |
| `npm run typecheck` | Final run exit 0 after correcting the adapter return annotation described below. |
| `npm run build` | Exit 0; existing 661.44-kB main chunk warning remains. |
| `npx playwright test --config tests/native-demo-browser.config.ts` | 1 passed, exit 0: expired scenario selection/persistence, 15 native pages, incoming allocation visibility, stranger isolation, buyer restriction, role switching and reset; no page errors. It does not exercise every accounting dialog. |
| Scoped `prettier --check` | All 12 changed implementation/test files checked passed, exit 0. |

Accounting checks cover native worker invoice/credit/application and balance reconciliation; paid checkout through cash synchronization, credit, refund expense/application; ledger isolation, cloned values, retry mismatch and final guard refusal; and native customer withdrawal/worker revocation. Payment checks cover unpaid/expired checkout without cash, refresh/closure/replacement eligibility and pending/failed refund accounting. Carrier and gateway tests retain their separately documented scopes.

Historical failure: an intermediate typecheck reported TS2339 at the accounting test's result access because TypeScript inferred a union from the adapter's implementation. The adapter now explicitly implements `Promise<EffectResult>`; the final typecheck passed. This was a type contract correction, not a removed assertion. Earlier logs are retained privately. The browser locator was updated before this run to expect the new visible scenario in the heading.

Private logs: `local-evidence/demo-accounting-initial-20261005.log`, `demo-providers-initial-20261005.log`, and `demo-providers-{tests-final,typecheck-final,build-final,browser-final,format}-20261005.log`. They are not published artifacts.

## Limits

No OAuth/company authorization, hosted payment form/card-decline response, email transport, cost/stock journal transport, real provider protocol qualification, hardware, residency hosting or protected operator procedure is proven. Pending refunds remain pending; reset selects another scenario. Seeded manual payments cannot be refunded through the fictional Stripe processor. Ledger state is temporary and discarded with the workspace. The public Site is unchanged.

No commit, push, PR, merge, CI runner, live provider request or deployment was performed for this increment. All 44 accepted tasks and 10 gates retain their existing unverified status. These are focused local correctness checks, not a universal parity or production-readiness claim.

Documentation validation: the initial planning check failed because the preceding carrier receipt/handoff quoted unknown scenario IDs as parser examples. Reworded those historical examples without removing their failure account or relaxing validation. Final planning and whitespace outcomes are recorded in the handoff.

## Source-bound repeat and delivery review — 08:41 UTC

To remove the original snapshot-timing limitation, source edits were held while the same 805 inputs were captured **before** checks at `2026-10-05T08:40:44.020530+00:00` and compared afterward at `2026-10-05T08:41:38.113105+00:00`. Both snapshots have the same `00bc37bbe4faebe983a655fed5db523c3d91638c8978462c3a0777ffa683a1f1` aggregate. Private manifests are `demo-providers-source-precheck-20261005.json` and `demo-providers-source-postcheck-20261005.json` under local-evidence.

The repeated combined provider/gateway run passed 28/28 with zero other outcomes, exit 0, 3970.517292 ms. TypeScript and build each exited 0. The browser journey passed 1/1 in 2.5 seconds, exit 0. Logs use `local-evidence/demo-providers-frozen-{tests,typecheck,build,browser}-20261005.log`. No source edits occurred during these checks. This remains focused coverage, not a full regression or acceptance result.

A separate source-reading pass reviewed the demo gateway's CSRF/Origin, selector isolation, lease/capacity and forwarding boundaries; temporary runtime shutdown; fictional accounting parent/credit/refund conservation and cloning; payment retry identity and unsettled outcomes; and native composition/HTTP/event-worker changes relevant to this slice. No additional demonstrated defect was found in that bounded pass. This was self-review, not an independent reviewer or universal security certification. The much larger preexisting UI/incoming-supply changes retain their own receipts and limitations.

Publication preflight: remote branch still points to base HEAD; the authenticated account is SJS1001, and only that account is configured locally. The recorded publication identity check expects sjsmithbot, so no push or GitHub mutation is attempted. A local source checkpoint may include the already authorized native application, tests and documentation needed to reproduce this demo; nested sites-demo, Python cache, runtime data and private evidence remain excluded. The separate warranty aggregate proposal is deferred in WARRANTY-SUMMARY-ISSUE-DRAFT.md.
