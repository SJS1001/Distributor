import React from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../src/web/modal.tsx";
import { RecordNotes } from "../src/web/record-notes.tsx";
import { IncomingSupply } from "../src/web/incoming-supply.tsx";
import { EnrollmentReview } from "../src/web/enrollment-review.tsx";
import { AuditHistory } from "../src/web/audit-history.tsx";
import { OrderRequests } from "../src/web/order-requests.tsx";
import { RecordIdentifier } from "../src/web/record-display.tsx";
const mode = new URL(location.href).searchParams.get("mode");
const record = (value: unknown) => {
  document.querySelector("#outcome")!.textContent = JSON.stringify(value);
};
createRoot(document.getElementById("root")!).render(
  <>
    <div id="outcome" />
    {mode === "notes" ? (
      <RecordNotes
        expanded
        kind="product"
        recordId="synthetic-product"
        recoveryScope="synthetic-scope"
        actorId="synthetic-actor"
      />
    ) : mode === "incoming" ? (
      <IncomingSupply
        orderId="synthetic-order"
        scope="synthetic-scope"
        editable
        onChanged={() => {}}
      />
    ) : mode === "enrollment" ? (
      <EnrollmentReview />
    ) : mode === "audit" ? (
      <AuditHistory />
    ) : mode === "requests" ? (
      <OrderRequests buyer={false} canReview resubmit={record} order={record} />
    ) : (
      <Modal
        busy={false}
        error=""
        close={() => record("closed")}
        submit={async (v) => record(v)}
        dialog={
          mode === "report"
            ? {
                title: "Read-only report",
                description: (
                  <RecordIdentifier
                    label="Record ID"
                    value="synthetic-record"
                  />
                ),
                readOnly: true,
                fields: [],
                perform: async () => {},
              }
            : {
                title: "Create synthetic user",
                description: (
                  <RecordIdentifier
                    label="Record ID"
                    value="synthetic-record"
                  />
                ),
                fields: [
                  {
                    name: "role",
                    label: "Role",
                    options: [
                      { value: "staff", label: "Staff" },
                      { value: "buyer", label: "Buyer" },
                    ],
                  },
                  {
                    name: "account",
                    label: "Buyer account",
                    optional: true,
                    enabledWhen: { field: "role", value: "buyer" },
                    options: [
                      { value: "account-test", label: "Synthetic account" },
                    ],
                  },
                ],
                perform: async () => {},
              }
        }
      />
    )}
  </>,
);
