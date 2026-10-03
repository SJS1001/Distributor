# Local durable offline storage integration — 2026-10-03

Parent: `aec669ac0a87d90098fa01e6cb0fff4578a30aa0`. The publishing commit is the first commit introducing this receipt; the exact tested files below identify its input. Environment: direct owner workstation, Darwin arm64, Node v24.16.0 / SQLite 3.53.0, synthetic isolated US/Canada fixtures. No CI runner, provider IO, private runtime upgrade, deployment or product-gate qualification.

Cloud storage delivery `cffc9413f93bbee7fd1ab140edc3a42f22ba5dd3` is integrated as only its eight-file owned delta against excluded `d6f8818a34626caf164769d196ecd9b27abb5799`. Root independently verifies raw patch 75,927 bytes, SHA-256 `4231314b2e9725802ba0185b7eda681bca44443b54b6df3efae0bf136cf13119`; compressed 18,982 bytes, SHA-256 `8131530f6e8671e83cb3eaca08c7eb98d0a30375abc191966c8dbe4caa88915d`; all independently decoded chunks, exact ownership and `git apply --check` exit 0. Private transfer and patch are retained, ignored, mode 0600. No excluded parent history is copied.

Initial combined root replay exits 1: 274/298 pass, 24 fail. Twenty-three failures reflect current version expectations and old-profile fixture builders retaining the four schema-18 offline tables. Root removes those tables solely when constructing historical fixtures and updates current expected version to 18; frozen schema fingerprints and startup refusal guards are retained. One additional storage fixture used an advancing held timestamp inconsistent with native hold() and the already repaired phase parser; root corrects the synthetic timestamp while preserving all refusal assertions. Cloud's historical 274/297 result remains in its report; root has one additional existing phase test.

Final root replay exits 0: **298/298** pass, zero failures/cancellations/skips/todo, 14,699.620333 ms. Command:

```sh
npx tsx --test tests/restore-offline-storage.test.ts tests/schema-upgrade.test.ts tests/restore-offline-phase.test.ts tests/restore-candidate-snapshot.test.ts tests/restore-activation.test.ts tests/restore-activation-boundary-review.test.ts tests/restore-review.test.ts tests/recovery.test.ts tests/recovery-profiles.test.ts tests/platform-restore-disposition-receipts.test.ts
```

Affected native-reader and phase-boundary replay exits 0: **130/130** pass, zero failures/cancellations/skips/todo, 3,196.126667 ms:

```sh
npx tsx --test tests/restore-offline-native-history.test.ts tests/restore-offline-native-history-boundary.test.ts tests/restore-offline-phase-boundary.test.ts tests/billing-offline-refund-review.test.ts tests/integration-offline-refund-review.test.ts tests/refunds.test.ts tests/integration-restore-dispositions.test.ts tests/integration-offline-refund-evidence.test.ts
npx tsc --noEmit
```

Complete TypeScript exits 0. These are focused checks; no complete-suite claim. Root separately reproduced **17/23 passing, six failing** Integration boundary assertions, exit 1, 1,437.935708 ms, from verified two-file cloud delivery `0c916ca8c9f4bcd2b1dabb7da2ed51f54ddeffe3`. That pending test/report delta is excluded from this storage commit. Its exclusive cloud owner is repairing the five gaps without weakening the six assertions. Original red evidence is retained.

Schema 18 adds Platform-owned immutable generation/journal/receipt storage and a compare-and-swap head. Existing schema 17 startup refuses before mutation; the explicit fresh-file upgrade preserves source bytes and initializes empty offline storage. No automatic private-preview upgrade occurred. Storage binds the native raw recovery generation and replays complete bounded phase history inside the existing writer transaction. Count and encoded-byte preflights precede record materialization. Storage is a prerequisite, not the qualified mutation coordinator: self-consistent whole-file copies need independent external authority/source fencing; historical data supplies no current IAM/provider grant. Candidate logical hashes currently include the ordinary offline tables, so qualified coordinator binding/receipt composition still needs explicit design and verification. Platform native refund command/audit reading and independent storage/Billing boundary reviews remain cloud work. All 44 tasks and ten gates remain NOT VERIFIED.

Source and fixture SHA-256 identities:

- `src/server/platform.ts`: `5e3d9ebc80f996ec11d7f2e992620aaf7d0e2ebbcd470a1ffebade78f7b28660`
- `src/server/restore-offline-schema.ts`: `62dfd1e0d9027658342e2b36f42f4608a4f30fd8e46c9dc7c6b240fbb1e8a2b5`
- `src/server/restore-offline-storage.ts`: `1c3af12cf4164fb4686b7286525a1a0f1babfa47c2a4747c1a4807c004888d64`
- `src/server/schema-upgrade.ts`: `1e505109264f54b4b5700ee2c228784732bfde7f07c510c98d29723fc100931b`
- `src/server/schema.ts`: `45f54e27f487cdc6ddabfd97650dfee2903e7531de2ad7047499ed80a1451f1c`
- `tests/restore-offline-storage.test.ts`: `ed4ad2330d60ac1a05595df2b08cbafe967328ec95d941beda49b2b1526dea62`
- `tests/schema-upgrade.test.ts`: `7effef351be0460c452c1bbcf5477c6e06a659b2653cb5e05e37401f32146d2f`
- `tests/recovery-profiles.test.ts`: `15668871c4bd63ff78f88f3adf99d27abdf4f4b632f6011119daf4e30f028e6c`
- `tests/restore-activation.test.ts`: `cd0716332cefa1c566ce59a6e31262ea3c40faf8210284400d1ae920ef739463`

Private logs under ignored `local-evidence/cloud-quantity-ui-2026-10-03/` (hashes only published):

- `offline-storage-integration-red.log`: `b84e222c5dc146b9ac06d99de8e78872a78dec5e2daced6b81bdf328cefaedfd`
- `offline-storage-integration-final.log`: `f9987c6f89139cee408d41179136058b1f9babe08cd844824b9642cdd5676a53`
- `offline-storage-native-readers-final.log`: `78c81566a9f9ff362ec103eb2ef3d0ba5fcb74ba13220bd682cdddeb8cd4f71b`
- `integration-boundary-local-red.log`: `6926ea54056f54fc6ba518b150289423815a2465403bedfdfc3d7a6071e6eaaa`
