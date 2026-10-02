# Local shipment coverage evidence

Partial D-025–D-033 and schema/recovery engineering evidence. All 44 tasks and 10 gates remain NOT VERIFIED. [Hash-bearing companion](LOCAL-SHIPMENT-COVERAGE-2026-10-02.json), [warranty operation](../WARRANTY.md) and [schema upgrade procedure](../SCHEMA-UPGRADES.md).

Parent `7fb1118683c7975bb4c849259361d61a71fa2648`, branch `codex/local-distributor-checkpoint`. Checks ran 2026-10-02 UTC on the direct macOS arm64 workstation with Node 24.16.0/npm 11.13.0, synthetic SQLite and loopback HTTP/Chromium. The companion identifies 314 unchanged tested inputs, actual command UTC times/exits/log hashes, retained historical evidence and license texts, and matching current/private production assets. Schema version six adds fulfillment-owned shipment coverage; no dependency, license or workflow change. No CI/cloud/delegation, provider/device request, push/PR, live data or deployment.

| Check | Actual outcome |
| --- | --- |
| `npm test` | PASS 1574/1574: eleven new shipment coverage tests and six additional schema-upgrade cases relative to the parent |
| `npm run test:e2e` | PASS 72/72 with production build, including the new phone shipment-policy claim journey |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `npm run verify:runtime` | PASS, exit 0; 195 copied inputs, 69 exclusively development packages absent, 27 child commands, CA/US startup twice each, authenticated PDF/ZPL replay and local encrypted backup/restore |
| Focused warranty/policy/sold-serial/schema/recovery backend | PASS 95/95 |
| Focused shipment-policy phone journey | PASS 1/1 |

## Tested behavior

Native handover captures the whitelisted duration policy revision and configuration timestamp, exact UTC shipment time and calculated end in the stock/order/invoice/custody command transaction. Packing does not capture the policy: two partial handovers on either side of a policy change retain their respective versions. A separate-process policy/handover race retains one complete old or new policy. A late coverage-insert failure rolls back stock, order, billing, shipment, command, event and audit effects; the same command then commits once after the injected failure is removed.

A 730-day leap-date shipment keeps its policy and end after the organization changes to 30 days, including application restart and local encrypted backup/restore. A malformed later organization policy blocks a new handover but cannot rewrite retained coverage or an authorized cached handover. Claim review accepts the retained shipment revision and refuses a different revision without effects. Zero-day elapsed dates remain reviewable; they do not make an eligibility decision. Replacement chains inherit the original claim policy/end; subsequent ordinary resale captures the resale handover's current policy and account.

Fresh persisted identity, role, warehouse/site, buyer account and forced-password-change checks precede retained reads and cached handover replay. Forged actor grants do not restore access. Whitelisted public projections exclude policy reviewer/reason and internal storage fields. Malformed retained policy/dates fail closed without read-side mutation. Real HTTP buyer sessions retain only their current scoped coverage.

The 390-by-844 Chromium journey reads the original revision despite a newer organization policy, retries a failed coverage read, opens the claim review, changes policy again through a separate authorized session, then loses the committed claim response. Exact retry uses the same command key and retained revision; one claim and its original end remain. The resulting panel identifies the policy retained at original shipment. The journey reports no page errors.

## Schema conservation and corrections

The independently frozen version-five fixture records parent layout fingerprints and claim-coverage DDL. Exact previous versions one through five upgrade into a fresh same-region version-six file, with CA/US and reporting-enabled/disabled profiles. Source files and existing business facts remain unchanged; version-five claim snapshots survive. Earlier missing shipment/claim policies remain absent. Lying version/hash receipts and partial new-table layouts are refused without a destination. Current-version encrypted archives restore locally; older layouts remain refused until the separate reviewed upgrade procedure.

Initial runs exposed outdated schema-version expectations, incomplete historical fixture table removal, impossible version-five shipment provenance, fixture API/type/session guesses and one phone wording mismatch. Corrected fixtures now model absent pre-version-six shipment policy before native claim creation, use the actual owning operations/security fields and assert the panel's original-shipment wording. No authority check was weakened. Initial/superseded logs and failed phone traces remain private and hashed by the companion.

Self-review checked module-owned storage, the single command transaction, current authority before cached replay, exact dates/public projection, retained versus legacy review revisions, replacement inheritance/resale, independent schema fingerprints and absence of fabricated backfill. Documentation structure/link and whitespace checks are recorded separately in the companion; they establish document consistency only.

## Limits

Shipment time and duration remain provisional engineering policy; approved product/customer terms, delivery/registration triggers, transferability and remedy/expiry rules are unresolved. Old ordinary shipments without retained policy explicitly use current provisional policy until claim capture. Historical missing facts are not reconstructed. Direct module helper reads are not independently qualified for concurrent writers; owning HTTP/warranty read transactions provide the tested scope. Actual providers, devices, infrastructure residency, production security/load, disk/power recovery, agreed RPO/RTO and operator acceptance remain outstanding. The full system is incomplete and no product gate is accepted.
