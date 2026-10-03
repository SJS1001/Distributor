# Local transfer loss approval and found-stock recovery verification

Date: 2026-10-02. Tested parent: `4ba370fd1c7d25ecc0fc1b9a0254107ceaeffde7` plus the candidate bound by the [machine receipt](LOCAL-TRANSFER-LOSS-RECOVERY-2026-10-02.json). Direct workstation verification on macOS arm64, Node 24.16.0, native SQLite and headless Chromium. No CI runners, cloud sessions, delegated agents, provider/device IO, PR, merge or deployment.

The previously unmounted draft is now connected to administrator-only Inventory controls. Loss approval and found-stock recovery independently retain their exact body/key and original transfer description before transport. Uncertain replies restore fixed read-only review across reload, navigation and account changes. Web Locks coordinate tabs; damaged/unwritable storage, missing locks and changed evidence block transport. Native pre-effect serial/validation refusals permit correction; changed custody requires a new current review. Authority uncertainty, reference conflicts, malformed success and cleanup failure preserve the original attempt. Native cached receipts require current administrator authority and do not repeat the stock change. Native implementation, schema, dependencies, licenses and workflows are unchanged. See [behavior and limitations](../TRANSFER-QUEUES.md#retained-loss-approval-and-found-stock-recovery).

Fifteen new synthetic browser journeys verify lost committed replies, exact original receipts after another operator changes custody, reload/account isolation, serial correction and identity, original cost, storage/locks, competing tabs, changed evidence, malformed success, cleanup, abandoned responses, revoked/restored administrator authority, stale transit revision and reference conflict. Two recovered bulk units retain 2,468 CAD cents of original cost; the serialized recovery retains its original unit identity and 6,000 CAD-cent cost. Exact replay leaves native transfer history unchanged.

| Command | Actual outcome |
| --- | --- |
| Complete production Chromium suite | Exit 0; 181 passed, zero failed; 3.4m. |
| `npm run typecheck` | Exit 0 on final source/tests. |
| `npm run build` | Exit 0; existing bundle warning above 500 kB. |
| `npm run format:check` | Exit 0 on final source/tests. |
| Changed-source React Doctor including untracked files | Exit 0; six files, zero errors, one existing App complexity warning. |

No fresh full native suite is claimed for this browser-only integration. The historical 1,983-test native result remains in the dispatch receipt. React diagnostics do not claim a clean full-project scan.

Initial focused checks failed on ambiguous SKU/loss selectors and an expectation including still-transiting stock; their logs/traces remain private. A subsequent boundary selector stalled and was interrupted; exact product headings now identify rows. Another selected run was interrupted after a concurrent rebuild temporarily removed the served index, causing a 404, and the serialized row selector was corrected. The first complete-suite attempt was interrupted to update an older lost-response regression assertion from Continue to the new explicit Retry exact label. The final complete browser suite runs against the finished build with no concurrent rebuild. All failed/interrupted logs and retained traces remain separate under `/tmp/distributor-transfer-loss-checkpoint`.

Self-review covers current native authority, immutable body/key, persisted evidence, tab coordination, pre-effect refusals versus uncertainty, cleanup, historical receipt versus current custody, serial/quantity/cost conservation, focus and abandoned responses. Cleared storage, pre-feature uncertain attempts, shared-device retention/protection, independent browsers/devices, physical custody, production security/load/recovery/residency/providers and operator acceptance remain open. All 44 tasks and 10 gates remain NOT VERIFIED; full system incomplete. Private runtime data, credentials, generated assets and raw logs/traces remain excluded from publication.
