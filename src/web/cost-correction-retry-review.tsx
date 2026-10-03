import React, { useState } from "react";
import type {
  CostCorrections,
  CorrectionRetryInput,
} from "../server/cost-corrections.ts";
import { command, request } from "./api.ts";
type Outcomes = ReturnType<CostCorrections["outcomes"]>;
type Detail = ReturnType<CostCorrections["retryDetail"]>;
export function CostCorrectionRetryReview({
  state,
  busy,
  leg,
  recoveryHold,
  run,
  load,
}: {
  state: Outcomes;
  busy: boolean;
  leg: Outcomes["legs"][number];
  recoveryHold: boolean;
  run: (work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  load: (signal: AbortSignal) => Promise<void>;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const read = async (id: string, signal: AbortSignal) => {
    const result = await request<Detail>(
      `/api/accounting/cost-correction-retries/${encodeURIComponent(id)}`,
      { signal },
    );
    signal.throwIfAborted();
    if (
      result.id !== id ||
      result.input.correctionId !== state.correctionId ||
      result.input.contentHash !== state.contentHash ||
      result.input.leg !== leg.leg
    )
      throw Error("Retry review does not match this correction and journal.");
    setDetail(result);
  };
  return (
    <section aria-label={`${leg.leg} posting retry reviews`}>
      <h5>Separate {leg.leg} retry review</h5>
      <p>
        A new reference requires final cancellation and verified non-posting,
        followed by a different current finance reviewer. The approved journal,
        date and amounts stay exact. This review does not send a journal.
      </p>
      {leg.current?.input.outcome === "cancelled-unposted" && (
        <form
          key={`${leg.attemptId ?? "initial"}-${leg.current.revision}`}
          aria-label={`Prepare ${leg.leg} posting retry`}
          onSubmit={(e) => {
            e.preventDefault();
            const values = new FormData(e.currentTarget);
            const input: CorrectionRetryInput = {
              correctionId: state.correctionId,
              contentHash: state.contentHash,
              leg: leg.leg,
              previousAttemptId: leg.attemptId,
              previousRevision: leg.current!.revision,
              previousEvidenceHash: leg.current!.evidenceHash,
              policyRevision: state.policyRevision,
              externalRef: String(values.get("externalRef")),
              reason: String(values.get("reason")),
            };
            void run(async (signal) => {
              const saved = (await command(
                "accounting.cost.correction.retry.prepare",
                input,
                signal,
              )) as { id: string };
              signal.throwIfAborted();
              await load(signal);
              await read(saved.id, signal);
            });
          }}
        >
          <fieldset disabled={recoveryHold || busy}>
            <legend>Prepare a separate {leg.leg} attempt</legend>
            <label htmlFor={`retry-${leg.leg}-reference`}>
              New {leg.leg} retry request reference
            </label>
            <input
              id={`retry-${leg.leg}-reference`}
              name="externalRef"
              required
              maxLength={160}
            />
            <label htmlFor={`retry-${leg.leg}-reason`}>
              {leg.leg} retry reason
            </label>
            <textarea
              id={`retry-${leg.leg}-reason`}
              name="reason"
              required
              maxLength={2000}
            />
            <button type="submit">Prepare {leg.leg} posting retry</button>
          </fieldset>
        </form>
      )}
      <p>
        Latest 100 saved retry reviews; earlier reviews remain accessible by ID.
      </p>
      <ul>
        {leg.retries.map((r) => (
          <li key={r.id}>
            {r.input.externalRef} · {r.state} · {r.createdBy} · {r.createdAt}.{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => void run((signal) => read(r.id, signal))}
            >
              Review retry {r.id}
            </button>
          </li>
        ))}
      </ul>
      {detail && (
        <section aria-label={`${leg.leg} saved posting retry`}>
          <p>
            Retry {detail.id}: {detail.state}. Prepared by {detail.createdBy};
            reviewer {detail.decisionBy ?? "pending"}. Review SHA-256:{" "}
            <code style={{ overflowWrap: "anywhere" }}>
              {detail.reviewHash}
            </code>
            .
          </p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(detail.plan, null, 2)}
          </pre>
          <ol>
            {detail.history.map((o) => (
              <li key={o.revision}>
                {o.input.outcome} · {o.input.externalRef} · {o.input.evidence} ·{" "}
                {o.recordedBy} · {o.recordedAt} · {o.evidenceHash}
              </li>
            ))}
          </ol>
          {detail.history.length < (detail.history.at(-1)?.revision ?? 0) && (
            <p>
              Latest 100 observations shown; older evidence remains retained.
            </p>
          )}
          {detail.state === "ready" && (
            <form
              aria-label={`Decide ${leg.leg} posting retry`}
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget),
                  input = {
                    retryId: detail.id,
                    reviewHash: detail.reviewHash,
                    decision: String(values.get("decision")),
                    reason: String(values.get("reason")),
                  };
                void run(async (signal) => {
                  await command(
                    "accounting.cost.correction.retry.decide",
                    input,
                    signal,
                  );
                  signal.throwIfAborted();
                  await load(signal);
                  await read(detail.id, signal);
                });
              }}
            >
              <fieldset disabled={recoveryHold || busy}>
                <legend>Independent {leg.leg} retry decision</legend>
                <label htmlFor={`retry-${detail.id}-decision`}>
                  {leg.leg} retry decision
                </label>
                <select
                  id={`retry-${detail.id}-decision`}
                  name="decision"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choose decision
                  </option>
                  <option value="approve">Approve</option>
                  <option value="reject">Reject</option>
                </select>
                <label htmlFor={`retry-${detail.id}-review-reason`}>
                  {leg.leg} retry review reason
                </label>
                <textarea
                  id={`retry-${detail.id}-review-reason`}
                  name="reason"
                  required
                  maxLength={2000}
                />
                <button type="submit">Save {leg.leg} retry decision</button>
              </fieldset>
            </form>
          )}
        </section>
      )}
    </section>
  );
}
