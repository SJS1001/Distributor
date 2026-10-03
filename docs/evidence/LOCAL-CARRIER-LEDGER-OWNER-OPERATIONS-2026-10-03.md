# Carrier and original cancellation workstation receipt — 2026-10-03

Tested source `3bb0eacb9af6faf9d3873116608d5a5667aa56e6` against baseline `e5d8bd73028438a67b0b8b202d61fccfe0a1f68e`; all 681 frozen runtime input hashes match working files and committed blobs. Environment: Darwin arm64, Node 24.16.0, SQLite 3.53.0, OpenSSL 3.5.6. The [machine receipt](LOCAL-CARRIER-LEDGER-OWNER-OPERATIONS-2026-10-03.json) binds inputs and private log digests.

- Nineteen affected suites: 697/697 pass, zero failed/cancelled/skipped/todo, exit0, 10827.471541ms.
- Complete native suite (`npm test`): 4551/4551 pass, zero failed/cancelled/skipped/todo, exit0, 110314.849125ms.
- Complete TypeScript, owned formatting, plan structure and whitespace checks exit0.

The [Canada Post comparison](../CANADA-POST-OFFLINE-MEMBER-EVIDENCE-2026-10-03.md) checks bounded full-member Carrier/Fulfillment/Platform copies, exact group/account/details and PDF evidence, and preserves explicit native/provider qualification blockers. The [native original cancellation operation](../STOCK-JOURNAL-OFFLINE-ORIGINAL-APPLICATION-2026-10-03.md) uses a process-issued capture under the actual writer and raw hold, rechecks current finance authority, adds two native observations/audits, conserves original facts, and requires escaping failures for whole-transaction rollback. Exact cancelled readback remains consistency-only.

Carrier cloud return `526448adb65b557bc31cda0bb051c8ad43015d6c` and Ledger return `628206b363cd41d1e327bb46faa5c082ae6e99b8` were transferred with verified patch and six file hashes, reviewed and replayed locally. Their 487/487 and 320/320 cloud affected claims are separate from this receipt. Historical cloud fixture/type failures remain recorded in their reports; transfer parser correction did not change source. Raw captures, patches and private logs remain excluded.

Qualified private capture/native joins, complete original command provenance, root mutation coordinator and independent current authority/source fencing through COMMIT remain incomplete. No Application route, schema, dependency, workflow, provider IO, CI runner, deployment, PR creation or merge occurred. All 44 tasks and ten product gates remain NOT VERIFIED; production, browser and provider acceptance are not claimed.
