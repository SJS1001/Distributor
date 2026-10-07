import { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request } from "./api.ts";
import "./operations-lane.css";
import { Modal, type Dialog } from "./modal.tsx";
const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

import type {
  EnrollmentApplication,
  EnrollmentQueue,
  EnrollmentDecisionResult,
} from "../shared/enrollment.ts";

function decisionDialog(
  application: EnrollmentApplication,
  decision: "approve" | "reject",
  finish: (
    application: EnrollmentApplication,
    result: EnrollmentDecisionResult,
  ) => Promise<void>,
): Dialog {
  return {
    title: `${decision === "approve" ? "Approve" : "Reject"} application: ${application.businessName}`,
    description: (
      <p>
        {decision === "approve"
          ? "Approval creates a Canadian buyer account with the pricing tier and credit limit you review here. The buyer must activate through a private invitation before signing in. No email is sent."
          : "Reject this application without granting purchasing access."}
      </p>
    ),
    submitLabel:
      decision === "approve"
        ? "Approve and create invitation"
        : "Reject application",
    fields: [
      ...(decision === "approve"
        ? [
            {
              name: "tier",
              label: "Reviewed pricing tier",
              value: "standard",
              maxLength: 80,
            },
            {
              name: "creditLimit",
              label: "Reviewed credit limit (CAD)",
              value: "0",
              help: "Enter dollars and cents, for example 500.00. Zero means no credit allowance.",
            },
          ]
        : []),
      {
        name: "reason",
        label: "Review reason",
        type: "textarea" as const,
        maxLength: 1000,
      },
      {
        name: "currentPassword",
        label: "Your current password",
        type: "password" as const,
        maxLength: 256,
      },
    ],
    perform: async (values) => {
      const amount = String(values.creditLimit ?? "0").trim();
      if (decision === "approve" && !/^\d+(?:\.\d{1,2})?$/.test(amount))
        throw Error(
          "Enter a non-negative CAD amount with at most two decimal places.",
        );
      const [dollars, cents = ""] = amount.split(".");
      const creditLimit = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
      if (decision === "approve" && !Number.isSafeInteger(creditLimit))
        throw Error("The credit limit is too large.");
      const result = await request<EnrollmentDecisionResult>(
        `/api/enrollment/applications/${encodeURIComponent(application.id)}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            currentPassword: values.currentPassword,
            reason: values.reason,
            ...(decision === "approve"
              ? { tier: values.tier, creditLimit }
              : {}),
          }),
        },
      );
      await finish(application, result);
    },
  };
}
function invitationDialog(
  application: EnrollmentApplication,
  action: "reissue" | "revoke",
  finish: (
    application: EnrollmentApplication,
    result: EnrollmentDecisionResult,
  ) => Promise<void>,
): Dialog {
  return {
    title: `${action === "reissue" ? "Replace" : "Revoke"} invitation: ${application.businessName}`,
    description: (
      <p>
        {action === "reissue"
          ? "This invalidates the previous invitation and creates a replacement. Deliver the new link privately; no email is sent."
          : "This invalidates the current invitation. The approved buyer cannot activate until a new invitation is issued."}
      </p>
    ),
    submitLabel:
      action === "reissue"
        ? "Create replacement invitation"
        : "Revoke invitation",
    fields: [
      { name: "reason", label: "Reason", type: "textarea", maxLength: 1000 },
      {
        name: "currentPassword",
        label: "Your current password",
        type: "password",
        maxLength: 256,
      },
    ],
    perform: async (values) => {
      const result = await request<EnrollmentDecisionResult>(
        `/api/enrollment/applications/${encodeURIComponent(application.id)}/invitation`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            currentPassword: values.currentPassword,
            reason: values.reason,
          }),
        },
      );
      await finish(application, result);
    },
  };
}
type PrivateInvitation = {
  applicationId: string;
  url: string;
  expiresAt: string;
  businessName: string;
};
function PrivateInvitationPanel({
  invitation,
  setNotice,
  dismiss,
}: {
  invitation: PrivateInvitation;
  setNotice: (value: string) => void;
  dismiss: () => void;
}) {
  const linkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    linkRef.current?.focus();
  }, [invitation]);
  return (
    <section
      className="enrollment-invitation"
      aria-label="Private activation invitation"
    >
      <h3>Private invitation for {invitation.businessName}</h3>
      <p>
        No email has been sent. Verify the reviewed recipient and deliver this
        single-use link through a private channel. Anyone holding it can set the
        buyer password.
      </p>
      <p>Expires: {new Date(invitation.expiresAt).toLocaleString()}</p>
      <label>
        Activation link
        <input
          ref={linkRef}
          readOnly
          value={invitation.url}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      <div className="actions">
        <button
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(invitation.url);
              setNotice(
                "Invitation copied. Deliver it privately; no email has been sent.",
              );
            } catch {
              setNotice(
                "Clipboard unavailable. Select and copy the link manually.",
              );
            }
          }}
        >
          Copy private link
        </button>
        <button className="secondary" onClick={dismiss}>
          Dismiss private link
        </button>
      </div>
      <p>
        Dismissal removes this link from the screen; it remains valid until
        expiry or revocation.
      </p>
    </section>
  );
}
function ApplicationTable({
  shown,
  busy,
  review,
  invitationAction,
}: {
  shown: EnrollmentApplication[];
  busy: boolean;
  review: (
    application: EnrollmentApplication,
    decision: "approve" | "reject",
    opener: HTMLButtonElement,
  ) => void;
  invitationAction: (
    application: EnrollmentApplication,
    action: "reissue" | "revoke",
    opener: HTMLButtonElement,
  ) => void;
}) {
  return (
    <div
      className="table-wrap"
      tabIndex={0}
      role="region"
      aria-label="Trade applications"
    >
      <table>
        <thead>
          <tr>
            <th>Business / contact</th>
            <th>Business details</th>
            <th>Review / terms</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((application) => (
            <tr key={application.id}>
              <td>
                <strong>{application.businessName}</strong>
                <br />
                {application.contactName}
                <br />
                {application.email}
                <br />
                {application.phone}
                <br />
                <small>
                  Submitted {new Date(application.createdAt).toLocaleString()}
                </small>
              </td>
              <td>
                {application.province} · Canada
                {application.businessNumber && (
                  <>
                    <br />
                    Registration: {application.businessNumber}
                  </>
                )}
                {application.notes && (
                  <p className="enrollment-notes">{application.notes}</p>
                )}
              </td>
              <td>
                <span className="ops-state" data-state={application.status}>
                  {application.status}
                </span>
                {application.reviewReason && (
                  <p className="enrollment-notes">{application.reviewReason}</p>
                )}
                {application.tier && (
                  <p>
                    {application.tier} ·{" "}
                    {cad.format((application.creditLimit ?? 0) / 100)} credit
                    limit
                  </p>
                )}
                {application.status === "approved" && (
                  <p>
                    {application.invitationActive
                      ? `Invitation expires ${application.invitationExpiresAt ? new Date(application.invitationExpiresAt).toLocaleString() : "—"}`
                      : "No active invitation"}
                  </p>
                )}
              </td>
              <td>
                <div className="actions">
                  {application.status === "pending" && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={(event) =>
                          review(application, "approve", event.currentTarget)
                        }
                      >
                        Approve {application.businessName}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={(event) =>
                          review(application, "reject", event.currentTarget)
                        }
                      >
                        Reject {application.businessName}
                      </button>
                    </>
                  )}
                  {application.status === "approved" && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={(event) =>
                          invitationAction(
                            application,
                            "reissue",
                            event.currentTarget,
                          )
                        }
                      >
                        Replace invitation
                      </button>
                      {application.invitationActive && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={(event) =>
                            invitationAction(
                              application,
                              "revoke",
                              event.currentTarget,
                            )
                          }
                        >
                          Revoke invitation
                        </button>
                      )}
                    </>
                  )}
                  {application.status === "activated" && (
                    <span>Buyer activated</span>
                  )}
                  {application.status === "rejected" && (
                    <span>No access granted</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function useEnrollmentQueue() {
  const [queue, setQueue] = useState<EnrollmentQueue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const after = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  async function load(cursor: string | null = null) {
    controller.current?.abort();
    const read = new AbortController();
    controller.current = read;
    setBusy(true);
    setError("");
    try {
      const result = await request<EnrollmentQueue>(
        `/api/enrollment/applications${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
        { signal: read.signal },
      );
      if (!read.signal.aborted) {
        setQueue(result);
        after.current = cursor;
      }
    } catch (e) {
      if (!read.signal.aborted) setError((e as Error).message);
    } finally {
      if (!read.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, []);
  return { queue, busy, error, setBusy, setError, after, load };
}
export function EnrollmentReview() {
  const { queue, busy, error, setBusy, setError, after, load } =
    useEnrollmentQueue();

  const [notice, setNotice] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [invitation, setInvitation] = useState<PrivateInvitation | null>(null);
  const [view, setView] = useState("pending");
  const shown =
    queue?.items.filter(
      (application) => view !== "pending" || application.status === "pending",
    ) ?? [];
  const finish = async (
    application: EnrollmentApplication,
    result: EnrollmentDecisionResult,
  ) => {
    setDialog(null);
    if (result.activationToken && result.expiresAt) {
      setInvitation({
        applicationId: application.id,
        url: `${window.location.origin}/#activate=${encodeURIComponent(result.activationToken)}`,
        expiresAt: result.expiresAt,
        businessName: application.businessName,
      });
      setNotice(
        "Invitation created. Deliver it privately to the reviewed contact; no email has been sent.",
      );
    } else {
      // A completed revocation must remove the now-unusable displayed link.
      if (
        invitation?.applicationId === application.id &&
        result.status === "approved"
      )
        setInvitation(null);
      setNotice("Application updated. No email has been sent.");
    }
    await load(after.current);
  };
  const review = (
    application: EnrollmentApplication,
    decision: "approve" | "reject",
    opener: HTMLButtonElement,
  ) => {
    setError("");
    setDialog({
      ...decisionDialog(application, decision, finish),
      returnFocus: opener,
    });
  };
  const invitationAction = (
    application: EnrollmentApplication,
    action: "reissue" | "revoke",
    opener: HTMLButtonElement,
  ) => {
    setError("");
    setDialog({
      ...invitationDialog(application, action, finish),
      returnFocus: opener,
    });
  };
  return (
    <section className="panel">
      <div className="section-heading ops-section-header">
        <div>
          <div className="info-heading">
            <h2>Trade account applications</h2>
            <InfoBubble label="Trade account applications">
              Review Canadian business applications before granting buyer
              access. Invitations require a manual private handoff.
            </InfoBubble>
          </div>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setNotice("");
            void load(after.current);
          }}
        >
          Refresh applications
        </button>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <p>
            If a decision response was lost, refresh and inspect its status
            before acting again. A returned invitation is shown only once;
            replace it if you cannot recover the private link.
          </p>
        </div>
      )}
      {invitation && (
        <PrivateInvitationPanel
          invitation={invitation}
          setNotice={setNotice}
          dismiss={() => setInvitation(null)}
        />
      )}
      <label>
        Application view{" "}
        <select value={view} onChange={(e) => setView(e.target.value)}>
          <option value="pending">Needs review</option>
          <option value="all">All applications / history</option>
        </select>
      </label>
      {queue && (
        <p role="status">
          {queue.items.filter((a) => a.status === "pending").length} need review
          on this page · {queue.items.length} applications on this page
        </p>
      )}
      {!queue ? (
        <p role="status">
          {busy
            ? "Loading applications…"
            : "Applications could not be loaded. Use Refresh applications to retry."}
        </p>
      ) : shown.length ? (
        <ApplicationTable
          shown={shown}
          busy={busy}
          review={review}
          invitationAction={invitationAction}
        />
      ) : (
        <p className="empty">
          {view === "pending"
            ? "No applications need review on this page. View All applications / history or check the next page."
            : "No trade account applications on this page. Applications submitted from the public trade account form appear here for review."}
        </p>
      )}
      {(after.current || queue?.next) && (
        <div className="actions">
          <button
            className="secondary"
            disabled={busy || !after.current}
            onClick={() => void load()}
          >
            First page
          </button>
          <button
            className="secondary"
            disabled={busy || !queue?.next}
            onClick={() => void load(queue?.next ?? null)}
          >
            Next applications
          </button>
        </div>
      )}
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
            setBusy(true);
            setError("");
            try {
              await dialog.perform(values);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}
