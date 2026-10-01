import React, { useEffect, useState } from "react";
import { request } from "./api.ts";
import { MfaSecurity } from "./mfa-security.tsx";

export function RequiredMfa({
  sessionEnded,
  signOut,
}: {
  sessionEnded: (message: string) => void;
  signOut: () => void;
}) {
  const [security, setSecurity] = useState<
    Parameters<typeof MfaSecurity>[0]["security"] | null
  >(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void request("/api/security", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setSecurity(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <main className="login">
      <h1>Set up your authenticator</h1>
      <p>
        Your role requires an authenticator before you can enter the workspace.
        Save your recovery codes during setup.
      </p>
      {security ? (
        <MfaSecurity security={security} sessionEnded={sessionEnded} />
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry security setup
          </button>
        </>
      ) : (
        <p role="status">Loading security setup…</p>
      )}
      <button className="secondary" onClick={signOut}>
        Back to sign in
      </button>
    </main>
  );
}
