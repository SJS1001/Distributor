# Local incoming supply verification — 2026-10-05

Bounded direct workstation checks for the incoming supply implementation described in [INCOMING-SUPPLY.md](../INCOMING-SUPPLY.md). No task or product gate changes to VERIFIED.

Source: uncommitted working tree based on `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703`, Node v24.16.0, local synthetic SQLite fixtures. Concurrent native UI and demo work is outside this backend receipt. The table below identifies the final changed backend/test inputs; it is not a freeze of all transitive dependencies. Canonical sorted compact JSON for this path-to-SHA256 map hashes to `1f314308f0eece71207df1eba7d577b2cc54819917daa166f5b4bf9ac88b62e3`.

| Input | SHA256 |
| --- | --- |
| `src/server/application.ts` | `c3027324397b5489fec697a82262ff6f328356ff6f86ed1a73ca6cd6076171c3` |
| `src/server/http.ts` | `9f4daae85bff8e758c2cc5d17a13877a554457acae243ee13724e523b5cc4de6` |
| `src/server/incoming-supply-schema.ts` | `96b5256305332c29ac2b30525139811162bcf142677d600933b6b42ed7296255` |
| `src/server/inventory-quantity-corrections.ts` | `9d4a5f5b380a2ec4dca534643961eb0e409526cda713b68ef6d10a3127f571a6` |
| `src/server/inventory.ts` | `cf22c1a420cdfbfb75f5acad3267ceb40ccbc6bc5dfdd64f369a5c71c8b17dbd` |
| `src/server/orders.ts` | `8b50e189a8db490008822ca60266a53e5cf5045f2816b6e27b27eea22dd8ec79` |
| `src/server/procurement.ts` | `c537ce545f07fe0be4aaaccaa5b25b66e2a8e5c74481b9ee16fd8d9399463074` |
| `src/server/schema-upgrade.ts` | `5af48808e6ab69d4c7fff454cb796648494fc344d364d94620ab40979a0ed637` |
| `src/server/schema.ts` | `297b6e3a54b7cd2e1aa748dc3d61bb324f4c2169f95b2bef8da300a84384a03d` |
| `src/shared/incoming-supply.ts` | `a1f7ae706b61479c2fb57efe3a821afbf97026d1c3199d056c9d1291e71e0417` |
| `tests/incoming-supply-child.ts` | `a8d8b8e1dc4ab483c84dfe6597f6657f97a2b79f927fb7e130a94ffa649558f5` |
| `tests/incoming-supply.test.ts` | `cdbae82ef7567b7fee1d42e9817a13600176a9b3f0c4320de9f083c07632a63f` |
| `tests/schema-upgrade.test.ts` | `b3169e10c69f176cd90d0be8266dea3a69b049d7dc6caae0e15910ba77a5b24d` |
| `tests/schema22-offline-owners.test.ts` | `0f8d40758ea6a5904bac5780e9b6c0ecfe937d4f41dac2d74883b51b5ac1654d` |
| `tests/schema23-incoming-supply.test.ts` | `5db78faa7d4b3599eddfe264e7cd2138ca0bf93f832f45e6bbab3e545fd2f744` |

## Observed results

Commands used `npx tsx --test` with the named files, not the full test script. These are separate focused runs; there is no claim of one consolidated full-suite replay.

- Final `tests/incoming-supply.test.ts`: 11/11 passed, 2607.11575 ms, exit 0. Includes independent OS process capacity competition, stale revision and exact retry, partial receipt priority/FIFO, quarantine protection and inspection conversion, bulk count protection, overdue/credit-held stock, amendment/cancellation, supplier return refusal, fresh scoped authorization, and late receipt audit failure rollback followed by successful retry.
- `tests/schema23-incoming-supply.test.ts`: 2/2 passed; explicit schema 22 clone upgrade preserves source and business rows and starts with empty incoming tables.
- `tests/schema22-offline-owners.test.ts`: 7/7 passed; prior schema 21 upgrade matrix now targets current schema 23.
- Existing `tests/order-amendments.test.ts`: 19/19 passed.
- Existing `tests/reservation-expiry.test.ts`: 19/19 passed.
- Existing `tests/inventory-quantity-native-contract.test.ts`: 6/6 passed.
- Existing `tests/schema-upgrade.test.ts`: 111/111 passed.
- Assigned runtime/test Prettier checks and `git diff --check`: passed.
- Global TypeScript checking passed before concurrent demo changes. Latest attempt reported only an in-flight demo import (`src/demo/runtime.ts` could not resolve `./seed.ts`); that attempt is not a backend verification pass. After the seed was created, the parent reported a fresh global TypeScript pass; that subsequent run was not independently repeated by this assignment.

Historical unsuccessful focused attempts are not erased: initial incoming expectations used cancellation state `canceled` instead of native `closed` and scope code `SITE_FORBIDDEN` instead of `FORBIDDEN`; a bulk-count test expected `RESERVED` instead of `ALLOCATION`, then briefly omitted its required revision. Those test expectations/setup were corrected before the final 11/11 replay. No backend runtime failure was established by those mismatches. Earlier broader runs contained these incoming test failures while the existing files listed above passed.

An independent agent inspected bounded receipt priority/capacity, hold accounting, stock correction/transfer/supplier return guards, amendment/cancellation, account/deadline blocking and schema upgrade code and reported no material backend defect. It did not execute tests. Its browser authentication-recovery finding was referred to the native UI owner and is outside this receipt.

## Limits

Existing schema 22 databases need an explicit fresh-destination upgrade and separate operator activation. No live database was migrated. Expired reservations do not discard incoming promises or custody holds automatically; commercial review/release/reconcile remains required. Failed inspection exposes shortage without automatic reassignment. No production load, physical device, supplier/provider, infrastructure or operator qualification was performed. No full suite, CI, PR, commit, push or deployment was performed by this backend assignment.
