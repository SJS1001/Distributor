import { useEffect, useRef, useState } from "react";
import type {
  LedgerAuthority,
  LedgerChoice,
  LedgerDisclosure,
} from "../server/organization-residency.ts";
import { request, setCsrf } from "./api.ts";

const endpoint = "/api/quickbooks/organization/authorization";
const callbackPath = "/quickbooks/organization/callback";
const receiptKey = "distributor-organization-oauth-attempt";
type Attempt = {
  id: string;
  bindingId: string;
  state: string;
  expiresAt: number;
  credentialRevision: number;
  installedRevision: number | null;
  authority: LedgerAuthority;
};
type Summary =
  | { enabled: false }
  | {
      enabled: true;
      scope: "organization";
      realm: string;
      credentials: { revision: number; state: string };
      attempt: Attempt | null;
    };
type Permission = {
  choice: LedgerChoice;
  terms: LedgerDisclosure | null;
  allowed: boolean;
  reason: string | null;
};
type Review = {
  revision: number;
  realm: string;
  authority: LedgerAuthority;
  permission: Permission;
};

// Memory only; scrub before any application request or StrictMode render.
let callback =
  location.pathname === callbackPath && location.search ? location.href : "";
if (callback) history.replaceState(null, "", callbackPath);
function authority(
  permission: Permission,
  orgId: string,
  realm: string,
): LedgerAuthority | null {
  const { choice: c, terms: d, allowed } = permission;
  if (
    !allowed ||
    !d ||
    c.orgId !== orgId ||
    d.orgId !== orgId ||
    c.provider !== "quickbooks" ||
    d.provider !== "quickbooks" ||
    c.purpose !== "stock-cost-journal" ||
    d.purpose !== "stock-cost-journal" ||
    c.environment !== "sandbox" ||
    d.environment !== "sandbox" ||
    c.mode !== "provider-exception" ||
    c.realm !== realm ||
    !["CA", "US"].includes(c.region) ||
    d.region !== c.region ||
    !Number.isSafeInteger(c.revision) ||
    c.revision < 1 ||
    !c.acceptance ||
    c.acceptance.disclosureId !== d.id ||
    c.acceptance.disclosureHash !== d.hash ||
    !/^[a-f0-9]{64}$/.test(d.hash)
  )
    return null;
  return {
    orgId,
    region: c.region,
    provider: "quickbooks",
    purpose: "stock-cost-journal",
    environment: "sandbox",
    realm,
    revision: c.revision,
    disclosureId: d.id,
    disclosureHash: d.hash,
  };
}
function sameAuthority(a: LedgerAuthority, b: LedgerAuthority) {
  return (
    Object.keys(a).sort().join() ===
      "disclosureHash,disclosureId,environment,orgId,provider,purpose,realm,region,revision" &&
    Object.entries(b).every(
      ([key, value]) => a[key as keyof LedgerAuthority] === value,
    )
  );
}
function Terms({ value: d }: { value: LedgerDisclosure }) {
  return (
    <section aria-label="Organization processing terms">
      <h4>Organization processing terms</h4>
      <p>QuickBooks sandbox · stock-cost-journal · version {d.version}</p>
      <p>Purpose: {d.purposes}</p>
      <p>Minimum data: {d.minimumData.join("; ")}</p>
      <p>Processing countries: {d.processingCountries.join(", ")}</p>
      <p>Subprocessors: {d.subprocessors.join("; ")}</p>
      <p>Retention: {d.retention}</p>
      <p>Withdrawal: {d.withdrawal}</p>
      <p>Terms reference: {d.termsReference}</p>
      <p>Review evidence: {d.reviewEvidence}</p>
      <p>
        Disclosure <code>{d.id}</code> · hash <code>{d.hash}</code>
      </p>
    </section>
  );
}
function Stamp({ value: a }: { value: LedgerAuthority }) {
  return (
    <>
      <p>
        Organization <code>{a.orgId}</code> · Region {a.region} · Sandbox
        company {a.realm}
      </p>
      <p>
        Permission revision {a.revision} · stock-cost-journal · QuickBooks
        sandbox
      </p>
      <p>
        Disclosure <code>{a.disclosureId}</code> · hash{" "}
        <code>{a.disclosureHash}</code>
      </p>
    </>
  );
}
function ConnectionState({
  value: s,
}: {
  value: Extract<Summary, { enabled: true }>;
}) {
  return (
    <>
      <p>
        Sandbox company {s.realm} · Credentials: {s.credentials.state} ·
        Revision {s.credentials.revision}
      </p>
      <p>
        Connection attempt: {s.attempt?.state ?? "No attempt for this login"}
      </p>
      {s.attempt && (
        <p>Expires {new Date(s.attempt.expiresAt).toLocaleString()}</p>
      )}
    </>
  );
}
export function OrganizationQuickBooksConnection({ orgId }: { orgId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null),
    [permission, setPermission] = useState<Permission | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [disconnect, setDisconnect] = useState<{
      realm: string;
      revision: number;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState("");
  const active = useRef(false),
    epoch = useRef(0),
    read = useRef<AbortController | null>(null),
    command = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const load = async () => {
    if (command.current) return;
    setReview(null);
    setDisconnect(null);
    setConfirmed(false);
    read.current?.abort();
    const controller = new AbortController(),
      current = ++epoch.current;
    read.current = controller;
    setBusy(true);
    setError("");
    try {
      const s = await request<Summary>(endpoint, { signal: controller.signal });
      const p = s.enabled
        ? await request<Permission>("/api/organization/ledger-residency", {
            signal: controller.signal,
          })
        : null;
      if (current !== epoch.current) return;
      setSummary(s);
      setPermission(p);
      setUncertain(false);
    } catch (e) {
      if (current === epoch.current && !controller.signal.aborted) {
        setSummary(null);
        setPermission(null);
        setError((e as Error).message);
      }
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      ++epoch.current;
      read.current?.abort();
    };
  }, [orgId]);
  const act = async (action: "begin" | "cancel" | "disconnect") => {
    if (
      !summary?.enabled ||
      busy ||
      uncertain ||
      command.current ||
      (action === "begin" && (!review || !confirmed)) ||
      (action === "disconnect" && !disconnect) ||
      (action === "cancel" && !summary.attempt)
    )
      return;
    command.current = true;
    ++epoch.current;
    read.current?.abort();
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string; authorizationUrl?: string }>(
        `${endpoint}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(
            action === "begin"
              ? { revision: review!.revision, authority: review!.authority }
              : action === "cancel"
                ? { attemptId: summary.attempt!.id }
                : { revision: disconnect!.revision },
          ),
        },
      );
      if (!active.current) return;
      if (action === "begin") {
        const url = new URL(result.authorizationUrl!);
        if (
          url.origin !== "https://appcenter.intuit.com" ||
          url.pathname !== "/connect/oauth2" ||
          url.username ||
          url.password ||
          url.searchParams.get("redirect_uri") !==
            `${location.origin}${callbackPath}`
        )
          throw Error(
            "Authorization address differs. Check organization connection status.",
          );
        // Only an attempt identifier is retained. No code, nonce, URL or token.
        sessionStorage.setItem(receiptKey, result.id);
        if (sessionStorage.getItem(receiptKey) !== result.id)
          throw Error(
            "Original attempt recovery is unavailable. Check organization connection status.",
          );
        location.assign(url.href);
      } else {
        command.current = false;
        await load();
      }
    } catch (e) {
      if (active.current) {
        setReview(null);
        setDisconnect(null);
        setConfirmed(false);
        setUncertain(true);
        setError((e as Error).message);
      }
    } finally {
      command.current = false;
      if (active.current) {
        setBusy(false);
        heading.current?.focus();
      }
    }
  };
  const prospective =
    summary?.enabled && permission
      ? authority(permission, orgId, summary.realm)
      : null;
  return (
    <section aria-label="Organization QuickBooks connection">
      <h2 ref={heading} tabIndex={-1}>
        Organization QuickBooks connection
      </h2>
      {summary?.enabled === false && (
        <p>
          Organization browser connection is disabled. Ask your administrator to
          configure approved organization QuickBooks access.
        </p>
      )}
      {summary?.enabled && (
        <>
          <ConnectionState value={summary} />
          <p>
            This connection belongs to the distributor organization. Review its
            accepted stock-journal processing permission and configured company
            before connecting.
          </p>
          {!prospective && (
            <p>
              Current organization processing permission is unavailable for this
              company. Review the organization residency choice before
              connecting.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              disabled={
                busy ||
                uncertain ||
                !prospective ||
                summary.credentials.state === "refreshing" ||
                !!review
              }
              onClick={() => {
                if (prospective && permission) {
                  setDisconnect(null);
                  setConfirmed(false);
                  setReview({
                    revision: summary.credentials.revision,
                    realm: summary.realm,
                    authority: prospective,
                    permission,
                  });
                }
              }}
            >
              Review organization QuickBooks connection
            </button>
            {summary.attempt &&
              ["pending", "exchanging"].includes(summary.attempt.state) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || uncertain}
                  onClick={() => void act("cancel")}
                >
                  Cancel organization connection attempt
                </button>
              )}
            {!["missing", "disabled"].includes(summary.credentials.state) && (
              <button
                type="button"
                className="secondary"
                disabled={busy || uncertain || !!disconnect}
                onClick={() => {
                  setReview(null);
                  setConfirmed(false);
                  setDisconnect({
                    realm: summary.realm,
                    revision: summary.credentials.revision,
                  });
                }}
              >
                Review local organization disconnect
              </button>
            )}
          </div>
          {review && (
            <section aria-label="Review organization connection">
              <h3>Review organization connection</h3>
              <Stamp value={review.authority} />
              <p>Credential revision {review.revision}</p>
              <p>
                Representative:{" "}
                {review.permission.choice.acceptance!.representative} ·
                Evidence: {review.permission.choice.acceptance!.evidenceRef}
              </p>
              <Terms value={review.permission.terms!} />
              <p>
                A new attempt cancels every pending connection for this
                organization binding. Existing accounting records remain.
                Connection does not send a stock journal.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || uncertain}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed this organization, company and processing permission
              </label>
              <div className="actions">
                <button
                  type="button"
                  disabled={busy || uncertain || !confirmed}
                  onClick={() => void act("begin")}
                >
                  Connect organization QuickBooks sandbox
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setConfirmed(false);
                  }}
                >
                  Cancel organization connection review
                </button>
              </div>
            </section>
          )}
          {disconnect && (
            <section aria-label="Review organization disconnect">
              <h3>Disconnect local organization access</h3>
              <p>
                Remove local credentials for organization <code>{orgId}</code>,
                sandbox company {disconnect.realm}, revision{" "}
                {disconnect.revision}, and cancel all pending connections for
                this binding. Existing accounting records remain. This does not
                revoke access at Intuit or undo requests already sent. Review
                the connected app in Intuit separately to revoke upstream
                access.
              </p>
              <div className="actions">
                <button
                  type="button"
                  disabled={busy || uncertain}
                  onClick={() => void act("disconnect")}
                >
                  Confirm local organization disconnect
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setDisconnect(null)}
                >
                  Keep organization connection
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {uncertain && (
        <p>
          The response was not confirmed. Check status before starting another
          attempt or disconnecting.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Checking organization connection…</p>}
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void load()}
      >
        Check organization connection status
      </button>
    </section>
  );
}
export function OrganizationQuickBooksCallback() {
  const [summary, setSummary] = useState<Summary | null>(null),
    [permission, setPermission] = useState<Permission | null>(null),
    [eligible, setEligible] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [consumed, setConsumed] = useState(!callback),
    [error, setError] = useState("");
  const active = useRef(false),
    epoch = useRef(0),
    read = useRef<AbortController | null>(null),
    command = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const load = async () => {
    if (command.current) return;
    read.current?.abort();
    const controller = new AbortController(),
      current = ++epoch.current;
    read.current = controller;
    setBusy(true);
    setError("");
    setConfirmed(false);
    setEligible(false);
    try {
      const session = await request<{ csrf: string; actor: { orgId: string } }>(
        "/api/session",
        { signal: controller.signal },
      );
      if (current !== epoch.current) return;
      setCsrf(session.csrf);
      const s = await request<Summary>(endpoint, { signal: controller.signal });
      const p = s.enabled
        ? await request<Permission>("/api/organization/ledger-residency", {
            signal: controller.signal,
          })
        : null;
      if (current !== epoch.current) return;
      setSummary(s);
      setPermission(p);
      const a =
        s.enabled && p ? authority(p, session.actor.orgId, s.realm) : null;
      const matches =
        s.enabled && s.attempt && a && sameAuthority(s.attempt.authority, a);
      setEligible(
        !!matches &&
          sessionStorage.getItem(receiptKey) ===
            (s.enabled ? s.attempt?.id : null),
      );
    } catch (e) {
      if (current === epoch.current && !controller.signal.aborted) {
        setSummary(null);
        setPermission(null);
        setError((e as Error).message);
      }
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      ++epoch.current;
      read.current?.abort();
    };
  }, []);
  const complete = async () => {
    if (
      !summary?.enabled ||
      !summary.attempt ||
      !callback ||
      !eligible ||
      !confirmed ||
      busy ||
      command.current
    )
      return;
    command.current = true;
    ++epoch.current;
    read.current?.abort();
    const input = callback;
    callback = "";
    setConsumed(true);
    setConfirmed(false);
    setBusy(true);
    setError("");
    try {
      await request(`${endpoint}/complete`, {
        method: "POST",
        body: JSON.stringify({
          attemptId: summary.attempt.id,
          callbackUrl: input,
        }),
      });
      if (active.current) {
        command.current = false;
        await load();
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      command.current = false;
      if (active.current) {
        setBusy(false);
        heading.current?.focus();
      }
    }
  };
  const pending =
    !consumed &&
    summary?.enabled &&
    summary.attempt?.state === "pending" &&
    summary.attempt.expiresAt > Date.now();
  return (
    <main className="login">
      <section>
        <h1 ref={heading} tabIndex={-1}>
          Organization QuickBooks connection result
        </h1>
        <p>
          Use the same Distributor login and browser tab that started this
          connection. Confirm the reviewed organization and sandbox company
          before finishing.
        </p>
        {summary?.enabled && (
          <>
            <ConnectionState value={summary} />
            {summary.attempt && <Stamp value={summary.attempt.authority} />}
            {pending && eligible && permission?.terms && (
              <>
                <Terms value={permission.terms} />
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I confirm the reviewed organization and sandbox company
                </label>
                <button
                  type="button"
                  disabled={busy || !confirmed}
                  onClick={() => void complete()}
                >
                  Finish organization QuickBooks connection
                </button>
              </>
            )}
            {!consumed && !eligible && (
              <p>
                The original attempt or its processing permission is
                unavailable. Check status and return to Billing to review a new
                connection.
              </p>
            )}
          </>
        )}
        {summary?.enabled === false && (
          <p>Organization browser connection is disabled.</p>
        )}
        {consumed && (
          <p>
            This callback cannot be resubmitted. Check status; if the connection
            did not complete, start a new reviewed attempt from Billing.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Checking organization connection…</p>}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Check organization connection result
        </button>
        <p>
          <a href="/">Return to Distributor</a>
        </p>
      </section>
    </main>
  );
}
