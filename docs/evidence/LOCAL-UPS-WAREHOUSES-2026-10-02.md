# Local UPS warehouse account verification — 2026-10-02

Status: PASS for the recorded synthetic engineering scope. Full system incomplete; all 44 tasks and 10 product gates remain NOT VERIFIED. Partial D-027/D-029 coverage only.

## Tested version and environment

Local parent `850ec09c8260bf40cfb8a7c96717e2e33c98b23a` plus the exact candidate and 336 tested input hashes in [the companion manifest](LOCAL-UPS-WAREHOUSES-2026-10-02.json). Companion SHA256: `b3906ee01f533dc1a0b806cafc06fb87acc48b0432603543bf86f64682def050`. Direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, synthetic SQLite stores, loopback HTTP and headless Chromium. Carrier transport is injected; no actual provider/device request, customer data, CI runner, cloud session, push/PR or deployment.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1703/1703; 26 new tests |
| Focused carrier/configuration/native regression | PASS, 254/254 |
| Production-build browser regression | PASS, 74/74 existing journeys |
| Typecheck and formatting | PASS, exit 0 |
| Isolated production-only install/startup | PASS, 205 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

Trusted startup accepts 1–20 exact UPS native warehouse registrations in one regional organization, or the retained organization-wide mode. Tests refuse empty/null/nonarray/oversized/malformed lists, duplicate/foreign warehouses, extra fields, invalid contacts/accounts/services, missing or invalid named credential references, inline credentials and mixed legacy account fields even when empty. Invalid startup preserves the entire native store and makes no provider request. Malformed injected bindings return configuration errors rather than dereferencing null entries.

CA and US store fixtures establish regional warehouse membership, frozen startup metadata, independent returned configuration copies, site-filtered configuration discovery and current-grant refusals. Runtime registration rejects duplicate native sites and ambiguous mixtures of organization-wide/site bindings. The original organization-wide account still works from either warehouse.

Two ordinary packed native shipments use different UPS accounts, shipper contacts, service names and credentials. HTTP review returns exactly the origin's configuration. Reviewing the other site's hash refuses preparation. Exact preparation retries retain one intent; each adapter uses its own token, Shipper account, billing account and reviewed ShipFrom. Booking/label retention leaves stock/orders/shipments/invoices unchanged until separate native handovers create two invoices.

A lost second-account committed reply remains unknown. After actual application/SQLite restart, removed registration and changed account refuse recovery before transport. Reordered startup entries select the exact original native warehouse/account. Read-only UPS reference tracking and label recovery retain the original label with exactly one purchase write. No resend is permitted.

A reserved warranty replacement uses its native site's HTTP configuration; a missing-site registration refuses preparation. Protocol booking preserves native facts. Separate warranty dispatch scans the exact reserved serial, uses confirmed tracking and preserves the original invoice without creating another sale.

## Evidence and limits

The manifest records command timestamps/exit codes/log hashes, exact tested source/config files, unchanged historical evidence/license notices, isolated runtime inputs/commands and matching private/current production assets. Initial focused failures remain preserved privately: the recovery assertion incorrectly expected a Promise from a synchronous refusal; the replacement assertion used `unit.status` instead of owning `unit.state`. Corrected tests leave production authority/dispatch/recovery guards intact. Current full regression uses the final captured inputs.

The 74 browser journeys are existing regression coverage. New warehouse-specific behavior is directly exercised through native backend and HTTP tests; no new dedicated browser journey is claimed. Runtime installation keeps carriers default-disabled. Registered shipper and native physical ShipFrom remain separate, and account selection does not certify actual origin ownership.

All origins, accounts, credentials and provider labels are synthetic. Actual UPS accounts/services/correlation, fees, credentials, physical labels/devices, residency and operator acceptance remain unqualified. There is no production switch, credential enrollment/editor, new provider protocol, multi-package support or carrier void/refund implementation in this change. Other clients retain their existing startup and recovery limits.

Local tests do not qualify physical disaster recovery, production load/security, infrastructure residency or agreed RPO/RTO. No schema, dependency, license or workflow change. See [the configuration runbook](../CARRIER-BOOKINGS.md#ups-configuration-for-multiple-warehouses).
