import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LedgerChoice,
  LedgerDisclosure,
} from "../server/organization-residency.ts";
import { request, RequestError } from "./api.ts";
import {
  organizationAuthority,
  OrganizationTerms,
  OrganizationStamp,
} from "./organization-quickbooks-authorization.tsx";
import * as evidence from "./organization-revocation-contract.ts";
const endpoint = "/api/quickbooks/organization/revocation";
const statusEndpoint = "/api/quickbooks/organization/authorization";
const metadata = async (signal: AbortSignal) =>
  evidence.summary(await request(statusEndpoint, { signal }));
type Saved = {
  raw: string | null;
  attempt: evidence.Attempt | null;
  error: string;
};
function saved(key: string, orgId: string): Saved {
  try {
    const raw = localStorage.getItem(key);
    return {
      raw,
      attempt: raw === null ? null : evidence.parse(raw, orgId),
      error: "",
    };
  } catch {
    return {
      raw: null,
      attempt: null,
      error:
        "Organization revocation recovery evidence is unavailable. Restore browser storage and reconcile the original receipt before another submission.",
    };
  }
}
export function OrganizationQuickBooksRevocation({ orgId }: { orgId: string }) {
  const key = `distributor:organization-revocation:v1:${orgId}`;
  const [retained, setRetained] = useState(() => saved(key, orgId));
  const [summary, setSummary] = useState<evidence.Summary | null>(null);
  const [review, setReview] = useState<evidence.Attempt | null>(null);
  const [receipt, setReceipt] = useState<evidence.Receipt | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [resolution, setResolution] = useState<
    "" | "provider-confirmed" | "provider-unconfirmed"
  >("");
  const [externalEvidence, setExternalEvidence] = useState("");
  const [receiptIdentifier, setReceiptIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false),
    pending = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const run = useCallback(
    async (
      fn: (signal: AbortSignal, current: () => boolean) => Promise<void>,
    ) => {
      if (!active.current || pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      const current = () =>
        active.current &&
        pending.current === controller &&
        !controller.signal.aborted;
      setBusy(true);
      setError("");
      setConfirmed(false);
      try {
        await fn(controller.signal, current);
      } catch (e) {
        if (current()) {
          setRetained(saved(key, orgId));
          setReview(null);
          setError(
            e instanceof Error
              ? e.message
              : "Organization revocation could not be confirmed.",
          );
        }
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          if (active.current) {
            setBusy(false);
            heading.current?.focus();
          }
        }
      }
    },
    [key, orgId],
  );
  const refresh = useCallback(
    () =>
      run(async (signal, current) => {
        setReview(null);
        setReceipt(null);
        const s = await metadata(signal);
        if (current()) {
          setSummary(s);
          setRetained(saved(key, orgId));
        }
      }),
    [run, key, orgId],
  );
  useEffect(() => {
    active.current = true;
    void refresh();
    const changed = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      pending.current?.abort();
      pending.current = null;
      setBusy(false);
      setReview(null);
      setConfirmed(false);
      setReceipt(null);
      setRetained(saved(key, orgId));
      setError(
        "Recovery evidence changed in another tab. Read the retained original receipt before continuing.",
      );
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      pending.current?.abort();
      pending.current = null;
      window.removeEventListener("storage", changed);
    };
  }, [refresh, key, orgId]);
  const freshRevoke = async (
    signal: AbortSignal,
    original?: evidence.Attempt,
  ) => {
    const s = await metadata(signal);
    evidence.assert(
      s.enabled &&
        s.credentials.state === "ready" &&
        s.credentials.revision > 0,
    );
    const permission = await request<{
      choice: LedgerChoice;
      terms: LedgerDisclosure | null;
      allowed: boolean;
      reason: string | null;
    }>("/api/organization/ledger-residency", { signal });
    const stamp = organizationAuthority(permission, orgId, s.realm);
    evidence.assert(stamp && permission.terms);
    const a: evidence.Attempt = original ?? {
      version: 1,
      orgId,
      bindingId: s.credentials.bindingId,
      kind: "revoke",
      terms: permission.terms,
      payload: {
        receiptId: crypto.randomUUID(),
        revision: s.credentials.revision,
        authority: stamp,
      },
    };
    evidence.assert(
      a.kind === "revoke" &&
        a.bindingId === s.credentials.bindingId &&
        a.payload.revision === s.credentials.revision &&
        evidence.canonical(a.payload.authority) === evidence.canonical(stamp),
    );
    await evidence.validate(a, orgId);
    return { s, a };
  };
  const prepare = () =>
    run(async (signal, current) => {
      const retainedNow = saved(key, orgId);
      evidence.assert(!retainedNow.error && !retainedNow.attempt);
      const { s, a } = await freshRevoke(signal);
      if (current()) {
        setSummary(s);
        setReview(a);
        setReceipt(null);
      }
    });
  const recover = () =>
    run(async (signal, current) => {
      setReview(null);
      setReceipt(null);
      const keep = saved(key, orgId);
      evidence.assert(!keep.error && keep.attempt && keep.raw);
      await evidence.validate(keep.attempt, orgId);
      const s = await metadata(signal);
      evidence.assert(
        s.enabled && s.credentials.bindingId === keep.attempt.bindingId,
      );
      let r: evidence.Receipt;
      try {
        r = evidence.match(
          await request(
            `${endpoint}?receiptId=${encodeURIComponent(keep.attempt.payload.receiptId)}`,
            { signal },
          ),
          keep.attempt,
        );
      } catch (e) {
        if (
          !(e instanceof RequestError) ||
          e.status !== 404 ||
          keep.attempt.kind !== "revoke"
        )
          throw e;
        const original = await freshRevoke(signal, keep.attempt);
        if (current() && localStorage.getItem(key) === keep.raw) {
          setSummary(original.s);
          setRetained(keep);
          setReview(original.a);
          setError(
            "No receipt was found. Review and confirm the exact retained original request; its identifier will be preserved.",
          );
        }
        return;
      }
      if (current() && localStorage.getItem(key) === keep.raw) {
        setSummary(s);
        setRetained(keep);
        setReceipt(r);
        setResolution("");
        setExternalEvidence("");
        if (keep.attempt.kind === "review" && !evidence.terminal(r)) {
          evidence.assert(
            s.enabled &&
              s.credentials.state === "disabled" &&
              s.credentials.revision === keep.attempt.payload.revision,
          );
          setReview(keep.attempt);
        }
      }
    });
  const prepareExternalReview = () =>
    run(async (signal, current) => {
      evidence.assert(resolution && externalEvidence.trim());
      const keep = saved(key, orgId);
      evidence.assert(
        !keep.error && keep.raw && keep.attempt?.kind === "revoke",
      );
      await evidence.validate(keep.attempt, orgId);
      const original = evidence.match(
        await request(
          `${endpoint}?receiptId=${encodeURIComponent(keep.attempt.payload.receiptId)}`,
          { signal },
        ),
        keep.attempt,
      );
      const s = await metadata(signal);
      evidence.assert(
        s.enabled &&
          s.credentials.bindingId === keep.attempt.bindingId &&
          s.realm === original.authority.realm &&
          s.credentials.state === "disabled" &&
          s.credentials.revision >= original.disabledRevision &&
          (original.state === "unknown" ||
            (original.state === "sending" &&
              Date.now() >= original.startedAt + 90_000)),
      );
      const a: evidence.Attempt = {
        version: 1,
        orgId,
        bindingId: keep.attempt.bindingId,
        kind: "review",
        terms: keep.attempt.terms,
        original,
        payload: {
          receiptId: original.id,
          revision: s.credentials.revision,
          resolution,
          evidence: externalEvidence,
        },
      };
      await evidence.validate(a, orgId);
      evidence.assert(localStorage.getItem(key) === keep.raw);
      if (current()) {
        setRetained(keep);
        setSummary(s);
        setReceipt(original);
        setReview(a);
      }
    });
  const readOriginal = () =>
    run(async (signal, current) => {
      const keep = saved(key, orgId);
      evidence.assert(!keep.error && !keep.attempt && keep.raw === null);
      evidence.assert(
        receiptIdentifier.trim() && receiptIdentifier.length <= 128,
      );
      const r = evidence.receipt(
        await request(
          `${endpoint}?receiptId=${encodeURIComponent(receiptIdentifier)}`,
          { signal },
        ),
        orgId,
      );
      evidence.assert(r.id === receiptIdentifier);
      const s = await metadata(signal);
      evidence.assert(
        s.enabled &&
          s.credentials.bindingId === r.bindingId &&
          s.realm === r.authority.realm,
      );
      const terms = await request<LedgerDisclosure>(
        `/api/organization/ledger-disclosures/${encodeURIComponent(r.authority.disclosureId)}`,
        { signal },
      );
      const a: evidence.Attempt = {
        version: 1,
        orgId,
        bindingId: r.bindingId,
        kind: "revoke",
        terms,
        payload: {
          receiptId: r.id,
          revision: r.credentialRevision,
          authority: r.authority,
        },
      };
      await evidence.validate(a, orgId);
      evidence.assert(navigator.locks);
      await navigator.locks.request(
        key,
        { ifAvailable: true },
        async (lock) => {
          signal.throwIfAborted();
          evidence.assert(
            lock && current() && localStorage.getItem(key) === null,
          );
          const raw = JSON.stringify(a);
          evidence.parse(raw, orgId);
          localStorage.setItem(key, raw);
          evidence.assert(localStorage.getItem(key) === raw);
          setRetained({ raw, attempt: a, error: "" });
          setSummary(s);
          setReview(null);
          setReceipt(r);
          setResolution("");
          setExternalEvidence("");
        },
      );
    });
  const submit = () => {
    if (!review || !confirmed) return;
    const a = review,
      expected = retained.raw;
    void run(async (signal, current) => {
      await evidence.validate(a, orgId);
      evidence.assert(navigator.locks);
      await navigator.locks.request(
        key,
        { ifAvailable: true },
        async (lock) => {
          evidence.assert(lock);
          signal.throwIfAborted();
          const keep = saved(key, orgId);
          evidence.assert(
            !keep.error &&
              keep.raw === expected &&
              (!keep.attempt ||
                evidence.canonical(keep.attempt) === evidence.canonical(a) ||
                (keep.attempt.kind === "revoke" &&
                  a.kind === "review" &&
                  evidence.canonical(keep.attempt.terms) ===
                    evidence.canonical(a.terms) &&
                  !!evidence.match(a.original, keep.attempt))),
          );
          const raw = JSON.stringify(a);
          evidence.parse(raw, orgId);
          localStorage.setItem(key, raw);
          evidence.assert(localStorage.getItem(key) === raw);
          if (current()) setRetained({ raw, attempt: a, error: "" });
          signal.throwIfAborted();
          const r = evidence.match(
            await request(
              a.kind === "review" ? `${endpoint}/review` : endpoint,
              {
                method: "POST",
                body: JSON.stringify(a.payload),
                signal,
              },
            ),
            a,
          );
          const s = await metadata(signal);
          evidence.assert(s.enabled && s.credentials.bindingId === a.bindingId);
          evidence.assert(localStorage.getItem(key) === raw);
          if (current()) {
            setReceipt(r);
            setSummary(s);
            setReview(null);
          }
        },
      );
    });
  };
  const acknowledge = () =>
    run(async (_signal, current) => {
      evidence.assert(
        receipt &&
          evidence.terminal(receipt) &&
          retained.attempt &&
          retained.raw &&
          navigator.locks,
      );
      await navigator.locks.request(
        key,
        { ifAvailable: true },
        async (lock) => {
          evidence.assert(lock && localStorage.getItem(key) === retained.raw);
          localStorage.removeItem(key);
          evidence.assert(localStorage.getItem(key) === null);
          if (current()) {
            setRetained({ raw: null, attempt: null, error: "" });
            setReceipt(null);
            setReview(null);
          }
        },
      );
    });
  return (
    <section aria-label="Organization QuickBooks revocation">
      <h2 tabIndex={-1} ref={heading}>
        Organization QuickBooks revocation
      </h2>
      <p>
        Revoke the organization sandbox grant with one explicit provider
        request. Local credentials are disabled first. An uncertain result
        requires receipt recovery and external evidence; it must not be resent.
      </p>
      {summary?.enabled === false && (
        <p>
          Organization provider revocation is disabled. An administrator must
          configure and qualify the separate organization connection.
        </p>
      )}
      {summary?.enabled && (
        <>
          <p>Sandbox company: {summary.realm}</p>
          <p>Binding: {summary.credentials.bindingId}</p>
          <p>
            Current credentials: {summary.credentials.state} — revision{" "}
            {summary.credentials.revision}
          </p>
          <button
            disabled={
              busy ||
              !!retained.error ||
              !!retained.attempt ||
              !!review ||
              summary.credentials.state !== "ready"
            }
            onClick={() => void prepare()}
          >
            Review organization provider revocation
          </button>
          {!retained.attempt && !retained.error && !review && (
            <>
              <label>
                Original organization revocation receipt identifier
                <input
                  maxLength={128}
                  value={receiptIdentifier}
                  disabled={busy}
                  onChange={(e) => setReceiptIdentifier(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !receiptIdentifier.trim()}
                onClick={() => void readOriginal()}
              >
                Read original organization revocation history
              </button>
              <p>
                Use the original identifier when browser evidence is missing.
                This reads history and retains its verified original scope. It
                sends no provider request.
              </p>
            </>
          )}
        </>
      )}
      {retained.attempt && (
        <>
          <p>Retained receipt: {retained.attempt.payload.receiptId}</p>
          <button
            disabled={busy || !!retained.error}
            onClick={() => void recover()}
          >
            Read retained organization revocation receipt
          </button>
        </>
      )}
      {review && (
        <section
          aria-label="Reviewed organization provider revocation"
          className="stock-history"
        >
          <h3>
            {review.kind === "review"
              ? "Reviewed external revocation evidence"
              : "Reviewed organization provider revocation"}
          </h3>
          <p>Binding: {review.bindingId}</p>
          <p>Credential revision: {review.payload.revision}</p>
          <OrganizationStamp
            value={
              review.kind === "revoke"
                ? review.payload.authority
                : review.original.authority
            }
          />
          <OrganizationTerms value={review.terms} />
          {review.kind === "review" ? (
            <>
              <p>Original receipt: {review.original.id}</p>
              <p>External outcome: {review.payload.resolution}</p>
              <p>Evidence reference: {review.payload.evidence}</p>
              <p>
                This records the external outcome for the original receipt. It
                sends no provider request. Credentials remain disabled; restore
                holds require their separate release process.
              </p>
            </>
          ) : (
            <p>
              Disabling local tokens comes before sending this request. Provider
              revocation may affect the entire grant, including other
              applications using it. Confirmation does not reconnect credentials
              or release a restore hold.
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {review.kind === "review"
              ? "I reviewed the external outcome and current disabled revision"
              : "I reviewed this organization, company, revision and provider revocation"}
          </label>
          <div className="actions">
            <button disabled={busy || !confirmed} onClick={submit}>
              {review.kind === "review"
                ? "Record organization revocation evidence"
                : "Revoke organization QuickBooks sandbox"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setReview(null);
                setConfirmed(false);
              }}
            >
              Close organization revocation review
            </button>
          </div>
        </section>
      )}
      {receipt && (
        <section
          aria-label="Organization revocation receipt"
          className="stock-history"
        >
          <h3>Organization revocation receipt</h3>
          <p>Receipt: {receipt.id}</p>
          <OrganizationStamp value={receipt.authority} />
          <p>Original credential revision: {receipt.credentialRevision}</p>
          <p>Disabled credential revision: {receipt.disabledRevision}</p>
          <p>Revocation state: {receipt.state}</p>
          <p>
            Confirmation source: {receipt.confirmationSource ?? "unconfirmed"}
          </p>
          <p>
            Credentials remain disabled. An operator evidence review does not
            establish a provider-response confirmation or release a restore
            hold.
          </p>
          {retained.attempt?.kind === "review" &&
            evidence.terminal(receipt) && (
              <p>
                This is the observed receipt outcome. Receipt lookup does not
                prove that this browser's exact retained evidence reference was
                recorded. Reconcile the retained reference with the audit
                history before acknowledging it.
              </p>
            )}
          {!review &&
            retained.attempt?.kind === "revoke" &&
            (receipt.state === "unknown" || receipt.state === "sending") && (
              <fieldset disabled={busy}>
                <legend>External revocation outcome</legend>
                <label>
                  <input
                    type="radio"
                    name={`${key}:resolution`}
                    checked={resolution === "provider-confirmed"}
                    onChange={() => setResolution("provider-confirmed")}
                  />
                  Provider revocation confirmed by external evidence
                </label>
                <label>
                  <input
                    type="radio"
                    name={`${key}:resolution`}
                    checked={resolution === "provider-unconfirmed"}
                    onChange={() => setResolution("provider-unconfirmed")}
                  />
                  Provider outcome remains unconfirmed
                </label>
                <label>
                  External revocation evidence reference
                  <textarea
                    maxLength={2000}
                    value={externalEvidence}
                    onChange={(e) => setExternalEvidence(e.target.value)}
                  />
                </label>
                <p>
                  An active provider claim must expire before evidence review.
                </p>
                <button
                  disabled={!resolution || !externalEvidence.trim()}
                  onClick={() => void prepareExternalReview()}
                >
                  Review external organization revocation evidence
                </button>
              </fieldset>
            )}
          {evidence.terminal(receipt) && (
            <button disabled={busy} onClick={() => void acknowledge()}>
              Acknowledge terminal organization revocation receipt
            </button>
          )}
        </section>
      )}
      {retained.error && <p role="alert">{retained.error}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Checking organization revocation evidence…</p>}
      <button disabled={busy} onClick={() => void refresh()}>
        Check organization revocation configuration
      </button>
    </section>
  );
}
