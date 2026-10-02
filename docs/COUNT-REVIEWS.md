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

## HTTP contracts

- `GET /api/count-review-policy`: current policy for authorized administrators, warehouse staff and support. Buyers cannot read it.
- `POST /api/commands/count.policy`: administrator input `{mode, revision, reason}`, with mode `administrator` or `independent`. `revision` is the currently reviewed policy version. The response is the selected policy.
- `GET /api/counts`: current policy and `canApprove` alongside scoped count history; committed results may contain their historical `reviewPolicy`.
- `POST /api/commands/count.decide`: `{countId, decision, reason, policyRevision}`. New approvals require the current `policyRevision`. Omission is accepted only while the organization still uses the unsaved legacy version-1 default. Rejections need no policy version because they do not alter stock.

Writes use the existing authenticated origin/CSRF/idempotency boundary and exact JSON schemas. Malformed saved policy fails closed. Never bypass validation by editing organization JSON or manually setting count results.

## Remaining qualification

Local fixtures prove policy persistence, fresh permissions, phone controls, separate-process contention, audit-failure rollback and encrypted fresh-file restoration. Actual staffing, count cutoff practices, override approval, large batches, physical evidence/device workflows, production rollout and operator acceptance remain unresolved. Policy selection alone does not qualify separation of duties for transfers, serialized discrepancies, supplier credits or other business modules. No accounting entry is posted by a count correction; finance must review any required original-cost accounting handoff separately.
