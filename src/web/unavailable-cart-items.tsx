import React, { useId, useState } from "react";
import type {
  CartLine,
  SelectedCustomerProduct,
} from "../shared/customer-products.ts";

// Removal choices describe this saved revision. They submit no mutation until
// the enclosing editor has reviewed every unavailable line and saves the cart.
export function UnavailableCartItems({
  products,
  lines,
}: {
  products: SelectedCustomerProduct[];
  lines: CartLine[];
}) {
  const prefix = useId();
  const [removed, setRemoved] = useState<string[]>([]);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const all = removed.length === lines.length;
  return (
    <section aria-label="Unavailable saved items">
      <input
        type="hidden"
        name="unavailableRemoval"
        value={JSON.stringify(removed)}
      />
      <p>
        {units} saved {units === 1 ? "unit" : "units"} across {lines.length}{" "}
        unavailable {lines.length === 1 ? "item" : "items"}. These items cannot
        be ordered from the current catalog. Review each removal, or select all.
        Continuing removes them before requesting a quote. Canceling after
        submission does not undo a saved change.
      </p>
      {lines.map((line) => {
        const product = products.find((item) => item.id === line.productId)!;
        return (
          <div key={line.productId} className="form-field check">
            <input
              id={`${prefix}-${line.productId}`}
              type="checkbox"
              checked={removed.includes(line.productId)}
              onChange={(event) =>
                setRemoved((old) =>
                  event.target.checked
                    ? [...old, line.productId]
                    : old.filter((value) => value !== line.productId),
                )
              }
            />
            <label htmlFor={`${prefix}-${line.productId}`}>
              Remove {product.sku} · {product.name} ({line.quantity} saved{" "}
              {line.quantity === 1 ? "unit" : "units"})
            </label>
          </div>
        );
      })}
      <div className="form-field check">
        <input
          id={`${prefix}-all`}
          type="checkbox"
          checked={all}
          onChange={(event) =>
            setRemoved(
              event.target.checked ? lines.map((line) => line.productId) : [],
            )
          }
        />
        <label htmlFor={`${prefix}-all`}>
          Remove unavailable items from this saved cart
        </label>
      </div>
      <p role="status">
        {removed.length} of {lines.length} unavailable items selected for
        removal.
      </p>
    </section>
  );
}
