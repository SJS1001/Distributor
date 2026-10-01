import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";

type Replacement = {
  replacementId: string;
  expiresAt: number;
  secret: string;
  recoveryCodes: string[];
};
export function FactorReplacement({
  revision,
  sessionEnded,
}: {
  revision: number;
  sessionEnded: (message: string) => void;
}) {
  const [replacement, setReplacement] = useState<Replacement | null>(null),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [newCode, setNewCode] = useState(""),
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
    setReplacement(null);
    setPassword("");
    setCode("");
    setNewCode("");
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
    if (!replacement) return;
    const timer = setTimeout(
      () => {
        clear();
        setError(
          "Replacement expired. Prepare a new authenticator. If a confirmation response was interrupted, sign in again to check whether it completed.",
        );
      },
      Math.max(0, replacement.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [replacement]);
  const submit = async () => {
    const current = ++generation.current,
      controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      if (!replacement) {
        const result = await request<Replacement>(
          "/api/security/mfa/replacement/prepare",
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
          setError("Replacement expired. Prepare a new authenticator.");
          return;
        }
        setReplacement(result);
        setPassword("");
        setCode("");
        setNewCode("");
        setSaved(false);
      } else {
        await request("/api/security/mfa/replacement/confirm", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            currentPassword: password,
            replacementId: replacement.replacementId,
            currentCode: code,
            newCode,
            recoverySaved: saved,
          }),
        });
        if (generation.current !== current) return;
        clear();
        sessionEnded(
          "Authenticator replaced. All your sessions have ended. Sign in again with the new authenticator or a new recovery code.",
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
    <section aria-label="Replace authenticator">
      <h4>Replace authenticator</h4>
      <p>
        Your current authenticator and unused recovery codes remain active until
        you confirm. Confirmation requires your password, an existing factor and
        a code from the new authenticator. Only one pending security replacement
        is available at a time.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {replacement && (
          <>
            <p>
              Add a time-based Distributor account to your new authenticator
              using this key (six digits, 30 seconds, SHA-1). Keep the key
              private.
            </p>
            <label>
              New authenticator setup key
              <input readOnly value={replacement.secret} autoComplete="off" />
            </label>
            <p>
              Save these ten new codes securely. Replacement expires at{" "}
              {new Date(replacement.expiresAt).toLocaleTimeString()}. Confirming
              invalidates your old authenticator and every old recovery code,
              and ends all your sessions.
            </p>
            <ul aria-label="New recovery codes" className="mfa-recovery-codes">
              {replacement.recoveryCodes.map((c) => (
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
          Current password for authenticator replacement
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
        {replacement && (
          <>
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
            <label>
              Code from new authenticator
              <input
                required
                pattern="[0-9]{6}"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                disabled={busy}
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={busy}>
          {busy
            ? "Saving…"
            : replacement
              ? "Confirm new authenticator"
              : "Prepare new authenticator"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const confirming = busy && !!replacement;
            clear();
            setError(
              confirming
                ? "Confirmation may have completed. Sign in again with the new authenticator or saved new codes to check whether replacement completed. If it did not, your existing factor remains active."
                : "Replacement canceled. Your current authenticator and recovery codes remain active unless an interrupted confirmation completed.",
            );
          }}
        >
          Cancel authenticator replacement
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
