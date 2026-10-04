# Ledger, Carrier and checkout — workstation receipt

Tested source `687f2329dba0c68b063a884f182b2b3fda241cdf`; baseline `43e6d82fbe98425b4e47a9ab7a76aaa73db63717`. All706 runtime inputs frozen at `2026-10-04T00:45:38.087432+00:00` match working files and tested Git blobs. Ignored incidental filesystem metadata is excluded. Darwin arm64, Node24.16.0, SQLite3.53.0, OpenSSL3.5.6. The [machine-readable receipt](LOCAL-LEDGER-CARRIER-CHECKOUT-2026-10-04.json) identifies every input, verified transfer and preserved private log hash.

Schema20 retains canonical original cancellation envelope/result preimages in an append-only owning table before the sole Platform task receipt; explicit historical upgrades do not backfill proof. Root recovery verifies those records after restart with both fresh native principals. Native Canada Post member import resolves the supported exact unknown target while conserving pending bookings, packed custody, sibling labels and the provider hold. Checkout evidence/native joins explicitly retain blockers for two demonstrated proposed-reference collisions; owning closure implementation remains in progress.

| Direct workstation check                               | Actual result                    |
| ------------------------------------------------------ | -------------------------------- |
| Full combined regression                               | 5055/5055, exit0,113079.415541ms |
| Final historical schema18 fixture replay               | 13/13, exit0,1577.281125ms       |
| Checkout dedicated replay                              | 90/90, exit0,9330.980709ms       |
| Ledger/root before checkout integration                | 347/347, exit0,18229.78525ms     |
| Carrier before checkout integration                    | 158/158, exit0,5830.848083ms     |
| Complete TypeScript/runtime formatting/plan/whitespace | exit0                            |

All final green runs have zero failed/cancelled/skipped/todo outcomes. Initial combined regression had5055 tests,5049 passed and six schema18 refund provenance fixture failures, exit1. Those fixtures failed because the schema20 table remained in the reconstructed historical database. Dropping the later additions and excluding their empty tables from business-row comparisons preserves the independently frozen v18 hashes and every original assertion. Earlier root fixture and cloud draft failures remain retained; cloud affected-suite claims are separate from this local receipt.

All chunks, compressed/raw identities and applied file hashes were checked for the three scoped transfers. Publication creates no PR or merge. External source/provider/current authority, signing trust, residency and actual COMMIT fencing remain unqualified; all44 tasks/ten gates remain NOT VERIFIED. Ledger copied-lease retirement and Billing reference closure are active; Carrier durable provenance follows this checkpoint. No CI/runners, workflow, provider IO or deployment.
