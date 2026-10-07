import { createContext, useContext, useEffect, useId, useState } from "react";
import type { CustomerProduct } from "../shared/customer-products.ts";
import { CustomerPrice } from "./customer-pricing.tsx";
import { AddonSuggestions, useAddonSuggestions } from "./product-addons.tsx";

export const CartFeedbackContext = createContext<{
  productId: string;
  message: string;
  viewCart: () => void;
} | null>(null);
export function LocalCartFeedback({ productId }: { productId: string }) {
  const feedback = useContext(CartFeedbackContext);
  if (!feedback?.message || feedback.productId !== productId) return null;
  return (
    <div className="sf-local-feedback">
      <p>
        {feedback.message.startsWith("Added ")
          ? feedback.message.replace(
              /^Added (.+) to your cart\.$/,
              "$1 added to your cart.",
            )
          : feedback.message}
      </p>
      <button type="button" className="sf-back" onClick={feedback.viewCart}>
        View cart
      </button>
    </div>
  );
}

// The server accepts at most this many units per line and lines per cart.
export const maxQuantity = 100000;
export const maxLines = 100;

export type ShopLine = { product: CustomerProduct; quantity: number };
export type ShopWarehouse = { id: string; name: string };

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    cents / 100,
  );
const storageKey = (scope: string) => `distributor-shop-cart:${scope}`;
function readLines(scope: string): ShopLine[] {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(storageKey(scope)) ?? "[]",
    ) as ShopLine[];
    return Array.isArray(value)
      ? value.filter(
          (l) =>
            typeof l?.product?.id === "string" &&
            Number.isInteger(l.quantity) &&
            l.quantity > 0,
        )
      : [];
  } catch {
    return [];
  }
}
export function wholeQuantity(text: string) {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= maxQuantity
    ? value
    : null;
}

// Lines wait in this browser tab until the buyer picks a warehouse; the saved
// server cart is per warehouse, so nothing is saved before that choice.
export function useShopCart(scope: string) {
  const [lines, setLines] = useState<ShopLine[]>(() => readLines(scope));
  useEffect(() => {
    try {
      if (lines.length)
        sessionStorage.setItem(storageKey(scope), JSON.stringify(lines));
      else sessionStorage.removeItem(storageKey(scope));
    } catch {
      // Storage can be unavailable; the cart still works for this page.
    }
  }, [scope, lines]);
  return {
    lines,
    add(product: CustomerProduct, quantity: number) {
      const existing = lines.find((l) => l.product.id === product.id);
      if (!existing && lines.length >= maxLines)
        return `Your cart already holds ${maxLines} products. Order these first.`;
      setLines(
        existing
          ? lines.map((l) =>
              l === existing
                ? {
                    product,
                    quantity: Math.min(maxQuantity, l.quantity + quantity),
                  }
                : l,
            )
          : [...lines, { product, quantity }],
      );
      return "";
    },
    setQuantity(productId: string, quantity: number) {
      setLines(
        lines.map((l) => (l.product.id === productId ? { ...l, quantity } : l)),
      );
    },
    remove(productId: string) {
      setLines(lines.filter((l) => l.product.id !== productId));
    },
    clear() {
      setLines([]);
    },
  };
}

export function AddToCart({
  product,
  add,
  compact = false,
}: {
  product: CustomerProduct;
  add: (quantity: number) => void;
  compact?: boolean;
}) {
  const [text, setText] = useState("1"),
    id = useId();
  const quantity = wholeQuantity(text);
  return (
    <div>
      <form
        className={compact ? "sf-add sf-add-compact" : "sf-add"}
        onSubmit={(e) => {
          e.preventDefault();
          if (quantity === null) return;
          add(quantity);
          setText("1");
        }}
      >
        <label htmlFor={id}>Quantity</label>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={maxQuantity}
          step={1}
          value={text}
          aria-label={compact ? `Quantity of ${product.name}` : undefined}
          aria-invalid={quantity === null}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="sf-primary"
          type="submit"
          disabled={quantity === null}
          aria-label={compact ? `Add ${product.name} to cart` : undefined}
        >
          Add to cart
        </button>
      </form>
      <LocalCartFeedback productId={product.id} />
    </div>
  );
}

export function ShopCart({
  accountId,
  add,
  lines,
  warehouses,
  setQuantity,
  remove,
  close,
  checkout,
}: {
  accountId: string;
  add: (product: CustomerProduct, quantity: number) => void;
  lines: ShopLine[];
  warehouses: ShopWarehouse[];
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  close: () => void;
  checkout: (warehouseId: string) => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState(
      warehouses.length === 1 ? warehouses[0]!.id : "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    id = useId();
  const currency = lines[0]?.product.currency ?? "CAD";
  // Suggest each configured add-on once, unless it is already in the cart.
  const suggestions = useAddonSuggestions(
    accountId,
    lines.map((l) => l.product.id).slice(0, 100),
  );
  const inCart = new Set(lines.map((l) => l.product.id)),
    seen = new Set<string>();
  const addons = suggestions
    .flatMap((s) => s.addons)
    .filter((p) => !inCart.has(p.id) && !seen.has(p.id) && !!seen.add(p.id));
  const subtotal = lines.reduce(
      (sum, l) => sum + l.product.unit_price * l.quantity,
      0,
    ),
    tax = lines.reduce((sum, l) => sum + l.product.unit_tax * l.quantity, 0);
  return (
    <section className="sf-cart" aria-labelledby="sf-cart-heading">
      <div className="sf-cart-heading">
        <h2 id="sf-cart-heading" tabIndex={-1}>
          Your cart
        </h2>
        <button className="sf-back" type="button" onClick={close}>
          Continue shopping
        </button>
      </div>
      {!lines.length ? (
        <p className="sf-empty">
          Your cart is empty. Add products from the Shop.
        </p>
      ) : (
        <>
          <ul className="sf-cart-lines">
            {lines.map((l) => (
              <li key={l.product.id}>
                <div>
                  <p className="sf-sku">{l.product.sku}</p>
                  <h3>{l.product.name}</h3>
                  <CustomerPrice product={l.product} compact />
                </div>
                <label>
                  Quantity
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxQuantity}
                    step={1}
                    aria-label={`Quantity of ${l.product.name} in cart`}
                    defaultValue={l.quantity}
                    onChange={(e) => {
                      const value = wholeQuantity(e.target.value);
                      if (value !== null) setQuantity(l.product.id, value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="sf-cart-remove"
                  aria-label={`Remove ${l.product.name} from cart`}
                  onClick={() => remove(l.product.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <form
            className="sf-cart-checkout"
            onSubmit={(e) => {
              e.preventDefault();
              if (!warehouseId || busy) return;
              setBusy(true);
              setError("");
              checkout(warehouseId)
                .catch((e: unknown) => setError((e as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            <dl>
              <div>
                <dt>Estimated subtotal</dt>
                <dd>{money(subtotal, currency)}</dd>
              </div>
              <div>
                <dt>Estimated tax</dt>
                <dd>{money(tax, currency)}</dd>
              </div>
            </dl>
            <div className="sf-cart-warehouse">
              <label htmlFor={`${id}-warehouse`}>
                Ship from warehouse <span aria-hidden="true">(required)</span>
              </label>
              <select
                id={`${id}-warehouse`}
                value={warehouseId}
                required
                aria-describedby={`${id}-warehouse-help`}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Choose a warehouse</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <p id={`${id}-warehouse-help`} className="sf-purchase-note">
              {warehouseId
                ? "Warehouse selected. Review your order quantities next."
                : "Choose a warehouse to review your order."}
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              className="sf-primary"
              type="submit"
              disabled={!warehouseId || busy}
            >
              {busy ? "Opening order…" : "Review order quantities"}
            </button>
            <p className="sf-purchase-note">
              The cart is saved for the chosen warehouse when you continue.
              Current prices, tax and availability are confirmed in the quote
              before you accept.
            </p>
          </form>
          <AddonSuggestions
            title="Add-ons for products in your cart"
            addons={addons}
            add={(product) => add(product, 1)}
          />
        </>
      )}
    </section>
  );
}
