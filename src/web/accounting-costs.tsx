import React, { useEffect, useRef, useState } from "react";
import { command, downloadCostFile, request } from "./api.ts";
import type {
  IntegrationCosts,
  CostPacketView,
  CostInput,
} from "../server/integration-costs.ts";

type Source = ReturnType<IntegrationCosts["source"]>;
type Detail = ReturnType<IntegrationCosts["detail"]>;
const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(n / 100);
const number = (v: FormData, key: string) => {
  const raw = String(v.get(key) ?? "");
  const n = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(n))
    throw Error("Enter exact whole-number cents and counts.");
  return n;
};
const field = (
  label: string,
  name: string,
  numeric = false,
  maxLength = 2000,
) => (
  <div className="form-field">
    <label htmlFor={`stock-cost-${name}`}>{label}</label>
    <input
      id={`stock-cost-${name}`}
      name={name}
      required
      type={numeric ? "number" : "text"}
      min={numeric ? 0 : undefined}
      max={numeric ? Number.MAX_SAFE_INTEGER : undefined}
      step={numeric ? 1 : undefined}
      maxLength={numeric ? undefined : maxLength}
    />
  </div>
);

export function AccountingCosts() {
  const [source, setSource] = useState<Source | null>(null),
    [items, setItems] = useState<CostPacketView[]>([]),
    [next, setNext] = useState<number | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const review = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detail) review.current?.focus();
  }, [detail?.id]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Cost handoff failed. Retry the same evidence.",
      );
    } finally {
      setBusy(false);
    }
  };
  const history = async (before?: number) => {
    const page = await request<ReturnType<IntegrationCosts["list"]>>(
      `/api/accounting/costs?limit=20${before ? `&before=${before}` : ""}`,
    );
    setItems((old) => (before ? [...old, ...page.items] : page.items));
    setNext(page.next);
    setSource((old) =>
      old ? { ...old, recoveryHold: page.recoveryHold } : old,
    );
  };
  const refresh = async () => {
    setSource(await request<Source>("/api/accounting/cost-source"));
    await history();
  };
  const load = async (id: string) => {
    setDetail(
      await request<Detail>(`/api/accounting/costs/${encodeURIComponent(id)}`),
    );
  };
  const submit = (
    event: React.FormEvent<HTMLFormElement>,
    work: (values: FormData) => Promise<unknown>,
  ) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void run(() => work(values));
  };
  const controls = (p: CostPacketView) => (
    <p>
      Opening {money(p.controls.openingValue, p.currency)}; increase{" "}
      {money(p.controls.increase, p.currency)}; decrease{" "}
      {money(p.controls.decrease, p.currency)}; closing{" "}
      {money(p.controls.closingValue, p.currency)}. Journal debit{" "}
      {money(p.controls.debit, p.currency)}, credit{" "}
      {money(p.controls.credit, p.currency)}.
    </p>
  );
  return (
    <section aria-label="Stock cost accounting handoffs">
      <h2>Stock cost accounting handoffs</h2>
      <p>
        Prepare and review an original-cost journal for a regional file
        receiver. Approval freezes the file and advances the stock cutoff.
        Record receiver acceptance separately after verifying its evidence.
        Check for duplicate inventory postings in the receiving ledger.
      </p>
      <button disabled={busy} onClick={() => void run(refresh)}>
        {source ? "Refresh stock cost review" : "Load stock cost review"}
      </button>
      {error && <p role="alert">{error}</p>}
      {source && (
        <>
          {source.recoveryHold && (
            <p role="status">
              Restore hold: cost preparation, decisions and acceptance are
              blocked. Saved reviewed files remain available.
            </p>
          )}
          <p role="status">
            {source.region} · {source.currency} · {source.movements.length}{" "}
            movements after {source.afterSequence}, through{" "}
            {source.throughSequence}
            {source.more ? "; additional movements await the next review" : ""}.
            Opening {money(source.openingValue, source.currency)}, increase{" "}
            {money(source.increase, source.currency)}, decrease{" "}
            {money(source.decrease, source.currency)}, closing{" "}
            {money(source.closingValue, source.currency)}.
          </p>
          <details>
            <summary>Inspect current movement evidence</summary>
            <div className="table-wrap">
              <table>
                <caption>Unreviewed original-cost movements</caption>
                <thead>
                  <tr>
                    {[
                      "Sequence",
                      "Movement",
                      "Unit",
                      "Type",
                      "Quantity",
                      "Unit cost",
                      "Value change",
                      "Reference",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {source.movements.map((m) => (
                    <tr key={m.id}>
                      <td>{m.sequence}</td>
                      <td>{m.id}</td>
                      <td>{m.serial ?? m.unitId}</td>
                      <td>{m.type}</td>
                      <td>{m.quantity}</td>
                      <td>{money(m.unitCost, source.currency)}</td>
                      <td>{money(m.valueDelta, source.currency)}</td>
                      <td>{m.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {source.movements.length > 0 && (
            <form
              aria-label="Prepare stock cost handoff"
              onSubmit={(e) =>
                submit(e, async (v) => {
                  const mappings: unknown = JSON.parse(
                    String(v.get("mappings")),
                  );
                  if (!Array.isArray(mappings))
                    throw Error("Mappings must be a JSON array.");
                  const input: CostInput = {
                    version: 1,
                    batchRef: String(v.get("batchRef")),
                    afterSequence: source.afterSequence,
                    throughSequence: source.throughSequence,
                    inventoryAccount: String(v.get("inventoryAccount")),
                    mappings,
                    expectedMovements: number(v, "expectedMovements"),
                    expectedIncrease: number(v, "expectedIncrease"),
                    expectedDecrease: number(v, "expectedDecrease"),
                    expectedOpeningValue: number(v, "expectedOpeningValue"),
                    expectedClosingValue: number(v, "expectedClosingValue"),
                    acknowledgment: String(v.get("acknowledgment")),
                  };
                  const p: CostPacketView = await command(
                    "accounting.cost.prepare",
                    input,
                  );
                  await load(p.id);
                  await history();
                })
              }
            >
              <h3>Prepare a saved review</h3>
              <p>
                Enter controls from an independently reconciled source. All
                amounts below are whole cents. Map every type with a nonzero
                value change to an explicit offset account. Types in this
                window: {source.byType.map((t) => t.type).join(", ")}.
              </p>
              <fieldset disabled={busy || source.recoveryHold}>
                {field("Cost batch reference", "batchRef", false, 100)}
                {field("Inventory account code", "inventoryAccount", false, 80)}
                <div className="form-field">
                  <label htmlFor="stock-cost-mappings">
                    Offset account mappings (JSON)
                  </label>
                  <textarea
                    id="stock-cost-mappings"
                    name="mappings"
                    required
                    maxLength={10000}
                    defaultValue="[]"
                    placeholder={'[{"type":"receipt","offsetAccount":"2100"}]'}
                  />
                </div>
                {field("Independent movement count", "expectedMovements", true)}
                {field(
                  "Independent cost increase (cents)",
                  "expectedIncrease",
                  true,
                )}
                {field(
                  "Independent cost decrease (cents)",
                  "expectedDecrease",
                  true,
                )}
                {field(
                  "Independent opening stock value (cents)",
                  "expectedOpeningValue",
                  true,
                )}
                {field(
                  "Independent closing stock value (cents)",
                  "expectedClosingValue",
                  true,
                )}
                {field(
                  "Regional receiver and duplicate-posting review evidence",
                  "acknowledgment",
                )}
                <button type="submit">Prepare cost handoff</button>
              </fieldset>
            </form>
          )}
          <div className="table-wrap">
            <table>
              <caption>Saved stock cost handoffs</caption>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>State</th>
                  <th>Cutoff</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.batchRef}</td>
                    <td>{p.state}</td>
                    <td>
                      {p.input.afterSequence}–{p.input.throughSequence}
                    </td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() => void run(() => load(p.id))}
                      >
                        Review {p.batchRef}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length === 0 && <p>No saved cost handoffs.</p>}
          {next !== null && (
            <button
              disabled={busy}
              onClick={() => void run(() => history(next))}
            >
              Load older cost handoffs
            </button>
          )}
        </>
      )}
      {detail && (
        <div
          ref={review}
          role="region"
          tabIndex={-1}
          aria-label="Saved cost review"
        >
          <h3>Saved cost review: {detail.batchRef}</h3>
          <p>
            State: {detail.state} · {detail.region} · {detail.currency} ·{" "}
            {detail.input.expectedMovements} movements · cutoff{" "}
            {detail.input.afterSequence}–{detail.input.throughSequence}.
          </p>
          {controls(detail)}
          <p>
            Review fingerprint:{" "}
            <code style={{ overflowWrap: "anywhere" }}>
              {detail.reviewHash}
            </code>
          </p>
          <p>Review evidence: {detail.input.acknowledgment}</p>
          <details>
            <summary>Saved independent controls and mappings</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(detail.input, null, 2)}
            </pre>
          </details>
          {detail.controls.issues.length > 0 && (
            <ul>
              {detail.controls.issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          )}
          <details>
            <summary>Inspect saved journal and movement evidence</summary>
            <div className="table-wrap">
              <table>
                <caption>Saved original-cost journal</caption>
                <thead>
                  <tr>
                    <th>Sequence</th>
                    <th>Date</th>
                    <th>Movement</th>
                    <th>Account</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.report.journal.map((l, n) => (
                    <tr key={n}>
                      <td>{l.sequence}</td>
                      <td>{l.date}</td>
                      <td>{l.movementId}</td>
                      <td>{l.account}</td>
                      <td>{money(l.debit, detail.currency)}</td>
                      <td>{money(l.credit, detail.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(detail.report.movements, null, 2)}
            </pre>
          </details>
          {["ready", "blocked"].includes(detail.state) && (
            <form
              aria-label="Decide stock cost handoff"
              onSubmit={(e) =>
                submit(e, async (v) => {
                  await command("accounting.cost.decide", {
                    packetId: detail.id,
                    reviewHash: detail.reviewHash,
                    decision: String(v.get("decision")),
                    reason: String(v.get("reason")),
                  });
                  await load(detail.id);
                  await refresh();
                })
              }
            >
              <fieldset disabled={busy || source?.recoveryHold}>
                <div className="form-field">
                  <label htmlFor="stock-cost-decision">
                    Cost review decision
                  </label>
                  <select
                    id="stock-cost-decision"
                    name="decision"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose a decision
                    </option>
                    {detail.state === "ready" && (
                      <option value="approve">Approve saved cost review</option>
                    )}
                    <option value="reject">Reject saved cost review</option>
                  </select>
                </div>
                {field("Cost decision reason", "reason")}
                <button type="submit">Record cost decision</button>
              </fieldset>
            </form>
          )}
          {detail.decisionReason && (
            <p>
              Decision: {detail.decisionReason} · {detail.decisionAt} ·{" "}
              {detail.decisionBy}
            </p>
          )}
          {detail.contentHash && (
            <>
              <p>
                Reviewed file SHA-256:{" "}
                <code style={{ overflowWrap: "anywhere" }}>
                  {detail.contentHash}
                </code>
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    downloadCostFile(detail.id, detail.contentHash!),
                  )
                }
              >
                Download reviewed cost file
              </button>
              {detail.receipt ? (
                <p role="status">
                  Receiver acceptance recorded: {detail.receipt.receiverRef} ·{" "}
                  {detail.receipt.receiverRegion} · {detail.receipt.externalRef}{" "}
                  · debit {money(detail.receipt.debit, detail.currency)}, credit{" "}
                  {money(detail.receipt.credit, detail.currency)} ·{" "}
                  {detail.receipt.reason} · {detail.receipt.recordedAt}. This is
                  recorded operator evidence; external posting remains to be
                  independently qualified.
                </p>
              ) : (
                <form
                  aria-label="Record stock cost receiver acceptance"
                  onSubmit={(e) =>
                    submit(e, async (v) => {
                      await command("accounting.cost.accept", {
                        packetId: detail.id,
                        contentHash: String(v.get("contentHash")),
                        receiverRef: String(v.get("receiverRef")),
                        receiverRegion: String(v.get("receiverRegion")),
                        externalRef: String(v.get("externalRef")),
                        debit: number(v, "debit"),
                        credit: number(v, "credit"),
                        reason: String(v.get("reason")),
                      });
                      await load(detail.id);
                      await history();
                    })
                  }
                >
                  <h4>Record verified receiver acceptance</h4>
                  <p>
                    Confirm the exact downloaded hash, original region and
                    independent receiver totals. No external request is sent by
                    this form.
                  </p>
                  <fieldset disabled={busy || source?.recoveryHold}>
                    {field("Accepted file SHA-256", "contentHash", false, 64)}
                    {field(
                      "Regional ledger receiver reference",
                      "receiverRef",
                      false,
                      100,
                    )}
                    <div className="form-field">
                      <label htmlFor="stock-cost-receiver-region">
                        Receiver region
                      </label>
                      <select
                        id="stock-cost-receiver-region"
                        name="receiverRegion"
                        required
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Choose the receiver region
                        </option>
                        <option value="CA">Canada</option>
                        <option value="US">United States</option>
                      </select>
                    </div>
                    {field(
                      "External acceptance reference",
                      "externalRef",
                      false,
                      160,
                    )}
                    {field(
                      "Independent receiver debit total (cents)",
                      "debit",
                      true,
                    )}
                    {field(
                      "Independent receiver credit total (cents)",
                      "credit",
                      true,
                    )}
                    {field("Receiver acceptance evidence", "reason")}
                    <button type="submit">
                      Record cost receiver acceptance
                    </button>
                  </fieldset>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
