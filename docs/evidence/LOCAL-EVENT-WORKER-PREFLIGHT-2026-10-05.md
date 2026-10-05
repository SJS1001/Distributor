# Local event worker target validation — 2026-10-05

Partial D-010/D-011 engineering evidence; no task or product gate is verified by this receipt.

The enabled event worker previously accepted a zero-byte file or an initialized but empty SQLite file, created application tables, and returned a successful zero-event batch. This violated its existing requirement to operate on an existing application database. Both cases reproduced in actual child-process execution before the repair. An unrelated SQLite database already refused.

The worker now uses the existing read-only schema inspector before application construction and requires a current schema in the selected region. Normal explicit report registration remains supported. This is startup validation, not a filesystem replacement fence or production scheduler qualification.

Environment: direct macOS arm64 workstation, Node v24.16.0, disposable synthetic CA databases, no provider calls. Base HEAD `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703`; changes are uncommitted and concurrent application/demo work was preserved.

## Actual results

- Regression before repair: two failing leaf cases (zero-byte and empty SQLite), one passing unrelated-database case. The parent test also failed; runner totals were 1 passed / 3 failed, exit 1.
- `node --import tsx --test tests/event-delivery.test.ts`: 20 passed, zero failures/cancellations/skips/todos, exit 0, 9363.116458 ms. Includes unchanged bytes and absence of new sidecars for refused targets, valid bounded worker batches, SIGKILL recovery before/during/after effect processing, replay deduplication, poison handling, competing OS processes, scoped diagnostics and optional report removal.
- `npm run typecheck`: exit 0.
- Scoped Prettier and whitespace checks: exit 0.

Private red/green/typecheck logs: `local-evidence/event-worker-preflight-*.log`. The post-run 689-input working-tree fingerprint and log hashes are retained in `local-evidence/event-worker-preflight-source.json`; this is a post-run capture, not a pre-run freeze.

Changed source SHA-256:

- `src/server/event-worker.ts`: `ae2aaabf9a8118f9074fa3b1c61da79f87ba0fbe5feabd97759a97b11f4e7701`
- `tests/event-delivery.test.ts`: `3b78b56ee56faf1ee8a2e6c164e559f5156b8ad1e7488739f6141bb59d541571`

No full suite, browser rerun, CI, runner, commit/push, PR, merge, deployment or external-provider operation. Native MVP hosting and authentic provider/device/operator qualification remain open as recorded in the [acceptance evidence map](../ACCEPTANCE-EVIDENCE-MAP.md).
