# Local unavailable saved-cart review receipt

Date: 2026-10-02. Candidate based on local parent `6c67a17`. The [machine receipt](LOCAL-UNAVAILABLE-CART-2026-10-02.json) identifies the exact parent, 382 final source/test/configuration inputs, terminal commands, log hashes and production assets. Direct macOS arm64 workstation checks use synthetic SQLite facts, loopback HTTP and production-build Chromium. All 44 tasks and 10 product gates remain **NOT VERIFIED**.

## Behavior checked

Previously, editing a saved cart omitted lines whose products had since become inactive. The unchanged-parent production build reproduces a native save before any removal review. The editor now discloses the unavailable item/unit counts and requires an unchecked explicit removal choice before either saving or quoting. Available saved quantities remain intact. Canceling before submission preserves the cart; reopening resets the choice. Canceling after submission cannot undo a committed save.

Three new native-backed journeys check:

- Phone buyer: refusing removal sends zero save and quote requests and preserves both original lines. A lost successful save response recovers with the exact original key/payload; the cart advances once to revision two, retains the active quantity, and produces a 11300-cent CAD quote without creating an order. Reload shows the saved active line and no removal checkbox.
- Staff: selecting the customer, checking removal and canceling preserves the original cart. Reopening resets the choice; explicit submission removes only the unavailable line and quotes the retained active quantity.
- Buyer with only an unavailable line: explicit removal saves an empty cart at revision two. Native quoting refuses with “Cart is empty.” Adding an active quantity saves revision three and permits quotation without automatic acceptance.

Synthetic product retirement occurs in the catalog's owning fixture store after native cart saving. Stock is received through native procurement/receiving. No native allocation, save revision, quote or acceptance rule changes.

## Results and retained failures

| Check | Observed result |
| --- | --- |
| Final complete production-build Chromium suite | 97 passed, zero failures |
| Final affected browser journeys | 12 passed, zero failures: three removal, six recovery, two pricing and existing warehouse count review |
| Final type, format and production build | Exit 0 |
| Changed React Doctor scan against parent | Exit 0; existing App complexity warning retained |
| Isolated production-only runtime | PASS; 217 inputs, 27 commands, 69 development-only packages absent; synthetic CA/US twice, PDF/ZPL and encrypted local backup/restore |

The first full browser run was 96/97. An older warehouse-count journey assumed its lot remained on the first stock page after dashboard refresh. It now uses the application's bin search after mutations, retaining all quantity, cost, stale-cutoff and approval assertions. The original failure and traces remain private. Initial field type inference failed and was corrected with an explicit `Field[]`. Parent reproduction and superseded checks also remain under `/tmp/distributor-unavailable-cart-checkpoint`.

The complete backend's preceding 1884/1884 result and full React scan's 212 findings remain historical. This frontend-only change claims no fresh full backend or clean full React result. Runtime's expected disabled CLI refusals exit one as asserted by its harness. Temporary artifacts are subject to machine cleanup; their hashes identify observations, not durable product acceptance.

## Review and remaining qualification

Self-review checked explicit consent before any command, original quantities on cancellation, zero save/quote traffic without consent, exact lost-response recovery, observed revisions, empty-cart refusal, phone layout and no automatic order acceptance. The removal decision currently relies on a **complete active catalog projection**: a future paged editor must resolve saved/selected products independently and must never classify an off-page active product as unavailable.

Unavailable product names and individual unavailable-line editing are absent; removal applies to all unavailable lines together. Catalog retirement management, bounded catalog/cart reads, coherent read snapshots, broader staff policy/React work and actual provider/device/production/residency/operator qualification remain open. This is partial D-019/D-020 and REQ-12/REQ-13 engineering, without G3 or task acceptance.

No backend, schema, dependency, license or workflow change. Work remains local: no CI runner, cloud session, delegation, actual provider/device request, push, PR, deployment or publication.
