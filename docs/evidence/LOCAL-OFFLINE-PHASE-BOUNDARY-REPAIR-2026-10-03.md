# Local offline phase boundary repair — 2026-10-03

Direct workstation verification on macOS/arm64, Node v24.16.0, OpenSSL 3.5.6; parent checkpoint `198e1d0d058c4fa4b8c0693088c18026c1beed23` plus the exact phase delta and root repair below. No CI or provider IO ran.

## Retained failures and repair

Independent cloud delta `840e87a0010736fc09863a266048ff7ce9c467a2` contributes only the new phase boundary test and [historical report](../RESTORE-OFFLINE-PHASE-BOUNDARY-2026-10-03.md). Root independently verified its 28,386-byte patch SHA-256 `d509b32d6ab04b083217328526c935069500259fe31ed6884a0607010ec554c1`, then reproduced all five failures locally on unchanged production. The original red log SHA-256 is `8c3abe123001367467928de244a0c7d4c25aabf94de2cb0c919669346f1c4547`.

The pure classifier now refuses rollback resumption after the last forward hold unless its marker is explicitly false. Permanent and conservative legacy holds may retain supersession evidence. Ordinary held points must retain the predecessor timestamp, matching native `RestoreActivation.hold()`.

The first repaired combined run passed 145/148 and exposed three older synthetic fixtures whose ordinary held timestamps advanced despite native hold retaining its timestamp. Root corrected that fixture generator without changing those assertions; the compatibility red log SHA-256 is `6c303ee0669ba7ebb63c54123fb29aa67acee4ef536a379af4f0f9b76edfc71e`. A new test also preserves an earlier recoverable hold resuming before a later permanent hold, while refusing rollback after the last permanent hold. The projection retains only the final marker; it does not authenticate intermediate marker values.

## Tested inputs and results

| Input                                          | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `src/server/restore-offline-phase.ts`          | `397a65ceab3d6a51eed3ffed49e78be7883da45cebad3455a9f0f5a2cc220c92` |
| `tests/restore-offline-phase.test.ts`          | `5bcc3bbaf8eaff0b19d13d212cc005dc2d7101b40816410367c44da3b5f42628` |
| `tests/restore-offline-phase-boundary.test.ts` | `da71317a9068dbbee1dfeeb88b353ef9a6930a3231f5d044011cc0e805b3df0a` |

```sh
npx tsx --test tests/restore-offline-native-history.test.ts tests/restore-offline-phase.test.ts tests/restore-offline-phase-boundary.test.ts tests/restore-activation.test.ts tests/restore-activation-boundary-review.test.ts tests/restore-native-dispositions.test.ts tests/recovery.test.ts tests/integration-offline-refund-evidence.test.ts
npm run typecheck
```

Actual final test process exit 0: 149/149 pass, zero failures/cancellations/skips/todo, 5,447.127041 ms. Complete TypeScript exits 0. Final private log SHA-256 `53c8c95bedaaf617f477354e1ce4d53200e57085f96e3d3ac82f056a1e25d533`; red and green logs remain excluded from publication.

These are focused synthetic/native workstation checks. They establish neither a full current browser/native regression nor qualified offline mutation, external source fencing, infrastructure/provider qualification or a passed product gate. All task and gate acceptance states remain unchanged.
