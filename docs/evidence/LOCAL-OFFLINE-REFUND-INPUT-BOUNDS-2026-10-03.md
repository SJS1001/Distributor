# Refund input property-name bounds — workstation receipt

Tested source `db10270641153a06b78f432f20197ff54a280d5f`; baseline `08ff523ead45ad9f5dab4727c3bb0de800bb51c2`. Frozen at `2026-10-03T23:58:07.190240+00:00`: all684 runtime input hashes match both working files and tested Git blobs. Darwin arm64, Node24.16.0, SQLite3.53.0, OpenSSL3.5.6. The [machine-readable receipt](LOCAL-OFFLINE-REFUND-INPUT-BOUNDS-2026-10-03.json) records every input and private-log digest.

Two actual-owner regression tests first reproduced authority-host entry for aggregate over-budget UTF-8 property names and an unpaired key surrogate. Their original failed log remains private and retained. Property names now consume the same node, byte and Unicode budget as values. Both repaired tests refuse before host entry with unchanged Billing, Integration, Platform and IAM state. No API, schema, Application wiring or dependency changed.

| Direct workstation command                                                                                                                                                    | Actual result                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `node --import tsx --test tests/restore-offline-failed-refund-coordinator.test.ts tests/restore-offline-commit-guard.test.ts tests/integration-offline-failed-refund.test.ts` | 134/134, exit0,18978.401125ms    |
| `node --import tsx --test tests/*.test.ts`                                                                                                                                    | 4586/4586, exit0,105539.969416ms |
| `npm run typecheck`                                                                                                                                                           | exit0                            |
| `npm run verify:plan`                                                                                                                                                         | exit0                            |
| Prettier changed source/test/documentation check                                                                                                                              | exit0                            |
| `git diff --check`                                                                                                                                                            | exit0                            |

Both test runs have zero failed/cancelled/skipped/todo outcomes. The initial documentation formatting failure remains retained and was repaired. These direct workstation checks used synthetic authority and private evidence fixtures. Independent provider truth, current authority/source/candidate fencing through actual COMMIT, remaining task-shaped imports and product acceptance remain incomplete. All44 tasks/ten gates remain NOT VERIFIED. No PR creation or merge, CI runner, workflow, provider IO or deployment.
