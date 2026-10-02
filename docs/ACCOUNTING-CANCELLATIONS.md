# Cancel an unsent accounting credit application

D-034/D-036/D-039 engineering work for accounting conservation and retained recovery history. All product tasks and gates remain NOT VERIFIED. This is a local correction of queued accounting work; no provider request occurs.

## Finance procedure

In Billing, review the QuickBooks credit application, its invoice and credit numbers, currency and exact reserved amount. An active administrator or finance user who has completed any required password change can choose **Cancel unsent credit application** only while the operation is pending and has never started. Enter a reason and confirm the reviewed amount. A changed operation requires a fresh review. Support, commercial, warehouse and buyer users cannot cancel it.

The action retains the original operation, immutable intent and reservation and adds an integration-owned cancellation receipt containing the actor, reason, reviewed version, amount and time. The displayed status becomes canceled. Its transport state is blocked so workers cannot send or reconcile it. Native invoices, credits, cash, stock and order facts are unchanged. This does not cancel a QuickBooks credit memo or reverse an external payment.

Only that explicit receipt releases this application's reserved credit and invoice capacity. Other pending, running, unknown, rejected, blocked and completed work continues to reserve capacity. Cash allocations and other credit applications still compete for the same invoice capacity; accounting refunds still compete for credit capacity. A correction must pass these current limits again.

After cancellation, queue a corrected application explicitly with a new request key. Retrying the original queue request returns its original operation and cannot reactivate it. If the cancellation response is lost, retry the same reviewed request and key; it returns the retained receipt without releasing capacity twice. A different reason under the same key conflicts. A new cancellation request against the canceled operation is refused. Current access is checked even on cached retries.

## When cancellation is refused

Any prior send start, external reference, result or active/started operation lease prevents cancellation. An uncertain or rejected external outcome is not evidence that the provider did nothing. Reconcile it through the supported accounting procedure rather than freeing capacity by changing transport state. A send and cancellation use the same SQLite write authority: whichever claims first prevents the other from proceeding. This procedure offers no reversal for already sent work.

Customer withdrawal of provider permission does not prevent this entirely local cancellation. It does prevent provider transport. A restored store's provider hold blocks cancellation, including cached retries, because its pending snapshot cannot prove that the source sent nothing after the backup. Review the cutoff and external outcomes under the [recovery procedure](RECOVERY.md); no cancellation action releases the hold.

## Store compatibility and qualification

Version four adds only `integration_credit_cancellations`. Normal startup and encrypted recovery require the exact current profile. Earlier version-one/two/three stores need the reviewed [fresh-file schema upgrade](SCHEMA-UPGRADES.md); it preserves original reservations, uncertain work, revocation history, native facts, region and stored reporting profile and creates empty cancellation storage. Old encrypted archives are not silently upgraded. Current backup/restore retains cancellation receipts and remaining reservations while isolating provider work.

Local synthetic tests cover amount/version and current-authority refusals, audit-fault rollback, lost HTTP responses, restart, separate-process contention, shared cash/credit capacity and encrypted isolated restore. They do not qualify actual QuickBooks behavior, accounting policy, vendor terms, physical residency, production security/load/recovery or operator acceptance. Workstation verification and local commits only; no CI runner or actual provider action is required.
