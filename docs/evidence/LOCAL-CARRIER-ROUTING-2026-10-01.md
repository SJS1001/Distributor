# Local named carrier routing, 2026-10-01

**PASS — bounded local engineering only.** Partial D-027/D-036 evidence for CH-01/CH-07/CH-09, REQ-03/REQ-16/REQ-19, G5/G7. All 44 tasks and 10 product gates remain **NOT VERIFIED**. Parent agent implementation/self-review; no independent reviewer or actual operator/provider sign-off.

Parent `d2107f3b4a74e839e92569af0c02c72e1c0d3d01`, branch `codex/local-distributor-checkpoint`. The [content record](LOCAL-CARRIER-ROUTING-2026-10-01.json) binds 222 tracked application/test/configuration/license inputs, final documents and 147 unchanged historical evidence files. Final inputs were compared with current bytes before this receipt. A subsequent local commit contains these exact content bindings.

## Environment and expected results

Direct workstation commands in `/Users/stevensmith/Documents/Distributor`; macOS-27.0-arm64-arm-64bit-Mach-O, Node v24.16.0, npm 11.13.0. Repository-pinned dependencies; disposable native SQLite and synthetic CA/CAD organizations, customers, two sites and shipments. No dependency/schema/lockfile/UI changes. No CI jobs/runners, cloud checkout/source transfer, push/PR, provider account/request, deployment, purchase, live data, publication or OPUS/UB integration.

- Registration accepts multiple unique organization/carrier pairs and rejects duplicate/malformed/empty/sparse configuration. Captured identity and bound methods remain stable if the caller mutates its registration array/object/hooks, while preserving the trusted adapter receiver.
- Each of six named providers dispatches only to the exact saved booking provider, independently of registration order. Tests accept only that named provider. A missing organization/provider pair calls no fallback and preserves pending native/booking state.
- Fresh actual role, site, active status and password restrictions defeat forged/stale actors before hooks. An actual foreign-organization booking row placed in the same integration store is not returned or dispatched; exact retained fields remain unchanged. Saved-intent provider corruption fails hash verification before hooks.
- Registering FedEx does not grant customer acceptance. An undisclosed provider cannot prepare; withdrawal after UPS preparation blocks dispatch before hooks and preserves pending state. Unknown after a simulated lost response cannot resend; reconstructing runtime with reordered bindings still performs only the original provider lookup and retains booked evidence. Native stock/order/shipment/invoices remain unchanged by booking/reconciliation.
- HTTP review reports saved FedEx eligibility with UPS registered first. An attempted client provider override rejects before any hook; the empty-object send selects only FedEx and retains booked metadata.

Eligibility itself is organization-level registration metadata; it grants no shipment-site authority or customer exception. Trusted adapters retain their original object receivers; method capture is not an untrusted code sandbox. All six-name routing fixtures are synthetic adapters, not six implemented vendor clients. Original UPS transport checks also run with injected fake fetch; no provider is contacted.

## Actual commands

| Command | Final observed outcome | Command duration |
| --- | --- | --- |
| `npm test` | PASS 755/755; zero fail/cancel/skip/todo, reported 24001.808291 ms; exit 0 | 24.199 seconds |
| `./node_modules/.bin/tsx --test tests/carrier-bookings.test.ts tests/ups-sandbox.test.ts` | PASS 121/121; zero fail/cancel/skip/todo; exit 0 | 12.853 seconds |
| `npm run typecheck` | PASS, exit 0 | 1.093 seconds |
| `npm run format:check` | PASS, exit 0 | 7.541 seconds |
| `npm run build` | PASS, exit 0, unchanged application bytes | 0.526 seconds |

Only the foreign-row backend test changed after the build capture; the companion records that exact difference. The final full/focused/type/format checks ran on the strengthened test. No frontend edit, so Chromium was not rerun; prior 48/48 browser evidence remains historical. New HTTP behavior uses native injection. Planning/whitespace checks run after receipt creation and their actual results are recorded in the companion.

Preserve initial focused FAIL 111/119 and initial type FAIL: two fixtures omitted region, and the site test incorrectly expected organization registration eligibility to require a shipment permission. Corrected tests retain site checks at dispatch. A later scoped foreign-row run failed 0/1 on SQLite null-prototype equality; comparison now binds exact retained database projections. Intermediate focused/full passes precede that stronger case. No failed/intermediate run substitutes for final evidence. Private result records/log hashes remain under `/tmp/distributor-carrier-routing-checkpoint`, with no archival guarantee. An unsuccessful patch match changed no state.

## Remaining scope

The new recovery case reconstructs the runtime with reordered adapters; it does not restart the application/database or terminate a provider process. Earlier UPS restart/process coverage remains part of the full suite. Normal startup still binds no carrier; no new vendor protocol, actual account/service/label/device, credential lifecycle, residency infrastructure, fees/terms or provider correlation is qualified. Production security/load/locking/retention/upgrades/recovery and actual business/operator acceptance remain open. Changed runtime/coordinator/authority/contracts/configuration/dependencies invalidate affected evidence. This receipt cannot pass a product gate or complete the full system.
