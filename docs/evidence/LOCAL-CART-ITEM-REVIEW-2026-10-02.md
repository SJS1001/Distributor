# Individual cart item review — local engineering receipt

Status: partial local PASS, 2026-10-02. Automated workstation review by Codex; no human acceptance or product gate verification. All 44 tasks and 10 gates remain NOT VERIFIED. Scope: D-018/D-019/D-020, REQ-12/REQ-13, partial G3 engineering.

## Candidate and environment

Parent: `1b65fd7` on `codex/local-distributor-checkpoint`. The companion [machine receipt](LOCAL-CART-ITEM-REVIEW-2026-10-02.json) identifies final source/test/configuration hashes, production assets, commands, timestamps and private artifact hashes. Tests ran directly on the macOS arm64 workstation, Node v24.16.0, npm 11.13.0, with production Vite assets and local Chromium against synthetic HTTP/SQLite fixtures. No CI runner, cloud session, external provider, physical device, deployment, publication, push or PR was used. Backend, schema, dependencies and workflows are unchanged.

## Change and independent outcomes

Unavailable saved items display SKU, name and saved quantity, each with an unchecked removal choice. Select-all follows individual choices. Every unavailable item must be selected before saving or quoting; partial choices and cancellation before submission preserve native facts. Active selected products have a removal button on the current or another catalog page. Removing an off-page row returns keyboard focus to the stable catalog search input. Removal buttons are disabled while a catalog read is pending.

The new unavailable-review fixture starts with four lines: EQ-1 quantity 1, retired serialized product quantity 2, retired bulk product quantity 3 and active bulk product quantity 2. Partial selection produces zero save and quote requests; cancellation retains all four lines and reopening resets choices and quantities. Reviewing both retired items and removing the active bulk item saves only EQ-1. The first native save commits revision 2 but its HTTP response is replaced by a synthetic 503. Editing EQ-1 to quantity 2 and continuing first repeats the identical saved payload/key, then saves against revision 2 with a new key. The final cart is revision 3, a single quote totals CA$226.00, and no order is accepted. Reopening preserves quantity 2 without unavailable lines.

The off-page keyboard fixture removes saved PAGE-44 quantity 3 with Enter after a catalog search returns no matching products. The serialized draft retains PAGE-00 quantity 2 and every other selected line. Search receives focus; cancel issues no save/quote and preserves the native cart. Reopening retains PAGE-44 quantity 3. Both new journeys use a 390×844 viewport; no horizontal overflow is observed, and the unavailable-review journey records no browser exceptions.

## Verification and retained failures

- Parent reproduction: expected exit 1, missing named unavailable-item review. Application ordering code was still the parent version; the new fixture/test and unused component were present. Original error context and trace remain private.
- Focused production-build browser run: 12/12 pass. This preceded the final loading-disable change and added off-page keyboard journey; the full run below covers final bytes.
- Final full production-build browser run: 102/102 pass, including both new journeys and existing order, money, stock, provider-policy and recovery journeys.
- Final TypeScript and formatting: exit 0 against final source/test bytes.
- Explicit React scan with `--scope changed --base 1b65fd7 --include-untracked --no-score`: exit 0, six files scanned, three warnings and no reported errors. The warnings are existing App control-flow complexity and array lookups in removal membership and descriptor rendering. Both new lookups are bounded by the existing 100-product selection limit. The descriptor lookup is guaranteed by constructing unavailable lines from the same independently resolved product identities. The warnings remain recorded; this is not a clean full-project React result.
- The earlier `--diff` invocation fell back to a full scan and exited 1: 41 errors and 177 warnings, compared with the prior checkpoint's 41 errors and 175 warnings. Original output is retained. The deprecated flag was corrected rather than treating the full result as a changed-file pass.
- Intermediate structure checks preceded creation of the Markdown and machine receipts and failed on those missing links. The final structure check follows creation of both files and is recorded separately in the machine receipt. Historical and intermediate command logs remain retained.

All command results and relevant private logs/traces are hashed under `/tmp/distributor-cart-item-review-checkpoint`. Final input and asset hashes scope the passing full browser result. Earlier backend 1890/1890 and production-only runtime receipts remain historical; they were not rerun for this UI-only change and are not new acceptance claims.

## Validity and limits

Removal review is a UI acknowledgement; current native role/customer/site, revision, price, credit, stock and acceptance guards remain authoritative. An unavailable line cannot be retained in a new quote, reactivated or independently requoted by this change. Canceling after a submitted save cannot undo its committed effect. Catalog retirement management, changing activity during preparation, browser engines other than tested Chromium, broader React diagnostics, live cursor consistency, SQL costs and actual tax/provider/device/production/residency/operator qualification remain open. Any change to ordering, serialization, descriptor resolution, native retry/revision behavior or dependencies requires appropriate re-verification. No generated operator sign-off or completed task/gate is claimed.
