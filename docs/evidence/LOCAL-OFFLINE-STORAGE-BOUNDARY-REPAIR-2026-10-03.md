# Local offline storage replacement repair — 2026-10-03

Root applied the exact incremental cloud repair d1030bea7276b770f3d369ea0caeeb1ad10d2cb0 excluding original boundary commit44f33adc84917db830b94f161126e151b0639ae4, on published parent27a81cc0ed8dc7266895c4e313f8a049af459db4. Transfer checks verified three owned paths, all decoded/gzip/raw lengths and hashes, and applicability. Raw repair: 9,061 bytes, SHA-256 1da0628982bb19f02ce3794543d4a39bf9ad25745a4e831eb83c9f56f7aa2e95. Original entire nineteen-test prefix remains byte-identical.

The original local run retained four failing assertions for implicit replacement deletes bypassing append-only guards, exit1, log SHA-256 d1e789fef8e1a0a70cb939e933f9752df6e86ce0a43b96efe91a40f0ff509497. Every native Database connection now sets recursive_triggers=ON before installing the authorizer. Immutable DELETE guards therefore run for INSERT OR REPLACE conflicts; native owners cannot turn the setting off. Stored DDL and frozen schema profiles are unchanged. Additional tests cover reopened and multiple connections, setting-change refusal and post-refusal preservation.

## Workstation verification

macOS arm64, Node v24.16.0, OpenSSL3.5.6, SQLite3.53.0; synthetic native fixtures, direct workstation commands.

```sh
node --import tsx --test tests/restore-offline-storage-boundary.test.ts tests/restore-offline-storage.test.ts tests/restore-offline-phase.test.ts tests/database-streaming.test.ts tests/audit-pages.test.ts tests/event-delivery.test.ts tests/schema-upgrade.test.ts
```

Actual outcome: 191/191 pass, zero failures/cancellations/skips/todo, exit0, 13,849.137834 ms. Private local log SHA-256 468ca37dea3e970a1775e8cabe59aa517f86301d7d2b52947055f5cedd6fc7f2. Cloud's older baseline reported190tests; this receipt records current combined local inputs. Complete TypeScript, assigned formatting and whitespace checks exit0. No whole-suite/browser rerun is claimed. Separate native maintenance-authority tests retain52/72passes and20failures and are assigned for repair; this storage pass does not supersede them.

## Tested bytes

- `src/server/database.ts`: `447471cb853a70151bd4b8b914b2991fba7bd41b534c4949395354df4f4449b5`
- `tests/restore-offline-storage-boundary.test.ts`: `e046fd7b9600a5344ad4f6ee8963c36e98e4ac65e73d92c83b526dd8ec48f1ef`

Connection-level SQL protection does not authenticate a copied database or independent anchor, qualify external fencing/provider truth, compose a coordinator, release recovery hold or verify any product gate. No CI/runner job, workflow, PR, deployment or provider IO occurred.
