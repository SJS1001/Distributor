# Local unsent accounting credit cancellation evidence

Partial D-034/D-036/D-039 engineering, REQ-03/18/19/21 and scoped CH-07/08/09/10 coverage. All 44 tasks and 10 gates remain NOT VERIFIED. [Hash-bearing companion](LOCAL-ACCOUNTING-CANCELLATIONS-2026-10-01.json), [finance procedure](../ACCOUNTING-CANCELLATIONS.md) and [schema upgrade procedure](../SCHEMA-UPGRADES.md).

Parent `1b47807f452194a199ce6b227b64a1f2633760f9`, branch `codex/local-distributor-checkpoint`. Candidate and tested-input hashes identify the tested version; the subsequent local commit is recorded in the handoff. Direct macOS arm64 workstation, Node 24.16.0/npm 11.13.0, synthetic regional SQLite, independent local OS processes, loopback HTTP and intercepted provider responses. Final checks began 2026-10-02 UTC (2026-10-01 Toronto); actual timestamps, exit codes and private log hashes are retained. No CI/cloud runner/session, actual provider/printer request, publication, deployment, purchase/account or live data. No dependency or license change.

| Check | Actual outcome |
| --- | --- |
| `npm test` | PASS 1526/1526: nine added cancellation tests, five schema tests and one old-archive recovery test |
| `npm run test:e2e` | PASS 67/67 with production build; extended accounting phone journey exercises reviewed cancellation, a lost response/retry, retained history, explicit replacement and uncertain/completed refusal |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `npm run verify:runtime` | PASS, exit 0; 188 copied inputs, 69 exclusively development packages absent, 27 child command records, CA/US each start twice, authenticated PDF/ZPL replay and local encrypted backup/restore |
| Focused accounting/schema/recovery | PASS 63/63 |

The companion retains 293 tested-input hashes, 203 unchanged historical evidence hashes, 58 retained notice/license hashes, actual command/log metadata, built-asset hashes and the isolated runtime receipt. Documentation structure and whitespace checks are recorded separately and prove no product acceptance.

## What the checks establish

An active finance/admin principal reviews exact credit/invoice identity, currency, reserved amount and operation version before local cancellation. A reason and dedicated integration-owned receipt retain the original reservation and immutable intent; transport is blocked. Only this receipt releases capacity. Native credits, invoices, cash, stock and orders are conserved. Other blocked, rejected, running, unknown and completed applications retain their reservations, as do applications with a prior start, external reference, result or claimed/started lease.

Tests check stale review, amount mismatch, missing/oversized reason, wrong kind, unauthorized role/password/current access and strict authenticated HTTP boundaries. An injected late audit failure rolls back receipt, transport change, event, command and capacity together. Restart and repeated exact request return the receipt once; a changed reason conflicts, a new cancel request is refused and replay of the original queue cannot resurrect sending. Customer permission withdrawal permits the local operation without provider I/O; restored provider holds deny new and cached cancellation requests.

Separate processes exercise both send/cancel orderings: a claimed held send prevents cancellation and resumes once; cancellation prevents a later sender from reaching its synthetic adapter. Two competing cancellations create exactly one receipt and release once. Shared cash and credit applications constrain the same invoice; canceling one application releases only its amount and a separately recorded native payment can reserve that capacity again. An encrypted isolated restore retains a partial cancellation and pending remainder, conserves native facts and keeps the provider hold.

Schema four adds only cancellation storage. Frozen version-one/two/three fixtures independently identify old layouts. CA/US with reporting enabled/disabled upgrade to fresh files while preserving source bytes, regional metadata, native facts, encrypted credentials, sessions, Canada Post facts and nonempty uncertain QuickBooks revocation history. Partial/lying version-three profiles refuse before creating a destination. Current encrypted recovery rejects old version-one/two/three archives rather than silently upgrading them.

## Preserved corrections and limits

Initial focused failures were fixture/oracle issues: queued public responses intentionally omit private payloads, frozen version-three tables must precede indexes, and current recovery expectations changed from schema three to four. The first focused browser invocation served old built assets without the cancellation control; rebuilding production assets made the journey pass before the final full browser run. Failed/superseded logs and browser traces remain private and hashed. The companion preserves their actual exit codes; none is replaced with a pass.

Synthetic/local outcomes do not qualify actual QuickBooks API behavior, accounting correction policy, provider terms/credentials, physical regional hosting, key custody, physical devices, production security/load, disk/power recovery, agreed RPO/RTO or human acceptance. Separate-process SQLite contention is not a distributed writer or throughput qualification. Cancellation cannot recall sent provider work or establish that a restored pending snapshot remained unsent. Existing stores require reviewed fresh-file schema upgrades before current startup. The full Distributor system remains incomplete and no product gate is accepted.
