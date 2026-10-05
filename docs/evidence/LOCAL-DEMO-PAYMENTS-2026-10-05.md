# Native demo payments and gateway privacy — 2026-10-05

This is focused, synthetic engineering evidence, not verification of a task, gate, production provider or complete demo parity.

## Change and boundary

- A demo-only, per-workspace processor now supplies fictional checkout/refund responses to the existing `ProviderRuntime`. The native worker, signed callback receipt, identity/amount comparison, billing settlement, credit/refund rules, role checks, residency checks and deduplication execute normally. There is no checkout redirect, card entry or network transport. Preparing a checkout simulates successful payment automatically.
- The seed explicitly records fictional Stripe disclosure/acceptance for Maple Workshop. The second customer retains its existing default policy. Native withdrawal remains effective. Processor results and a random signing secret are isolated to the temporary instance.
- The demo worker serializes ticks, retains failed callback deliveries for retry, and stops before database disposal. Worker permission failure retains native state; it does not relax authorization.
- Inspection found that the gateway copied inner cache/referrer headers over its outer privacy policy. Forwarding now reapplies `no-store` and `no-referrer`. The regression fixture supplies deliberately weaker inner headers and verifies that both remain restricted while binary responses and cookies still pass through.

No production runtime guard was replaced. The actual application and demo share the existing payment and authorization implementation; these checks are not a comprehensive security audit.

## Source and environment

Base HEAD: `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703`, branch `codex/local-distributor-checkpoint`, uncommitted working tree with concurrent work preserved. Direct macOS arm64 workstation / Node 24.16.0; temporary synthetic databases and offline signature helpers only.

Post-verification source fingerprint: `9dcfe06e110b860f9ae96973b35417e7697b13f99d81029b7ffdb2e6ad37326d` over 795 source/test/config inputs, recorded privately in `local-evidence/demo-simulation-source-20261005.json`. This was not a pre-run freeze and does not bind unrelated earlier receipts to this candidate.

| Changed input | SHA-256 |
| --- | --- |
| `src/demo/payments.ts` | `0b12a16052e6c8ee123572676f53fc16f3c82668979fc8defdd984cae888e872` |
| `src/demo/runtime.ts` | `92107b11c4187a15b01ccf5010738fb1c700b8745411c367a58a2b3373cf6ecc` |
| `src/demo/seed.ts` | `dfbde6077680fe282613605130963818d15ef6eb783a412d3512cc6e6e4ab864` |
| `src/demo/gateway.ts` | `8f5bdbb2005ed0a1f7025e9e421f311014068cbcb23c70d785973ce5723ba2a7` |
| `src/demo/onboarding.ts` | `3a21555b8e972f29889c8397d02644244cfbfc856b2af8afcd858914a92f1880` |
| `src/web/demo-notice.tsx` | `efe3788a7f477820ce8d4acd8409df6fa658e6417b4e7da2d3a0d7cb5882b200` |
| `tests/demo-payments.test.ts` | `faf67491ccfc2c935a333446c20d51f55e75fefaa091a4a9051ad872f297af23` |
| `tests/native-demo-gateway.test.ts` | `22163536ee60e03834a319f9978b0b18b9dfa7c8e40ca309e11db57441e879d9` |

## Actual verification

- First combined run: 9 passed / 1 failed, exit 1. The new test referenced nonexistent `billing.payments`; corrected to the existing `billing.refunds.payments` read interface. TypeScript caught the same test defect. No product defect was inferred from that failure.
- After correction and gateway privacy repair: 10/10 passed. After adding callback retry retention and the actual demo HTTP/worker settlement check: 11/11 passed, exit 0, 3258.570416 ms (four payment tests plus seven gateway tests).
- After adding an explicit failed-callback delivery regression: `node --import tsx --test tests/demo-payments.test.ts` passed 5/5, zero failures/cancellations/skips/todos, exit 0, 797.478833 ms. Thus twelve distinct focused tests were exercised across the final relevant runs, not one twelve-test frozen suite. Gateway runtime/source was unchanged by the final test-only addition.
- Payment tests cover native settlement/refund exactly once, withdrawal before settlement, revoked worker grant, invalid signature, processor isolation, final write refusal, detached results and callback delivery retry without duplicate cash.
- The new gateway test uses onboarding, native admin authentication, the real checkout command and the scheduled worker, then observes an invoice balance of zero. Existing gateway checks retain authentication/isolation/reset/expiry/binary/cookie/rate coverage. This HTTP injection test is not a browser journey.
- Final `npm run typecheck`, `npm run build`, scoped Prettier check and `git diff --check`: exit 0. Vite retains its main-chunk size warning (661.42 kB minified). No browser or full-suite rerun.

Private payment, build and typecheck logs: `local-evidence/demo-payments*-20261005.log`. Gateway combined results were observed in command output; no separate retained raw gateway log is claimed for this pass.

## Remaining work

QuickBooks and carrier simulations (including labels/manifests), interactive payment failure/expiry/pending-refund scenarios, actual OAuth and external provider/device/operator/hosting qualification remain open. The public Site still serves the earlier simplified demo; no publication or server deployment occurred. All 44 tasks and ten acceptance gates remain unverified individually. No CI, runner, PR, merge, push, live payment, provider request or production data was used.
