# Local provider queue and callback authority

Date: 2026-10-02. Partial engineering evidence only; all 44 tasks and 10 product gates remain **NOT VERIFIED**. Partial D-008/D-010/D-024/D-034/D-036 and REQ-03/REQ-15/REQ-18. See [machine receipt](LOCAL-INTEGRATION-AUTHORITY-2026-10-02.json), [provider procedure](../PROVIDERS.md#current-provider-queue-and-callback-authority), [user access](../USER-ACCESS.md#current-provider-authority) and [implementation status](../IMPLEMENTATION.md).

## Version and environment

Parent `e8cd0d8` on `codex/local-distributor-checkpoint`. The receipt hashes 353 final tested inputs and the candidate source/tests/docs; [handoff](../HANDOFF.md) records the local committed version and audit. Direct macOS arm64 workstation verification uses synthetic SQLite, loopback HTTP and production-build Chromium. No CI/cloud/delegation, actual provider/device request, live ingestion, push/PR, deployment or publication.

## Changed behavior and independent checks

Provider effect/list/pending/callback reads and accounting CSV refresh current active persisted role/account/password authority. Raw financial effects use the existing finance/support/admin privacy policy. Buyers follow current account assignment; supplied staff/account fields cannot elevate them. Commercial and buyer checkout/invoice access retains its existing scope.

Checkout receipt, including duplicate signed receipts, claim, completion and retry reauthorize current finance/admin workers inside the native mutation transaction. Claim/retry also require provider restore clearance. Support may inspect queues but cannot run these writes. Refund callback list reads enforce password changes; existing refund worker guards and private owned-attempt cleanup remain. Refund retry dispatch stays outside its callee-owned transaction, with checkout authorization checked again inside its own transaction.

Nine tests cover absent/foreign/inactive principals, demotion, password restrictions, supplied-role forgery, current buyer account, independent promotions/revocations across a second database connection and restart, authority changes at transaction acquisition, support and restore limits, and callback attempt fencing. Owning integration, stock, order, money and platform facts remain unchanged after denials.

Revocation during asynchronous synthetic settlement verification records no cash and cannot finish the processing callback. Existing stale-attempt recovery retains it for a qualified successor. The successor verifies and settles once; another tick and duplicate receipt preserve the full native state. An old attempt cannot overwrite a later claim. This does not qualify real provider timing, outages or production incident handling.

Expanded tests independently reproduce eight gaps against unchanged parent integration modules in a private copy; the existing valid attempt-fencing/recovery case passes. The fixed candidate passes all nine. Initial failures also exposed revoked-reader fixtures, test helper typing/restart cleanup and an actual nested retry transaction introduced during the fix. Corrected actual persisted-user fixtures and independent owning state oracles without weakening production guards. A first full backend run passed 1831/1832 because an accounting balance conservation oracle read after password revocation; it now asserts public denial and compares owning persisted state. All failures remain private under `/tmp/distributor-integration-authority-checkpoint`.

## Captured verification

| Check | Outcome |
| --- | --- |
| Unchanged-parent reproduction | Eight failures, one existing-behavior pass |
| New authority/recovery tests | 9/9 pass |
| Focused provider/accounting/callbacks | 126/126 pass |
| Full backend | 1832/1832 pass |
| Production-build Chromium | 3/3 pass: buyer checkout, accounting invoice/cash/credit queues, accounting refund handoff |
| Typecheck, format, build | Exit 0 |
| Isolated production-only runtime | PASS: 209 copied inputs, 69 development-only packages absent, 27 child commands; CA/US each start twice, PDF/ZPL output and encrypted local backup/restore |
| Structure/local links and whitespace | Commands/outcomes retained in machine receipt |

Build/runtime/browser inputs did not change after those checks. Final full/focused/type/format verification covers subsequent changes only to the accounting-balance oracle and expanded authority recovery test. Receipt binds tested/candidate hashes, command timings/log hashes, production assets, runtime receipts, historical evidence and license notices.

## Limits

This is partial security/recovery engineering. Staff visibility remains provisional; some provider lists are unbounded and separate reads do not form a coherent snapshot. Other internal APIs, actual providers/hardware, regional infrastructure, operating policies, production security/load/retention/recovery and operator acceptance remain unqualified. Other browser workflows were not rerun. Full-system work remains active.
