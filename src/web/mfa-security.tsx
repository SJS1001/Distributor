import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";

type Setup = {
  enrollmentId: string;
  expiresAt: number;
  secret: string;
  recoveryCodes: string[];
};
export function MfaSecurity({
  security,
  sessionEnded,
}: {
  security: {
    revision: number;
    mfa: {
      available: boolean;
      enabled: boolean;
      recoveryCodesRemaining: number;
    };
  };
  sessionEnded: (message: string) => void;
}) {
  const [setup, setSetup] = useState<Setup | null>(null),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!setup) return;
    const expiry = setTimeout(
      () => {
        setSetup(null);
        setPassword("");
        setCode("");
        setSaved(false);
        key.current = crypto.randomUUID();
        setError("Setup expired. Start a new setup.");
      },
      Math.max(0, setup.expiresAt - Date.now()),
    );
    return () => clearTimeout(expiry);
  }, [setup]);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (!setup && !security.mfa.enabled) {
        const result = await request<Setup>("/api/security/mfa/setup", {
          method: "POST",
          body: JSON.stringify({
            currentPassword: password,
            revision: security.revision,
            key: key.current,
          }),
        });
        if (result.expiresAt <= Date.now()) {
          setPassword("");
          setCode("");
          setSaved(false);
          key.current = crypto.randomUUID();
          setPassword("");
          setCode("");
          setSaved(false);
          throw new Error("Setup expired. Start a new setup.");
        }
        setSetup(result);
        setPassword("");
        setCode("");
      } else {
        await request(`/api/security/mfa/${setup ? "confirm" : "disable"}`, {
          method: "POST",
          body: JSON.stringify(
            setup
              ? {
                  currentPassword: password,
                  enrollmentId: setup.enrollmentId,
                  code,
                  recoverySaved: saved,
                }
              : {
                  currentPassword: password,
                  code,
                  revision: security.revision,
                },
          ),
        });
        setPassword("");
        setCode("");
        setSetup(null);
        sessionEnded(
          "Authenticator settings saved. All your sessions have ended. Sign in again.",
        );
      }
    } catch (e) {
      if (!setup && (e as Error).message.includes("(MFA_EXPIRED)"))
        key.current = crypto.randomUUID();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Authenticator security">
      <h3>Authenticator app</h3>
      <p>
        {security.mfa.enabled
          ? `Enabled · ${security.mfa.recoveryCodesRemaining} unused recovery codes.`
          : "Add a second sign-in step with a six-digit authenticator code."}
      </p>
      {!security.mfa.available ? (
        <p role="status">
          Authenticator service is unavailable. Contact your administrator.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {setup && (
            <>
              <p>
                In your authenticator app, add a time-based account named
                Distributor, using this setup key (six digits, 30 seconds,
                SHA-1).
              </p>
              <label>
                Authenticator setup key
                <input readOnly value={setup.secret} autoComplete="off" />
              </label>
              <p>
                Setup expires at{" "}
                {new Date(setup.expiresAt).toLocaleTimeString()}. Keep this key
                private.
              </p>
              <h4>Recovery codes</h4>
              <p>
                Save these ten codes securely before continuing. Each code can
                replace the authenticator code once at sign-in; your password is
                still required. They cannot be viewed after activation.
              </p>
              <ul aria-label="Recovery codes" className="mfa-recovery-codes">
                {setup.recoveryCodes.map((c) => (
                  <li key={c}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
              <label>
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(e) => setSaved(e.target.checked)}
                  required
                />{" "}
                I saved my recovery codes securely
              </label>
            </>
          )}
          {security.mfa.enabled && (
            <p>
              Removing the authenticator requires your password and an unused
              authenticator or recovery code. All your sessions will end.
            </p>
          )}
          <label>
            Current password for authenticator
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>
          {(setup || security.mfa.enabled) && (
            <label>
              Authenticator or recovery code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                spellCheck={false}
                required
                maxLength={64}
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
              : setup
                ? "Enable authenticator"
                : security.mfa.enabled
                  ? "Remove authenticator"
                  : "Set up authenticator"}
          </button>
          {setup && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                key.current = crypto.randomUUID();
                setSetup(null);
                setPassword("");
                setCode("");
                setSaved(false);
                setError("");
              }}
            >
              Start a new setup
            </button>
          )}
          {(setup || security.mfa.enabled) && (
            <p>
              If a save response is interrupted, return to sign-in to check
              whether it completed. Enabling consumes that authenticator code;
              wait for a new code or use a saved recovery code.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
