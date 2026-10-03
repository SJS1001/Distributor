import React, { useEffect, useRef, useState } from "react";
import type {
  StockJournalDelivery,
  JournalDeliveryInput,
} from "../server/stock-journal-delivery.ts";
import { request, RequestError } from "./api.ts";

type Source = ReturnType<StockJournalDelivery["preparationReview"]>;
type Attempt = { key: string; source: Source; payload: JournalDeliveryInput };
const moneyFormatters = {
  CAD: new Intl.NumberFormat("en", { style: "currency", currency: "CAD" }),
  USD: new Intl.NumberFormat("en", { style: "currency", currency: "USD" }),
};
const storageError =
  "Journal preparation recovery evidence is unavailable. Restore browser storage and investigate the original attempt before preparing another journal.";
const nonempty = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const numeric = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9][0-9]{0,29}$/.test(v);
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 1;
const exactKeys = (v: object, expected: string) =>
  Object.keys(v).sort().join() === expected;
const canonical = (v: any): string =>
  JSON.stringify(v, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
function validSource(s: Source, orgId: string) {
  const a = s?.authority;
  if (
    !s ||
    !exactKeys(
      s,
      "approvedAt,approvedBy,attemptId,authority,closedThrough,currency,dates,establishedValuation,leg,lines,policyHash,policyRevision,postingDate,region,sourceAccounts,sourceHash,sourceId",
    ) ||
    !nonempty(s.sourceId, 160) ||
    !hash(s.sourceHash) ||
    !["original", "reversal", "replacement"].includes(s.leg) ||
    !date(s.postingDate) ||
    !(s.attemptId === null || nonempty(s.attemptId, 160)) ||
    (s.leg === "original" && s.attemptId !== null) ||
    !integer(s.policyRevision) ||
    !hash(s.policyHash) ||
    !(
      s.closedThrough === null ||
      (date(s.closedThrough) && s.postingDate > s.closedThrough)
    ) ||
    !nonempty(s.establishedValuation, 2000) ||
    !nonempty(s.approvedBy, 160) ||
    !nonempty(s.approvedAt, 100) ||
    !["CA", "US"].includes(s.region) ||
    s.currency !== (s.region === "CA" ? "CAD" : "USD") ||
    !a ||
    !exactKeys(
      a,
      "disclosureHash,disclosureId,environment,orgId,provider,purpose,realm,region,revision",
    ) ||
    a.orgId !== orgId ||
    a.region !== s.region ||
    a.provider !== "quickbooks" ||
    a.purpose !== "stock-cost-journal" ||
    a.environment !== "sandbox" ||
    !(typeof a.realm === "string" && /^[1-9][0-9]{0,39}$/.test(a.realm)) ||
    !integer(a.revision) ||
    !nonempty(a.disclosureId, 160) ||
    !hash(a.disclosureHash) ||
    !Array.isArray(s.dates) ||
    s.dates.length === 0 ||
    s.dates.length > 20000 ||
    !s.dates.every(date) ||
    !s.dates.includes(s.postingDate) ||
    !Array.isArray(s.lines) ||
    s.lines.length === 0 ||
    s.lines.length > 1000 ||
    !Array.isArray(s.sourceAccounts) ||
    s.sourceAccounts.length === 0 ||
    s.sourceAccounts.length > 30 ||
    !s.sourceAccounts.every((v) => nonempty(v, 160))
  )
    return false;
  let debit = 0n,
    credit = 0n;
  for (const line of s.lines) {
    if (
      !line ||
      !exactKeys(line, "account,credit,date,debit,movementId,sequence") ||
      !nonempty(line.movementId, 160) ||
      !integer(line.sequence) ||
      line.date !== s.postingDate ||
      !nonempty(line.account, 160) ||
      !Number.isSafeInteger(line.debit) ||
      !Number.isSafeInteger(line.credit) ||
      line.debit < 0 ||
      line.credit < 0 ||
      line.debit > 1_000_000_000_000 ||
      line.credit > 1_000_000_000_000 ||
      line.debit > 0 === line.credit > 0
    )
      return false;
    debit += BigInt(line.debit);
    credit += BigInt(line.credit);
  }
  return (
    debit > 0n &&
    debit === credit &&
    debit <= BigInt(Number.MAX_SAFE_INTEGER) &&
    canonical(s.sourceAccounts) ===
      canonical([...new Set(s.lines.map((line) => line.account))].sort())
  );
}
function parse(raw: string, orgId: string): Attempt {
  if (raw.length > 1_048_576) throw Error(storageError);
  const a = JSON.parse(raw) as Attempt,
    p = a?.payload,
    s = a?.source;
  if (
    !a ||
    !exactKeys(a, "key,payload,source") ||
    !nonempty(a.key, 36) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      a.key,
    ) ||
    !validSource(s, orgId) ||
    !p ||
    !exactKeys(
      p,
      "accounts,attemptId,authority,bindingId,leg,policyRevision,postingDate,realm,reason,sourceHash,sourceId",
    ) ||
    p.sourceId !== s.sourceId ||
    p.sourceHash !== s.sourceHash ||
    p.leg !== s.leg ||
    p.postingDate !== s.postingDate ||
    p.attemptId !== s.attemptId ||
    p.policyRevision !== s.policyRevision ||
    canonical(p.authority) !== canonical(s.authority) ||
    p.realm !== s.authority.realm ||
    !nonempty(p.bindingId, 160) ||
    !nonempty(p.reason, 2000) ||
    !Array.isArray(p.accounts) ||
    p.accounts.length !== s.sourceAccounts.length ||
    !p.accounts.every(
      (v, index) =>
        v &&
        exactKeys(v, "accountId,sourceAccount") &&
        v.sourceAccount === s.sourceAccounts[index] &&
        numeric(v.accountId),
    ) ||
    new Set(p.accounts.map((v) => v.accountId)).size !== p.accounts.length
  )
    throw Error(storageError);
  return a;
}
function retained(storageKey: string, orgId: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    return { attempt: raw === null ? null : parse(raw, orgId), error: "" };
  } catch {
    return { attempt: null, error: storageError };
  }
}
async function sha(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
async function validReply(value: any, attempt: Attempt, actorId: string) {
  const { payload, source } = attempt,
    intent = value?.plan?.intent;
  if (
    !value ||
    !nonempty(value.id, 160) ||
    value.createdBy !== actorId ||
    !nonempty(value.createdAt, 100) ||
    value.state !== "ready" ||
    !/^DJ-[a-f0-9]{18}$/.test(value.requestRef ?? "") ||
    !hash(value.reviewHash) ||
    canonical(value.plan?.input) !== canonical(payload) ||
    value.plan?.policyHash !== source.policyHash ||
    !intent ||
    intent.version !== 1 ||
    intent.organizationId !== source.authority.orgId ||
    intent.realmId !== payload.realm ||
    intent.leg !== payload.leg ||
    intent.postingDate !== payload.postingDate ||
    intent.closedThrough !== source.closedThrough ||
    canonical(intent.accounts) !== canonical(payload.accounts) ||
    intent.source?.hash !== source.sourceHash ||
    typeof intent.source.bytes !== "string" ||
    intent.source.bytes.length > 2_097_152 ||
    ![
      "sourceId",
      "sourceHash",
      "leg",
      "postingDate",
      "attemptId",
      "bindingId",
      "realm",
    ].every((k) => value[k] === (payload as any)[k])
  )
    return false;
  const document = JSON.parse(intent.source.bytes),
    lines =
      payload.leg === "original"
        ? document.report?.journal
        : document[payload.leg];
  return (
    document.currency === source.currency &&
    document.region === source.region &&
    document.reviewedBy === source.approvedBy &&
    document.reviewedAt === source.approvedAt &&
    Array.isArray(lines) &&
    canonical(
      lines.filter((line: any) => line.date === payload.postingDate),
    ) === canonical(source.lines) &&
    (await sha(intent.source.bytes)) === source.sourceHash &&
    (await sha(canonical(value.plan))) === value.reviewHash
  );
}

export function StockJournalPreparation({
  orgId,
  actorId,
  saved,
}: {
  orgId: string;
  actorId: string;
  saved: (id: string) => void;
}) {
  const storageKey = `distributor-journal-preparation:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey, orgId)),
    [source, setSource] = useState<Source | null>(null),
    [review, setReview] = useState<Attempt | null>(null),
    [replaying, setReplaying] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null),
    active = useRef(true),
    heading = useRef<HTMLHeadingElement>(null),
    opener = useRef<HTMLElement | null>(null),
    sourceButton = useRef<HTMLButtonElement>(null),
    restoreFocus = useRef(false),
    retry = useRef<(() => void) | null>(null);
  useEffect(() => {
    active.current = true;
    const changed = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null)
        setRecovery(retained(storageKey, orgId));
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      pending.current?.abort();
      pending.current = null;
      window.removeEventListener("storage", changed);
    };
  }, [storageKey, orgId]);
  useEffect(() => {
    if (source || review) heading.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      (opener.current?.isConnected
        ? opener.current
        : sourceButton.current
      )?.focus();
    }
  }, [source, review]);
  const load = async (
    sourceId: string,
    leg: JournalDeliveryInput["leg"],
    postingDate?: string,
  ) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    retry.current = () => load(sourceId, leg, postingDate);
    const current = () =>
      active.current &&
      pending.current === controller &&
      !controller.signal.aborted;
    setBusy(true);
    setSource(null);
    setError("");
    setNotice("");
    try {
      const query = new URLSearchParams({
          leg,
          ...(postingDate ? { postingDate } : {}),
        }),
        result = await request<Source>(
          `/api/accounting/journal-sources/${encodeURIComponent(sourceId)}?${query}`,
          { signal: controller.signal },
        );
      if (
        !validSource(result, orgId) ||
        result.sourceId !== sourceId ||
        result.leg !== leg ||
        (postingDate && result.postingDate !== postingDate)
      )
        throw Error(
          "Approved source review could not be confirmed. Retry the source read.",
        );
      if (current()) setSource(result);
    } catch (e) {
      if (current())
        setError(e instanceof Error ? e.message : "Source review unavailable.");
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  const close = () => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setReview(null);
    setSource(null);
    setError("");
    retry.current = null;
    restoreFocus.current = true;
  };
  const submit = async () => {
    if (!review || pending.current) return;
    const input = review,
      recovering = replaying,
      controller = new AbortController();
    pending.current = controller;
    const current = () =>
      active.current &&
      pending.current === controller &&
      !controller.signal.aborted;
    setBusy(true);
    setError("");
    retry.current = null;
    try {
      if (!navigator.locks)
        throw Error(
          "This browser cannot coordinate journal preparations between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!current()) return;
          if (!lock)
            throw Error(
              "Another tab is preparing a journal. Wait for its outcome before retrying.",
            );
          const previous = retained(storageKey, orgId);
          if (previous.error) throw Error(previous.error);
          if (
            recovering
              ? canonical(previous.attempt) !== canonical(input)
              : !!previous.attempt
          )
            throw Error(
              "Journal recovery evidence changed. Close this review and review the retained original preparation.",
            );
          const raw = JSON.stringify(input);
          parse(raw, orgId);
          localStorage.setItem(storageKey, raw);
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "The exact preparation could not be retained. Nothing was sent.",
            );
          if (current()) {
            setRecovery({ attempt: input, error: "" });
            setReplaying(true);
          }
          controller.signal.throwIfAborted();
          const clear = () => {
            if (localStorage.getItem(storageKey) !== raw)
              throw Error(
                "Journal recovery evidence changed. The retained preparation has been preserved.",
              );
            localStorage.removeItem(storageKey);
            if (localStorage.getItem(storageKey) !== null)
              throw Error(
                "Preparation recovery evidence could not be cleared. Recover the retained exact preparation after restoring browser storage.",
              );
          };
          let result: any = null,
            currentState = "ready";
          if (recovering) {
            try {
              const recovered = await request(
                `/api/accounting/journal-preparations/${encodeURIComponent(input.key)}/receipt`,
                { signal: controller.signal },
              );
              if (
                !recovered ||
                !exactKeys(recovered, "currentState,receipt") ||
                !recovered.receipt ||
                typeof recovered.receipt !== "object" ||
                ![
                  "ready",
                  "rejected",
                  "pending",
                  "running",
                  "unknown",
                  "posted",
                  "cancelled",
                ].includes(recovered.currentState)
              )
                throw Error(
                  "Preparation recovery reply could not be confirmed. Keep the retained original attempt.",
                );
              result = recovered.receipt;
              currentState = recovered.currentState;
            } catch (e) {
              if (!(
                e instanceof RequestError &&
                e.code === "NOT_FOUND" &&
                e.status === 404
              ))
                throw e;
            }
          }
          if (result === null) {
            try {
              result = await request(
                "/api/commands/accounting.journal.prepare",
                {
                  signal: controller.signal,
                  method: "POST",
                  headers: { "idempotency-key": input.key },
                  body: JSON.stringify(input.payload),
                },
              );
            } catch (e) {
              // This conflict is raised only after the native receipt lookup and
              // inside the serialized new-command transaction. Authority/period
              // refusals can precede cached lookup and must remain retained.
              if (
                e instanceof RequestError &&
                e.code === "JOURNAL_DUPLICATE" &&
                current()
              ) {
                clear();
                setRecovery({ attempt: null, error: "" });
                setReview(null);
              }
              throw e;
            }
          }
          if (!(await validReply(result, input, actorId)))
            throw Error(
              "Preparation reply could not be confirmed. Recover the retained exact preparation.",
            );
          controller.signal.throwIfAborted();
          clear();
          if (current()) {
            setRecovery({ attempt: null, error: "" });
            setReview(null);
            setSource(null);
            setNotice(
              `Journal preparation confirmed. Current state: ${currentState}. A different finance reviewer must decide it; no provider delivery was requested.`,
            );
            saved(result.id);
          }
        },
      );
    } catch (e) {
      if (current()) {
        setRecovery(retained(storageKey, orgId));
        setError(
          e instanceof Error
            ? e.message
            : "Preparation could not be confirmed.",
        );
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  const selected = review?.source ?? source,
    money = (value: number) =>
      moneyFormatters[selected?.currency === "USD" ? "USD" : "CAD"].format(
        value / 100,
      );
  return (
    <section aria-label="Prepare stock journal">
      <h3>Prepare stock journal</h3>
      <p>
        Select an approved stock-cost packet or correction. Review one unchanged
        source date and map each source account to a distinct QuickBooks sandbox
        account. Creation retains a local review; company credentials,
        independent approval and delivery are separate steps.
      </p>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && (
        <p role="status">
          {review
            ? "Confirming journal preparation…"
            : "Loading approved journal source…"}
        </p>
      )}
      {retry.current && error && (
        <button disabled={busy} onClick={() => retry.current?.()}>
          Retry journal source read
        </button>
      )}
      {recovery.attempt && !review && (
        <>
          <p role="status">
            An exact journal preparation is retained for this organization and
            principal. Recover it before preparing another journal.
          </p>
          <button
            disabled={busy}
            onClick={(e) => {
              opener.current = e.currentTarget;
              setReview(recovery.attempt);
              setSource(null);
              setReplaying(true);
              setError("");
            }}
          >
            Review retained journal preparation
          </button>
        </>
      )}
      {!review && (
        <form
          aria-label="Select approved journal source"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            opener.current = e.currentTarget.querySelector("button");
            load(
              String(data.get("sourceId")).trim(),
              String(data.get("leg")) as JournalDeliveryInput["leg"],
            );
          }}
        >
          <div className="form-field">
            <label htmlFor="journal-source-id">
              Approved stock-cost source ID
            </label>
            <input
              id="journal-source-id"
              name="sourceId"
              required
              maxLength={160}
              disabled={busy}
            />
          </div>
          <div className="form-field">
            <label htmlFor="journal-source-leg">Source journal leg</label>
            <select id="journal-source-leg" name="leg" disabled={busy}>
              <option value="original">Original approved packet</option>
              <option value="reversal">Correction reversal</option>
              <option value="replacement">Correction replacement</option>
            </select>
          </div>
          <button ref={sourceButton} disabled={busy} type="submit">
            Load approved journal source
          </button>
        </form>
      )}
      {selected && (
        <section
          className="stock-history"
          aria-label={
            review
              ? "Exact journal preparation review"
              : "Approved journal source review"
          }
        >
          <h4 ref={heading} tabIndex={-1}>
            {review
              ? "Exact journal preparation review"
              : "Approved journal source review"}
          </h4>
          <p>
            Source <code>{selected.sourceId}</code> · {selected.leg} ·{" "}
            {selected.postingDate} · {selected.currency} · {selected.region}.
            Source hash <code>{selected.sourceHash}</code>. Approved by{" "}
            {selected.approvedBy} at {selected.approvedAt}. Attempt:{" "}
            {selected.attemptId ?? "initial"}.
          </p>
          <p>
            QuickBooks sandbox company {selected.authority.realm}; permission
            revision {selected.authority.revision}. Accepted terms{" "}
            <code>{selected.authority.disclosureId}</code>, hash{" "}
            <code>{selected.authority.disclosureHash}</code>.
          </p>
          <p>
            Cost policy revision {selected.policyRevision}; hash{" "}
            <code>{selected.policyHash}</code>. Closed through{" "}
            {selected.closedThrough ?? "no date"}. Established valuation:{" "}
            {selected.establishedValuation}.
          </p>
          {!review && (
            <div className="form-field">
              <label htmlFor="journal-source-date">
                Approved journal posting date
              </label>
              <select
                id="journal-source-date"
                value={selected.postingDate}
                disabled={busy}
                onChange={(e) =>
                  load(selected.sourceId, selected.leg, e.currentTarget.value)
                }
              >
                {selected.dates.map((d) => (
                  <option
                    key={d}
                    disabled={
                      selected.closedThrough !== null &&
                      d <= selected.closedThrough
                    }
                  >
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <caption>
                Approved source lines for {selected.postingDate}
              </caption>
              <thead>
                <tr>
                  <th>Movement</th>
                  <th>Source account</th>
                  {review && <th>QuickBooks account</th>}
                  <th>Debit</th>
                  <th>Credit</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.map((line) => (
                  <tr key={`${line.sequence}:${line.account}`}>
                    <td>
                      {line.sequence} · {line.movementId}
                    </td>
                    <td>{line.account}</td>
                    {review && (
                      <td>
                        {
                          review.payload.accounts.find(
                            (a) => a.sourceAccount === line.account,
                          )?.accountId
                        }
                      </td>
                    )}
                    <td>{money(line.debit)}</td>
                    <td>{money(line.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={review ? 3 : 2}>Control totals</th>
                  <td>
                    {money(
                      selected.lines.reduce((n, line) => n + line.debit, 0),
                    )}
                  </td>
                  <td>
                    {money(
                      selected.lines.reduce((n, line) => n + line.credit, 0),
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {review ? (
            <>
              <p>
                Organization credential binding:{" "}
                <code>{review.payload.bindingId}</code>. Reason:{" "}
                {review.payload.reason}. Exact preparation key:{" "}
                <code>{review.key}</code>.
              </p>
              <p>
                {replaying
                  ? "Recovery checks the original committed receipt first. An absent receipt only permits retrying the same exact command under current native controls; it does not prove the earlier request never ran."
                  : "Confirm these fixed source, date, company and account mappings. A different current finance principal must approve or reject the prepared journal."}
              </p>
              <button disabled={busy || !!recovery.error} onClick={submit}>
                {replaying
                  ? "Recover exact journal preparation"
                  : "Confirm journal preparation"}
              </button>
              <button disabled={busy} onClick={close}>
                Close preparation review
              </button>
            </>
          ) : (
            <form
              key={`${selected.sourceHash}:${selected.postingDate}`}
              aria-label="Map journal accounts"
              onSubmit={(e) => {
                e.preventDefault();
                if (recovery.error || recovery.attempt || pending.current)
                  return;
                const data = new FormData(e.currentTarget),
                  accounts = selected.sourceAccounts.map(
                    (sourceAccount, i) => ({
                      sourceAccount,
                      accountId: String(data.get(`account-${i}`)).trim(),
                    }),
                  ),
                  attempt: Attempt = {
                    key: crypto.randomUUID(),
                    source: structuredClone(selected),
                    payload: {
                      sourceId: selected.sourceId,
                      sourceHash: selected.sourceHash,
                      leg: selected.leg,
                      postingDate: selected.postingDate,
                      attemptId: selected.attemptId,
                      bindingId: String(data.get("bindingId")).trim(),
                      realm: selected.authority.realm,
                      policyRevision: selected.policyRevision,
                      authority: selected.authority,
                      accounts,
                      reason: String(data.get("reason")).trim(),
                    },
                  };
                try {
                  parse(JSON.stringify(attempt), orgId);
                  opener.current = e.currentTarget.querySelector("button");
                  setReview(attempt);
                  setReplaying(false);
                  setError("");
                  retry.current = null;
                } catch {
                  setError(
                    "Enter a distinct positive numeric QuickBooks account ID for each source account, a binding ID and a review reason.",
                  );
                }
              }}
            >
              {selected.sourceAccounts.map((account, i) => (
                <div className="form-field" key={account}>
                  <label htmlFor={`journal-account-${i}`}>
                    QuickBooks account for {account}
                  </label>
                  <input
                    id={`journal-account-${i}`}
                    name={`account-${i}`}
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,29}"
                    maxLength={30}
                    required
                    disabled={busy}
                  />
                </div>
              ))}
              <div className="form-field">
                <label htmlFor="journal-binding">
                  Organization credential binding ID
                </label>
                <input
                  id="journal-binding"
                  name="bindingId"
                  required
                  maxLength={160}
                  disabled={busy}
                />
              </div>
              <div className="form-field">
                <label htmlFor="journal-prepare-reason">
                  Journal preparation reason
                </label>
                <textarea
                  id="journal-prepare-reason"
                  name="reason"
                  required
                  maxLength={2000}
                  disabled={busy}
                />
              </div>
              <button
                type="submit"
                disabled={busy || !!recovery.error || !!recovery.attempt}
              >
                Review exact journal preparation
              </button>
              <button type="button" onClick={close}>
                Close source review
              </button>
            </form>
          )}
        </section>
      )}
      {busy && !review && (
        <button onClick={close}>Cancel journal source read</button>
      )}
    </section>
  );
}
