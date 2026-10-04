# Durable original cancellation provenance

This closes the missing original-cancellation result-preimage storage gap. The existing internal Integration operation now inserts the exact canonical parsed envelope and exact existing result-record preimage into Integration-owned schema20 storage in the SAME outer writer, before its single Platform record-task receipt. Recovery after reopen reads the actual stored preimages; it no longer needs the caller's returned record. Neither storage nor matching hashes establishes qualification or execution authority.

Excluded published baseline: `30ebbf44432aca93206da69d9756ae73f7186935` (source `20867b7b4571f8837f58af6a8d5d241e9ea8d290`), public `SJS1001/Distributor`, `codex/local-distributor-checkpoint`. Exact tree `3e1bf1a5dee1646422b014efe2bfeb1de9bec10f`. Direct HTTPS Git was blocked; public connector objects were reconstructed with exact blob/tree/commit hash verification before creating the isolated checkout. Prior deliveries and all other lanes are preserved. Final tested/closing commit and nine exact owned file identities are in the accompanying transfer manifest.

Requested `gpt-6-astra/high` per the owner's financial/security boundary rule; effective model/effort are unexposed and unverified. No additional agent/session was launched. No PR, merge, push, CI/runner, provider call, credentials, live data, deployment or recurring work.

## API and transaction ordering

[IntegrationOfflineOriginalCancellation](../src/server/integration-offline-original-cancellation.ts) keeps its existing constructor and task-shaped apply API:

```ts
applyInTransaction(
  evidenceActor,
  cancellationActor,
  envelope,
  capturedOriginal,
  reason,
);
recoverRetainedInTransaction(evidenceActor, cancellationActor, exactEnvelope);
recoverInTransaction(
  evidenceActor,
  cancellationActor,
  exactEnvelope,
  returnedRecord,
);
```

Both principal inputs remain exact inert `{id, orgId}` locators. All methods require an existing actual Database writer, current distinct finance/admin staff principals in the original organization, neither account scope nor forced password change, and actual raw restore hold. The fixed signed task, process-issued capture, exact native/source/intent/history joins, reason equality with signed `attestation.evidence`, phase/candidate pinning and native cancellation behavior are unchanged. No SQL/table/callback ports or operational route were added.

Apply performs a complete bounded provenance preflight and checks absence of journal, binding and same-org/request conflicts before native writes. It delegates the existing two exact independently authored observations and cancelled-unposted transition to StockJournalDelivery, then stores the canonical envelope/result record and their SHA-256 hashes. It invokes the same single Platform owning transition as before. Final readback now joins the durable row to the exact Platform task receipt and full native cancellation/audit proof; both principals are refreshed after final writes. Errors must escape the enclosing writer. There is no nested transaction, savepoint, DDL in the operation, replay inference or ordinary Platform.command bypass.

`recoverRetainedInTransaction` captures the fixed envelope and locators, refreshes actual current authority/raw hold, reads the bounded exact persisted row, then performs the existing native cancellation/Platform receipt checks. It is read-only, detached and deeply frozen, with existing status `native-owner-recovery-consistency-only`. Its output shape and old full result-purpose/hash domain remain unchanged.

The explicit-record recovery API remains compatible for newly committed rows but now also requires exact equality with the retained database record. A caller cannot supply an alternate result preimage. Absent provenance is a refusal even when matching ordinary cancellation observations or a Platform result hash exists. No original operation is reexecuted to recover a response.

The stored envelope is the exact canonical **parsed structural envelope**, not an invented signature or original command preimage. The full existing envelope binding commits source/evidence/trust claims without qualifying them. Native source, policy, actor, raw hold or complete audit history drift still refuses according to the existing conservative reader. This includes later incompatible or unrelated organization observation-audit changes; no history is filtered away to force recovery.

## Schema20 and frozen historical profiles

[New schema module](../src/server/integration-offline-original-schema.ts) defines STRICT `integration_offline_original_cancellations` with eight columns:

- `journal_id`: primary key and foreign key to actual `integration_stock_journals(id)`.
- `org_id`, `request_id`, `binding`: exact native/task identities; binding unique and `(org_id, request_id)` unique.
- `envelope`, `envelope_hash`: canonical parsed envelope, bounded to 4,194,304 raw UTF-8 bytes, and hash.
- `record`, `record_hash`: unchanged canonical result preimage, bounded to 16,384 raw UTF-8 bytes, and hash.

UPDATE/DELETE triggers enforce append-only rows. Actual Database connections retain their existing recursive-trigger policy, so INSERT OR REPLACE is also refused. No existing DDL string was modified. Integration's initializer change is only the new schema import and initialization call; StockJournalDelivery's owning tables already exist at that point.

[schema.ts](../src/server/schema.ts) publishes honest version20, freezes old current v19 as a separately recognized previous profile, and leaves v1–v18 definitions unchanged. [schema-upgrade.ts](../src/server/schema-upgrade.ts) adds the new empty table/triggers after all prior migrations for legacy and v1–v19 sources, before writing the new schema receipt. Native startup still refuses a previous profile before constructors; the supported explicit fresh-file upgrade is required. Virgin initialization and both reporting profiles are tested.

| Profile    | Reports enabled                                                    | Reports disabled                                                   |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Frozen v18 | `18310a051c7e1d3e278e11251cd1cdc417517148e61aa45a42d39fab96cd07b8` | `66885390969e98b27ea19044f4e7b3cc399518fb50c9196962d2293f4569d942` |
| Frozen v19 | `78ae9e9a3b784a506d5be099aeb9884e86c783c432944dc6a7e46b7c11ae0521` | `787d1fd08ff0508d06f017ffbd449e610a295b81d24178d6969e5408602a02c5` |
| New v20    | `7fd45cbd7a88edbdf10b3f2b1daa220706d9eb5af20f32cfad99291b5e0a3ed5` | `f1f0d63fb11f4f56c4ec7941f234dadbabac18ff5e3686e5282cf6ed125b1162` |

Upgrade creates **no** original preimages, evidence, approvals or receipts. Historical v19 cancellations missing this row remain unrecoverable through this new retained-only API; their missing preimages are not guessed/backfilled, and cancellation is not repeated. Existing held generations/envelopes remain bound to their original schema/generation; changing schema does not qualify or migrate their authority.

## Read bounds and ownership

The operation's only new SQL uses Integration-owned tables. Platform receipts, raw hold and audits stay behind actual native owning APIs. A fixed global preflight counts the complete provenance table before selecting subject text: at most 1,024 rows, 16 MiB total bytes, each envelope 4 MiB and record 16 KiB, identities at most 160 ASCII bytes and hashes exactly lowercase64hex. Every column's storage type and raw NUL presence is checked. Excess is a fixed redacted refusal, never truncation or pagination.

Before SQL JSON validity or JavaScript parsing, scalar SQL conservatively counts punctuation (including punctuation inside strings) and refuses more than 32,768 structural markers or 4,096 containers per document. This follows the existing owner reader pattern; SQLite `json_tree` is deliberately not used because it violates table isolation. JSON must then be valid and object-shaped. Global orphan/cross-org journal links refuse using scalar existence/count joins, without materializing other tenants' preimages.

Selection covers journal identity OR exact binding OR same-org/request identity. A scalar count/contradiction check requires exactly one fully matching row before selecting any envelope/record blob. Bounded blobs are decoded with fatal UTF-8 validation; record/envelope strict parsers reject escaped surrogates, unknown structure, malformed primitives and altered identities. Entire canonical strings, both stored hashes, envelope equality/binding, result preimage and native/Platform receipt hashes must match exactly. Noncanonical/duplicate-key JSON is refused by exact canonical-byte comparison. No normalize-and-accept behavior is added.

Incoming normal/revoked proxies, accessors, hidden/symbol fields and substitute prototypes retain pre-hook rejection. Current native source/plan/reference/history and audit readers retain all existing SQL preflights. Recovery's total_changes is unchanged, including after reopening.

## Verification, original failures and root-owned fixture corrections

Environment: Linux x64, Node v24.19.0, SQLite 3.53.3, TypeScript 7.0.2, Prettier 3.9.9. Synthetic file-backed Application/Database fixtures only. Existing installed dependencies reused; no dependency files changed. Tests ran as bounded foreground commands, with no jobs left running.

Initial existing-suite run: **32/79 passed, 47 failed**, exit1. The new `json_tree` complexity query was denied by actual Database table ownership. The unchanged guard was correct. Repair replaced that query with scalar-only conservative preflight before JSON parsing, retaining all refusal assertions. Log `provenance-existing-first.log`, 96,310 bytes, SHA-256 `7134267f48fc76ac0a439cac4ecee498f7ec4860b8ad31cc882214ffa6fcc91e`.

Corrected initial dedicated run: **114/114 passed**, exit0. Added adversarial tests then exposed two test-only TypeScript overload errors caused by possibly undefined raw SQLite dictionary fields; non-null known fixture fields were made explicit without changing runtime data/assertions. Red TypeScript log `provenance-tsc-second.log`, 511 bytes, SHA-256 `4e784857d8a79b7dccb07ae7466190610f01bdbb4157c06bd8e6db44ad3ee416`. Complete final `tsc --noEmit` passes, exit0.

Final owning/affected command, **276/276 pass**, exit0, no failures/skips/cancellations/todos, 72,585.156743 ms:

```sh
node --import tsx --test --test-concurrency=1 \
  tests/integration-offline-original-cancellation.test.ts \
  tests/integration-offline-original-provenance.test.ts \
  tests/restore-offline-original-native-join.test.ts \
  tests/restore-offline-private-original-parser.test.ts \
  tests/restore-offline-native-phase.test.ts \
  tests/restore-offline-commit-recovery.test.ts \
  tests/restore-offline-failed-refund-coordinator.test.ts
```

Receipt `provenance-affected-final.log`, 25,663 bytes, SHA-256 `cbfd387d65b427d78826664b0bb32f9bf12b62e2ab0e970421db042b8031fc68`.

Schema command `node --import tsx --test --test-concurrency=1 tests/schema-upgrade.test.ts`: **103/103 pass**, exit0, no failures/skips/cancellations/todos, 28,815.148976 ms. This includes independently literal-frozen v1–v19 CA/US reporting-on/off upgrades, exact unchanged source bytes, sessions/native records, empty added storage, virgin/restart behavior and existing failure/rollback checks. Receipt `provenance-schema-first.log`, 13,817 bytes, SHA-256 `eb2ef1cf1256133d6556daef7269c178025e6c738ce0fa24c9d7c32e0b0dd73e`.

New coverage exercises no-caller-record reopen recovery; exact canonical durable bytes; UPDATE/DELETE/REPLACE refusal; missing, foreign, orphan, conflicting, noncanonical, oversized, NUL, surrogate and invalid-UTF8 retained rows; complete count/aggregate checks before JSON and blob materialization; changed source/evidence/trust envelope fields; native/audit/receipt drift; both current principals; writer/hold requirements; trap-free hostile input; native/provenance/Platform late faults and corrupted final readback after the receipt with full outer rollback. Conservation checks include the new table.

Two root-owned historical fixture locations need the new table removed when deliberately reconstructing older schemas; neither file was edited:

1. `tests/recovery-profiles.test.ts:581`: add `DROP TABLE integration_offline_original_cancellations` before its existing failed-refund table drop. The version18 reproduction fails at line643 with actual `f4f4e6849cf76cb25fe08bb1fed42511d7a79b87fb7cc75273d9f77cc790cf85` versus frozen expected `66885390969e98b27ea19044f4e7b3cc399518fb50c9196962d2293f4569d942`, because the new table remains.
2. `tests/restore-activation.test.ts:548`: the same table must be dropped before the historical v16 reconstruction's existing drop list. This need is confirmed by source inspection. The selected Linux test stops earlier in setup at the existing candidate-file guard (`RESTORE_REVIEW_CHANGED: Candidate files changed during inspection`), so this run did **not** reach that drop list. No guard, timeout or assertion was weakened.

Bounded reproduction command:

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='v16/false exact fresh-file upgrade|authenticated version-18 archives' \
  tests/restore-activation.test.ts tests/recovery-profiles.test.ts
```

Actual result: **0/2 pass, 2 fail**, exit1, no skips/cancellations/todos, 1,904.264028 ms. Preserved `provenance-root-fixtures-red.log`, 2,439 bytes, SHA-256 `a10b4683c2ef1040813d3b286521e029d5bf111d475f8b6d115c36ec432c918e`. The complete suite is not claimed green. Root must integrate its fixture changes and replay the combined tree.

Owned formatting, relative links and whitespace checks pass. No shared private parser, original command reader, StockJournalDelivery, Platform, Database, coordinator, Application, other existing tests/docs or historical DDL modules changed. The full original command/private/approval/trust/provider qualification and current source/instance fences through COMMIT remain separate root requirements, default closed. This is an engineering prerequisite, not a verified product gate or provider outcome.
