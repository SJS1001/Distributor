# Bulk count review duties

Local configurable controls for D-008/D-015. Operating policy and all product gates remain unqualified. These controls govern bulk count adjustments; serialized custody has its separate reviewed workflow. See [contracts](CONTRACTS.md), [fulfillment shortages](FULFILLMENT.md) and [local evidence](evidence/LOCAL-COUNT-REVIEWS-2026-10-01.md).

## Select the organization policy

In Inventory, an active administrator selects **Configure count review**, reviews the duties and enters a reason. The saved organization policy applies to every application instance using that organization. It retains the selecting administrator, time, reason and monotonically increasing version, plus an atomic event/audit/command receipt. It preserves unrelated organization settings. No schema or dependency change is needed.

| Mode | New approval | Direct quantity adjustment |
| --- | --- | --- |
| Administrator review | A current administrator may approve their own observation. | Available to a current authorized administrator. |
| Independent administrator review | A current administrator other than both the count starter and the observer must approve. | Refused; save a count observation and obtain separate review. |

Organizations without a saved selection retain the historical provisional administrator mode at version 1. This default is shown explicitly and is not an approved business policy. Every saved selection starts at version 2 or increments the current version, including selecting the same mode. An organization with one administrator needs another administrator before independent approvals can succeed. Selecting a more permissive mode requires an explicit administrator command and reason; it remains audited. Password-change restrictions prevent configuration and count operations.

An administrator can reject their own draft or submitted count in either mode. Rejection creates no physical movement. Count snapshots and immutable observations survive policy changes; no bulk approval bypasses the current policy. Existing stale-stock/reservation constraints still apply.

## Review and retry

The count list shows the current policy and whether the caller can approve each submitted count. Approvals review both the stock cutoff and policy version. A policy change after opening the approval dialog refuses the stale request; refresh and review again. Saved decisions retain the policy that governed the decision even after subsequent configuration changes. Historical decisions predating policy evidence remain historical; no policy is invented for them.

A lost policy or count-decision response can be retried with the same key and unchanged input. Current identity, role, original warehouse grant and password restrictions are checked before cached replies. Replaying an already committed count decision returns its original outcome/policy without another movement, including under a changed policy. A conflicting decision or changed reason is refused. Direct adjustments under independent mode are refused even for a cached older direct-adjustment request; use the retained count history for historical review.

Policy selection and stock decision transactions serialize across local processes. An approval racing a policy change either commits under the policy valid at its own transaction, or refuses stale review. A late audit failure rolls back the entire command. Existing count revision and reservation checks keep the original-cost movement and physical correction atomic.

## Browse the count queue

Inventory shows at most twenty counts on each page, newest recorded first. **Older counts** and **Newer counts** replace rows and keep navigation tokens. **Count state** selects all states, awaiting observation, awaiting review, approved or rejected. Filtering and **Refresh counts** restart at the selected state's first page. Application Refresh keeps the count state held in the address bar. Successful commands restart with all states. References identify counts across pages. Empty scoped results remain explicit; support has no observation or decision controls.

Pending or failed reads clear the old rows and actions. **Retry count queue** repeats the original filter, continuation and page position. Successful navigation focuses the queue heading; failed reads focus retry. Changed filters, navigation, application refresh and sign-out abandon late responses. The queue does not retain count rows from previous pages.

Native reads resolve current persisted identity, role, password restrictions, original warehouse grants and organization policy before returning results. SQL applies organization, site and state selection before the twenty-one-row lookahead. Continuations bind purpose/version, organization, current site scope and state; inaccessible or missing anchors refuse. Tied timestamps use insertion order. An anchor can change state without preventing continued traversal; grants changing invalidate an old continuation. Current approval eligibility and historical decision policy remain separate.

These are live pages, not a frozen export. New counts and changed states can alter results between reads; refresh to inspect current facts. Read transactions, query/index costs and production-scale history remain unqualified. The compatible full-list API still returns the complete permitted history. Observation and decision controls now use the retained recovery procedure below. Other browsers/devices and cleared storage remain outside that recovery contract. See the [local queue receipt](evidence/LOCAL-COUNT-QUEUE-2026-10-02.md).

## Recover an observation or decision

Recording an observation, approving a correction and rejecting a count each retain one exact attempt per signed-in organization/staff account in this browser profile. The saved evidence includes the original count/reference, product/site/bin/condition, expected and observed units, stock revision, original unit cost, reviewed policy, reason, payload and request key. It is written and read back before transport. Web Locks prevent a competing tab from submitting the same operation concurrently. Unreadable, unwritable or inconsistent storage and missing/occupied locks block transport.

A lost reply, uncertain failure, malformed success or cleanup failure retains that original attempt. After reload, navigation or signing back into the same account, Inventory offers **Review retained count observation**, **Review retained count approve** or **Review retained count reject**. The review is fixed and readonly; **Retry exact count operation** sends the original payload/key. Finishing initial count loading cannot discard the review or focus. Storage events update the banner without replacing an open review. Changed retained evidence requires closing and reviewing the retained original before retry.

Known native validation refusals permit correction without retaining a poisoned attempt. A changed stock/state/policy or separation-of-duties refusal requires closing, refreshing Inventory and reviewing current facts before a new submission. Authority, missing-record, conflicting-receipt and uncertain failures preserve the original evidence. Native current identity and original warehouse authority still apply before cached receipts.

An observation receipt must match its original quantity/delta. An approval receipt must match the original policy, stock revision, expected/observed quantities, original unit cost and value adjustment. A rejection must contain no adjustment. These checks describe the original committed operation: retry after newer stock or policy changes does not correct stock again. Inspect current stock and count history before further work. Approval posts no accounting entry. Cancel dismisses review without clearing unresolved evidence or undoing a native operation.

This browser retention is not encrypted storage, an offline contract or cross-device recovery. Shared-device access, cleared/copied storage, uncertain attempts made before these controls and operating custody require reconciliation. Sign-out hides but retains account-scoped attempts; a different account does not inherit them. See the [local recovery receipt](evidence/LOCAL-COUNT-RECOVERY-2026-10-02.md) for exact test scope and limitations.

## HTTP contracts

- `GET /api/count-review-policy`: current policy for authorized administrators, warehouse staff and support. Buyers cannot read it.
- `POST /api/commands/count.policy`: administrator input `{mode, revision, reason}`, with mode `administrator` or `independent`. `revision` is the currently reviewed policy version. The response is the selected policy.
- `GET /api/counts`: current policy and `canApprove` alongside scoped count history; committed results may contain their historical `reviewPolicy`.
- `GET /api/counts/page?state=submitted&after=<continuation>`: at most twenty scoped count headers and `next` or null. Both parameters are optional; state is `draft`, `submitted`, `approved` or `rejected`. Unknown fields and invalid continuations refuse. Browser reads use this endpoint.
- `POST /api/commands/count.decide`: `{countId, decision, reason, policyRevision}`. New approvals require the current `policyRevision`. Omission is accepted only while the organization still uses the unsaved legacy version-1 default. Rejections need no policy version because they do not alter stock.

Writes use the existing authenticated origin/CSRF/idempotency boundary and exact JSON schemas. Malformed saved policy fails closed. Never bypass validation by editing organization JSON or manually setting count results.

## Remaining qualification

Local fixtures prove policy persistence, fresh permissions, phone controls, separate-process contention, audit-failure rollback and encrypted fresh-file restoration. Actual staffing, count cutoff practices, override approval, large batches, physical evidence/device workflows, production rollout and operator acceptance remain unresolved. Policy selection alone does not qualify separation of duties for transfers, serialized discrepancies, supplier credits or other business modules. No accounting entry is posted by a count correction; finance must review any required original-cost accounting handoff separately.
