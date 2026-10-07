import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { Modal, type Dialog } from "./modal.tsx";
import { SessionList, type SessionDetail } from "./session-list.tsx";
import {
  forgetSessionRevokeAttempt,
  prepareSessionRevokeAttempt,
  readSessionRevokeAttempt,
  submitSessionRevokeAttempt,
  type SessionRevokeActor,
  type SessionRevokeAttempt,
  type SessionRevokeReceipt,
} from "./session-revoke-recovery-contract.ts";

type Props = {
  actor: SessionRevokeActor;
  sessions?: readonly SessionDetail[];
  disabled?: boolean;
  onSessionEnded: () => void;
  onChanged: () => Promise<void>;
};
export function SessionRevokeRecovery(props: Props) {
  return (
    <SessionRevokeForm
      key={`${props.actor.orgId}:${props.actor.id}`}
      {...props}
    />
  );
}
function SessionRevokeForm({
  actor,
  sessions,
  disabled = false,
  onSessionEnded,
  onChanged,
}: Props) {
  const [retained, setRetained] = useState<SessionRevokeAttempt | null>(() =>
      readSessionRevokeAttempt(sessionStorage, actor),
    ),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const latest = useRef({ onSessionEnded, onChanged });
  useLayoutEffect(() => {
    latest.current = { onSessionEnded, onChanged };
  }, [onSessionEnded, onChanged]);
  const open = (
    session: Pick<SessionDetail, "reference" | "current">,
    recovering: boolean,
  ) => {
    setError("");
    setNotice("");
    setDialog({
      title: recovering
        ? "Recover saved session end"
        : session.current
          ? "End this session"
          : "End selected session",
      fields: [
        {
          name: "currentPassword",
          label: "Your current password",
          type: "password",
          maxLength: 256,
        },
      ],
      description: recovering
        ? `Retry the exact saved request for session ${session.reference}. Reenter the same password used for that attempt. A replacement sign-in stays active when the original session already ended.`
        : `End ${session.current ? "your current signed-in session. You will need to sign in again" : "only the selected signed-in session"}. Session reference: ${session.reference}.`,
      submitLabel: recovering ? "Retry session end" : "End session",
      perform: async (values) => {
        const previous = readSessionRevokeAttempt(sessionStorage, actor);
        const attempt = await prepareSessionRevokeAttempt(
          sessionStorage,
          actor,
          session,
          String(values.currentPassword ?? ""),
        );
        if (mounted.current) setRetained(attempt);
        try {
          const receipt = await submitSessionRevokeAttempt(
            attempt,
            String(values.currentPassword ?? ""),
            (key, payload) => {
              if (!mounted.current)
                throw new Error("Session review was closed.");
              return request<SessionRevokeReceipt>(
                "/api/commands/user.session.end-own",
                {
                  method: "POST",
                  headers: { "idempotency-key": key },
                  body: JSON.stringify(payload),
                },
                false,
              );
            },
          );
          forgetSessionRevokeAttempt(sessionStorage, actor, attempt.key);
          if (!mounted.current) return;
          setRetained(null);
          setDialog(null);
          setError("");
          if (receipt.sessionEnded) {
            latest.current.onSessionEnded();
            return;
          }
          setNotice(
            "The selected session has ended. Your current sign-in stays active.",
          );
          try {
            await latest.current.onChanged();
          } catch (e) {
            if (mounted.current)
              setError(
                `The selected session ended, but the list could not refresh. ${e instanceof Error ? e.message : "Refresh your sessions."}`,
              );
          }
        } catch (e) {
          // A rejected first password never committed. Permit a corrected new
          // attempt; uncertain replies and retained attempts keep the exact key.
          if (
            !previous &&
            e instanceof RequestError &&
            ["LOGIN", "REAUTHENTICATE", "VALIDATION"].includes(e.code ?? "")
          ) {
            forgetSessionRevokeAttempt(sessionStorage, actor, attempt.key);
            if (mounted.current) setRetained(null);
          }
          if (!mounted.current) return;
          if (
            e instanceof RequestError &&
            e.status === 401 &&
            e.code === "UNAUTHENTICATED"
          ) {
            latest.current.onSessionEnded();
            return;
          }
          throw e;
        }
      },
    });
  };
  return (
    <>
      {retained && (
        <section className="record-detail" aria-label="Saved session end">
          <h4>Saved session end</h4>
          <p>
            The result of your request may be unknown. Recover the exact request
            for session {retained.reference}. This saved attempt belongs to your
            current account and contains no password.
          </p>
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() =>
              open(
                { reference: retained.reference, current: retained.current },
                true,
              )
            }
          >
            Retry ending selected session
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || disabled}
            onClick={() =>
              setDialog({
                title: "Forget saved session end",
                fields: [],
                submitLabel: "Forget saved attempt",
                description: `Forget the local retry details for session ${retained.reference}. This does not end a session or undo an earlier request. Refresh the session list to check current access.`,
                perform: async () => {
                  forgetSessionRevokeAttempt(
                    sessionStorage,
                    actor,
                    retained.key,
                  );
                  setRetained(null);
                  setDialog(null);
                },
              })
            }
          >
            Forget saved attempt
          </button>
        </section>
      )}
      <SessionList
        sessions={sessions}
        disabled={busy || disabled || retained !== null}
        onRevoke={(session) => open(session, false)}
      />
      {notice && <p role="status">{notice}</p>}
      {error && !dialog && <p role="alert">{error}</p>}
      {dialog && (
        <Modal
          dialog={dialog}
          busy={busy}
          error={error}
          close={() => {
            setDialog(null);
            setError("");
          }}
          submit={async (values) => {
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await dialog.perform(values);
            } catch (e) {
              if (mounted.current)
                setError(
                  `${e instanceof Error ? e.message : "Session could not be ended."} Your saved attempt remains available when the outcome is uncertain.`,
                );
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
