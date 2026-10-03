import React, { useEffect, useRef, useState } from "react";
import type {
  Valuation,
  ValuationInput,
  ValuationPolicyInput,
  ValuationReview,
} from "../server/inventory-valuations.ts";
import { request } from "./api.ts";
import {
  canonical,
  ensure,
  hash,
  readAttempt,
  recoveryError,
  validateAttempt,
  validatePolicyRead,
  validateReply,
  validateReviewRead,
  validateValuation,
  type PolicyRead,
  type ReviewRead,
  type ValueAttempt,
} from "./inventory-valuation-contract.ts";

export type ValuationSelection = {
  unitId: string;
  product: string;
  warehouse: string;
};
type Page = { rows: Valuation[]; more: boolean };
const emptyPolicy = {
  policyVersion: "",
  establishedBasis: "",
  establishedMethod: "specific-identification",
  effectiveFrom: "",
  closedThrough: "",
  financeEvidence: "",
  nonInterchangeableEvidence: "",
};
const emptyAdjustment = {
  reference: "",
  kind: "write-down",
  targetValue: "",
  postingDate: "",
  reason: "",
  evidence: "",
  accountantEvidence: "",
};

export function InventoryValuation({
  orgId,
  actorId,
  selection,
  close,
}: {
  orgId: string;
  actorId: string;
  selection: ValuationSelection | null;
  close: () => void;
}) {
  const storageKey = `distributor-valuation:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState<ValueAttempt | null>(null);
  const [storageError, setStorageError] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [fixed, setFixed] = useState<ValueAttempt | null>(null);
  const [policyRead, setPolicyRead] = useState<PolicyRead | null>(null);
  const [current, setCurrent] = useState<ReviewRead | null>(null);
  const [history, setHistory] = useState<Page>({ rows: [], more: false });
  const [cursors, setCursors] = useState<string[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<Valuation | null>(null);
  const [policyForm, setPolicyForm] = useState(emptyPolicy);
  const [adjustment, setAdjustment] = useState(emptyAdjustment);
  const [decision, setDecision] = useState("approve"),
    [decisionReason, setDecisionReason] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [readEpoch, setReadEpoch] = useState(0);
  const active = useRef(true),
    executing = useRef(false),
    epoch = useRef(0);
  const readController = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null);
  const opener = useRef<HTMLElement | null>(null),
    reviewOpener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const unitId = recoveryOpen ? recovery?.unitId : selection?.unitId;
  const unitPath = unitId ? `/api/stock/${encodeURIComponent(unitId)}` : "";

  useEffect(() => {
    active.current = true;
    let generation = 0;
    const read = async () => {
      const selected = ++generation;
      try {
        const a = await readAttempt(storageKey, orgId, actorId);
        if (active.current && selected === generation) {
          setRecovery(a);
          setStorageError("");
          setStorageReady(true);
        }
      } catch {
        if (active.current && selected === generation) {
          setRecovery(null);
          setStorageError(recoveryError);
          setStorageReady(true);
        }
      }
    };
    void read();
    const changed = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null) void read();
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      generation++;
      readController.current?.abort();
      writeController.current?.abort();
      window.removeEventListener("storage", changed);
    };
  }, [storageKey, orgId, actorId]);
  useEffect(() => {
    epoch.current++;
    writeController.current?.abort();
    executing.current = false;
    setBusy(false);
    setFixed((v) => (recoveryOpen && v?.unitId === unitId ? v : null));
    setError("");
    setPolicyRead(null);
    setCurrent(null);
    setHistory({ rows: [], more: false });
    setSelectedRecord(null);
    setCursors([]);
    if (unitId) opener.current = document.activeElement as HTMLElement;
  }, [unitId]);
  useEffect(() => {
    if (!unitId) return;
    const controller = new AbortController();
    readController.current?.abort();
    readController.current = controller;
    const signal = controller.signal;
    const chosenEpoch = epoch.current;
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        const p = await request<PolicyRead>(`${unitPath}/valuation-policy`, {
          signal,
        });
        await validatePolicyRead(p, orgId, unitId);
        const h = await request<Page>(`${unitPath}/valuations`, { signal });
        ensure(
          Array.isArray(h.rows) &&
            h.rows.length <= 20 &&
            typeof h.more === "boolean" &&
            (!h.more || h.rows.length === 20) &&
            new Set(h.rows.map((v) => v.id)).size === h.rows.length,
        );
        for (const v of h.rows) await validateValuation(v, orgId, unitId);
        let r: ReviewRead | null = null;
        if (p.policy) {
          // Disposed units keep readable history even when they cannot be valued.
          try {
            r = await request<ReviewRead>(`${unitPath}/valuation-review`, {
              signal,
            });
            await validateReviewRead(r, orgId, unitId);
          } catch (e) {
            if (!(
              e instanceof Error && e.message.includes("VALUATION_CUSTODY")
            ))
              throw e;
          }
        }
        signal.throwIfAborted();
        if (!active.current || chosenEpoch !== epoch.current) return;
        setPolicyRead(p);
        setCurrent(r);
        setHistory(h);
        setCursors([]);
        setSelectedRecord(
          h.rows.find((v) => v.state === "ready") ?? h.rows[0] ?? null,
        );
        setPolicyForm(
          p.policy
            ? {
                policyVersion: p.policy.policyVersion,
                establishedBasis: p.policy.establishedBasis,
                establishedMethod: p.policy.establishedMethod,
                effectiveFrom: p.policy.effectiveFrom,
                closedThrough: p.policy.closedThrough ?? "",
                financeEvidence: "",
                nonInterchangeableEvidence:
                  p.policy.nonInterchangeableEvidence ?? "",
              }
            : emptyPolicy,
        );
      } catch (e) {
        if (!signal.aborted && active.current && chosenEpoch === epoch.current)
          setError(
            e instanceof Error ? e.message : "Valuation read did not complete.",
          );
      } finally {
        if (!signal.aborted && active.current && chosenEpoch === epoch.current)
          setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [unitId, unitPath, orgId, readEpoch]);
  useEffect(() => {
    if (fixed) heading.current?.focus();
  }, [fixed]);

  async function reviewAttempt(
    kind: ValueAttempt["kind"],
    payload: unknown,
    snapshot: unknown,
  ) {
    if (
      !unitId ||
      executing.current ||
      fixed ||
      !storageReady ||
      storageError ||
      recovery
    )
      return;
    const selectedEpoch = epoch.current;
    try {
      if (kind === "prepare") {
        const p = payload as ValuationInput,
          r = snapshot as ReviewRead;
        ensure(
          p.postingDate >= r.policy.effectiveFrom &&
            (!r.policy.closedThrough || p.postingDate > r.policy.closedThrough),
          "Posting date must be in an open period on or after the policy effective date.",
        );
      }
      const body = {
        version: 1 as const,
        key: crypto.randomUUID(),
        orgId,
        actorId,
        unitId,
        kind,
        snapshot,
        payload,
      };
      const a = { ...body, fingerprint: await hash(body) } as ValueAttempt;
      await validateAttempt(a, orgId, actorId);
      ensure(
        (await readAttempt(storageKey, orgId, actorId)) === null,
        "Another valuation attempt is retained. Review its exact recovery first.",
      );
      if (!active.current || selectedEpoch !== epoch.current) return;
      reviewOpener.current = document.activeElement as HTMLElement;
      setError("");
      setFixed(a);
    } catch (e) {
      if (active.current && selectedEpoch === epoch.current)
        setError(
          e instanceof Error ? e.message : "Valuation review did not complete.",
        );
    }
  }
  async function confirm(a: ValueAttempt) {
    if (executing.current || storageError) return;
    const controller = new AbortController();
    writeController.current = controller;
    const selectedEpoch = epoch.current;
    const live = () =>
      active.current &&
      selectedEpoch === epoch.current &&
      !controller.signal.aborted;
    executing.current = true;
    setBusy(true);
    setError("");
    try {
      ensure(
        navigator.locks,
        "Use a browser with Web Locks to coordinate valuation commands between tabs.",
      );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          ensure(
            lock,
            "Another tab is submitting valuation evidence. Wait for its outcome.",
          );
          await validateAttempt(a, orgId, actorId);
          controller.signal.throwIfAborted();
          const existing = await readAttempt(storageKey, orgId, actorId);
          ensure(
            !existing || canonical(existing) === canonical(a),
            "Another exact valuation attempt is retained. Review its recovery first.",
          );
          ensure(live());
          if (!existing) localStorage.setItem(storageKey, JSON.stringify(a));
          ensure(
            canonical(await readAttempt(storageKey, orgId, actorId)) ===
              canonical(a),
          );
          if (live()) setRecovery(a);
          let result: unknown;
          if (a.kind === "decide") {
            const retained = await request<Valuation>(
              `/api/stock/valuations/${encodeURIComponent(a.payload.valuationId)}`,
              { signal: controller.signal },
            );
            await validateValuation(retained, orgId, a.unitId);
            if (retained.state !== "ready") result = retained;
            else
              ensure(
                canonical(retained) === canonical(a.snapshot),
                "Prepared valuation evidence changed. Reconcile this exact attempt.",
              );
          }
          if (!result)
            result = await request(
              `/api/commands/inventory.valuation.${a.kind}`,
              {
                method: "POST",
                signal: controller.signal,
                headers: { "idempotency-key": a.key },
                body: JSON.stringify(a.payload),
              },
            );
          await validateReply(result, a);
          controller.signal.throwIfAborted();
          ensure(live());
          ensure(
            canonical(await readAttempt(storageKey, orgId, actorId)) ===
              canonical(a),
          );
          controller.signal.throwIfAborted();
          ensure(live());
          localStorage.removeItem(storageKey);
          setRecovery(null);
          setFixed(null);
          setRecoveryOpen(false);
          setAdjustment(emptyAdjustment);
          setReadEpoch((v) => v + 1);
          reviewOpener.current?.focus();
        },
      );
    } catch (e) {
      if (live()) {
        setError(
          e instanceof Error
            ? e.message
            : "Valuation reply is uncertain. Recover the retained exact attempt.",
        );
        try {
          setRecovery(await readAttempt(storageKey, orgId, actorId));
        } catch {
          setStorageError(recoveryError);
        }
      }
    } finally {
      if (live()) {
        executing.current = false;
        setBusy(false);
      }
    }
  }
  async function historyPage(next: string[]) {
    if (!unitId || loading || executing.current || fixed) return;
    const controller = new AbortController();
    readController.current?.abort();
    readController.current = controller;
    const selectedEpoch = epoch.current;
    setLoading(true);
    setError("");
    try {
      const cursor = next.at(-1);
      const h = await request<Page>(
        `${unitPath}/valuations${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
        { signal: controller.signal },
      );
      ensure(
        Array.isArray(h.rows) &&
          h.rows.length <= 20 &&
          typeof h.more === "boolean" &&
          (!h.more || h.rows.length === 20) &&
          new Set(h.rows.map((v) => v.id)).size === h.rows.length,
      );
      for (const v of h.rows) await validateValuation(v, orgId, unitId);
      controller.signal.throwIfAborted();
      if (!active.current || selectedEpoch !== epoch.current) return;
      setHistory(h);
      setCursors(next);
      setSelectedRecord(
        h.rows.find((v) => v.state === "ready") ?? h.rows[0] ?? null,
      );
    } catch (e) {
      if (
        !controller.signal.aborted &&
        active.current &&
        selectedEpoch === epoch.current
      )
        setError(e instanceof Error ? e.message : "History read failed.");
    } finally {
      if (
        !controller.signal.aborted &&
        active.current &&
        selectedEpoch === epoch.current
      )
        setLoading(false);
    }
  }
  const dismiss = () => {
    epoch.current++;
    writeController.current?.abort();
    readController.current?.abort();
    executing.current = false;
    setBusy(false);
    setFixed(null);
    setRecoveryOpen(false);
    close();
    opener.current?.focus();
  };
  const blocked =
    !storageReady || !!storageError || !!recovery || !!fixed || busy || loading;
  const field = (
    label: string,
    value: string,
    change: (s: string) => void,
    options: { type?: string; readOnly?: boolean; maxLength?: number } = {},
  ) => (
    <label>
      {label}
      <input
        value={value}
        onChange={(e) => change(e.target.value)}
        type={options.type ?? "text"}
        readOnly={options.readOnly}
        maxLength={options.maxLength ?? 2000}
        required
      />
    </label>
  );
  const configField = (
    label: string,
    name: keyof typeof emptyPolicy,
    options = {},
  ) =>
    field(
      label,
      policyForm[name],
      (value) => setPolicyForm((p) => ({ ...p, [name]: value })),
      options,
    );
  const adjustField = (
    label: string,
    name: keyof typeof emptyAdjustment,
    options = {},
  ) =>
    field(
      label,
      adjustment[name],
      (value) => setAdjustment((p) => ({ ...p, [name]: value })),
      options,
    );
  const fixedReview = fixed && (
    <section aria-label="Exact valuation review">
      <h3 ref={heading} tabIndex={-1}>
        Confirm exact{" "}
        {fixed.kind === "policy"
          ? "valuation policy"
          : fixed.kind === "prepare"
            ? "valuation adjustment"
            : "valuation decision"}
      </h3>
      <p>
        Organization {orgId} · Stock unit {fixed.unitId} · Principal {actorId}
      </p>
      {fixed.kind === "policy" ? (
        <>
          <p>
            Product {fixed.payload.productId} · Previous revision{" "}
            {fixed.payload.previousRevision}
          </p>
          <p>
            Policy version {fixed.payload.policyVersion} · Basis{" "}
            {fixed.payload.establishedBasis} · Method{" "}
            {fixed.payload.establishedMethod}
          </p>
          <p>
            Effective from {fixed.payload.effectiveFrom} · Closed through{" "}
            {fixed.payload.closedThrough ?? "No closed date"}
          </p>
          <p>Finance evidence: {fixed.payload.financeEvidence}</p>
          <p>
            Non-interchangeability evidence:{" "}
            {fixed.payload.nonInterchangeableEvidence ?? "Not supplied"}
          </p>
        </>
      ) : (
        <>
          <ValueSource
            value={
              fixed.kind === "prepare" ? fixed.snapshot : fixed.snapshot.review
            }
          />
          <ValueInput
            input={
              fixed.kind === "prepare" ? fixed.payload : fixed.snapshot.input
            }
          />
          {fixed.kind === "decide" && (
            <>
              <p>
                Prepared by {fixed.snapshot.createdBy} · Record{" "}
                {fixed.snapshot.id}
              </p>
              <p>
                Decision {fixed.payload.decision} · Reason{" "}
                {fixed.payload.reason}
              </p>
            </>
          )}
        </>
      )}
      <p>
        The command uses this fixed evidence. Acquisition cost and physical
        quantity remain unchanged.
      </p>
      <button
        disabled={busy || !!storageError}
        onClick={() => void confirm(fixed)}
      >
        Confirm exact valuation
      </button>
      <button
        disabled={busy}
        onClick={() => {
          setFixed(null);
          reviewOpener.current?.focus();
        }}
      >
        Back to valuation
      </button>
    </section>
  );
  return (
    <>
      {storageError && <p role="alert">{storageError}</p>}
      {recovery && !fixed && (
        <button
          disabled={busy}
          onClick={() => {
            reviewOpener.current = document.activeElement as HTMLElement;
            setRecoveryOpen(true);
            setFixed(recovery);
          }}
        >
          Recover exact valuation attempt
        </button>
      )}
      {(selection || recoveryOpen) && (
        <section className="stock-valuation" aria-label="Stock valuation">
          <h2>Stock valuation</h2>
          <p>
            {selection && selection.unitId === unitId
              ? selection.product
              : "Retained stock"}{" "}
            ·{" "}
            {selection && selection.unitId === unitId
              ? selection.warehouse
              : "Retained custody"}{" "}
            · {unitId}
          </p>
          <button onClick={dismiss}>Close stock valuation</button>
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">Reading current valuation evidence…</p>}
          {!fixed && (
            <button
              disabled={busy || loading}
              onClick={() => setReadEpoch((v) => v + 1)}
            >
              Refresh valuation evidence
            </button>
          )}
          {fixedReview}
          {!fixed && policyRead && (
            <>
              {policyRead.policy && (
                <p>Policy revision {policyRead.policy.revision}</p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const p: ValuationPolicyInput = {
                    productId: policyRead.productId,
                    previousRevision: policyRead.policy?.revision ?? 0,
                    ...policyForm,
                    establishedMethod:
                      policyForm.establishedMethod as ValuationPolicyInput["establishedMethod"],
                    closedThrough: policyForm.closedThrough || null,
                    nonInterchangeableEvidence:
                      policyForm.nonInterchangeableEvidence.trim() || null,
                  };
                  void reviewAttempt("policy", p, policyRead);
                }}
              >
                <h3>Established valuation policy</h3>
                <fieldset disabled={blocked}>
                  {configField("Policy version", "policyVersion", {
                    maxLength: 160,
                  })}
                  {configField(
                    "Established accounting basis",
                    "establishedBasis",
                    { readOnly: !!policyRead.policy },
                  )}
                  <label>
                    Costing method
                    <select
                      aria-label="Costing method"
                      value={policyForm.establishedMethod}
                      disabled={!!policyRead.policy}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          establishedMethod: e.target.value,
                        }))
                      }
                    >
                      <option value="specific-identification">
                        Specific identification
                      </option>
                      <option value="fifo-receipt-layers">
                        FIFO receipt layers
                      </option>
                    </select>
                  </label>
                  {configField("Effective from", "effectiveFrom", {
                    type: "date",
                    readOnly: !!policyRead.policy,
                  })}
                  <label>
                    Closed through
                    <input
                      type="date"
                      value={policyForm.closedThrough}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          closedThrough: e.target.value,
                        }))
                      }
                    />
                  </label>
                  {configField("Finance policy evidence", "financeEvidence")}
                  <label>
                    Non-interchangeability evidence
                    <input
                      value={policyForm.nonInterchangeableEvidence}
                      required={
                        policyForm.establishedMethod ===
                        "specific-identification"
                      }
                      maxLength={2000}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          nonInterchangeableEvidence: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <button>Review valuation policy</button>
                </fieldset>
              </form>
              {current && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void reviewAttempt(
                      "prepare",
                      {
                        ...adjustment,
                        targetValue: Number(adjustment.targetValue),
                        unitId,
                        reviewHash: current.reviewHash,
                      },
                      current,
                    );
                  }}
                >
                  <h3>Prepare valuation adjustment</h3>
                  <ValueSource value={current} />
                  <fieldset disabled={blocked}>
                    {adjustField("Valuation reference", "reference", {
                      maxLength: 160,
                    })}
                    <label>
                      Adjustment kind
                      <select
                        aria-label="Adjustment kind"
                        value={adjustment.kind}
                        onChange={(e) =>
                          setAdjustment((p) => ({ ...p, kind: e.target.value }))
                        }
                      >
                        <option value="write-down">Write-down</option>
                        <option value="reversal">Reversal</option>
                      </select>
                    </label>
                    {adjustField(
                      "Target carrying value (minor units)",
                      "targetValue",
                      { type: "number" },
                    )}
                    {adjustField("Posting date", "postingDate", {
                      type: "date",
                    })}
                    {adjustField("Valuation reason", "reason")}
                    {adjustField("Value evidence", "evidence")}
                    {adjustField("Accountant evidence", "accountantEvidence")}
                    <button>Review valuation adjustment</button>
                  </fieldset>
                </form>
              )}
              <section aria-label="Valuation history">
                <h3>Valuation history</h3>
                {history.rows.length === 0 && <p>No valuation records.</p>}
                {history.rows.map((v) => (
                  <div key={v.id}>
                    <button
                      disabled={blocked}
                      onClick={() => setSelectedRecord(v)}
                    >
                      {v.reference}
                    </button>
                    <span>{v.state}</span>
                  </div>
                ))}
                <button
                  disabled={blocked || cursors.length === 0}
                  onClick={() => void historyPage(cursors.slice(0, -1))}
                >
                  Previous valuations
                </button>
                <button
                  disabled={blocked || !history.more}
                  onClick={() =>
                    void historyPage([...cursors, history.rows.at(-1)!.id])
                  }
                >
                  More valuations
                </button>
                {selectedRecord && (
                  <>
                    <ValueSource value={selectedRecord.review} />
                    <ValueInput input={selectedRecord.input} />
                    <p>
                      Prepared by {selectedRecord.createdBy} · Record{" "}
                      {selectedRecord.id}
                    </p>
                    {selectedRecord.decision && (
                      <p>
                        Decision {selectedRecord.decision.decision} by{" "}
                        {selectedRecord.decision.by}:{" "}
                        {selectedRecord.decision.reason}
                      </p>
                    )}
                    {selectedRecord.state === "ready" && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void reviewAttempt(
                            "decide",
                            {
                              valuationId: selectedRecord.id,
                              reviewHash: selectedRecord.reviewHash,
                              decision,
                              reason: decisionReason.trim(),
                            },
                            selectedRecord,
                          );
                        }}
                      >
                        <fieldset disabled={blocked}>
                          <label>
                            Valuation decision
                            <select
                              aria-label="Valuation decision"
                              value={decision}
                              onChange={(e) => setDecision(e.target.value)}
                            >
                              <option value="approve">Approve</option>
                              <option value="reject">Reject</option>
                            </select>
                          </label>
                          {field(
                            "Decision reason",
                            decisionReason,
                            setDecisionReason,
                          )}
                          <button
                            disabled={selectedRecord.createdBy === actorId}
                          >
                            Review decision
                          </button>
                          {selectedRecord.createdBy === actorId && (
                            <p>
                              A different current finance principal must review
                              this adjustment.
                            </p>
                          )}
                        </fieldset>
                      </form>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </section>
      )}
    </>
  );
}
function ValueSource({ value }: { value: ValuationReview }) {
  const u = value.unit;
  return (
    <div>
      <p>
        {value.region} · {value.currency} · Stock {u.serial ?? u.id} ·{" "}
        {u.warehouse_id} / {u.bin} · {u.state} / {u.condition}
      </p>
      <p>
        Quantity {u.quantity} · Original unit acquisition cost {u.cost} ·
        Carrying value {value.carryingValue} · Stock revision {u.revision}
      </p>
      <p>
        Policy {value.policy.policyVersion}, revision {value.policy.revision} ·{" "}
        {value.policy.establishedMethod} · {value.policy.establishedBasis}
      </p>
      <p>
        Effective from {value.policy.effectiveFrom} · Closed through{" "}
        {value.policy.closedThrough ?? "No closed date"}
      </p>
      <p>
        Finance policy evidence: {value.policy.financeEvidence} ·
        Non-interchangeability evidence:{" "}
        {value.policy.nonInterchangeableEvidence ?? "Not supplied"}
      </p>
      <p>
        Policy evidence {value.policyHash} · Position evidence{" "}
        {value.positionHash ?? "Original acquisition layer"}
      </p>
    </div>
  );
}
function ValueInput({ input }: { input: Valuation["input"] }) {
  return (
    <div>
      <p>
        {input.kind} · Target carrying value {input.targetValue} · Posting date{" "}
        {input.postingDate}
      </p>
      <p>Reference: {input.reference}</p>
      <p>Reason: {input.reason}</p>
      <p>Value evidence: {input.evidence}</p>
      <p>Accountant evidence: {input.accountantEvidence}</p>
    </div>
  );
}
