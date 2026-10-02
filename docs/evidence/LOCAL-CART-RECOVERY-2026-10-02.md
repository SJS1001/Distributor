# Local cart save and quote recovery receipt

Date: 2026-10-02. Candidate based on local parent `abdf51b`; exact parent, final input manifest and command/log hashes are in the [machine receipt](LOCAL-CART-RECOVERY-2026-10-02.json). Direct macOS arm64 workstation checks use synthetic SQLite facts, loopback HTTP and production-build Chromium. All 44 tasks and 10 product gates remain **NOT VERIFIED**.

## Behavior checked

Previously, a successful cart save followed by a failed quote left the quantity editor at its original revision. Retrying attempted another save and failed with “Cart changed; refresh before saving.” The unchanged-parent production build independently reproduces this symptom. The editor now retains uncertain exact saves, recovers their durable request keys before submitting changed quantities, advances its observed revision after success and skips another save when retrying a quote for unchanged saved quantities. Structured request errors retain existing user messages and permit correcting explicit client refusals while preserving pending transport/server/408 attempts.

Six new native-backed browser journeys check:

- A failed quote after a successful save: one save, two quote requests, one accepted order.
- Lost successful save and quote responses: identical keys and payloads, original quote identity and one order.
- Changed quantities after a lost save: resolve original revision-zero attempt, then save three units at revision one; reload preserves the saved quantities.
- A separate administrator session changes the cart: new quotes and saves refuse the stale revision; cancel/reopen loads the other session's quantities.
- A quantity of 100001 is refused without creating a cart; correcting to one unit permits ordering.
- A successful save whose response is dropped, followed by HTTP 408 and changed quantities: three identical original attempts precede one new save at the returned revision; the final two-unit order allocates once.

The synthetic fixture receives additional serialized units through native procurement and receiving. It does not bypass allocation rules. Order totals are independently asserted at 11300, 22600 and 33900 cents for one, two and three units under the fixture's illustrative tax. See [the recovery procedure](../CUSTOMER-PRICING.md#recover-saving-and-quoting).

## Results and version limits

| Check | Observed result |
| --- | --- |
| Complete production-build Chromium suite | 94 passed, zero failures; precedes the final timeout-test strengthening and its synthetic stock adjustment |
| Final affected production-build Chromium journeys | 9 passed, zero failures: all six recovery journeys, both customer-pricing journeys and existing multi-line ordering/fulfillment |
| Focused native pricing, ordering authority, domain and concurrency checks | 28 passed, zero failures; backend inputs unchanged throughout this frontend change |
| Final type and formatting checks | Exit 0 |
| Changed React Doctor scan against parent | Exit 0; existing App complexity warning retained |

Final runtime packaging results are recorded in the machine receipt and handoff. The preceding complete backend receipt remains historical (1884/1884); this frontend-only change does not claim a fresh full backend run. The preceding full React scan remains nonclean with 212 findings; a scoped scan does not establish full React cleanliness.

The final manifest identifies 382 inputs. Only the new recovery fixture and journey differ from the complete 94-test run's captured inputs: the timeout oracle now changes quantities before recovery, and native fixture stock supports its extra unit. All affected journeys were rerun. Production source/assets are unchanged by that test strengthening.

Original parent reproduction, insufficient-stock fixture failures, validation expectation mismatch, SQLite fixture typing failure, unavailable npx invocation and superseded runs remain private under `/tmp/distributor-cart-recovery-checkpoint`. Runtime's first receipt predates a source-comment clarification; final packaging is checked again against final bytes. Temporary evidence can be removed by machine cleanup; hashes identify observed evidence, not durable product acceptance. Historical receipts and third-party notices are preserved.

## Review and outstanding work

Self-review checked exact pending payload/key recovery before changed quantities, revision advancement after observed success, explicit validation correction, retained network/server/timeout uncertainty, cached immutable quote identity, separate-session refusal/reopen, native current authority/credit/stock checks and one-order allocation/totals. No backend, schema, dependency, license or workflow change.

Pending editor state lasts for that editor; reopening reads native saved quantities. Existing issued quotes retain their snapshot and expiry. Submitted commands may finish after navigation; this does not add offline ordering, global mutation cancellation or a new quote-expiry experience. Catalog/cart bounds, inactive saved lines, coherent snapshots, broader React diagnostics and actual tax/provider/device/production/residency/operator acceptance remain open.

This is partial D-019/D-020 and REQ-12/REQ-13 engineering. It does not pass G3 or complete task acceptance. Work remains local: no CI runner, cloud session, delegation, actual provider/device request, push, PR, deployment or publication was started.
