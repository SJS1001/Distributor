# Explicit stock-journal sandbox transport

D-009/D-034/D-036/D-039 engineering work. `StockJournalTransport` connects the [native journal queue](STOCK-JOURNAL-DELIVERY.md), [organization credential vault](ORGANIZATION-LEDGER-CREDENTIALS.md) and [QuickBooks sandbox candidate](QUICKBOOKS-STOCK-JOURNAL.md) for one explicitly invoked operation. It is disabled by default. No application startup, HTTP route, CLI, polling worker or automatic reconciliation invokes it. All tasks and gates remain NOT VERIFIED.

## Invocation and ownership

Construct the service with the native journal queue, a vault using the same database connection, the exact organization binding, protected client secret and explicit enablement. The binding contains exactly `id`, `orgId`, `workerUserId`, `realm` and `clientId`; it is copied and frozen. This transport limits the company identifier to 30 decimal digits, matching its journal protocol. Secrets stay within the operator process.

`run(actor, journalId, mode, signal?)` accepts `write` or `lookup`. Before claiming, it verifies enablement, interruption, current journal access, exact organization/worker/company/binding and ready organization credentials. Buyer credentials cannot satisfy this scope. The native queue owns the issued lease, source approval, immutable mapping, period, consent stamp, correction order and permanent document reference.

Credential access checks the expected revision in its transaction and returns a frozen token/revision receipt captured with decryption or accepted refresh. A legitimate refresh may advance that revision once; a concurrent installation cannot masquerade as that refresh. Additional synchronous guards check the exact current credential revision, key generation, organization permission and worker inside the same native journal transaction at read guard, final dispatch and outcome retention. A vault attached to another database connection refuses this contract.

## Single write and explicit reconciliation

The adapter performs its guarded sandbox reads, exact query and at most one final POST. The native final fence commits dispatch before the request. A posted result is retained only after exact source/company/date/currency/line validation and current native and credential authority. Provider observations do not establish independent finance reconciliation or change stock, manual acceptance or correction observations.

A matching receiver journal found before the final write fence first retains uncertainty. Its result needs a separately invoked lookup lease. Lost or invalid responses, lookup misses, changed consent/credentials/role/policy, a recovery hold or interruption retain an unknown observation. No automatic resend, cancellation, retry or lookup follows. A caller must inspect current state and explicitly request permitted reconciliation.

Caller interruption combines with the journal request's existing 20-second timeout. It cannot recall a provider POST already processed. Credential refresh retains its existing exclusive 90-second claim and guarded acceptance; interruption does not promise to recall an exchange already underway. The transport checks interruption again before further journal IO or outcome retention.

An expired caller cannot release a successor's lease or overwrite its result. If native uncertainty cannot be retained, the service throws the sanitized `JOURNAL_RETENTION` error instead of reporting persisted uncertainty. Operational results contain only journal identity, `idle`, `posted` with receiver reference, or `unknown` with a fixed reason; raw provider responses and secrets are excluded.

## Verification and remaining work

The [local receipt](evidence/LOCAL-STOCK-JOURNAL-TRANSPORT-2026-10-03.md) records synthetic CA/US network mocks, credential races, refresh, interruption, lost responses, restart, competing invocations, stale leases, correction ordering and audit rollback. These are workstation checks, not actual sandbox protocol qualification. Schema 12, dependencies and frontend are unchanged.

Task-shaped queue/review/history APIs, browser controls, explicit independently reviewed permission replacement, organization OAuth/company verification and remote revocation remain open. Original cancellation/fresh retry, multiple-date acceptance/correction reconciliation and changed-journal/valuation corrections require separate contracts. Actual provider terms/fields, finance mappings, processor/infrastructure residency, devices, security, recovery and operator acceptance remain unqualified. No live provider IO, account, CI runner, workflow, delegated/cloud session, PR, merge or deployment is created by this increment.
