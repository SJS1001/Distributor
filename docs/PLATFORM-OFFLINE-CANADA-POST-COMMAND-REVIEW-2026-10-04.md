# Original ordinary Canada Post command preimage review

Excluded public baseline: `f1583c3ae343e3bd1ea265a98b77bb2134507085`, `SJS1001/Distributor`, branch `codex/local-distributor-checkpoint`; exact tree `db79742e99320d6272147ce37e11a66a147d144f`. Public Git commit/tree/blob objects were reconstructed and independently matched before creating the isolated checkout. Prior Ledger deliveries remain preserved. Only the three assigned NEW source/test/report paths change. The transfer manifest binds the exact tested/closing commit and final file bytes; no existing production file, schema, test or report was edited.

Requested model/effort: `gpt-6-astra/high`. Effective runtime model/effort settings are unexposed and unverified. No new executor or agent was started.

## Fixed API and result

[PlatformOfflineCanadaPostCommandReviewReader](../src/server/platform-offline-canada-post-command-review.ts) has exactly the requested constructor `(database: Database, identity: Identity, platform: Platform, fulfillment: Fulfillment, carrier: CarrierBookings)` and method `getInTransaction(actor: Actor, groupId: string, bookingId: string)`.

The detached, deeply frozen result exports `PlatformOfflineCanadaPostCommandReview` and includes:

- `version: 1`, purpose `distributor-platform-offline-canada-post-command-review-v1`, exact organization/group/booking identities;
- `nativeReviewHash` from a freshly captured actual `CarrierOfflineMemberReview.reviewUnknownMemberInTransaction` result, plus its original `nativeBlockers` without rewriting those native limitations;
- actual raw hold, complete scoped Platform history fingerprint, underlying Platform review hash, exact reconstructed preparation commands and native packed custody hashes;
- explicit task-specific `blockers`, and `factsHash = digest(canonical(all other returned fields))`.

Root can bind `nativeReviewHash` to its signed expected state and `factsHash` to host `evidence.commandReviewHash`. These hashes identify consistency only. A clean supported preparation graph returns the task-specific blocker `SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED`; that string is not a capability or permission. Native provider-account/evidence/fencing blockers remain visible and must be qualified independently. No current external authority, stopped source, private evidence authenticity, signed approval, COMMIT fencing, import or release follows from this reader.

The constructor and each call validate concrete owner prototypes, same Database/Identity/Platform/Fulfillment/Carrier composition and owned stores. Per-instance method substitutions are rejected. The caller cannot supply SQL, table names, callbacks, parsers, evidence, snapshots or authority ports. Actor locators and group/booking primitives are captured before owner hooks; normal/revoked proxies, accessors, symbol/hidden/extra Actor fields, nonplain Actor values, sparse/proxy/accessor site arrays and oversized/nonprimitive identifiers refuse without invoking traps. Supplied grants are discarded. Reentry refuses before nested owner hooks.

The actual outer SQLite writer is required. Current native finance/admin, no account scope, no forced password change and raw hold are mandatory. **Current compatibility limit:** the reused Platform reader requires admin and the Carrier/Fulfillment readers require warehouse authority. Thus this combined operation currently admits native admins, not finance-only users. It does not synthesize an admin Actor to bypass those existing contracts. Root needs an independently reviewed owning API change before widening that profile; this assignment edits none of those readers.

## What is reconstructed and compared

The native UNKNOWN member review supplies the complete connected group/sibling/predecessor graph and immutable booking intents. Every retained ordinary preparation in that graph is joined, including canceled predecessors. Fulfillment's actual bounded packed-custody task validates each retained shipment snapshot against current custody; CarrierBookings' actual native warehouse lookup agrees with it.

For `carrier.prepare`, the reconstructed payload is precisely the retained intent minus `bookingId`, `reviewHash`, `nativeSnapshot` and the separately supplied display `configuration`. Optional `configurationHash` remains when present. This follows the actual `CarrierBookings.prepare` call to `Platform.command`: the request hash covers the input payload, not the separate configuration argument or generated native snapshot.

For `carrier.canada-post.group.prepare`, the payload is `{configurationHash, entries}` using the complete retained ordered members and their native review hashes. Group preparation sorts members before storage, but Platform hashes the original payload **before** that sorting. Therefore only the retained sorted-order preimage is admitted when its exact canonical hash equals the stored command hash. An originally submitted different order, optional/extra input property or normalized-away string cannot be recovered by guessing permutations, omitted values or historical strings. It refuses even if the command audit repeats that unmatched hash. No existing hashes are normalized or replaced.

For every preparation, exact command/result identity and native review hash must match; `digest(canonical(payload))` must equal the retained Platform request hash. The existing `PlatformOfflineCarrierReviewReader` separately validates command/audit pairing, all scoped supported carrier receipts, domain audits, events and durable audit order. Prepared events are joined to actual native shipment/provider or group/site/count. All sibling member domain audits must name actual group membership and the exact native review hash. A retained created sibling must have its matching final created audit/label hash and event/provider shipment identity. Unknown outcomes without an applicable retained native outcome remain blocked. This is native event consistency, not authentication of provider outcomes.

Cancellation and claim-release request preimages are deliberately unsupported: `CANCELLATION_OR_RELEASE_REQUEST_PREIMAGE_UNSUPPORTED` is returned even where partial reason/claim fields exist in audits. Other carrier commands/events outside the native graph yield `OTHER_CARRIER_COMMAND_NOT_NATIVE_JOINED`. Retained claims remain explicit member/group/booking blockers. Manifest histories and ordinary booking outcomes not joined by this original-member profile yield `NATIVE_UNJOINED_CARRIER_OUTCOME`; matching a group ID is insufficient. Other unsupported member states also remain blocked. Root must require no task blockers other than the explicit external-qualification blocker before using this prerequisite, and must still satisfy its separate qualified contracts.

The complete Platform reader's historical limitations are not wholesale cleared by this new result: event actor/order is not invented, claim tokens or disappeared attempt histories are not reconstructed, and Platform receipts alone still do not retain arbitrary original payloads. This task proves only the exact preparation preimages actually matched to native fields. It cannot prove absent history from hashes, provider account equivalence, exhaustive provider enumeration or non-transmission.

## Bounds, scope and unchanged state

Only fixed Platform-owned SELECTs occur in this new module. Integration/Fulfillment facts come through actual native owner task APIs, never foreign-table SQL. It performs global Platform preflight before selecting any command/audit/event text: counts, fixed-column storage types, NUL, UTF-8/blob row and total bytes, numeric event/order constraints and complete audit-order orphan/scope checks. Complete scalar SQL punctuation/container budgets precede JSON validity, JavaScript text decoding, parsing and canonicalization. Overflow refuses, without pagination or selected-subject truncation.

| Profile                         |                    Limit |
| ------------------------------- | -----------------------: |
| Global commands                 |                    1,000 |
| Global audits/order rows        |               4,000 each |
| Global events                   |                    2,000 |
| Row bytes                       |                   65,536 |
| Combined text/order bytes       |                    8 MiB |
| JSON lexical nodes / containers | 8,192 / 512 per document |
| Parsed JSON depth               |                       32 |
| Frozen canonical output bytes   |                   16 MiB |

Selected-organization fields are fetched as blobs, decoded with fatal UTF-8 and checked for byte round-trip identity before parsing. Escaped unpaired surrogates and NUL in parsed strings refuse. Commands/audits/events from another organization that claim carrier scope refuse with a fixed redacted error; no other tenant's records are returned. Global orphan order rows refuse even if their tenancy cannot be recovered. Noncarrier Platform histories are bounded and fingerprinted but not represented as carrier authority. This conservative small-store profile can refuse large otherwise legitimate stores; it must not truncate them.

The reused Carrier native reader retains its existing independent global row/byte and parsed-JSON limits. This module does not claim to add an Integration-owned SQL JSON-complexity guard or alter that reader's parser, nor to preflight foreign tables through Platform. Root/Carrier own any further native parser hardening. Native custody/source snapshots and private provider-account binding remain separate qualifications.

Before return, the implementation refreshes current authority/owner graph/raw hold, recaptures native member facts and all custody hashes, rescans Platform history and verifies `total_changes()` unchanged. Late callback-driven test corruption of authority, hold, command or custody refuses and escapes the caller's transaction; outer rollback preserves every owner. No write, provider operation, cached result replay, schema initialization or runtime route is added.

## Verification and retained failures

Synthetic file-backed Application SQLite; Linux x64, Node `v24.19.0`, SQLite `3.53.3`, TypeScript `7.0.2`, Prettier `3.9.9`. Real native packing, booking, group preparation and guarded synthetic member creation/uncertain outcomes are used. No provider network, live data, account/secret, CI runner, PR, push, merge or deployment was used.

Preserved initial receipts outside the patch:

1. Initial test module failed to load because the NEW source did not exist: 0/1, exit 1. Four initial clean fixture cases then passed.
2. First TypeScript run failed on descriptor/Row typing and a union-valued command name. These were repaired without changing parser or authority acceptance.
3. First adversarial run: 31/33 passed, exit 1. The NUL fixture accidentally collided two command primary keys before reaching review; it now appends NUL to each distinct key. The reopen fixture initially returned a spread copy, so the original fixture teardown retained the closed app; returning the same native fixture object corrected cleanup. Refusal assertions were retained.
4. That fixture edit briefly produced a syntax error, retained as 0/1, exit 1; its closing delimiter was repaired. The next 43/43 dedicated run passed.
5. The first five-suite affected run passed 146/146. An additional manifest-claim test then reproduced a genuine missing native join: 0/1, exit 1. The implementation now returns `NATIVE_UNJOINED_CARRIER_OUTCOME` for manifest/ordinary-booking outcome profiles and verifies each member audit's actual native group membership. The original failing assertion remains in the final suite.

Final command outcomes and exact file/commit hashes are supplied with the transfer manifest. No full-product run, provider qualification or product gate is claimed.

```sh
node --import tsx --test --test-concurrency=1 \
  tests/platform-offline-canada-post-command-review.test.ts \
  tests/platform-offline-carrier-review.test.ts \
  tests/carrier-offline-member-review.test.ts \
  tests/fulfillment-offline-carrier-custody.test.ts \
  tests/integration-offline-canada-post-member.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check \
  src/server/platform-offline-canada-post-command-review.ts \
  tests/platform-offline-canada-post-command-review.test.ts \
  docs/PLATFORM-OFFLINE-CANADA-POST-COMMAND-REVIEW-2026-10-04.md
git diff --check
```

Final affected result: **147/147 pass**, including **46 new tests**, zero failures/cancellations/skips/todos, exit 0, 29,633.896101 ms. Complete TypeScript, owned formatting, local report links and whitespace pass. Existing baseline paths are byte-identical. Root independently reviews, composes and replays this prerequisite; no qualified coordinator or import is enabled here.
