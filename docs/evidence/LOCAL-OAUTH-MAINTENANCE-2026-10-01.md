# Local QuickBooks authorization maintenance evidence

Partial D-029/D-036/D-039 engineering; all 44 tasks and 10 gates remain NOT VERIFIED. [Hash-bearing companion](LOCAL-OAUTH-MAINTENANCE-2026-10-01.json), [maintenance procedure](../PROVIDERS.md#local-authorization-expiry-maintenance) and [runtime procedure](../RUNTIME.md).

Parent `33aa0bdb6248bf5631145dc3fff17ea005baa601`, branch `codex/local-distributor-checkpoint`. Candidate hashes identify the tested version; the subsequent local commit is recorded in the handoff. Direct macOS arm64 workstation, Node 24.16.0/npm 11.13.0, synthetic regional SQLite fixtures and separate local OS processes. Final checks began 2026-10-02 UTC (2026-10-01 Toronto); actual timestamps and exit codes are retained. No actual Intuit/provider/printer request, CI/cloud runner/session, publication, deployment, purchase/account or live data. No schema, package, lockfile or license change.

| Check | Actual outcome |
| --- | --- |
| `npm test` | PASS 1511/1511, including 16 new maintenance checks |
| `npm run test:e2e` | PASS 67/67 with production build; existing Chromium phone/desktop journeys, no new UI journey claimed |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `npm run verify:runtime` | PASS, exit 0; 187 copied inputs, 69 exclusively development packages absent, 27 child command records, CA/US each start twice, authenticated PDF/ZPL replay and local encrypted backup/restore |

The companion retains 290 tested-input hashes, 201 unchanged historical evidence hashes, 58 retained notice/license hashes, actual command/log metadata and the isolated runtime receipt. Documentation structure and whitespace are checked separately; they prove no product acceptance.

## What the checks establish

One atomic statement terminalizes at most 100 combined pending/exchanging attempts with one captured clock, clearing claims while conserving every other metadata column. Tests drain 205 mixed attempts across organizations in 100/100/5 batches, retain all active/terminal rows, check exact expiry and ninety-second boundaries, absent exchange start and no resurrection after clock rollback. An injected storage trigger aborts the entire batch; explicit retry applies both transitions without partial changes.

Current worker/binding/login authorization precedes exact-row status repair, including a row beyond a 105-attempt backlog. Authenticated HTTP status returns terminal metadata with no provider I/O; unauthorized reads cannot change it and no bulk-maintenance customer endpoint exists. Browser status is restricted to the initiating login. Startup without an encryption key and after customer permission withdrawal still cleans attempts while preserving existing encrypted credential rows byte for byte. Revoked worker authority and restore hold block scoped reads while filesystem-authorized cleanup remains available.

Four held token/company response tests prove deadline refusal both with and without cleanup. Existing credentials remain byte-identical, revisions remain unchanged and replay makes no further provider request. A separate process's held token response is fenced by cleanup before any company read or installation. Two independent process startups consume 200 attempts, and concurrent subsequent batches transition the remaining five once. Completion exactly at ninety seconds still installs once.

The full backend run starts an actual API server and inserts expired work after startup. After the real minute interval, an injected authenticator storage failure emits only its generic retry message while OAuth maintenance clears the interrupted claim. The server remains live and exits normally on SIGTERM. This is real timer/process coverage, not a shortened interval or clock simulation. The isolated production-install check separately exercises installed-runtime startup in both regions.

## Preserved corrections and limits

Initial failures were fixtures/oracles: null-prototype SQLite comparisons, invalid scope/mode, session cookie/CSRF/origin, copied fixture ownership/double close and restore table/current authority error expectations. Final tests preserve production authority and state assertions. Earlier focused outputs and formatter/type logs remain private and hashed; the final full backend includes stronger credential conservation and `/api/health` readiness. The prior `/health` readiness could have served static fallback and is superseded.

The row cap is not a query-cost, retention/index/backlog fairness or throughput qualification. Clock trust, production timing, actual Intuit behavior/authorization, credentials/key custody, vendor terms, physical residency, device support, load, disk/power recovery, incident/security review and human acceptance remain outstanding. Cleanup cannot recall transmitted codes, revoke upstream tokens or securely erase state hashes or older WAL/backup bytes. These synthetic/local outcomes pass no product gate and do not complete the full-system objective.
