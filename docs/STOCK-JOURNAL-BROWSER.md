# Stock-journal browser review and recovery

D-034/D-036/D-039 engineering continuation. Billing now exposes internal finance/admin review of the [native stock-journal queue](STOCK-JOURNAL-CONTROLS.md). Preparation and correction cancellation remain authenticated API operations. This browser reads retained plans/history and records independent approve/reject decisions. Approval queues the local instruction; the disabled transport has no browser execution route. All tasks and gates remain NOT VERIFIED.

## Review the frozen instruction

Select a state and load the queue. Each page contains at most twenty preparations, newest first. Older/Newer retain the exact scoped cursor; Retry repeats a failed page. Refresh begins a new position and includes subsequent preparations. State membership is live, not a historical database snapshot.

Open a journal to inspect its exact leg, posting date, currency, sandbox company, permanent document reference, immutable source/review hashes, credential binding/attempt, preparer, reason, policy revision and organization permission/terms. The frozen date-specific journal lines show original source accounts, selected receiver account IDs and debit/credit amounts. Current state, independent decision and observed external ID appear when retained. Recent observations have separate twenty-item pages; each exposes the recorder/time/hash and retained body. Reading these records cannot send, reconcile, cancel or release a journal.

A journal's preparer cannot approve or reject it. A different current finance/admin principal selects a decision and reason, opens a fixed review, then confirms. The fixed review identifies the exact source, hash, company, reference and decision. Approval does not establish actual finance acceptance or provider posting. Unknown delivery has no browser resend or cancellation action.

## Recover an uncertain decision

Before transport, the browser retains the exact body, idempotency key and reviewed journal identity in local storage scoped to organization and principal. It verifies the stored bytes and obtains a same-profile Web Lock. Unavailable/damaged/unwritable storage, missing Web Locks or a competing tab block submission. A second tab's storage event updates available recovery evidence but cannot replace an already opened fixed review. Confirmation rechecks the retained original under the lock.

After a lost reply, malformed receipt, authority failure or uncertain transport result, open **Review retained journal decision**. Its fields are readonly. **Retry exact journal decision** submits the original body/key; the native cached receipt may describe historical state. On a verified reply, the browser clears only matching retained bytes, loads current journal/history and clears the stale queue. Refresh the queue explicitly for current membership. A different principal's login does not expose this recovery action. Returning to the original principal in the same browser profile restores it after reload/sign-out.

Only explicit native input/review/state/reference refusals known to precede this attempt's effect clear matching retained evidence for a fresh review. Authority/key/storage/unknown failures retain it. If cleanup fails after native success, restore storage and retry the retained original. The browser cannot create a replacement key or edit an uncertain original. Clearing browser data or changing devices loses this local evidence; recover through retained native records and independently reviewed operations. Web Locks do not coordinate different browser profiles/devices; native transactions and idempotency remain authoritative.

Closing or navigating away aborts pending reads/decision fetches and prevents late UI updates. A submitted native decision may still commit. Returning to Billing exposes its retained exact recovery. Browser cancellation does not undo approval/rejection. No automatic retry, provider dispatch, polling, workflow or CI runner is connected.

## Verification boundaries

The [local browser receipt](evidence/LOCAL-STOCK-JOURNAL-BROWSER-2026-10-03.md) records direct workstation production Chromium journeys and native/runtime checks. Fixtures use synthetic organizations, terms, companies, accounts and finance evidence. They do not qualify real QuickBooks processing, current vendor terms, residency, approved charts/valuation, device/browser fleets, operator procedures, production scan/lock/load costs or release readiness.

Browser preparation/cancellation and reviewed organization permission replacement remain dependent work, alongside organization OAuth/company verification/remote revocation, original cancellation/fresh retry and multiple-date reconciliation. Further changed-journal/valuation corrections, durable restore activation and current Purolator contract remain open. No product gate is passed by the UI or a synthetic receipt.
