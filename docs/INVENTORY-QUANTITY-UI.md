# Fixed-review bulk quantity corrections

## Parent integration verification — 2026-10-03

The parent applied the original contribution below, the native quantity
reconciliation repair and the stock-refresh integration repair. Six native
HTTP/contract checks pass across CA/CAD, US/USD and CA/USD. Eleven production
Chromium journeys against actual isolated SQLite/HTTP fixtures also pass locally
in 28.9 seconds:

```sh
./node_modules/.bin/playwright test --config tests/inventory-quantity-native-playwright.config.ts
```

These exercise actual preparation, independent approval/rejection, lost
completed responses with exact recovery, changed reservations/site authority,
valued stock reaching zero, twenty-record history paging and saved results
after a failed dashboard refresh. Provider adapters and workers are disabled.
The private browser log SHA-256 is
`c5d3dbca8c312348cca5852a69066e29884d46b4051d2b80c5a41feb8cc4de89`.
The original fourteen mock browser checks also pass after the refresh repair.

Three shared-server startup attempts reached no journeys; those failures remain
retained. The dedicated configuration uses the test group's owned fixture
lifecycle without weakening assertions or the 60-second test timeout. This
passing receipt does not qualify the separate unresolved organization revocation
browser failure, actual finance/provider/residency acceptance or any product gate.
The original cloud-only contribution and its environment limitations below
remain historical.

Bounded browser contribution, 2026-10-03. Base: `4d0c45a275fd26a3cdb1362182f7c4eea3881110` on `codex/local-distributor-checkpoint`. Native quantity commands, accounting effects, shared schema/version, restore lifecycle and final integration belong to the parent and other authorized sessions. This contribution changes only two new browser modules, minimal Inventory integration, dedicated tests and this document. Existing valuation modules, server/shared files and continuation documents remain unchanged.

## Operator workflow

Current organization finance staff (or administrators) select **Inventory → Quantity correction** on nonserialized bulk stock. Establish the product's policy separately through existing **Stock valuation** controls. Quantity correction does not create or change policies.

Source selection reads the existing bounded `/api/stock/history?unitId=…&after=…` history. Eligible sources have nonzero quantity, match original unit acquisition cost and have type `receipt`, `opening`, `count` or `quantity.correction`. Each selection requests `/api/stock/:unitId/quantity-review?sourceMovementId=…`, preserving the exact selected source identity. Original source movements are never edited; generic count commands are never used for this correction.

The review binds organization, region, configured currency, unit/product/site/bin/custody/revision, source facts, reservations, carrying position and policy. Region and currency are independent, so a Canada-resident USD organization is valid. Zero current quantity is accepted. Target quantity must be an integer between reservations and 100000, different from reviewed quantity. Physical evidence, accountant classification, reason, unique reference and explicit posting date are required. The date must be real, on or after policy effective date and strictly after the closed-through date.

**Review quantity correction** freezes every field and the exact source/policy evidence in a readonly confirmation. Only **Confirm exact quantity** sends `inventory.quantity.prepare`. Preparation creates a ready record without effects. A different current finance principal separately reviews its exact record, chooses approve or reject and supplies a reason. Confirmation sends `inventory.quantity.decide`. Rejection has a separate decision without movement/value effect. Approval must return a separate `quantity.correction` movement equal to target minus reviewed quantity, original unit cost and an integer value delta. The browser does not invent the finance valuation calculation.

## Exact attempt retention and recovery

Before any POST, the browser retains the original command body, idempotency key, review/record snapshot and canonical SHA256 fingerprint in local storage under an organization/principal key. Same-profile Web Locks coordinate submission. Storage read-back and repeated exact-attempt checks fence replacement. Missing locks, inaccessible/damaged storage, conflicting tab evidence and unverified authority refuse transport. An externally cleared key invalidates the fixed review and fences the current view; restoring/reconciling evidence is required. There is no discard-and-replace bypass.

Lost, malformed, refused or abandoned replies retain the attempt. After reload or fresh login as the original principal, use **Recover exact quantity attempt**. This finance-only panel is mounted independently of the selected stock row and remains available if that row disappears. Opening retained evidence and confirming it recheck the current session's identity, role, organization account scope, password/MFA requirements and site grants. Org/unit navigation abandons late UI work and never undoes an already submitted native command.

Decision recovery first reads `/api/stock/quantity-corrections/:correctionId`. A matching terminal decision resolves without another POST. A ready record must preserve exact immutable identity before the original decision body/key may be sent. A conflicting decision or failed read retains the original attempt without replacement writes. Preparation recovery uses its original body/key; it accepts the actual current ready/reviewed/rejected record while preserving immutable preparation identity. After every successful command/replay, a fresh record read preserves current native state instead of overwriting it with a stale ready receipt.

Strict structural guards mirror the parent-supplied native excerpts. Review and policy SHA256 hashes are recomputed over canonical JSON; source, organization, region/currency, unit/product and warehouse grants are checked before response display/acceptance. Record identity, independent reviewer, ready/rejected null effects and approved movement bindings are enforced. These hashes establish consistency, not authenticity or independent accountant verification; the native authenticated authority remains decisive.

After saving, actual stock refresh and bounded history refresh are attempted. A saved record/status remains useful when refresh fails. Cleanup failure also retains that saved result and the original recoverable attempt. Source and correction history pages are bounded to twenty records; older/newer controls preserve cursor paths and fail closed on malformed pages, duplicate identities or invalid records. Failed reads clear stale actionable evidence; **Refresh quantity evidence** restarts current reads.

## Local verification and integration limits

Final foreground checks:

- `node --import tsx --test tests/inventory-quantity-contract.test.ts`: 8/8 passing structural/hash/input/record/replay/page checks against synthetic supplied-contract fixtures.
- `DISTRIBUTOR_QUANTITY_CHROMIUM=/tmp/quantity-chromium node node_modules/@playwright/test/cli.js test --config tests/inventory-quantity-playwright.config.ts`: 14/14 passing browser journeys against an isolated Vite harness with mocked HTTP responses, using Chromium 153 from an isolated `@sparticuz/chromium` 153.0.0 runtime. No runtime package or lockfile changes are included. The environment variable is optional on a host with Playwright's normal installed browser.
- `npm run typecheck`, `npm run build`, dedicated Prettier check and `git diff --check`: passing; the build retains the existing large bundle warning.

Browser cases cover fixed preparation, independent approval/rejection, persisted-before-send body/key, lost/malformed/abandoned replies, reload/missing-row recovery, stale-ready versus current decided preparation, read-first terminal decisions, conflicting decisions/read refusal, storage/cleanup failure, missing Web Locks/held locks, competing tab storage, authority denial, org/unit switching, bounded paging, saved refresh failure, forged policy hashes and phone width/focus.

Initial checks preserve their limitations: `tsx --test` hit an environment IPC socket refusal; `node --import tsx --test` succeeded. Browser startup initially lacked Chromium and Playwright download returned invalid archives; isolated Chromium resolved that. The first executed browser run passed five and failed five due to the decision select's missing explicit accessible label and a test that did not respect the storage-clear fence. Corrections and the expanded passing runs supersede those failures, without claiming they never occurred.

These are mock-only browser/contract checks, not native HTTP/database/accounting verification. The baseline has no native quantity API. Read-only inspection of published parent `f90922717f444af7ee57d17701cc470319bf2a29` confirms native types/guards/HTTP paths and the flattened review response (review fields plus reviewHash), which the browser normalizes into its retained envelope. The parent will integrate this patch with its published native implementation and test against the real backend, including schema 17 interaction, current authority/restore holds, immutable original movements, accounting effects, concurrency and actual stock refresh. No full existing browser/native suite, production-only runtime, actual finance/provider/residency/device/operator acceptance or product-gate completion is claimed.

Browser storage is plaintext same-profile evidence; cleared storage, independent browsers/devices and shared-device protection require operator policy and native reconciliation. Web Locks do not coordinate independent devices. Retained local evidence cannot authorize a native action. Effective model/reasoning configuration is unverified: this launcher exposes no selection or runtime-readable configuration controls. No subagents, CI/workflows/runners, providers, credentials, deployments, pushes, PRs, merges, purchases or automations were used.
