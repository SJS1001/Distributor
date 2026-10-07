import React from "react";
import "./customer-returns.css";

export function CustomerReturnsGuide({
  hasSoldEquipment,
}: {
  hasSoldEquipment: boolean;
}) {
  return (
    <section className="customer-returns-guide" aria-label="Return guidance">
      <p className="return-authorization-note">
        <strong>Wait for authorization before sending equipment.</strong>{" "}
        Confirm return instructions with your distributor. Submitting a request
        does not approve a refund or replacement.
      </p>
      <details>
        <summary>How returns work</summary>
        <p>
          Register your equipment at installation in Warranty registration.
          Request a return under the distributor’s return policy, or submit a
          warranty claim for an equipment fault. Warranty claims remain
          available after the ordinary return period ends. Either request may
          require an RMA (return authorization); your distributor reviews each
          request.
        </p>
        <ol>
          <li>
            Select your sold serial, explain the issue and provide an evidence
            reference.
          </li>
          <li>
            Follow the request status below while your distributor reviews it.
          </li>
          <li>
            Wait for authorization and confirm return instructions before
            sending equipment.
          </li>
        </ol>
      </details>
      {!hasSoldEquipment && (
        <p role="status">
          No eligible sold equipment is available for a new request. Only
          serialized equipment already handed over to your account appears here.
          If a purchased serial is missing, contact your distributor with the
          serial and order or invoice reference to check its records.
        </p>
      )}
    </section>
  );
}

export function CustomerReturnStatus({
  state,
  credited,
  replaced,
}: {
  state: string;
  credited: boolean;
  replaced: boolean;
}) {
  const statuses: Record<string, [string, string]> = {
    submitted: [
      "Awaiting distributor review",
      "Wait for authorization and return instructions before sending equipment.",
    ],
    approved: [
      "Return authorized",
      "Confirm the return address, reference and handover instructions with your distributor before sending equipment.",
    ],
    rejected: [
      "Request not authorized",
      "Contact your distributor to discuss the review before sending equipment.",
    ],
    received: [
      "Received for inspection",
      "Your returned equipment is in quarantine awaiting inspection.",
    ],
    inspected: [
      "Inspection recorded",
      "Your distributor will decide the equipment disposition and any remedy.",
    ],
    repair: [
      "Under repair",
      "Your distributor will record the outcome after repair.",
    ],
    disposed: credited
      ? [
          "Credit issued",
          "View your credit and invoice balance in Invoices & payments.",
        ]
      : replaced
        ? [
            "Replacement handed over",
            "View collection or shipping details in Replacements.",
          ]
        : [
            "Equipment disposition recorded",
            "A credit or replacement is a separate decision. Contact your distributor about the outcome.",
          ],
  };
  const [label, next] = statuses[state] ?? [
    state,
    "Contact your distributor about the current request status.",
  ];
  return (
    <div className="customer-return-status">
      <strong>{label}</strong>
      <p>{next}</p>
    </div>
  );
}
