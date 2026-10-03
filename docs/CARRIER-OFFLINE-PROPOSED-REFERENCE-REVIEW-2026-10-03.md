# Native proposed Canada Post reference review

Date: 2026-10-03. Repository `SJS1001/Distributor`, public source ref
`codex/local-distributor-checkpoint`. Exact excluded baseline:
`423800747358f18f9265259144bcd1e4828e067b`.
Tested source/test commit: `3a01bd220db59b548c6ef330030f24a6649b9cba`.
The closing documentation commit is in the transfer manifest; its only additional
change is this report. No other cloud parent is imported.

## Fixed operation

`CarrierOfflineMemberReview.reviewProposedReferencesInTransaction(actor, input)`
now closes the native proposed-reference lookup gap reproduced by the unchanged
`CARRIER-OFFLINE-MEMBER-EVIDENCE-2026-10-03.md` report. Input is `unknown`, with
exactly four own enumerable data fields:

```ts
{
  groupId: string;
  bookingId: string;
  providerShipmentId: string;
  tracking: string;
}
```

One pair is deliberate: this is the fixed lookup for one unknown target member,
not a batch import or arbitrary reference-query interface. Group/booking IDs use
the existing nonblank, trimmed, control-free 128-character identifier bound.
Provider shipment ID is 1–32 ASCII letters/digits/underscore/hyphen; tracking is
11–16 ASCII digits. Normal/revoked proxies are rejected before reflection. Only
plain or null-prototype records with exact descriptors are accepted; accessors,
unknown keys/symbols, arrays, executable values, nested objects, numeric tracking,
oversized values and caller completeness/collision flags refuse. The four scalar
values are detached into a frozen record before any native inventory read.

The operation requires the caller's actual outer native Database writer
transaction, fresh `Identity.currentActor`, warehouse permission/current password
policy, real raw restored-store hold, and the exact target's current site access.
It calls the same private native-reader implementation as the historical public
`reviewUnknownMemberInTransaction`, with a single complete inventory scan. It
does not start a transaction, connection, async operation or SQL/callback port.
Store-visitor ownership cannot escape into this operation.

## Complete retained scope and refusal policy

The original fixed SQL preflights remain: whole-store bounds of 512 bookings,
128 groups and 512 members; UTF-8 BLOB-length/type checks; 256 KiB intent/observation
text, 4 KiB other scalars, 1 MiB label/manifest blobs; conservative 16 MiB per-row
and aggregate expansion budget. Every table's preflight finishes before any
carrier row materialization or JSON parsing. There is no successful limited
page, late filter hiding oversized foreign rows, or caller-supplied inventory.

The new operation additionally checks native sequence/active/start numeric storage
and safe integer ranges in SQL before row materialization. This prevents the
SQLite-to-JavaScript conversion of unsafe integers from preceding a bounded
domain refusal. The older reader retains its existing accepted profiles.

Before organization/provider selection, the new path checks the complete scanned
booking's canonical intent/review commitment and SQL/intent/snapshot organization
and target linkage. It respects the native `replacement:<id>` SQL target encoding
when validating unrelated replacement booking identities; the selected target
still has to pass the historical reader's ordinary unknown-member profile.
It checks all groups' complete ordered membership commitments, member-to-group/
booking/org/configuration/site links, activity/state/claim consistency and exact
created artifact identities/PDF hashes. Orphan/empty groups, copied foreign
linkage, partial references, impossible inactive-created references and malformed
artifacts refuse rather than disappearing behind subject filtering.

The actual collision inventory includes **all retained created member references
and ordinary Canada Post booking references in the target organization**, across
other sites, disconnected groups and different configuration hashes. ID and
tracking conflicts are independent. Exact proposed conflict throws
`CARRIER_OFFLINE_REFERENCE_CONFLICT` with a fixed message and no conflicting row,
site, customer or reference tuple. Malformed retained history is a conservative
`CARRIER_OFFLINE_REVIEW` refusal (the existing PDF validator retains its own
`CARRIER_RESULT` vocabulary where applicable).

Native manifest promotion produces a created-member reference and its booked
copy. The operation counts this exactly once only when the owning booking,
shipment/tracking/PDF hash, transmitted group and retained manifest confirmation
agree. It checks the confirmation's exact native structure, group/member/
document commitments, identity/result agreement, complete sorted shipment IDs,
bounded PO/date/amount, and actual retained PDF. A missing confirmation, changed
member commitment or copied transmitted state cannot silently justify deduplication.
This is retained consistency, not a new provider manifest validation/transport API
or proof that a transmission occurred externally.

After checking exact conflicts, **any relevant reference with missing or different
configuration identity refuses** with `CARRIER_OFFLINE_ACCOUNT_AMBIGUOUS`. A new
configuration hash is never interpreted as a different provider account. The
operation cannot qualify account equivalence; that requires separately obtained
historical nonsecret account descriptors and independent qualification. Even
matching configurations and no matching retained reference establish only this
bounded local observation, never collision-free provider truth.

Valid unrelated organizations are structurally checked and committed by the
whole-inventory hash, but are not treated as this organization's reference
reservations. Coherently rewritten/copied histories, deleted history, unretained
external objects and actual cross-organization provider-account equivalence
cannot be authenticated by this native read. No local hash supplies that proof.

## Returned facts and compatibility

Exported type: `CarrierOfflineProposedReferenceFacts`. The detached recursively
frozen result contains:

- Version 1 and purpose `carrier-offline-proposed-reference-review-v1`.
- Current organization/region/currency, raw hold, target warehouse, exact proposed
  four-field input and target configuration hash.
- `memberReviewHash`: the exact compatible historical unknown-member review hash.
- `scopeHash`: `digest(canonical(...))` with new purpose
  `carrier-offline-proposed-reference-scope-v1`, binding every fixed ordered row
  from the three checked inventories, including null/nonreference/foreign rows.
  Blob content is committed by byte length and SHA-256. No rows or blob bytes are
  returned by this new method; unrelated history can conservatively change this
  commitment.
- `references`: aggregate target-organization counts for members, bookings,
  promoted copies and distinct retained outcomes, with no reference tuples.
- Every historical blocker, plus `NATIVE_REFERENCE_MATCH_ONLY_NO_RESERVATION` and
  `PROVIDER_ACCOUNT_EQUIVALENCE_AND_EXTERNAL_REFERENCES_UNQUALIFIED`.
- `reviewHash`: digest of the entire preceding purpose-tagged body.

`total_changes()` is checked before/after. No reference reservation, owner write,
claim release, receipt, approval, label output, retry, provider access or activation
is performed. Returned facts are reusable historical observations, **not reusable
authority**. A future root coordinator must read fresh facts in its actual writer
and enforce its qualified commit-spanning external guard and native owner checks.

The old public method remains the same shape and behavior, returning only the
historical facts. A source comparison confirms its entire captured-intent-through-
validation/facts/hash body remains **byte-identical**; only the private return
wrapper retains the already-read inventory for the new method. Existing digest
domains and old test/report assertions remain unchanged. All ordinary Application,
schema, Platform, Fulfillment, private capture/parser and carrier transport source
files are untouched.

## Tests, preserved failures and exact environment

Fresh isolated worktree `/workspace/Distributor-carrier-proposed-reference`, branch
`codex/cloud-carrier-proposed-reference`, obtained via existing public HTTPS Git
remote at the exact excluded commit. Prior worktrees and artifacts are preserved.
Runtime: **Node v24.19.0, Linux x64, SQLite 3.53.3**; existing matching dependency
installation. No environment, credential, dependency or service change was needed.
Requested Astra/high is **unverified** because this launcher exposes neither
effective model nor reasoning effort. No nested delegation occurred.

All new fixtures use actual file-backed Application/Database/IAM/Carrier owners,
native accept/pick/pack/preparation, guarded synthetic creation/ordinary booking
and actual native manifest promotion. No provider transport occurs. The 26 new
cases cover CA/CAD, CA/USD and US/USD at this native reader; the separate Platform
carrier provenance reader's US restriction remains unchanged and still blocks a
complete US comparison join.

Coverage includes the original outside-group conflict, independent shipment and
tracking reuse, changed configuration, missing account identity, actual ordinary
booking and promoted duplicates, redacted/frozen detached output, no-write/reopen
stability, caller rollback, current role/site/org/password/hold, owner SQL fencing,
normal/revoked proxies and accessors with trap counters, exact scalar bounds,
UTF-8/blob/aggregate/count/numeric pre-materialization refusal, malformed/copied/
orphan history and retained manifest consistency. A second real native connection
cannot replace a reference while the first holds the actual writer (bounded
five-second SQLite busy timeout); after release its committed replacement is seen
and conflicts. No PR/CI executor or background test survives the run.

Preserved attempts under `/workspace/distributor-carrier-proposed-reference-audit`:

| Log                          | Outcome and cause                                                                                                                                                                                    | SHA-256                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `initial.log`                | Exit 1; 18/21 pass. Fixture mistakes: undefined option variable, nonexistent `book` method and nonexistent Store `read` method. Repaired to actual `execute`/`visit`; authority assertions retained. | `6b597bf284cfbccfcb7cfbd1a1c3b7eba1a6b9785ea2f4fdd3ee1d0fd1dbd10b` |
| `typecheck-initial.log`      | Exit 1; corresponding fixture API/name and inferred-parameter errors.                                                                                                                                | `eccedd1bcebb53d0b3146d07ad608b49d86ac915ef7da2574b1488d22b2eb08a` |
| `repaired.log`               | Exit 0; 21/21 pass before expanded adversarial coverage.                                                                                                                                             | `c1386f0ecb1f8eebce2f02cd461378b75fa2e9240ee2c53d204d126468cc9100` |
| `promotion-red.log`          | Exit 1; 0/1 pass. New implementation incorrectly deduplicated promotion after deletion of its native manifest. Fixed retained confirmation/member/document validation; failing assertion unchanged.  | `79a7b4ea4b52f137a49ddbe807c66f2af585bb948593d8eaa49d0502b9414ccd` |
| `affected.log`               | Exit 0; 184/184 pass after manifest repair, before copied-snapshot case.                                                                                                                             | `5e091931b5a94cf6e6ac7a778bcc1dee97daefd7c16a8b93a187181245dd30d9` |
| `copied-snapshot-red.log`    | Exit 1; 0/1 pass. New implementation missed an unrelated ordinary booking's changed snapshot ID. Fixed native SQL/intent/snapshot target binding; failing assertion unchanged.                       | `f6e71008e3c7d7d695fea3ee48d0dca89eca00bf45fb384bf78a01be9848b2bb` |
| `final-tests.log`            | Exit 0; **185/185 pass**, including all **26 new** cases; zero failed/cancelled/skipped/todo; **21807.744658 ms**.                                                                                   | `c7dc1d991661c99cb60000682009ad11a19e01660e41754f1f37474371e8eb5b` |
| `typecheck-final-source.log` | Exit 0; complete TypeScript.                                                                                                                                                                         | `8a702e6f87c8a6ca129035a44568229aa0a0ce49ce48d85c056ac1c3a87c0c57` |

Exact final commands from the isolated worktree:

```sh
node --import tsx --test tests/carrier-offline-proposed-reference-review.test.ts tests/carrier-offline-member-review.test.ts tests/carrier-offline-member-evidence.test.ts tests/canada-post-manifest.test.ts tests/carrier-bookings.test.ts tests/database-streaming.test.ts
npm run typecheck
npx --no-install prettier --check src/server/carrier-offline-member-review.ts tests/carrier-offline-proposed-reference-review.test.ts docs/CARRIER-OFFLINE-PROPOSED-REFERENCE-REVIEW-2026-10-03.md
git diff --check
git diff --cached --check
```

Assigned formatting and whitespace pass. The exclusive baseline-to-closing binary
patch, deterministic gzip, independent chunk sizes/hashes and every final file
hash accompany the transfer manifest. Root independently applies and replays the
three-file delta before publishing; no cloud push or other parent's delta is
included.

This completes the bounded native lookup prerequisite, **not the pure/private
carrier evidence comparator or qualified offline importer**. Complete current
Platform/Fulfillment joins, source interval and provider truth, external account
equivalence, current independent trust/approvals, actual fencing, durable account
reservations and commit/restart composition remain Root/owning-coordinator work.
Full system and product gates remain **NOT VERIFIED**. No CI/runners/workflows,
provider IO, PR/merge/push/deploy, settings/accounts/secrets or reminder/automation
was used.
