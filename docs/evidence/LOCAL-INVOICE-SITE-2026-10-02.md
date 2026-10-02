# Local invoice shipment-site custody — 2026-10-02

Status: partial synthetic engineering evidence; all 44 tasks and 10 product gates remain NOT VERIFIED. Full-system implementation remains in progress.

The candidate is based on local parent `cc9316c` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-INVOICE-SITE-2026-10-02.json) identifies exact source/test/configuration SHA256 values, environment, commands, outcomes and private retained logs. Work runs directly on the workstation with synthetic SQLite, loopback HTTP and production-build Chromium. No CI/cloud runner, provider/device request, push, PR, deployment or publication occurred.

## Behavior and coverage

Warehouse invoice details, lines and balances require current persisted shipment-site grants. Billing resolves financial data; fulfillment alone checks its shipment's organization, site, account, order and packed/shipped state. Historical opening invoices have no native warehouse entitlement. Issuance checks custody before saved results or effects, and verifies saved invoice account/order. The owning native handover remains responsible for actual quantities and triggers, with immutable invoice facts captured while packed inside its atomic transaction.

Eight focused cases verify other-site and empty-grant denial; stale/forged grants after independent change and restart; native effects conserved on denied new/saved issuance; void, absent and mismatched sources; tampered stored invoice provenance; actual approved opening import; and authorized warehouse handover/exact retries with immutable facts and no duplicate stock/money. Conservation compares all tables owned by billing, fulfillment, ordering, inventory and platform before/after refused access or saved issuance.

## Verification

Final reviewed checks passed: **1855/1855 backend**, **52/52 focused**, **5/5 selected browser journeys**, type/format/build and isolated production-only installation. Runtime verified CA and US startup/restart, synthetic outputs and local backup/restore with development-only dependencies absent. Exact command outcomes and runtime details are recorded in the machine receipt. These local checks do not establish product gate acceptance.

The reduced unchanged-parent reproduction restores only application/billing/fulfillment modules to the parent and retains candidate supporting dependencies and final tests: seven expected failures and one valid native handover pass. A separate candidate copy removes only the saved-invoice provenance check: its targeted test fails at issuance retry while invoice-read guards remain. Neither reproduction changes the working checkout. Earlier test typing/constructor failures and superseded passing runs remain retained privately.

The five browser journeys cover multi-line acceptance and fulfillment, split packing/void/handover, reviewed unpaid-document import, immutable PDF/credit/aging and short-pick handover. The earlier billing-profile journey relies on the preceding unpaid-document fixture; both are included in order. No UI source changed; prior React diagnostics remain unresolved and no clean React scan is claimed.

## Limits

Partial D-008/D-022/D-023 and REQ-03/REQ-14/REQ-15 evidence only. This does not independently authorize arbitrary direct invoice issuance or prove quantity/tax policy, staff visibility, all raw internal APIs, coherent cross-query reads, bounded collections, production scale/security, residency, actual providers/hardware or operator acceptance. Other staff visibility remains provisional. No schema, dependency, license or workflow change. Historical receipts and dependency notices are retained.
