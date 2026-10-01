# Warranty and manual manufacturer cases

Local implementation checkpoint: 2026-10-01. Tasks D-030–D-033 and G6 remain NOT VERIFIED. This is a synthetic engineering workflow; actual coverage, manufacturer terms, returned custody, financial policy and operator acceptance require qualification. See [proposed contracts](CONTRACTS.md), [decisions](DECISIONS.md) and [the local receipt](evidence/LOCAL-MANUFACTURER-CASES-2026-10-01.md).

## Native return workflow

A claim references a sold serial, customer, shipment and original invoice. Staff or the scoped buyer submit issue and evidence references; a warranty reviewer or administrator approves/rejects the claim with a reason. Current coverage dates use the organization's provisional coverage-days setting. A calculated date does not establish coverage eligibility or approved expiry rules.

An approved return receives the exact serial into quarantine at an authorized warehouse. Inspection records findings; a warranty reviewer or administrator selects repair, restock or scrap. Inventory owns the custody change. Finance separately issues the permitted original-invoice credit and records any authorized refund. Manufacturer acceptance does not trigger these tasks. Replacement procurement/allocation, physical manufacturer custody, attachment storage and approved coverage/expiry policies remain engineering and qualification gaps.

## Record an external manufacturer referral

In Returns, an approved unfinished warranty claim offers **Record manufacturer referral**. This is available for native states approved, received, inspected or repair. Enter the manufacturer, its actual case reference, referral evidence reference and reason. The workflow records communication arranged outside Distributor; it does not send a request to any provider.

Only a warranty reviewer with the unit's current warehouse grant, or an administrator, may record a referral or response. Buyers cannot read internal manufacturer names, references, reasons or evidence; their claim projection has an empty manufacturer-case list. Authorized warranty, commercial and finance staff can read organization claim history; warehouse staff are limited to their granted unit sites. These permissions follow the current local role model; human approval duties remain to be selected.

Manufacturer and reference are required, at most 160 characters each. Their trimmed NFKC-normalized, case-insensitive pair is permanently unique within the organization. A reused pair is rejected even after a case closes. There can be only one pending manufacturer case per claim. A different reference may create a follow-up after the preceding case is accepted, denied or cancelled. Original cases and evidence remain visible.

## Record a response or cancellation

The Manufacturer case history section shows every case's state, revision and evidence history. A pending case offers **Record manufacturer response**. Select accepted, denied or cancelled and enter an actual response/cancellation evidence reference and reason. Evidence is limited to 2,000 characters; reasons to 1,000. This stores text references, not uploaded or independently authenticated attachments.

Referral creates pending revision 1. A final response creates revision 2 and retains the original referral evidence. Terminal decisions cannot be edited or reopened; an additional referral uses a new reference. Accepted means staff recorded manufacturer acceptance of that external case. It does not establish payment, coverage approval, customer replacement or manufacturer possession of equipment. A pending case may receive its final external response after the native claim has been disposed; this preserves independent communication history.

If another operator decides the case while a response dialog is open, the stale revision is rejected. Cancel the dialog, refresh and review the actual history before taking another action. Do not relabel a conflicting response as a new successful decision.

## Retries and evidence

HTTP commands `warranty.manufacturer.refer` and `warranty.manufacturer.decide` require a current session, same-origin/CSRF protection, an idempotency key and exact allowed fields. A lost committed response can be retried with the unchanged key and payload. Current role and current unit-site authority are checked before returning a cached result, including after grant changes or restart.

Warranty owns the case, immutable history and claim decision records. The shared command transaction commits them with its receipt and audit; a late failure rolls the whole attempt back. Independent process contention serializes one pending referral and one final decision. Manufacturer commands leave native claim state, stock, orders, shipments and financial documents unchanged.

[Local evidence](evidence/LOCAL-MANUFACTURER-CASES-2026-10-01.md) covers restart/retry, permissions, stale revisions, duplicate references, invalid fields, atomic failure and real process contention, plus synthetic browser lost-response and stale-decision operation. It does not qualify real manufacturer communication or human acceptance. Claim/case history is currently loaded in the dashboard without pagination; production volume/indexing/retention, upgrades/fault/recovery/residency and independent security review remain outstanding. No CI runners or external provider requests are used by this checkpoint.
