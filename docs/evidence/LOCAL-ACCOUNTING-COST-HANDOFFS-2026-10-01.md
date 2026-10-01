# Local stock cost accounting handoffs — 2026-10-01

Partial D-034/D-036/D-037 engineering affecting G4/G7/G8. All 44 tasks and ten gates remain NOT VERIFIED; full-system work remains incomplete. Reviewer: Codex automated synthetic checks, without human finance/operator acceptance. Parent local commit `2985edaffc60e7eced61153d289a7f18b477aa39`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-ACCOUNTING-COST-HANDOFFS-2026-10-01.json) binds tested source/test/configuration, documentation, workstation logs and unchanged historical evidence. See the [cost handoff runbook](../ACCOUNTING-COSTS.md).

Inventory supplies sequenced original-cost windows and reconciles all native movement value with held and in-transit stock. Integration owns independent controls, explicit account mappings, saved reports, immutable regional artifacts, permanent source claims and receiver receipts. Finance approval rechecks the exact frozen window and sequential cursor atomically with claims/audit; preparation and download are distinct from receiver acceptance. No handoff operation changes native stock, orders, invoices, credits, cash or refunds, and no external request is sent.

Backend evidence covers signed receipt/opening/count/shipment/supplier-return/loss/recovery/return/replacement/scrap costs and zero-value custody, balanced journals, original CAD/USD region and exact arithmetic beyond the shared money limit. It exercises independent control/mapping failures, competing approvals, restart, late audit rollback, authority/password/organization/restore restrictions before cached writes, immutable artifact/receipt identity, missing or unsupported source evidence, stable bounded cutoffs, paged history, migration/backfill and separate-process contention. Migration checks simulate the pre-sequence schema; no actual production upgrade is claimed.

Browser evidence covers a committed lost preparation response, exact-key retry, recovery from saved history after reload, interrupted pagination retaining 20 rows and successful continuation to 24, saved review approval, exact downloaded SHA-256/journal bytes, distinct receiver acceptance, unchanged native dashboard facts, a 390-pixel viewport and buyer UI/API exclusion. Synthetic controls derive from the test source to exercise interaction; they are not independent human financial approval.

Verification used macOS arm64, Node 24.16.0, SQLite 3.53.0, npm 11.13.0, a temporary synthetic database and local Chromium. Exact commands/logs appear in the machine receipt.

- Final type/format checks: PASS.
- Focused cost checks: 15/15 PASS, zero failures/cancellations/skips/todos, 4215.280542 ms.
- Full Node regression: 274/274 PASS, zero failures/cancellations/skips/todos, 23069.240625 ms. Later edits changed form labels and browser assertions only; backend/tests remain the verified candidate.
- Production build: PASS (80 ms). Focused browser journey: 1/1 PASS (3.4 seconds total; 1.5 seconds journey).
- Full browser suite: 23/23 PASS (42.2 seconds; new cost journey 2.0 seconds).
- Planning/link/whitespace/history checks appear in the machine receipt and verify documentation consistency only.

Earlier failures remain preserved: an unauthorized SQLite AUTOINCREMENT/system-table migration, duplicate schema/type declarations, incorrect acceptance assertion and identity fixture, nested transaction fault fixture, nonexistent supplier-return method, textarea label lookup and an invocation without npm's `tsx` PATH. Subsequent fixes retain module ownership, use a persistent inventory clock, exercise owning APIs or explicit rolled-back corruption fixtures, bind form labels to their controls and run Playwright with npm's environment.

Self-review checked owning SQL/migrations, stock reconciliation, safe BigInt intermediate arithmetic, sequential cutoffs/source claims, immutable canonical JSON plus final newline, approval/audit rollback, current restrictions before cached writes, exact regional acceptance totals, buyer isolation, browser retry/pagination and preserved historical receipts. Dependencies/lockfile/license notices are unchanged; no third-party implementation code was copied.

## Limits and continuation

The JSON file and recorded acceptance do not prove a posted ledger entry, actual receiver residency, QuickBooks import/JournalEntry contracts or human accounting acceptance. Automatic provider stock/COGS postings must be reconciled to avoid duplicates. Chart/period/valuation policies, original evidence completeness, corrected/reversed approved artifacts, supplier/manufacturer settlement and independent preparer/reviewer policy remain unresolved. Approval has no reset/reversal path. The UI uses the displayed 500-movement window; smaller custom cutoffs currently require the API. Full source history/physical units load without a production bound; streaming/index/archive/retention, upgrades, clocks, real process termination, load/recovery/security and regional hosting remain unqualified.

Direct workstation checks and local commits only: no local/self-hosted/cloud CI jobs, workflows/registrations, push/PR, deployment/purchase, actual provider accounts/requests, live data, publication/settings changes or OPUS/UB integration. Future Distributor CI remains GitHub-hosted after separate authorization/qualification. No fresh remote-access claim. Continue provider authorization/revocation/rotation, accounting refund/import identities, individual carriers/devices and human business/source/vendor/security acceptance; no task or gate is passed by this checkpoint.
