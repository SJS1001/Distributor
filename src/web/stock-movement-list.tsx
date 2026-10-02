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
            {new Date(m.created_at).toLocaleString()}
          </p>
          <p>{m.reason}</p>
          <p>
            Reference <code>{m.reference}</code> · movement <code>{m.id}</code>{" "}
            · recorded by <code>{m.actor_id}</code>
          </p>
        </li>
      ))}
    </ol>
  );
}
