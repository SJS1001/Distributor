import { CostCorrectionOutcomes } from "./cost-correction-outcomes.tsx";
import React, { useEffect, useRef, useState } from "react";
import type { CostPacketView } from "../server/integration-costs.ts";
import type {
  CostCorrections,
  CostPolicyInput,
  CorrectionInput,
} from "../server/cost-corrections.ts";
import { command, downloadCostFile, request } from "./api.ts";

type Policy = ReturnType<CostCorrections["policy"]>;
type Correction = ReturnType<CostCorrections["detail"]>;
type Item = ReturnType<CostCorrections["list"]>[number];
const field = (label: string, name: string, optional = false, date = false) => (
  <div className="form-field">
    <label htmlFor={`cost-correction-${name}`}>{label}</label>
    <input
      id={`cost-correction-${name}`}
      name={name}
      required={!optional}
      type={date ? "date" : "text"}
      maxLength={2000}
    />
  </div>
);
const value = (v: FormData, key: string) => String(v.get(key) ?? "");
const optional = (v: FormData, key: string) => value(v, key).trim() || null;
const mappings = (v: FormData) => {
  const input: unknown = JSON.parse(value(v, "mappings"));
  if (!Array.isArray(input)) throw Error("Mappings must be a JSON array.");
  return input as CostPolicyInput["mappings"];
};
export function CostCorrectionsPanel({
  original,
  recoveryHold,
}: {
  original: CostPacketView;
  recoveryHold: boolean;
}) {
  const [loaded, setLoaded] = useState(false),
    [policy, setPolicy] = useState<Policy>(null),
    [items, setItems] = useState<Item[]>([]),
    [detail, setDetail] = useState<Correction | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null),
    review = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    [],
  );
  useEffect(() => {
    if (detail) review.current?.focus();
  }, [detail?.id]);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await work(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Correction failed. Retry the same evidence.",
        );
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const load = async (signal: AbortSignal) => {
    const [current, history] = await Promise.all([
      request<Policy>("/api/accounting/cost-policy", { signal }),
      request<Item[]>(
        `/api/accounting/costs/${encodeURIComponent(original.id)}/corrections`,
        { signal },
      ),
    ]);
    signal.throwIfAborted();
    setPolicy(current);
    setItems(history);
    setLoaded(true);
  };
  const open = async (id: string, signal: AbortSignal) => {
    const next = await request<Correction>(
      `/api/accounting/cost-corrections/${encodeURIComponent(id)}`,
      { signal },
    );
    signal.throwIfAborted();
    setDetail(next);
  };
  const submit = (
    e: React.FormEvent<HTMLFormElement>,
    work: (v: FormData, signal: AbortSignal) => Promise<void>,
  ) => {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    void run((signal) => work(v, signal));
  };
  return (
    <section aria-label="Approved cost corrections">
      <h4>Correct approved account mappings</h4>
      <p>
        Preserve this original file and its stock cutoff. Verify the ledger
        outcome before preparing a linked replacement or reversal. A different
        finance reviewer must approve it. This workflow keeps original
        quantities and values.
      </p>
      <button disabled={busy} onClick={() => void run(load)}>
        {loaded ? "Refresh cost corrections" : "Load cost corrections"}
      </button>
      {error && <p role="alert">{error}</p>}
      {loaded && (
        <>
          {recoveryHold && (
            <p role="status">
              Restore hold: correction changes are blocked; approved files
              remain available.
            </p>
          )}
          {policy ? (
            <p>
              Correction policy revision {policy.revision}:{" "}
              {policy.input.policyVersion} · mapping{" "}
              {policy.input.mappingVersion} · monthly periods · closed through{" "}
              {policy.input.closedThrough ?? "no recorded close"}. Established
              valuation: {policy.input.establishedValuation}.
            </p>
          ) : (
            <p>
              No correction policy configured. Responsible finance must supply
              the established accounting basis and reviewed accounts.
            </p>
          )}
          <details>
            <summary>Configure correction policy</summary>
            <form
              aria-label="Configure stock cost correction policy"
              onSubmit={(e) =>
                submit(e, async (v, signal) => {
                  const input: CostPolicyInput = {
                    previousRevision: policy?.revision ?? 0,
                    policyVersion: value(v, "policyVersion"),
                    mappingVersion: value(v, "mappingVersion"),
                    establishedValuation: value(v, "establishedValuation"),
                    period: "monthly",
                    closedThrough: optional(v, "closedThrough"),
                    inventoryPostingOwner: "distributor",
                    inventoryAccount: value(v, "inventoryAccount"),
                    mappings: mappings(v),
                    financeEvidence: value(v, "financeEvidence"),
                  };
                  await command("accounting.cost.policy", input, signal);
                  signal.throwIfAborted();
                  await load(signal);
                })
              }
            >
              <fieldset disabled={busy || recoveryHold}>
                <p>
                  Distributor owns the stock-cost subledger handoff; reconcile
                  the receiving general ledger to avoid duplicate postings.
                  Closed periods cannot be reopened here. This policy controls
                  corrections and does not recalculate valuation or replace the
                  original handoff controls.
                </p>
                {field("Correction policy version", "policyVersion")}
                {field("Correction mapping version", "mappingVersion")}
                {field(
                  "Established valuation and finance basis",
                  "establishedValuation",
                )}
                {field("Closed through date", "closedThrough", true, true)}
                {field("Corrected inventory account", "inventoryAccount")}
                <div className="form-field">
                  <label htmlFor="cost-correction-mappings">
                    Corrected movement mappings (JSON)
                  </label>
                  <textarea
                    id="cost-correction-mappings"
                    name="mappings"
                    required
                    maxLength={10000}
                  />
                </div>
                {field(
                  "Responsible finance policy evidence",
                  "financeEvidence",
                )}
                <button type="submit">Save correction policy</button>
              </fieldset>
            </form>
          </details>
          {policy && !items.some((i) => i.state === "reviewed") && (
            <form
              aria-label="Prepare approved cost correction"
              onSubmit={(e) =>
                submit(e, async (v, signal) => {
                  const input: CorrectionInput = {
                    originalId: original.id,
                    originalHash: original.contentHash!,
                    policyRevision: policy.revision,
                    postingDate: value(v, "postingDate"),
                    outcome: value(v, "outcome") as CorrectionInput["outcome"],
                    receiverRef: value(v, "receiverRef"),
                    externalRef: value(v, "externalRef"),
                    originalPostingDate: optional(v, "originalPostingDate"),
                    outcomeEvidence: value(v, "outcomeEvidence"),
                    cancellationEvidence: optional(v, "cancellationEvidence"),
                    priorPeriodEvidence: optional(v, "priorPeriodEvidence"),
                    reason: value(v, "correctionReason"),
                  };
                  const prepared = await command(
                    "accounting.cost.correction.prepare",
                    input,
                    signal,
                  );
                  signal.throwIfAborted();
                  await open(prepared.id, signal);
                  await load(signal);
                })
              }
            >
              <h5>Prepare linked correction</h5>
              <fieldset disabled={busy || recoveryHold}>
                {field("Correction posting date", "postingDate", false, true)}
                <div className="form-field">
                  <label htmlFor="cost-correction-outcome">
                    Verified original ledger outcome
                  </label>
                  <select
                    id="cost-correction-outcome"
                    name="outcome"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose verified outcome
                    </option>
                    <option value="posted">
                      Posted: reverse original and replace
                    </option>
                    <option value="unposted">
                      Verified unposted and cancelled: replace
                    </option>
                    <option value="unknown">
                      Unknown: blocked review only
                    </option>
                  </select>
                </div>
                {field("Correction ledger receiver", "receiverRef")}
                {field("Original ledger outcome reference", "externalRef")}
                {field(
                  "Original ledger posting date",
                  "originalPostingDate",
                  true,
                  true,
                )}
                {field("Verified ledger outcome evidence", "outcomeEvidence")}
                {field(
                  "Verified non-posting and cancellation evidence",
                  "cancellationEvidence",
                  true,
                )}
                {field(
                  "Prior period accountant review",
                  "priorPeriodEvidence",
                  true,
                )}
                {field("Account mapping correction reason", "correctionReason")}
                <button type="submit">Prepare cost correction</button>
              </fieldset>
            </form>
          )}
          <ul aria-label="Saved cost corrections">
            {items.map((item) => (
              <li key={item.id}>
                {item.state} · {item.input.postingDate} · {item.input.reason}{" "}
                <button
                  disabled={busy}
                  onClick={() => void run((signal) => open(item.id, signal))}
                >
                  Open cost correction {item.id}
                </button>
              </li>
            ))}
          </ul>
          {items.length === 0 && <p>No saved corrections for this original.</p>}
          {items.length === 100 && (
            <p>
              Only the latest 100 corrections are shown. Retain the correction
              ID for direct evidence retrieval.
            </p>
          )}
        </>
      )}
      {detail && (
        <div
          ref={review}
          role="region"
          aria-label="Saved account mapping correction"
          tabIndex={-1}
        >
          <h5>Saved account mapping correction</h5>
          <p>
            State: {detail.state} · prepared by {detail.createdBy} ·{" "}
            {detail.createdAt}. Original SHA-256:{" "}
            <code style={{ overflowWrap: "anywhere" }}>
              {detail.originalHash}
            </code>
            .
          </p>
          <p>
            Review SHA-256:{" "}
            <code style={{ overflowWrap: "anywhere" }}>
              {detail.reviewHash}
            </code>
          </p>
          <details>
            <summary>Inspect frozen correction and balanced journals</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(detail.plan, null, 2)}
            </pre>
          </details>
          {["ready", "blocked"].includes(detail.state) && (
            <form
              aria-label="Decide account mapping correction"
              onSubmit={(e) =>
                submit(e, async (v, signal) => {
                  await command(
                    "accounting.cost.correction.decide",
                    {
                      correctionId: detail.id,
                      reviewHash: detail.reviewHash,
                      decision: value(v, "decision"),
                      reason: value(v, "reviewReason"),
                    },
                    signal,
                  );
                  signal.throwIfAborted();
                  await open(detail.id, signal);
                  await load(signal);
                })
              }
            >
              <fieldset disabled={busy || recoveryHold}>
                <p>
                  A different current finance principal must review the exact
                  frozen evidence. Unknown outcomes cannot be approved.
                </p>
                <div className="form-field">
                  <label htmlFor="cost-correction-decision">
                    Correction review decision
                  </label>
                  <select
                    id="cost-correction-decision"
                    name="decision"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose a decision
                    </option>
                    {detail.state === "ready" && (
                      <option value="approve">Approve correction</option>
                    )}
                    <option value="reject">Reject correction</option>
                  </select>
                </div>
                {field("Independent correction review reason", "reviewReason")}
                <button type="submit">Record correction decision</button>
              </fieldset>
            </form>
          )}
          {detail.decisionReason && (
            <p>
              Decision evidence: {detail.decisionReason} · {detail.decisionBy} ·{" "}
              {detail.decisionAt}.
            </p>
          )}
          {detail.contentHash && (
            <>
              <p>
                Approved correction SHA-256:{" "}
                <code style={{ overflowWrap: "anywhere" }}>
                  {detail.contentHash}
                </code>
                . Download does not record ledger delivery or posting.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async (signal) => {
                    await downloadCostFile(
                      detail.id,
                      detail.contentHash!,
                      signal,
                      true,
                    );
                  })
                }
              >
                Download approved cost correction
              </button>
              <CostCorrectionOutcomes
                key={detail.id}
                correctionId={detail.id}
                contentHash={detail.contentHash}
                recoveryHold={recoveryHold}
              />
            </>
          )}
          <button disabled={busy} onClick={() => setDetail(null)}>
            Close cost correction review
          </button>
        </div>
      )}
    </section>
  );
}
