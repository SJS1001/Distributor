import React from "react";
import type { StockMovement } from "../shared/stock-history.ts";

export function StockMovementList({
  items,
  money,
  warehouseName,
}: {
  items: StockMovement[];
  money: (amount: number) => string;
  warehouseName: (id: string) => string;
}) {
  return (
    <ol>
      {items.map((m) => (
        <li key={m.id}>
          <p>
            <strong>{m.type}</strong> · {m.quantity} units · original unit cost{" "}
            {money(m.unit_cost)}
          </p>
          <p>
            {warehouseName(m.warehouse_id)} ·{" "}
            <time dateTime={m.created_at} title={m.created_at}>
              {new Date(m.created_at).toLocaleString(undefined, {
                timeZoneName: "short",
              })}
            </time>
          </p>
          <p>{m.reason}</p>
          <p>
            {m.currentActorName ? (
              <>
                Current actor name: <strong>{m.currentActorName}</strong>
              </>
            ) : (
              "Actor name unavailable; the recorded identifier is retained below."
            )}
          </p>
          <details>
            <summary>
              Movement references and recorded actor identifiers
            </summary>
            <p>
              Reference <code>{m.reference}</code> · movement{" "}
              <code>{m.id}</code> · actor identifier <code>{m.actor_id}</code>
            </p>
          </details>
        </li>
      ))}
    </ol>
  );
}
