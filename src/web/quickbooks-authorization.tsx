import { useEffect, useRef, useState } from "react";
import { request, setCsrf } from "./api.ts";

type Attempt = {
  id: string;
  state: string;
  expiresAt: number;
  installedRevision: number | null;
};
type Summary =
  | { enabled: false }
  | {
      enabled: true;
      realm: string;
      accountId: string;
      credentials: { revision: number; state: string };
      attempt: Attempt | null;
    };

// Capture once before rendering, including StrictMode remounts. Never persist or
// render the code/state, and remove the query before application requests.
let callback =
  location.pathname === "/quickbooks/callback" && location.search
    ? location.href
    : "";
if (callback) history.replaceState(null, "", "/quickbooks/callback");

export function QuickBooksConnection() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const epoch = useRef(0);
  const read = useRef<AbortController | null>(null);
  const active = useRef(false);
  const load = async () => {
    read.current?.abort();
    const controller = new AbortController(),
      current = ++epoch.current;
    read.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await request<Summary>("/api/quickbooks/authorization", {
        signal: controller.signal,
      });
      if (current !== epoch.current) return;
      setSummary(result);
      setUncertain(false);
    } catch (e) {
      if (current === epoch.current && !controller.signal.aborted)
        setError((e as Error).message);
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
  const act = async (action: "begin" | "cancel") => {
    if (!summary?.enabled || busy || uncertain) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<Attempt & { authorizationUrl?: string }>(
        `/api/quickbooks/authorization/${action}`,
        {
          method: "POST",
          body: JSON.stringify(
            action === "begin"
              ? { revision: summary.credentials.revision }
              : { attemptId: summary.attempt!.id },
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
          url.password
        )
          throw Error(
            "Authorization address is invalid; inspect connection status.",
          );
        location.assign(url.href);
      } else await load();
    } catch (e) {
      if (active.current) {
        setError((e as Error).message);
        setUncertain(true);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <section aria-label="QuickBooks connection">
      <h2>QuickBooks connection</h2>
      {summary?.enabled === false && (
        <p>
          Browser connection is disabled. Ask your administrator to configure
          approved QuickBooks access.
        </p>
      )}
      {summary?.enabled && (
        <>
          <p>
            Sandbox company {summary.realm} · Credentials:{" "}
            {summary.credentials.state} · Revision{" "}
            {summary.credentials.revision}
          </p>
          {summary.attempt && (
            <p>
              Connection attempt: {summary.attempt.state} · Expires{" "}
              {new Date(summary.attempt.expiresAt).toLocaleString()}
            </p>
          )}
          <p>
            Connect the configured company after reviewing the customer’s
            processing choice. A new attempt cancels any pending connection.
            Canceling an attempt does not disconnect installed credentials.
          </p>
          <div className="actions">
            <button
              disabled={
                busy || uncertain || summary.credentials.state === "refreshing"
              }
              onClick={() => void act("begin")}
            >
              Connect QuickBooks sandbox
            </button>
            {summary.attempt &&
              ["pending", "exchanging"].includes(summary.attempt.state) && (
                <button
                  className="secondary"
                  disabled={busy || uncertain}
                  onClick={() => void act("cancel")}
                >
                  Cancel connection attempt
                </button>
              )}
          </div>
        </>
      )}
      {uncertain && (
        <p>
          The response was not confirmed. Check status before starting another
          attempt.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        Check QuickBooks connection status
      </button>
      {busy && <p role="status">Checking connection…</p>}
    </section>
  );
}

export function QuickBooksCallback() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [consumed, setConsumed] = useState(!callback);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const read = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const active = useRef(false);
  const load = async () => {
    read.current?.abort();
    const controller = new AbortController(),
      current = ++epoch.current;
    read.current = controller;
    setBusy(true);
    setError("");
    try {
      const session = await request<{ csrf: string }>("/api/session", {
        signal: controller.signal,
      });
      if (current !== epoch.current) return;
      setCsrf(session.csrf);
      const result = await request<Summary>("/api/quickbooks/authorization", {
        signal: controller.signal,
      });
      if (current === epoch.current) setSummary(result);
    } catch (e) {
      if (current === epoch.current && !controller.signal.aborted)
        setError((e as Error).message);
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
    if (!summary?.enabled || !summary.attempt || !callback || busy) return;
    const input = callback;
    ++epoch.current;
    read.current?.abort();
    callback = "";
    setConsumed(true);
    setBusy(true);
    setError("");
    try {
      await request("/api/quickbooks/authorization/complete", {
        method: "POST",
        body: JSON.stringify({
          attemptId: summary.attempt.id,
          callbackUrl: input,
        }),
      });
      if (active.current) await load();
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) {
        setBusy(false);
        heading.current?.focus();
      }
    }
  };
  return (
    <main className="login">
      <section>
        <h1 ref={heading} tabIndex={-1}>
          QuickBooks connection result
        </h1>
        <p>
          Use the same Distributor login that started this connection. Confirm
          the configured sandbox company before finishing.
        </p>
        {summary?.enabled && (
          <>
            <p>
              Sandbox company {summary.realm} · Credentials:{" "}
              {summary.credentials.state}
            </p>
            <p>
              Connection attempt:{" "}
              {summary.attempt?.state ?? "No attempt for this login"}
            </p>
            {!consumed &&
              summary.attempt?.state === "pending" &&
              summary.attempt.expiresAt > Date.now() && (
                <button disabled={busy} onClick={() => void complete()}>
                  Finish QuickBooks connection
                </button>
              )}
          </>
        )}
        {summary?.enabled === false && <p>Browser connection is disabled.</p>}
        {consumed && (
          <p>
            This callback cannot be resubmitted. Check status; if the connection
            did not complete, start a new attempt from Billing.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Checking connection…</p>}
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Check connection result
        </button>
        <p>
          <a href="/">Return to Distributor</a>
        </p>
      </section>
    </main>
  );
}
