# Native demo carrier simulation — 2026-10-05

Focused fictional engineering evidence only. No acceptance task or gate is closed by this receipt.

## Scope

Offline per-workspace adapters now connect UPS, FedEx, USPS, Purolator and DHL booking to the existing native carrier runtime. Each advertises a simulated account and DEMO_GROUND service; labels are valid PDF files prominently marked SIMULATED / NOT VALID FOR SHIPPING. Canada Post uses a separate per-warehouse offline creation/manifest client. Both its labels and manifest documents are marked simulated. No carrier account, credentials, network transport or provider SDK was added.

The normal runtime still enforces current warehouse grants, reviewed configuration, customer residency permission, shipment identity, duplicate handling and explicit warehouse handover. Booking and manifest generation do not themselves alter stock or create invoices. Seeded Maple Workshop has fictional named carrier permissions; Lakeside retains strict defaults. Ordinary customer withdrawal remains effective. Results are detached copies and recovery reads only return observations already created inside that workspace. Before-write checks execute after PDF generation and before storing a result.

These generic fictional responses do not model carrier-specific rates, customs acceptance, service eligibility, API rejection/recovery contracts or delivery tracking. In particular, a Purolator simulation is not evidence that its real API has been qualified. Existing native DHL review requirements still apply; DHL customs paths were not newly exercised here.

## Candidate and environment

Base HEAD `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703`, branch `codex/local-distributor-checkpoint`, dirty working tree; other work preserved. Direct macOS arm64 workstation, Node v24.16.0, synthetic temporary databases. No CI, runners, PRs, merge, push, deployment or external provider traffic.

Final source/test/config snapshot was captured before the corrected focused test batch at 2026-10-05T07:20:36.406193+00:00. It covers 805 files under src/tests/scripts plus package/config inputs. SHA-256: `6f1640dea485935cc468f4c4aeaa92ee0ad965b34ece6c926cded165d28ce849`. Private manifest: `local-evidence/demo-carriers-source-final-20261005.json`. Recomputed hashes after carrier verification matched every captured file. A later planning-parser-only correction is recorded below; application/test inputs remain unchanged. The earlier failed-test snapshot is retained separately. Typecheck/build ran before the final test-only literal correction; application source and build inputs did not change afterward. This does not rebind historical receipts to this candidate.

| Input | SHA-256 |
| --- | --- |
| `src/demo/carriers.ts` | `79a8cb9541f3314c6c893b3dca06b1bea0257bcdb4bd65cb5e11b8e88b6e9d63` |
| `src/demo/runtime.ts` | `86b9d254bf0d7b5eab6661a832f22660f35259cf9ef64d243d2fa31b771a8d1e` |
| `src/demo/seed.ts` | `2ddb9d4247c6b49dcdf179b59c3fdc57ef4c971d25dc495f4b77af4338e25d20` |
| `src/demo/onboarding.ts` | `7f78a143f9269bded561b271654a2fef780ab8ebd04d4be9f5c896aef7958648` |
| `src/web/demo-notice.tsx` | `cd01396becfb213768d106d23c8aa98c22c52eb75410292dec70a38363501664` |
| `tests/demo-carriers.test.ts` | `1856d42f90b581a4f520a71e8d16d4e02b0c4be9f458742ed83e2781b04b23c7` |
| `tests/native-demo-gateway.test.ts` | `591adc5929bfab93a50eb5710a6d432ddb90137732722233a1bc48051821160c` |

## Actual verification

- Initial TypeScript check caught the untyped database warehouse ID at the runtime binding boundary. Converted it to the existing string identity form; the subsequent typecheck passed.
- Initial four carrier tests passed. Adding manifest result isolation and gateway wiring checks produced 12/12 passing tests, zero other outcomes.
- Adding the native non-warehouse-role regression produced 12 pass / 1 fail: permission refusal worked, but the test expected a nonexistent `prepared` booking state instead of native `pending`. Corrected that test expectation; no production-state change was made. Retained failed output: `local-evidence/demo-carriers-final-20261005.log`.
- Corrected `npx tsx --test tests/demo-carriers.test.ts tests/native-demo-gateway.test.ts`: 13 passed, zero failed/cancelled/skipped/todo, 3395.564417 ms. Log: `local-evidence/demo-carriers-corrected-20261005.log`. The shell printed the saved log after running the test, so its tool exit is the print command's status; the test result claim is grounded in the test runner's complete summary.
- Six carrier tests cover booking/label PDF, explicit handover and exactly one invoice, customer withdrawal, native role refusal, two-member Canada Post creation/manifest/handover, denied final-write guards, read-only recovery, foreign-workspace manifest refusal and detached result bytes/identities.
- Seven gateway tests include actual seeded HTTP Canada Post enablement, actual queued checkout/worker settlement, authentication/visitor isolation, Origin/CSRF, reset/expiry leases, resource bounds and binary/privacy forwarding. These are HTTP injection checks, not browser journeys.
- `npm run typecheck`, `npm run build`, scoped Prettier and `git diff --check` passed with exit 0. Vite retains the existing main-chunk warning (661.43 kB minified). No full suite or browser pass was repeated.

## Outstanding / next slice

QuickBooks simulation, interactive payment failures/expiry/pending refunds, actual OAuth and the broader application security/wiring review remain open. Provider/device/operator/hosting qualification remains separate. All 44 tasks and ten acceptance gates remain individually unverified. The public Site still serves the earlier simplified demo and has not been updated by this local runtime change.

Next bounded slice: inspect native QuickBooks effect/authorization contracts, add offline simulation without bypassing those controls, and verify its representative accounting outcomes. No completion time is established until that contract inspection is complete.

## Planning validator follow-up

The first `npm run verify:plan` exited 1 because its unbounded ID regex matched the scenario-prefix substring for twenty inside existing `RESEARCH-2026` documentation filenames. Added word boundaries around the complete ID alternatives. A first ad-hoc parser check imported an unused nonexistent helper and raised ImportError; corrected the import. Focused checks now recognize all ID families and an unknown scenario ID ending in ninety-nine, while excluding the research filename and partial longer IDs. The subsequent `npm run verify:plan` exited 0: 44 tasks, ten gates, 11 scenarios, 14 decision sheets, 22 requirements, 421 Markdown files and 2129 links. This proves planning structure only.

This post-test script change has SHA-256 `280cbf82805676da0398ebf9cab8f3965c530ab554766bd7096d2e0f547c28f7` for `scripts/verify_plan.py`; it supersedes that single file's hash in the carrier pre-test snapshot. No carrier test or application input changed.
