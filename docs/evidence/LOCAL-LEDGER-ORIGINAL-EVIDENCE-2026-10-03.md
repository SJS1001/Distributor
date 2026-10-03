# Native original-ledger evidence workstation verification — 2026-10-03

Exact tested source: `a1fab3bad3beed21fbcffddf2f442869e6adbe46`. Baseline: `dd8517e9bf735b26be0854d3f785c845a374959f`. The three exclusive cloud files were independently transferred, decoded and hash verified; no cloud parent was imported. Source, tests and report were reviewed locally before replay. This verifies the fixed original-ledger evidence comparison and its existing native readers together.

| Check                               | Actual outcome                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Six affected original-ledger suites | 191/191 passed; zero failed, cancelled, skipped or todo; exit0;7931.730167ms     |
| Complete `npm test`                 | 4315/4315 passed; zero failed, cancelled, skipped or todo; exit0;100030.384417ms |
| `npm run typecheck`                 | exit0                                                                            |
| Owned Prettier check                | exit0                                                                            |
| `npm run verify:plan`               | exit0; document structure only                                                   |
| `git diff --check`                  | exit0                                                                            |
| Frozen runtime input comparison     | All673 working-tree and exact committed input hashes match                       |

Workstation environment: Darwin arm64, Node24.16.0, OpenSSL3.5.6, SQLite3.53.0. Frozen inputs captured at `2026-10-03T23:02:23.976934+00:00`. The [hash manifest](LOCAL-LEDGER-ORIGINAL-EVIDENCE-2026-10-03.json), SHA-256 `e8614d7403b9630d5890817217e1f50f37780f7af08a46a2a390128ff60ad996`, records all runtime inputs, private log hashes, outcomes and exact transfer metadata. Private logs and runtime data remain excluded from publication.

The [implementation report](../STOCK-JOURNAL-OFFLINE-ORIGINAL-EVIDENCE-2026-10-03.md) preserves earlier failed attempts and documents the fixed profile, bounds and current-IAM rechecks. Verification covers native US/USD and Canada/CAD evidence joins, cancelled ancestor history, hostile object/byte/resource inputs, changed permissions and stale native history. Claimed provider cancellation is a consistency assertion; a process-issued capture proves its local origin only. Neither grants provider authenticity, evidence qualification or import authority. The actual qualified mutation coordinator and external acceptance remain incomplete. All44 baseline tasks and all ten product gates remain NOT VERIFIED; this receipt grants no product gate.

No GitHub Actions, local/self-hosted runner, cloud CI runner, workflow, PR, merge, deployment or provider operation was used. Separate cloud coding sessions continue Billing and Canada Post implementation; requested Astra/high is not runtime-verified where the launcher does not expose it.
