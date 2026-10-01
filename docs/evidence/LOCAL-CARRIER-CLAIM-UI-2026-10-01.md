# Interrupted carrier claim browser recovery — 2026-10-01

**PASS within captured local regression scope. Full system incomplete; all 44 tasks/10 gates NOT VERIFIED.** Partial D-027/D-036, REQ-03/REQ-16/REQ-19 and CH-05/CH-07/CH-08/CH-09. Codex self-review; independent operator/provider/security acceptance outstanding.

Parent `a846b88a0b7b45f55d39dc5ecde94fb87f4e37ad` on `codex/local-distributor-checkpoint`. Candidate captured 2026-10-01T23:05:31.178581+00:00. The [companion](LOCAL-CARRIER-CLAIM-UI-2026-10-01.json) binds 263 application/configuration/test inputs, 183 unchanged historical evidence files, 170 unchanged dependency license/notice files and private commands/logs. No schema/dependency/license change. Procedure: [administrator recovery controls](../CARRIER-BOOKINGS.md#administrator-browser-recovery-controls).

Environment: direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, disposable SQLite and Chromium. Four original phone journeys at 390 × 844. Six synthetic packed shipments include ordinary UPS claims and Canada Post member/manifest groups. Synthetic aged token/start values represent interrupted writers; retained manifest uncertainty is created through the real coordinator and an injected lost response. HTTP provider processing is disabled. No actual provider, printed label or stopped production process.

| Check | Observed result |
| --- | --- |
| `npm test` | PASS 1228/1228, exit 0 |
| Focused phone claim journeys | PASS 4/4, exit 0 |
| `npm run test:e2e` | PASS 59/59 plus production build, exit 0; four new journeys and 55 existing |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |

Expected and observed: administrators select an explicit age with no default, review the exact retained target/hash/state/times, supply a nonblank reason and acknowledge writer investigation. Missing reason or acknowledgment prevents submission. Whitespace-only reasons produce an inline error without a command. A deliberately too-large age gets CLAIM_ACTIVE with original running state/native facts intact; the exact refused attempt is retained. Discard clears only the saved browser payload, and a refreshed new age/hash/acknowledgment permits a separate release.

The ordinary journey commits a real release then drops its HTTP response. Reloading the same tab restores the immutable payload and retries the same command key; both bodies/keys are identical and the original booking remains unknown. Saved release payloads disappear after observed success. No send control is offered. Native stock, orders, invoices and shipments equal their pre-release snapshots.

The member journey holds a real claim read, changes age and observes request cancellation; a late response cannot populate release controls. A competing real API release invalidates the displayed review; its attempted release is refused and leaves the pending sibling unchanged. After discard/refresh, a second held read is canceled by warehouse change and cannot restore the previous controls. The manifest journey releases with all created members and provider-group identity retained, changes no native facts and offers no transmit control. A warehouse account sees no administrator controls and its direct claim API read returns 403. All four journeys observe no unhandled page errors.

The browser saves exact target/hash/age/reason scoped to organization/administrator/target in session storage before sending. The existing command helper retains the exact key until observed success. Sign-out clears saved payloads/keys; another tab/device does not inherit them. Discard does not reverse server state or erase its durable audit. Displayed acknowledgment does not prove stopped writer or qualified deadline. No provider configuration is enabled by these controls.

Preserved initial failure: 1/3 journeys passed. The ordinary selector expected a full shipment ID despite the screen's eight-character cell, and the manifest fixture set transmitting state without retained claim identity. Corrected the exact cell selector and generated manifest uncertainty through the coordinator before aging the fixture claim. Initial logs/error contexts/traces are retained privately with hashes. Repaired three journeys and then strengthened four journeys passed; no existing assertions were weakened. Self-review also added bounded timestamp display, inline discard-storage failure and nonblank trimmed reason checks.

Self-review checked current administrator exposure plus server authority, exact immutable retries before I/O, storage scoping and sign-out behavior, review lifetime/canceled reads, parent refresh/unmount, unknown-only outcome and native conservation. Source/tests are original within the existing license/dependency baseline. Historical evidence is untouched. This verifies synthetic local engineering only.

Remaining: qualified stopped-writer/deadline/clock/monitoring procedures, external account writers, actual carrier credentials/account/protocol/services/fees/terms/residency, supported physical devices, regional infrastructure, independent security/load/retention/recovery and human acceptance. FedEx synchronous lost-response recovery remains unsupported. Private temporary logs have no archival guarantee. Direct workstation/local commits only; no CI/cloud/delegation/provider request/push/PR/deployment/publication/purchase/live data or OPUS/UB integration. All product gates remain NOT VERIFIED.
