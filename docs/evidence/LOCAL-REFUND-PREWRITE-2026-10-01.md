# Local refund write guard — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-024/D-033 engineering relevant to CH-07/08; all 44 tasks and 10 product gates remain NOT VERIFIED, and the full system is incomplete. Reviewer: Codex source review and workstation checks without independent customer, finance or provider acceptance.

Parent local commit `4414cf8`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-REFUND-PREWRITE-2026-10-01.json) binds the candidate, documents, available local logs and byte-identical historical evidence. It excludes its own bytes from circular hashing; the subsequent actual local commit identifies delivery. This checkpoint closes the coordinator wiring gap recorded in the unchanged [checkout receipt](LOCAL-CHECKOUT-ACCESS-2026-10-01.md).

## Observed behavior and oracle

The refund coordinator now supplies the configured Stripe SDK adapter's synchronous pre-write callback. After retrieving the original settled test PaymentIntent, immediately before refund creation, the callback checks current real active regional finance/password authority, restore clearance, current named customer permission and reviewed terms, held poll token, running/unbound effect and unchanged provider/kind/account/reference/payload. Billing checks the exact frozen native money/payment/invoice intent, unknown reservation state and absence of any prior provider proof through its owning API. The guard's transaction ends before the SDK request. The SDK is configured without automatic network retries.

A changed restriction, native intent or abandoned claim blocks creation. The claimed refund stays unknown, with its cash reservation retained and no automatic resend. Qualified original-payment reads may recover a matching result; an absent read remains unknown. A stale sender cannot clear its successor's live poll token. Matching outcomes from an authorized write may be retained if consent is withdrawn inside that write, while future outbound processing is blocked. Existing completion authority/restore/token checks remain in force.

Synthetic fixtures use a CAD 11,300-cent settled Stripe payment, one invoice-unit credit and an 11,300-cent refund reservation. Explicit promise barriers pause the actual SDK adapter's mocked PaymentIntent read. Six scenarios change consent, current terms, restore hold, active status, role or required password change before release; each records one preliminary read, zero refund creates, unknown native/effect state and zero observations. Password change uses the actual administrator reset command; active/role scenarios inject durable grants directly and do not qualify administrator workflows.

Four fault scenarios change native amount, native state, prior provider proof or frozen effect payload. Each blocks creation, retains zero refunded cash and writes no new provider observation; the proof scenario retains only its deliberately injected pending observation. Two application connections share one fixture database for explicit stale recovery: a successor holds a read claim while the old sender resumes, cannot create a refund or release that claim, and two matching later observations leave refunded cash at exactly 11,300 cents. This new test does not terminate an OS process. Existing focused callback/refund tests retain their earlier separate-process verification scenarios.

Read-only recovery checks the original reservation prevents a second one-cent refund; after explicit customer permission restoration, sending is still refused, an empty mocked list retains zero cash/unknown state, and a matching list records exactly 11,300 cents without any create. A normal authorized SDK create withdraws consent inside its mock and retains one matching cash observation; the next read is refused without another preliminary SDK call. No actual Stripe request occurs.

## Checks

| Command | Actual outcome |
| --- | --- |
| `npx tsx --test tests/refunds.test.ts tests/refund-callbacks.test.ts` | PASS 39/39, zero fail/cancel/skip/todo, 2513.137459 ms, exit 0 |
| `npm test` | PASS 442/442, zero fail/cancel/skip/todo, 15690.699833 ms, exit 0 |
| `npm run test:e2e` | PASS 37/37, reported 1.3 minutes, exit 0; build PASS 280 ms |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |

All final candidate source/test/configuration edits precede these checks. Documentation and evidence were created afterward. Planning/link, whitespace and independent hash/historical-byte checks follow documentation creation; these validate structure and binding, not product acceptance. Local temporary logs are available evidence, not a durable production archive.

Preserved focused failure: the terms test expected `RESIDENCY_BLOCKED` but correctly received `DISCLOSURE_REVIEW_REQUIRED`; its assertion now checks that precise denial. The password fault initially updated a nonexistent bootstrap security row and therefore did not change authority; the actual reset command now establishes the required password change. The initial 36/39 result includes the failed parent scenario and is not a pass. Failed patch attempts changed no files. Initial link validation also rejected the missing companion and interpreted the original receipt filename ending in `GUARD` followed by the year as an unknown task ID. The final filename uses `PREWRITE`, and its companion now exists. Historical receipts are retained unchanged.

Self-review covers owner API/table boundaries, real current authority, customer terms/permission, frozen money and state, existing provider proof, durable claim recovery/late fencing, unknown reservation/no resend, authorized observation retention and native cash conservation. Dependencies, lockfile and license notices are unchanged; no third-party implementation copied.

## Remaining qualification

Native transactions and external writes are not atomic. The guard narrows races and cannot recall a sent request; restrictions may still change after its transaction ends. Trusted custom adapters must honor the supplied callback. Preliminary SDK reads already authorized before withdrawal may complete; this checkpoint blocks the subsequent write rather than recalling that read. New contention uses two connections in one process and forced expiry, not new OS termination evidence. Refund/payment lists and observation history remain unpaged. Actual provider/bank/customer/finance qualification, production upgrades/load/locking/clock/retention/security/recovery/residency and operating/human acceptance remain open. Stop old writers before upgrading; mixed versions are unqualified.

Direct workstation checks and local commits only: no CI jobs/runners, workflows/registrations, push/PR, actual provider accounts/requests, live data, deployment/purchase, publication/settings changes or OPUS/UB integration. Future CI remains GitHub-hosted after separate authorization and qualification. No fresh remote-access claim is made.
