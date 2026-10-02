# Local split-stock downstream qualification — 2026-10-02

Tested candidate: published parent `16612546e27047017bb6a397f45d1a880768faf7` plus the test/helper changes identified by SHA-256 in [the machine receipt](LOCAL-PARTIAL-BIN-DOWNSTREAM-2026-10-02.json). Branch: `codex/local-distributor-checkpoint`. Environment: direct macOS arm64 workstation, Node v24.16.0, fresh synthetic CA/CAD and US/USD native SQLite stores. No CI runners, workflows or provider requests were used.

## Outcomes

| Check | Command | Actual result |
| --- | --- | --- |
| New downstream cases | `npm exec -- tsx --test tests/partial-bin-downstream.test.ts` | 8 passed; zero failed, cancelled or skipped |
| Full native suite | `npm test` | 1,955 passed; zero failed, cancelled or skipped |
| Focused native suite | `npm exec -- tsx --test tests/partial-bin-downstream.test.ts tests/partial-bin-relocation.test.ts tests/supplier-returns.test.ts tests/supplier-followups.test.ts tests/transfers.test.ts tests/transfer-loss.test.ts tests/accounting-costs.test.ts` | 52 passed; zero failed, cancelled or skipped |
| TypeScript | `npm run typecheck` | Exit 0 |
| Formatting | `npm run format:check` | Exit 0 |
| Planning structure | `npm run verify:plan` | Exit 0; 44 tasks, 10 gates and 1,092 local links checked; no product gate verified |

The new cases qualify existing native behavior; no production fix or failing-before/fixed-after claim is made. The helper accepts the test store's declared region and preserves its prior CA default.

## Independent expectations

- Six bulk units received at 125 regional cents retain their receipt through repeated bin splits. Returning four descendants and two source units exhausts the original six-unit capacity. A separately counted extra unit remains present but cannot enlarge that receipt's return allowance.
- A destination-only warehouse user sees the original receipt through its own arrival lot and cannot read source custody or perform administrator supplier handover. Changed grants/demoted administrator authority persist through restart and reject cached as well as new requests. An authorized retry recovers the original result without another stock removal.
- Independent native processes attempt three-unit and four-unit returns from separate split lots after a count gain. Exactly one commits; the other receives `QUANTITY`. The receipt and physical stock/cost totals match the winning handover and remain stable on restart/retry.
- Repeated splits and a two-unit transfer produce five lots after one damaged arrival, one recorded loss and one quarantined recovery. Every lot traces to the original receipt. Three supplier handovers remove 375 regional cents. The bulk remainder is three units worth 375; the independent fixture's serialized stock contributes 18,000, yielding closing value 18,375.
- The cost window contains 15 movements, increases 18,875, decreases 500 and closes at 18,375. Reviewed regional accounting files balance debits/credits at 19,375 and remain byte-identical after restart. Recorded supplier credit of 130 against original return cost 125 preserves the five-cent difference without changing stock or creating customer invoices/credits. A reviewed local file is not evidence of accounting-provider acceptance.

## Review and limits

Checks use public owning native operations, literal quantity/cost expectations and real competing processes. No direct foreign-table writes, dependency, schema or workflow changes were introduced. All logs remain private under `/tmp/distributor-partial-bin-downstream-checkpoint`; the machine receipt preserves their hashes. No failing verification run was observed in this checkpoint.

No fresh browser, build, React, physical-device, carrier/payment/accounting-provider, production load/security or infrastructure-residency qualification is claimed. Bin directory/capacity, browser downstream journeys, actual custody and operator acceptance remain outstanding. All 44 tasks and 10 gates remain NOT VERIFIED; the full system remains incomplete.
