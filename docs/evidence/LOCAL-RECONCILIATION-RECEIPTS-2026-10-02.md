# Local retained reconciliation receipt verification — 2026-10-02

Status: PASS for the recorded local synthetic engineering scope. Full system incomplete; all 44 tasks and 10 product gates remain NOT VERIFIED. Partial D-025/D-036 coverage only.

## Tested version and environment

Local parent `58edc56c8822185b01cf9b66fda9822ab19ee05a` plus the exact candidate and 327 tested input hashes in [the companion manifest](LOCAL-RECONCILIATION-RECEIPTS-2026-10-02.json). Companion SHA256: `0630653a59ff95d6bcd5749c5d76a2fa4fde8942f6cacdca3d7be7764a7170fd`. Direct macOS arm64 workstation with Node 24.16.0/npm 11.13.0, synthetic SQLite stores, loopback HTTP and Chromium against a production Vite build. No provider, scanner/printer or external customer data was used. No CI runners, cloud sessions, deployment, push or PR.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1628/1628, 14 new receipt tests |
| Full production-build browser (`npm run test:e2e`) | PASS, 73/73; enhanced phone receipt journey |
| Focused receipt/reconciliation/sales tests | PASS, 54/54 |
| Typecheck and formatting | PASS, exit 0 |
| Isolated production-only runtime install/startup | PASS, 203 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

Reviewed saves rescan displayed controls under current authority in the receipt/audit transaction, reject stale reviews and preserve the full store on conflicting inputs, failed scans, oversized documents and late audit failure. Independent writer contention cannot interleave stock/billing reads and save. Original JSON survives payment changes, exact idempotent retries, restart and encrypted snapshot restoration; later reports are absent at the restored cutoff and providers remain isolated. CAD/USD reports retain exact large integer strings, complete discrepancy counts and the first 100 details without private payment references.

Organization/current-role/active-state/password/MFA refusals cover history, bytes and cached saves. Stable 20-record pages handle clock ties, later appends and scoped cursors. Corrupt metadata/content and malformed or falsy cached JSON fail closed. HTTP checks exercise session, CSRF, strict payloads, private download headers, filename and exact bytes. The actual phone journey covers lost committed save response with the same retry key, one retained report, old bytes after payment, stale review/rescan, failed history retry, corrupt download refusal and sign-out during a held download with no late file.

The manifest retains command timestamps, exit codes and log hashes, runtime inputs/child commands, exact matching private/current production assets, prior evidence and license notices. Initial focused fixtures and the direct Playwright PATH invocation failure remain preserved privately; they were corrected without weakening production authority or integrity checks. The enhanced browser journey supersedes the earlier focused browser run.

## Limits

The review hash binds displayed organization/currency/version/totals/bounded details, excluding checked time and undisplayed underlying facts. Matching controls and SHA256 do not establish independent physical, bank/provider or commercial truth, a digital signature, tax policy or product acceptance. Saved JSON is capped at 512 KiB; downloaded copies require approved external access/retention/disposal policies. Actual customer policies remain open.

Synchronous scans/receipt transactions block other writers; retained evidence, lookup cost and explicitly loaded browser history grow with usage. Client cancellation cannot stop an already running scan or guarantee a save did not commit. Production volume, indexing, lock duration, real integrations/devices, infrastructure residency, security/load, disk/power recovery, agreed RPO/RTO and human acceptance remain unqualified. No schema, dependency, license or workflow change.

See [the operating procedure](../RECONCILIATION.md#save-and-retrieve-reviewed-evidence). This evidence authorizes no live integration or release.
