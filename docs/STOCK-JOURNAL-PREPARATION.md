# Stock journal preparation and retained receipts

D-034/D-036/D-039 engineering continuation. Billing exposes finance/admin preparation of the [native journal instruction](STOCK-JOURNAL-DELIVERY.md). All tasks and gates remain NOT VERIFIED. Preparation creates a local review awaiting a different finance principal's decision. Provider delivery remains disconnected.

## Select and map an approved source

Enter an approved stock-cost packet or correction ID and choose original, reversal or replacement. The authenticated no-store source read checks current persisted authority, organization-owned sandbox-company permission and accepted terms, the restore hold, current reviewed cost policy, immutable source/hash/approval, supersession and the current correction attempt. It reads current permission inside the same transaction as the approved source. Reads create no command, journal, lease, binding or audit effect.

The review shows source/approval identities and hash, current leg/attempt, date, currency/region, company, permission revision/accepted terms, policy revision/hash, closed-through date and established valuation. It displays the selected date's unchanged balanced lines and debit/credit totals. Each source date remains selectable; closed dates are disabled. Selecting a date performs a fresh source read. This does not implement reconciliation or automatic delivery across dates.

Map every source account to a distinct positive numeric QuickBooks sandbox account ID. Supply the organization credential binding ID and preparation reason. **Review exact journal preparation** opens fixed fields and a new exact request key without sending a command. **Confirm journal preparation** persists and verifies the exact source/body/key before transport. Native preparation rechecks current authority, policy, immutable source and duplicate work inside the serialized transaction. Supplied account IDs and bindings remain unqualified until separate actual account/credential checks; the source read's temporary IDs only validate native source invariants.

The resulting ready instruction appears in the frozen journal review. A different current finance/admin principal must approve or reject it through [independent journal review](STOCK-JOURNAL-BROWSER.md). Preparing or approving an instruction does not establish provider posting.

## Recover the original attempt

Local storage is scoped to organization and preparer. A same-profile Web Lock coordinates confirmation/recovery; missing locks, damaged storage, failed persistence/readback or a competing lock refuse transport. Storage events update recovery availability without changing a fixed review. Confirmation rechecks original retained evidence under the lock.

Lost replies, malformed success, changed permission/policy/period, interrupted navigation and cleanup failure retain the original attempt. **Review retained journal preparation** shows its fixed source and body. **Recover exact journal preparation** first reads the original committed receipt through an authenticated no-store task route scoped to organization, preparer, command and key. It validates the original command hash against its plan and retained native instruction, returns the historical ready receipt with current state, and performs no mutation. Current permission withdrawal or provider hold does not erase that receipt; fresh finance identity remains required. A historical receipt grants no write authority.

Only native NOT_FOUND permits submitting the same original body/key through current native preparation controls. Absence does not establish that an earlier request never ran and cannot authorize a new key. Malformed/error recovery replies refuse fallback. Only a JOURNAL_DUPLICATE refusal raised after original receipt lookup and inside serialized new-work handling may clear matching retained evidence as a proved new-work conflict. Authority/period refusals can precede receipt lookup and remain retained. A checked reply clears only unchanged stored bytes, with verified removal; otherwise recovery remains available.

Closing/navigation aborts reads and fetches and fences late UI replies. Native work may still commit; browser cancellation does not undo it. Web Locks coordinate one browser profile, while native transactions/idempotency remain authoritative across devices. Preserved browser storage is required for this local recovery action; investigate native records before replacing uncertain work when storage is lost.

## Boundaries

Source and browser validation are bounded to native-approved journals, at most thirty accounts per date, and the existing native journal line/amount limits. No account search, OAuth/company verification, permission replacement, execution route, automatic retry, worker polling or provider IO is introduced. The [local receipt](evidence/LOCAL-STOCK-JOURNAL-PREPARATION-2026-10-03.md) records version-bound synthetic checks and their limitations. Actual finance approval, charts/valuation, terms/company credentials, provider/residency/infrastructure, browser/device/operator and security/load/recovery qualification remain open. Original cancellation/fresh retry, multiple-date reconciliation, further journal/valuation corrections, durable restore activation and the current Purolator contract remain dependent work.
