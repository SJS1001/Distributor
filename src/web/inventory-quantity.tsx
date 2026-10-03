import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import type { Actor } from "../server/core.ts";
import type { StockHistoryPage } from "../shared/stock-history.ts";
import {
  canonical,
  ensure,
  hash,
  readAttempt,
  recoveryError,
  validateAttempt,
  validateReviewRead,
  validateReviewResponse,
  validateRecord,
  validateReply,
  validatePage,
  validateMovements,
  eligibleSource,
  immutableRecord,
  type Scope,
  type QuantityAttempt,
  type QuantityCorrection,
  type QuantityCorrectionInput,
  type ReviewRead,
  type QuantityPage,
} from "./inventory-quantity-contract.ts";

export type QuantitySelection = {
  unitId: string;
  product: string;
  warehouse: string;
};
const empty = {
  reference: "",
  targetQuantity: "",
  postingDate: "",
  reason: "",
  physicalEvidence: "",
  accountantEvidence: "",
};
export function InventoryQuantity({
  orgId,
  actorId,
  region,
  currency,
  selection,
  close,
  saved,
}: {
  orgId: string;
  actorId: string;
  region: string;
  currency: string;
  selection: QuantitySelection | null;
  close: () => void;
  saved: (signal: AbortSignal) => Promise<void>;
}) {
  const storageKey = `distributor-quantity:${orgId}:${actorId}`;
  const [retained, setRetained] = useState<QuantityAttempt | null>(null),
    [storageError, setStorageError] = useState(""),
    [storageReady, setStorageReady] = useState(false);
  const [fixed, setFixed] = useState<QuantityAttempt | null>(null),
    [recovering, setRecovering] = useState(false);
  const [movements, setMovements] = useState<StockHistoryPage | null>(null),
    [history, setHistory] = useState<QuantityPage>({ items: [], next: null });
  const [movementTrail, setMovementTrail] = useState<(string | null)[]>([]),
    [historyTrail, setHistoryTrail] = useState<(string | null)[]>([]);
  const movementCursor = useRef<string | null>(null),
    historyCursor = useRef<string | null>(null);
  const [current, setCurrent] = useState<ReviewRead | null>(null),
    [record, setRecord] = useState<QuantityCorrection | null>(null),
    [result, setResult] = useState<QuantityCorrection | null>(null);
  const [form, setForm] = useState(empty),
    [decision, setDecision] = useState<"approve" | "reject">("approve"),
    [decisionReason, setDecisionReason] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [reload, setReload] = useState(0);
  const active = useRef(true),
    generation = useRef(0),
    executing = useRef(false),
    reading = useRef(false),
    readController = useRef<AbortController | null>(null),
    writeController = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null),
    opener = useRef<HTMLElement | null>(null),
    reviewOpener = useRef<HTMLElement | null>(null);
  const unitId = recovering ? retained?.unitId : selection?.unitId;
  const live = (g: number, c: AbortController) =>
    active.current && g === generation.current && !c.signal.aborted;
  async function authority(id: string, signal: AbortSignal): Promise<Scope> {
    const s = await request<{
      actor: Actor;
      passwordChangeRequired: boolean;
      mfaEnrollmentRequired: boolean;
    }>("/api/session", { signal });
    ensure(
      s.actor?.id === actorId &&
        s.actor.orgId === orgId &&
        s.actor.accountId === null &&
        ["admin", "finance"].includes(s.actor.role) &&
        Array.isArray(s.actor.sites) &&
        s.actor.sites.every((v) => typeof v === "string") &&
        s.passwordChangeRequired === false &&
        s.mfaEnrollmentRequired === false,
      "Current organization finance authority is required. Sign in again before recovery.",
    );
    return {
      orgId,
      unitId: id,
      region,
      currency,
      sites: s.actor.sites,
      allSites: s.actor.role === "admin",
    };
  }
  useEffect(() => {
    active.current = true;
    let revision = 0;
    async function read(changed = false) {
      const r = ++revision;
      try {
        const a = await readAttempt(storageKey, orgId, actorId);
        if (active.current && r === revision) {
          setRetained(a);
          setStorageError(changed && !a ? recoveryError : "");
          setStorageReady(true);
        }
      } catch {
        if (active.current && r === revision) {
          setRetained(null);
          setStorageError(recoveryError);
          setStorageReady(true);
        }
      }
    }
    void read();
    const changed = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null) {
        generation.current++;
        readController.current?.abort();
        writeController.current?.abort();
        executing.current = false;
        reading.current = false;
        setBusy(false);
        setLoading(false);
        setCurrent(null);
        setRecord(null);
        setFixed(null);
        setRecovering(false);
        void read(true);
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      revision++;
      generation.current++;
      readController.current?.abort();
      writeController.current?.abort();
      window.removeEventListener("storage", changed);
    };
  }, [storageKey, orgId, actorId]);
  useEffect(() => {
    generation.current++;
    readController.current?.abort();
    writeController.current?.abort();
    executing.current = false;
    reading.current = false;
    setBusy(false);
    setLoading(false);
    setFixed((v) => (recovering && v?.unitId === unitId ? v : null));
    setCurrent(null);
    setRecord(null);
    setError("");
    setForm(empty);
    setMovements(null);
    setHistory({ items: [], next: null });
    setMovementTrail([]);
    setHistoryTrail([]);
    movementCursor.current = null;
    historyCursor.current = null;
    if (unitId) opener.current = document.activeElement as HTMLElement;
  }, [unitId]);
  async function load(
    kind: "both" | "movements" | "history" = "both",
    after: string | null = null,
    trail: (string | null)[] = [],
  ) {
    if (!unitId || executing.current || fixed) return;
    const id = unitId,
      g = generation.current,
      c = new AbortController();
    readController.current?.abort();
    readController.current = c;
    reading.current = true;
    setLoading(true);
    setError("");
    setCurrent(null);
    setRecord(null);
    // Do not leave stale visible pages actionable after a failed read.
    if (kind !== "history") setMovements(null);
    if (kind !== "movements") setHistory({ items: [], next: null });
    try {
      const scope = await authority(id, c.signal),
        path = `/api/stock/${encodeURIComponent(id)}`;
      if (kind !== "history") {
        const m = validateMovements(
          await request(
            `/api/stock/history?unitId=${encodeURIComponent(id)}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
            { signal: c.signal },
          ),
          scope,
        );
        ensure(live(g, c));
        setMovements(m);
        movementCursor.current = after;
        setMovementTrail(trail);
      }
      if (kind !== "movements") {
        const h = await validatePage(
          await request(
            `${path}/quantity-corrections${after ? `?after=${encodeURIComponent(after)}` : ""}`,
            { signal: c.signal },
          ),
          scope,
        );
        ensure(live(g, c));
        setHistory(h);
        historyCursor.current = after;
        setHistoryTrail(trail);
        setRecord(
          h.items.find((x) => x.state === "ready") ?? h.items[0] ?? null,
        );
      }
    } catch (e) {
      if (live(g, c))
        setError(
          e instanceof Error ? e.message : "Quantity evidence read failed.",
        );
    } finally {
      if (live(g, c) && readController.current === c) {
        reading.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (unitId && !recovering) void load();
    return () => readController.current?.abort();
  }, [unitId, reload]);
  useEffect(() => {
    if (fixed) heading.current?.focus();
  }, [fixed]);
  async function chooseSource(sourceId: string) {
    if (!unitId || blocked || !movements) return;
    const chosen = movements.items.find((x) => x.id === sourceId);
    if (!chosen || !eligibleSource(chosen, movements.unit.cost)) return;
    const g = generation.current,
      c = new AbortController();
    readController.current?.abort();
    readController.current = c;
    reading.current = true;
    setLoading(true);
    setCurrent(null);
    setError("");
    try {
      const scope = await authority(unitId, c.signal);
      const r = await validateReviewResponse(
        await request(
          `/api/stock/${encodeURIComponent(unitId)}/quantity-review?sourceMovementId=${encodeURIComponent(sourceId)}`,
          { signal: c.signal },
        ),
        scope,
      );
      const { org_id, unit_id, ...source } = r.review.source;
      ensure(
        r.review.source.id === sourceId &&
          canonical(source) === canonical(chosen),
        "Selected source evidence changed. Refresh movement history.",
      );
      ensure(live(g, c));
      setCurrent(r);
    } catch (e) {
      if (live(g, c))
        setError(
          e instanceof Error ? e.message : "Quantity review read failed.",
        );
    } finally {
      if (live(g, c)) {
        reading.current = false;
        setLoading(false);
      }
    }
  }
  async function review(
    kind: QuantityAttempt["kind"],
    payload: unknown,
    snapshot: unknown,
  ) {
    if (!unitId || blocked) return;
    const g = generation.current,
      c = new AbortController();
    readController.current?.abort();
    readController.current = c;
    reading.current = true;
    setLoading(true);
    setError("");
    try {
      const scope = await authority(unitId, c.signal);
      if (kind === "prepare") await validateReviewRead(snapshot, scope);
      else await validateRecord(snapshot, scope);
      const body = {
        version: 1 as const,
        key: crypto.randomUUID(),
        orgId,
        actorId,
        unitId,
        kind,
        payload,
        snapshot,
      };
      const a = await validateAttempt(
        { ...body, fingerprint: await hash(body) },
        orgId,
        actorId,
      );
      ensure(
        (await readAttempt(storageKey, orgId, actorId)) === null,
        "Recover the retained quantity attempt first.",
      );
      ensure(live(g, c));
      reviewOpener.current = document.activeElement as HTMLElement;
      setFixed(a);
    } catch (e) {
      if (live(g, c))
        setError(e instanceof Error ? e.message : "Quantity review failed.");
    } finally {
      if (live(g, c)) {
        reading.current = false;
        setLoading(false);
      }
    }
  }
  async function confirm(a: QuantityAttempt) {
    if (executing.current || storageError || !storageReady) return;
    const g = generation.current,
      c = new AbortController();
    writeController.current = c;
    executing.current = true;
    let persisted = false;
    setBusy(true);
    setError("");
    try {
      ensure(
        navigator.locks,
        "Use a browser with Web Locks to coordinate quantity commands between tabs.",
      );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          ensure(
            lock,
            "Another tab is submitting quantity evidence. Wait for its outcome.",
          );
          await validateAttempt(a, orgId, actorId);
          ensure(live(g, c));
          const old = await readAttempt(storageKey, orgId, actorId);
          ensure(
            !old || canonical(old) === canonical(a),
            "Another exact quantity attempt is retained. Recover it first.",
          );
          if (!old) localStorage.setItem(storageKey, JSON.stringify(a));
          ensure(
            canonical(await readAttempt(storageKey, orgId, actorId)) ===
              canonical(a),
          );
          ensure(live(g, c));
          persisted = true;
          setRetained(a);
          const scope = await authority(a.unitId, c.signal);
          if (a.kind === "prepare") await validateReviewRead(a.snapshot, scope);
          else await validateRecord(a.snapshot, scope);
          let reply: unknown;
          if (a.kind === "decide") {
            const actual = await validateRecord(
              await request(
                `/api/stock/quantity-corrections/${encodeURIComponent(a.payload.correctionId)}`,
                { signal: c.signal },
              ),
              scope,
            );
            ensure(
              canonical(immutableRecord(actual)) ===
                canonical(immutableRecord(a.snapshot)),
              "Prepared quantity identity changed. Reconcile the retained attempt.",
            );
            if (actual.state !== "ready") reply = actual;
            else ensure(canonical(actual) === canonical(a.snapshot));
          }
          // Storage/authority waits never grant a late or substituted write.
          ensure(live(g, c));
          ensure(
            canonical(await readAttempt(storageKey, orgId, actorId)) ===
              canonical(a),
          );
          if (!reply)
            reply = await request(
              `/api/commands/inventory.quantity.${a.kind}`,
              {
                method: "POST",
                signal: c.signal,
                headers: { "idempotency-key": a.key },
                body: JSON.stringify(a.payload),
              },
            );
          // Preparation replay may return a stale ready receipt; fresh read preserves the current record.
          const observed = await validateReply(reply, a, scope);
          ensure(live(g, c));
          const actual = await validateRecord(
            await request(
              `/api/stock/quantity-corrections/${encodeURIComponent(observed.id)}`,
              { signal: c.signal },
            ),
            scope,
          );
          ensure(
            canonical(immutableRecord(actual)) ===
              canonical(immutableRecord(observed)) &&
              !(
                observed.state !== "ready" &&
                canonical(actual) !== canonical(observed)
              ),
            "Quantity receipt identity or decided state changed.",
          );
          await validateReply(actual, a, scope);
          ensure(live(g, c));
          setResult(actual);
          setNotice(
            `Saved quantity correction ${actual.reference}: ${actual.state}.`,
          );
          ensure(
            canonical(await readAttempt(storageKey, orgId, actorId)) ===
              canonical(a),
          );
          localStorage.removeItem(storageKey);
          ensure(localStorage.getItem(storageKey) === null);
          ensure(live(g, c));
          try {
            await saved(c.signal);
            ensure(live(g, c));
          } catch (e) {
            if (live(g, c))
              setNotice(
                `Saved quantity correction ${actual.reference}: ${actual.state}. Stock refresh failed; refresh current stock and history before further work.`,
              );
          }
          // Keep the selected/recovered unit stable until stock refresh finishes.
          // Clearing it earlier aborts this command's own refresh controller.
          if (live(g, c)) {
            setRetained(null);
            setFixed(null);
            setRecovering(false);
            setForm(empty);
            setCurrent(null);
            setRecord(actual);
            setReload((x) => x + 1);
            reviewOpener.current?.focus();
          }
        },
      );
    } catch (e) {
      if (live(g, c)) {
        setError(
          e instanceof Error
            ? e.message
            : "Quantity reply is uncertain. Recover the exact attempt.",
        );
        try {
          const pending = await readAttempt(storageKey, orgId, actorId);
          setRetained(pending);
          if (persisted && !pending) setStorageError(recoveryError);
        } catch {
          setStorageError(recoveryError);
        }
      }
    } finally {
      if (live(g, c)) {
        executing.current = false;
        setBusy(false);
      }
    }
  }
  async function openRecovery() {
    if (!retained || busy || loading || storageError) return;
    const g = generation.current,
      c = new AbortController();
    readController.current?.abort();
    readController.current = c;
    reading.current = true;
    setLoading(true);
    setError("");
    try {
      const scope = await authority(retained.unitId, c.signal);
      if (retained.kind === "prepare")
        await validateReviewRead(retained.snapshot, scope);
      else await validateRecord(retained.snapshot, scope);
      ensure(
        canonical(await readAttempt(storageKey, orgId, actorId)) ===
          canonical(retained),
      );
      ensure(live(g, c));
      reviewOpener.current = document.activeElement as HTMLElement;
      setCurrent(null);
      setRecord(null);
      setRecovering(true);
      setFixed(retained);
    } catch (e) {
      if (live(g, c)) setError(e instanceof Error ? e.message : recoveryError);
    } finally {
      if (live(g, c)) {
        reading.current = false;
        setLoading(false);
      }
    }
  }
  const dismiss = () => {
    generation.current++;
    readController.current?.abort();
    writeController.current?.abort();
    executing.current = false;
    reading.current = false;
    setBusy(false);
    setLoading(false);
    setFixed(null);
    setRecovering(false);
    close();
    opener.current?.focus();
  };
  const blocked =
    !storageReady || !!storageError || !!retained || !!fixed || busy || loading;
  const input = (
    label: string,
    name: keyof typeof empty,
    type = "text",
    maxLength = 2000,
  ) => (
    <label>
      {label}
      <input
        required
        type={type}
        maxLength={maxLength}
        min={name === "targetQuantity" ? current?.review.reserved : undefined}
        max={name === "targetQuantity" ? 100000 : undefined}
        step={name === "targetQuantity" ? 1 : undefined}
        value={form[name]}
        onChange={(e) => setForm((v) => ({ ...v, [name]: e.target.value }))}
      />
    </label>
  );
  return (
    <>
      {storageError && <p role="alert">{storageError}</p>}
      {!selection && !recovering && error && <p role="alert">{error}</p>}
      {!selection && !recovering && loading && (
        <p role="status">Checking current quantity recovery authority…</p>
      )}
      {retained && !fixed && (
        <button disabled={busy || loading} onClick={() => void openRecovery()}>
          Recover exact quantity attempt
        </button>
      )}
      {!selection && !recovering && result && (
        <section aria-label="Saved quantity result">
          <p role="status">{notice}</p>
          <RecordResult value={result} />
        </section>
      )}
      {(selection || recovering) && (
        <section
          aria-label="Stock quantity correction"
          className="stock-valuation"
        >
          <h2>Stock quantity correction</h2>
          <p>
            {selection?.product ?? "Retained stock"} · {unitId}
          </p>
          <button onClick={dismiss}>Close quantity correction</button>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {result && <RecordResult value={result} />}
          {loading && <p role="status">Reading current quantity evidence…</p>}
          {!fixed && (
            <button disabled={busy || loading} onClick={() => void load()}>
              Refresh quantity evidence
            </button>
          )}
          {fixed ? (
            <section aria-label="Exact quantity review">
              <h3 ref={heading} tabIndex={-1}>
                Confirm exact quantity{" "}
                {fixed.kind === "prepare" ? "correction" : "decision"}
              </h3>
              <p>
                Organization {orgId} · Principal {actorId} · Key {fixed.key}
              </p>
              <QuantityEvidence
                value={
                  fixed.kind === "prepare"
                    ? fixed.snapshot.review
                    : fixed.snapshot.review
                }
              />
              <QuantityInput
                value={
                  fixed.kind === "prepare"
                    ? fixed.payload
                    : fixed.snapshot.input
                }
              />
              {fixed.kind === "decide" && (
                <p>
                  Record {fixed.snapshot.id} · Prepared by{" "}
                  {fixed.snapshot.createdBy} · {fixed.payload.decision}:{" "}
                  {fixed.payload.reason}
                </p>
              )}
              <p>
                The original source movement and acquisition cost are preserved.
                Approval creates a separate quantity.correction movement and
                accounting effect.
              </p>
              <button
                disabled={busy || !!storageError}
                onClick={() => void confirm(fixed)}
              >
                Confirm exact quantity
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setFixed(null);
                  reviewOpener.current?.focus();
                }}
              >
                Back to quantity
              </button>
            </section>
          ) : (
            <>
              <section aria-label="Quantity source movements">
                <h3>Select original source movement</h3>
                <p>
                  Choose an eligible nonzero receipt, opening, count or quantity
                  correction with matching original unit cost. Configure
                  policies in Stock valuation.
                </p>
                {movements?.items
                  .filter((m) => eligibleSource(m, movements.unit.cost))
                  .map((m) => (
                    <button
                      key={m.id}
                      disabled={blocked}
                      onClick={() => void chooseSource(m.id)}
                    >
                      Source {m.type} · {m.reference} · {m.id} · {m.quantity}
                    </button>
                  ))}
                <button
                  disabled={blocked || !movementTrail.length}
                  onClick={() =>
                    void load(
                      "movements",
                      movementTrail.at(-1)!,
                      movementTrail.slice(0, -1),
                    )
                  }
                >
                  Newer source movements
                </button>
                <button
                  disabled={
                    blocked ||
                    !movements?.next ||
                    movementTrail.includes(movements.next)
                  }
                  onClick={() =>
                    void load("movements", movements!.next, [
                      ...movementTrail,
                      movementCursor.current,
                    ])
                  }
                >
                  Older source movements
                </button>
              </section>
              {current && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void review(
                      "prepare",
                      {
                        ...form,
                        targetQuantity:
                          form.targetQuantity.trim() === ""
                            ? NaN
                            : Number(form.targetQuantity),
                        unitId: current.review.unit.id,
                        sourceMovementId: current.review.source.id,
                        reviewHash: current.reviewHash,
                      } satisfies QuantityCorrectionInput,
                      current,
                    );
                  }}
                >
                  <h3>Prepare quantity correction</h3>
                  <QuantityEvidence value={current.review} />
                  <fieldset disabled={blocked}>
                    {input("Quantity reference", "reference", "text", 160)}
                    {input("Target quantity", "targetQuantity", "number")}
                    {input("Posting date", "postingDate", "date")}
                    {input("Quantity reason", "reason", "text", 1000)}
                    {input("Physical evidence", "physicalEvidence")}
                    {input("Accountant evidence", "accountantEvidence")}
                    <button>Review quantity correction</button>
                  </fieldset>
                </form>
              )}
              <section aria-label="Quantity correction history">
                <h3>Quantity correction history</h3>
                {history.items.map((v) => (
                  <button
                    disabled={blocked}
                    key={v.id}
                    onClick={() => setRecord(v)}
                  >
                    {v.reference} · {v.state}
                  </button>
                ))}
                <button
                  disabled={blocked || !historyTrail.length}
                  onClick={() =>
                    void load(
                      "history",
                      historyTrail.at(-1)!,
                      historyTrail.slice(0, -1),
                    )
                  }
                >
                  Newer quantity corrections
                </button>
                <button
                  disabled={
                    blocked ||
                    !history.next ||
                    historyTrail.includes(history.next)
                  }
                  onClick={() =>
                    void load("history", history.next, [
                      ...historyTrail,
                      historyCursor.current,
                    ])
                  }
                >
                  Older quantity corrections
                </button>
                {record && (
                  <>
                    <QuantityEvidence value={record.review} />
                    <QuantityInput value={record.input} />
                    <RecordResult value={record} />
                    {record.state === "ready" && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void review(
                            "decide",
                            {
                              correctionId: record.id,
                              reviewHash: record.reviewHash,
                              decision,
                              reason: decisionReason.trim(),
                            },
                            record,
                          );
                        }}
                      >
                        <fieldset
                          disabled={blocked || record.createdBy === actorId}
                        >
                          <label>
                            Quantity decision
                            <select
                              aria-label="Quantity decision"
                              value={decision}
                              onChange={(e) =>
                                setDecision(
                                  e.target.value as "approve" | "reject",
                                )
                              }
                            >
                              <option value="approve">Approve</option>
                              <option value="reject">Reject</option>
                            </select>
                          </label>
                          <label>
                            Decision reason
                            <input
                              required
                              maxLength={2000}
                              value={decisionReason}
                              onChange={(e) =>
                                setDecisionReason(e.target.value)
                              }
                            />
                          </label>
                          <button>Review quantity decision</button>
                        </fieldset>
                        {record.createdBy === actorId && (
                          <p>
                            A different current finance principal must approve
                            or reject this correction.
                          </p>
                        )}
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
function QuantityEvidence({ value: r }: { value: ReviewRead["review"] }) {
  return (
    <div>
      <p>
        {r.orgId} · {r.region} · {r.currency} · Unit {r.unit.id} · Product{" "}
        {r.unit.product_id} · {r.unit.warehouse_id} / {r.unit.bin} ·{" "}
        {r.unit.condition} / {r.unit.state}
      </p>
      <p>
        Reviewed quantity {r.unit.quantity} · Reserved {r.reserved} · Original
        unit cost {r.unit.cost} · Carrying value {r.carryingValue} · Stock
        revision {r.unit.revision}
      </p>
      <p>
        Source {r.source.id} · {r.source.type} · Quantity {r.source.quantity} ·
        Cost {r.source.unit_cost} · {r.source.warehouse_id} · Reference{" "}
        {r.source.reference} · Reason {r.source.reason} · {r.source.actor_id} ·{" "}
        {r.source.created_at}
      </p>
      <p>
        Policy {r.policy.policyVersion} · Revision {r.policy.revision} ·{" "}
        {r.policy.establishedMethod} · {r.policy.establishedBasis} · Effective{" "}
        {r.policy.effectiveFrom} · Closed through{" "}
        {r.policy.closedThrough ?? "None"}
      </p>
      <p>
        Finance evidence {r.policy.financeEvidence} · Non-interchangeability{" "}
        {r.policy.nonInterchangeableEvidence ?? "None"} · Policy hash{" "}
        {r.policy.policyHash} · Position hash{" "}
        {r.positionHash ?? "Original acquisition layer"}
      </p>
    </div>
  );
}
function QuantityInput({ value: p }: { value: QuantityCorrectionInput }) {
  return (
    <div>
      <p>
        Reference {p.reference} · Target quantity {p.targetQuantity} · Posting
        date {p.postingDate} · Source {p.sourceMovementId} · Review hash{" "}
        {p.reviewHash}
      </p>
      <p>
        Reason {p.reason} · Physical evidence {p.physicalEvidence} · Accountant
        evidence {p.accountantEvidence}
      </p>
    </div>
  );
}
function RecordResult({ value: v }: { value: QuantityCorrection }) {
  return (
    <div>
      <p>
        Record {v.id} · {v.reference} · {v.state} · Prepared by {v.createdBy} ·{" "}
        {v.createdAt}
      </p>
      {v.decision && (
        <p>
          {v.decision.decision} by {v.decision.by} · {v.decision.at} ·{" "}
          {v.decision.reason}
        </p>
      )}
      {v.movement && (
        <p>
          Correction movement {v.movement.id} · Quantity delta{" "}
          {v.movement.quantity} · Value delta {v.valueDelta} minor units
        </p>
      )}
    </div>
  );
}
