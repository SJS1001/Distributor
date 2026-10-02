# Synthetic load and recovery rehearsal

Run `npm run verify:load-recovery` directly on a workstation with Node >=24.16.0 <25 and the repository dependencies installed. This command does not use GitHub Actions or another CI runner. It creates fresh private temporary stores for CA and US, starts independent native writer processes and a loopback HTTP server, and retains a private `receipt.json` with tested input hashes, environment, timings and reconciliation results. Existing stores and inherited provider configuration are not used.

The default workload has twenty products, twenty units of each product in each of two warehouses, four writers completing twenty orders each, and four authenticated readers making sixty requests each. Products alternate serialized and quantity stock. Prices, costs, tax rates, customers, payments and handover evidence are illustrative synthetic fixtures. They are not approved operating or tax policies.

For another workload, pass a JSON file: `npm run verify:load-recovery -- /absolute/path/workload.json`. Omitted fields keep their defaults:

```json
{
  "catalogProducts": 20,
  "unitsPerProductPerWarehouse": 20,
  "writers": 4,
  "ordersPerWriter": 20,
  "readClients": 4,
  "readsPerClient": 60,
  "deadlineMs": 180000
}
```

Unknown fields, fractional/out-of-range values, more than 100,000 synthetic units per region, and insufficient per-product/warehouse stock are refused. Workload ranges are 2–1,000 products, 2–500 units, 2–16 writers, 2–1,000 orders per writer, 1–32 readers, 3–10,000 reads per reader and a 10–900 second deadline. These are local resource caps, not production capacity promises. There is no existing-store or provider option.

Each region receives stock through native purchasing, reserves one pending order, and runs overlapping writers and HTTP readers. Writers create, accept, pick, pack, commit and manually pay one-unit orders. Readers request bounded catalog and stock pages and live reconciliation. Independent fixture calculations verify product/site quantities, retained serial identity, original costs, customer/order/invoice links, prices, taxes and payment totals.

Writers pause at a known cutoff while the source database and HTTP listener remain open. The command creates an encrypted WAL backup, completes the remaining source orders, and restores to a separate fresh file. It verifies the exact cutoff, excludes later sales, refuses copied sessions and keeps provider access held. Replaying completed shipment/payment requests must conserve the original totals. The pending reservation must complete and replay with one additional invoice. HTTP and writer timing samples stay in the private regional directories. The command closes its children on completion or failure and emits a failure receipt when a run fails after initialization; incomplete regions need not have timing samples.

The backup key exists only in memory and is erased after the run. Retained synthetic archives cannot be reopened. Private receipts, databases, archives, logs, credentials and session tokens must not be committed. A public engineering receipt may record aggregate results and hashes without copying runtime data.

This provides partial local engineering coverage for D-036/D-039 and CH-10. It does not verify a product gate. Production peak load, latency, availability, RPO and RTO targets remain unapproved. CA/US here are logical stores on one workstation, not physical data residency evidence. HTTP writes, browsers, devices, real providers, network failures, simultaneous-commit backup qualification, Windows, provisioning, incident detection, operator review and scheduled-backup guarantees remain outside this rehearsal. Measured restore duration covers the restore operation only.

The focused test file is `tests/load-recovery.test.ts`. It checks workload refusals and a CA/US run under misleading inherited database/preload environment settings, with exact invoice counts, restored session/provider controls, request overlap, private file modes and terminated children. Existing native recovery and domain tests provide separate functional evidence; historical test results do not establish current production acceptance.
