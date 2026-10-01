import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";

type Renewal = {
  renewalId: string;
  expiresAt: number;
  recoveryCodes: string[];
};
export function RecoveryCodes({
  revision,
  sessionEnded,
}: {
  revision: number;
  sessionEnded: (message: string) => void;
}) {
  const [renewal, setRenewal] = useState<Renewal | null>(null),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID()),
    generation = useRef(0),
    pending = useRef<AbortController | null>(null);
  const clear = () => {
    generation.current++;
    pending.current?.abort();
    pending.current = null;
    key.current = crypto.randomUUID();
    setRenewal(null);
    setPassword("");
    setCode("");
    setSaved(false);
    setBusy(false);
  };
  useEffect(
    () => () => {
      generation.current++;
      pending.current?.abort();
    },
    [],
  );
  useEffect(() => {
    clear();
    setError("");
  }, [revision]);
  useEffect(() => {
    if (!renewal) return;
    const timer = setTimeout(
      () => {
        clear();
        setError(
          "Replacement expired. Prepare new recovery codes. If a confirmation response was interrupted, sign in again to check whether it completed.",
        );
      },
      Math.max(0, renewal.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [renewal]);
  const submit = async () => {
    const current = ++generation.current,
      controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      if (!renewal) {
        const result = await request<Renewal>(
          "/api/security/mfa/recovery/prepare",
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              currentPassword: password,
              revision,
              key: key.current,
            }),
          },
        );
        if (generation.current !== current) return;
        if (result.expiresAt <= Date.now()) {
          clear();
          setError("Replacement expired. Prepare new recovery codes.");
          return;
        }
        setRenewal(result);
        setPassword("");
        setCode("");
        setSaved(false);
      } else {
        await request("/api/security/mfa/recovery/confirm", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            currentPassword: password,
            renewalId: renewal.renewalId,
            code,
            recoverySaved: saved,
          }),
        });
        if (generation.current !== current) return;
        clear();
        sessionEnded(
          "Recovery codes replaced. Your authenticator remains enabled. All your sessions have ended. Sign in again with an authenticator code or a new recovery code.",
        );
      }
    } catch (e) {
      if (generation.current !== current || controller.signal.aborted) return;
      if ((e as Error).message.includes("(MFA_EXPIRED)")) clear();
      setError((e as Error).message);
    } finally {
      if (generation.current === current) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section aria-label="Replace recovery codes">
      <h4>Replace recovery codes</h4>
      <p>
        Keep your authenticator enabled while replacing all recovery codes.
        Current unused codes remain valid until you confirm. New codes are
        inactive until confirmation.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {renewal && (
          <>
            <p>
              Save these ten new codes securely. Replacement expires at{" "}
              {new Date(renewal.expiresAt).toLocaleTimeString()}. Confirming
              invalidates every old recovery code and ends all your sessions.
            </p>
            <ul aria-label="New recovery codes" className="mfa-recovery-codes">
              {renewal.recoveryCodes.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
            <label>
              <input
                type="checkbox"
                required
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
              />{" "}
              I saved my new recovery codes securely
            </label>
          </>
        )}
        <label>
          Current password for recovery codes
          <input
            type="password"
            required
            maxLength={256}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        {renewal && (
          <label>
            Existing authenticator or recovery code
            <input
              required
              maxLength={64}
              spellCheck={false}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={busy}>
          {busy
            ? "Saving…"
            : renewal
              ? "Confirm replacement codes"
              : "Prepare replacement codes"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const confirming = busy && !!renewal;
            clear();
            setError(
              confirming
                ? "Confirmation may have completed. Sign in again to check whether your new codes are active."
                : "Replacement canceled. Current recovery codes remain valid.",
            );
          }}
        >
          Cancel replacement
        </button>
        <p>
          Confirmation requires your password and an unused code from your
          existing authenticator or current recovery codes. After using an
          authenticator code, wait for its next code. If a confirmation response
          is interrupted, return to sign-in and use your authenticator or a
          saved new code to check whether it completed.
        </p>
      </form>
    </section>
  );
}
