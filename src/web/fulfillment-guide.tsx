import React from "react";

export function FulfillmentGuide({
  shipments,
  navigate,
}: {
  shipments: boolean;
  navigate: () => void;
}) {
  return (
    <section
      className="record-detail-panel"
      aria-label={shipments ? "Complete shipment handover" : "Fulfill an order"}
    >
      <h2>{shipments ? "Complete the handover" : "Fulfill an order"}</h2>
      {shipments ? (
        <>
          <p>
            Packed stock is ready for handover. Open the shipment's Actions to
            confirm customer collection or review carrier booking and handover.
            Record evidence when the equipment actually leaves the warehouse.
          </p>
          <p>
            Handover records the shipped quantity and creates its invoice.
            Packing alone does not complete delivery or create an invoice.
          </p>
        </>
      ) : (
        <ol>
          <li>Open an order's Actions and pick its allocated stock.</li>
          <li>
            Pack the picked quantities for collection or carrier delivery.
          </li>
          <li>
            Open Shipments to confirm the actual handover and create its
            invoice.
          </li>
        </ol>
      )}
      <button type="button" className="secondary" onClick={navigate}>
        {shipments
          ? "Return to orders to pick and pack"
          : "Review packed shipments"}
      </button>
    </section>
  );
}
