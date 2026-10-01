import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  command,
  request,
  setCsrf,
  downloadDocument,
  downloadStockLabel,
  downloadInboxDocument,
} from "./api.ts";
import { BillingInbox } from "./billing-inbox.tsx";
import { ScanInput } from "./scan-input.tsx";
import "./style.css";
type Item = Record<string, any>;
type Field = {
  name: string;
  label: string;
  type?: "number" | "textarea" | "checkbox" | "password" | "multiselect";
  options?: { value: string; label: string }[];
  value?: string | number | boolean | string[];
  optional?: boolean;
  help?: string;
  max?: number;
  min?: number;
  scan?: "single" | "lines";
};
type Dialog = {
  title: string;
  fields: Field[];
  perform: (values: Item) => Promise<unknown>;
  description?: string;
  submitLabel?: string;
};
const money = (value: number, currency = "CAD") =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    value / 100,
  );
const checkoutUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "checkout.stripe.com" &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
function App() {
  const [actor, setActor] = useState<Item | null>(null),
    [data, setData] = useState<Item | null>(null),
    [page, setPage] = useState("Overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [extra, setExtra] = useState<Item>({});
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const refresh = async () => {
    const d = await request("/api/dashboard");
    setData(d);
    const e: Item = {};
    if (
      ["admin", "commercial", "warehouse", "finance"].includes(
        actor?.role ?? "",
      )
    )
      e.purchases = await request("/api/purchases");
    if (["admin", "commercial", "buyer"].includes(actor?.role ?? ""))
      e.carts = await request("/api/carts");
    if (["admin", "warehouse", "support"].includes(actor?.role ?? "")) {
      e.transfers = await request("/api/transfers");
      e.transferDestinations = await request("/api/transfer-destinations");
      e.counts = await request("/api/counts");
      if (["admin", "warehouse"].includes(actor?.role ?? ""))
        e.labels = await request("/api/stock/labels");
    }
    if (
      ["admin", "finance", "commercial", "buyer", "support"].includes(
        actor?.role ?? "",
      )
    )
      e.effects = await request("/api/effects");
    if (["admin", "finance", "support"].includes(actor?.role ?? ""))
      e.callbacks = await request("/api/provider-callbacks");
    if (actor?.role === "admin") {
      e.users = await request("/api/users");
      e.openingImports = await request("/api/imports/opening");
      e.masterImports = await request("/api/imports/masters");
      e.documentImports = await request("/api/imports/documents");
    }
    if (
      [
        "admin",
        "finance",
        "commercial",
        "buyer",
        "warranty",
        "support",
      ].includes(actor?.role ?? "")
    ) {
      e.credits = await request("/api/credits");
      e.aging = await request("/api/billing/aging");
      e.downloads = await request("/api/billing/downloads");
      e.inbox = await request("/api/billing/inbox/page");
      e.inboxRefresh = crypto.randomUUID();
    }
    if (["admin", "finance"].includes(actor?.role ?? ""))
      e.billingProfiles = await request("/api/billing/profiles");
    e.security = await request("/api/security");
    setExtra(e);
  };
  useEffect(() => {
    void request("/api/session")
      .then((s) => {
        setCsrf(s.csrf);
        setPasswordChangeRequired(s.passwordChangeRequired);
        setActor(s.actor);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (actor && !passwordChangeRequired)
      void refresh().catch((e) => setError(e.message));
  }, [actor, passwordChangeRequired]);
  const clearSession = (message = "") => {
    setActor(null);
    setData(null);
    setExtra({});
    setDialog(null);
    setPage("Overview");
    setPasswordChangeRequired(false);
    setPassword("");
    setNotice(message);
    setError("");
    setCsrf("");
    sessionStorage.clear();
  };
  const signOut = () => {
    void request("/api/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => clearSession());
  };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await work();
      if ((result as Item)?.sessionEnded) {
        clearSession("Saved. Your sessions have ended. Sign in again.");
        return result;
      }
      await refresh();
      setNotice("Saved.");
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const open = (
    title: string,
    fields: Field[],
    perform: Dialog["perform"],
    description?: string,
    submitLabel?: string,
  ) => {
    setNotice("");
    setError("");
    setDialog({ title, fields, perform, description, submitLabel });
  };
  const options = (items: Item[], label: (i: Item) => string) =>
    (items ?? []).map((i) => ({ value: String(i.id), label: label(i) }));
  const reason: Field = {
    name: "reason",
    label: "Reason / evidence",
    type: "textarea",
  };
  const select = (
    name: string,
    label: string,
    items: Item[],
    display: (i: Item) => string,
    value?: string,
  ): Field => ({ name, label, options: options(items, display), value });
  const simple = (
    title: string,
    fields: Field[],
    name: string,
    transform: (v: Item) => unknown = (v) => v,
  ) => open(title, fields, (v) => command(name, transform(v)));
  const receiptDraft = (po: Item, draft?: Item) => {
    const saved = draft?.input;
    open(
      draft ? "Resume receipt scans" : "Start receipt draft",
      [
        ...(draft
          ? []
          : [
              select(
                "lineId",
                "Purchase line",
                po.lines.filter((l: Item) => l.received < l.quantity),
                (l) =>
                  `${productName(l.product_id)} · ${l.quantity - l.received} remaining`,
              ),
              { name: "deliveryRef", label: "Supplier delivery reference" },
            ]),
        {
          name: "observedSku",
          label: "Observed SKU on delivery",
          value: saved?.observedSku ?? "",
          scan: "single",
        },
        {
          name: "quantity",
          label: "Units",
          type: "number",
          min: 1,
          value: saved?.quantity ?? 1,
        },
        {
          name: "serials",
          label: "Serials, one per line (blank for bulk)",
          type: "textarea",
          optional: true,
          value: saved?.serials.join("\n") ?? "",
          scan: "lines",
        },
        { name: "bin", label: "Receiving bin", value: saved?.bin ?? "" },
        {
          name: "quarantine",
          label: "Requires inspection / quarantine",
          type: "checkbox",
          value: saved?.quarantine ?? true,
        },
      ],
      (v) =>
        command("purchase.draft.save", {
          ...v,
          draftId: draft?.id ?? null,
          revision: draft?.revision ?? 0,
          poId: po.id,
          lineId: saved?.lineId ?? v.lineId,
          deliveryRef: saved?.deliveryRef ?? v.deliveryRef,
          serials: v.serials
            .split(/\r?\n/)
            .map((serial: string) => serial.trim())
            .filter(Boolean),
        }),
      "Save incomplete scans to resume later. Stock changes only after Review and receive. Unsaved changes stay in this dialog; saving requires a connection.",
      "Save draft",
    );
  };
  const staff = actor?.role !== "buyer",
    admin = actor?.role === "admin",
    can = (...roles: string[]) => admin || roles.includes(actor?.role ?? "");
  const currency = data?.organization.currency ?? "CAD";
  const productName = (pid: string) =>
    data?.products.find((p: Item) => p.id === pid)?.sku ?? pid;
  const warehouseName = (wid: string) =>
    data?.warehouses.find((w: Item) => w.id === wid)?.name ?? "Warehouse";
  const accountName = (aid: string) =>
    data?.accounts.find((a: Item) => a.id === aid)?.name ?? "Account";
  const publishDocument = (
    kind: "invoice" | "credit",
    documentId: string,
    number: string,
    accountId: string,
  ) => {
    void run(() => downloadDocument(kind, documentId))
      .then((downloadId) => {
        if (typeof downloadId !== "string" || !downloadId)
          throw new Error(
            "Reviewed download receipt is missing. Retry the PDF.",
          );
        open(
          "Publish reviewed PDF",
          [reason],
          (v) =>
            command("billing.portal.publish", { downloadId, reason: v.reason }),
          `Review the downloaded ${number} PDF for ${accountName(accountId)} before publishing it to this customer's inbox. Publication makes it available; the buyer must separately confirm receipt.`,
          "Publish to customer inbox",
        );
      })
      .catch(() => {});
  };
  const receiveDocument = (publication: Item) => {
    void run(() => downloadInboxDocument(publication.id))
      .then((downloadId) => {
        if (typeof downloadId !== "string" || !downloadId)
          throw new Error("Download receipt is missing. Retry the PDF.");
        if (
          publication.acknowledgments.some(
            (a: Item) => a.actor_id === actor?.id,
          )
        )
          return;
        open(
          "Confirm document receipt",
          [],
          () =>
            command("billing.portal.acknowledge", {
              publicationId: publication.id,
              downloadId,
              contentHash: publication.content_hash,
              confirmation: "received",
            }),
          `After checking the downloaded ${publication.number} PDF, confirm receipt for ${accountName(publication.account_id)}. This does not confirm payment or agreement with its contents.`,
          "Confirm receipt",
        );
      })
      .catch(() => {});
  };
  const reviewCart = async (cart: Item) => {
    const quote = await command("cart.quote", {
      cartId: cart.id,
      revision: cart.revision,
    });
    open(
      "Review and accept order",
      [
        {
          name: "allowBackorder",
          label: "Accept any unavailable units as backorders",
          type: "checkbox",
          value: false,
        },
      ],
      (v) =>
        command("order.accept", {
          quoteId: quote.id,
          allowBackorder: !!v.allowBackorder,
        }),
      `${quote.lines.map((l: Item) => `${l.quantity} × ${l.description} ${money(l.unitPrice, quote.currency)} + ${money(l.unitTax, quote.currency)} tax per unit`).join("\n")}\nTotal: ${money(quote.total, quote.currency)}. Quote valid for 15 minutes.`,
    );
    return { keepDialog: true };
  };
  const editCart = (accountId: string, warehouseId: string, old?: Item) => {
    open(
      "Edit order quantities",
      data!.products.map((p: Item) => ({
        name: p.id,
        label: `${p.sku} · ${p.name}`,
        type: "number",
        value:
          old?.lines.find((l: Item) => l.productId === p.id)?.quantity ?? 0,
      })),
      async (v) => {
        const cart = await command("cart.save", {
          accountId,
          warehouseId,
          revision: old?.revision ?? 0,
          lines: data!.products
            .map((p: Item) => ({ productId: p.id, quantity: v[p.id] }))
            .filter((l: Item) => l.quantity > 0),
        });
        return reviewCart(cart);
      },
      "Set the quantity for each product. Zero removes a product. Saved quantities are loaded before editing. If another session changes this cart, reopen it to review the latest quantities.",
    );
  };
  const placeOrder = (
    accountId?: string,
    warehouseId?: string,
    _existing?: Item[],
  ) =>
    open(
      "Prepare an order",
      [
        select(
          "accountId",
          "Customer",
          data!.accounts,
          (a) => a.name,
          accountId,
        ),
        select(
          "warehouseId",
          "Warehouse",
          data!.warehouses,
          (w) => w.name,
          warehouseId,
        ),
      ],
      async (v) => {
        const carts = await request("/api/carts");
        editCart(
          v.accountId,
          v.warehouseId,
          carts.find(
            (c: Item) =>
              c.account_id === v.accountId && c.warehouse_id === v.warehouseId,
          ),
        );
        return { keepDialog: true };
      },
    );
  const table = (
    columns: string[],
    rows: Item[],
    cells: (row: Item) => React.ReactNode[],
    empty = "No records yet.",
  ) =>
    rows?.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <tr key={r.id ?? index}>
                {cells(r).map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="empty">{empty}</div>
    );
  const button = (label: string, action: () => void) => (
    <button className="secondary" disabled={busy} onClick={action}>
      {label}
    </button>
  );
  if (!actor)
    return (
      <main className="login">
        <div className="brand">
          D<span>Distributor</span>
        </div>
        <h1>Sign in to your workspace</h1>
        <p>Orders, warehouses and customer accounts in one place.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const s = await request("/api/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
              });
              setCsrf(s.csrf);
              setPasswordChangeRequired(s.passwordChangeRequired);
              setActor(s.actor);
              setPassword("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    );
  if (passwordChangeRequired)
    return (
      <main className="login">
        <h1>Change initial password</h1>
        <p>
          {actor.name}, choose a new password before entering the workspace.
          This ends all your sessions.
        </p>
        <PasswordChangeForm
          busy={busy}
          submit={(values) =>
            run(() => command("user.password.change", values))
          }
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="secondary" onClick={signOut}>
          Back to sign in
        </button>
      </main>
    );
  if (!data)
    return (
      <main className="login">
        <p role="status">Loading your workspace…</p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  const pages = staff
    ? [
        "Overview",
        "Orders",
        "Inventory",
        "Purchasing",
        "Catalog",
        "Billing",
        "Returns",
        "Customers",
        "Security",
        ...(admin ? ["Imports", "Administration"] : []),
      ]
    : ["Overview", "Orders", "Billing", "Returns", "Customers", "Security"];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          D<span>Distributor</span>
        </div>
        <p className="workspace">{data.organization.name}</p>
        <nav aria-label="Workspace">
          {pages.map((p) => (
            <button
              key={p}
              aria-current={page === p ? "page" : undefined}
              onClick={() => {
                setPage(p);
                setError("");
              }}
            >
              {p}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>{actor.name}</strong>
          <span>
            {actor.role} · {data.organization.region}
          </span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">
              {staff ? "OPERATIONS" : "CUSTOMER PORTAL"}
            </p>
            <h1>{page}</h1>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              void run(refresh).catch(() => {});
            }}
          >
            Refresh
          </button>
        </header>
        <div className="qualification">
          Development workspace · synthetic qualification pending · storage
          region {data.organization.region} · {currency}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {data.recoveryHold && (
          <p role="alert" className="notice">
            Recovery workspace: provider operations and payment links are on
            hold. An operator must reconcile this snapshot before activation.
          </p>
        )}
        {page === "Overview" && (
          <>
            <div className="metrics">
              {[
                [
                  "Open orders",
                  data.orders.filter((o: Item) => o.state === "open").length,
                ],
                [
                  "Invoice balance",
                  money(
                    data.invoices.reduce(
                      (s: number, i: Item) => s + Math.max(0, i.balance),
                      0,
                    ),
                    currency,
                  ),
                ],
                [
                  "Open returns",
                  data.claims.filter(
                    (c: Item) => !["disposed", "rejected"].includes(c.state),
                  ).length,
                ],
                ...(staff
                  ? [
                      [
                        "Available units",
                        data.stock.reduce(
                          (s: number, u: Item) => s + u.available,
                          0,
                        ),
                      ],
                    ]
                  : []),
              ].map(([label, value]) => (
                <section key={String(label)}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </section>
              ))}
            </div>
            <section className="panel">
              <h2>Work queue</h2>
              {table(
                ["Customer", "Order", "Status", "Created"],
                data.orders.slice(0, 8),
                (o: Item) => [
                  accountName(o.account_id),
                  o.id.slice(0, 8),
                  o.state,
                  new Date(o.created_at).toLocaleString(),
                ],
              )}
            </section>
            <section className="panel">
              <h2>Next actions</h2>
              <div className="actions">
                {can("commercial", "buyer") &&
                  button("Prepare order", () => placeOrder())}
                {can("warehouse") &&
                  button("Review inventory", () => setPage("Inventory"))}
                {can("finance", "buyer") &&
                  button("Review invoices", () => setPage("Billing"))}
              </div>
            </section>
          </>
        )}
        {page === "Orders" && (
          <>
            <div className="actions">
              {can("commercial", "buyer") &&
                button("Prepare order", () => placeOrder())}
            </div>
            {table(
              ["Customer / order", "Warehouse", "Lines", "Status", "Actions"],
              data.orders,
              (o: Item) => [
                <>
                  <strong>{accountName(o.account_id)}</strong>
                  <small>{o.id.slice(0, 8)}</small>
                </>,
                warehouseName(o.warehouse_id),
                o.lines.map((l: Item) => (
                  <div key={l.id}>
                    {productName(l.product_id)} · {l.quantity} ordered /{" "}
                    {l.allocated} reserved / {l.shipped} shipped / {l.canceled}{" "}
                    canceled
                  </div>
                )),
                <span className="badge">{o.state}</span>,
                <div className="actions">
                  {o.state === "open" &&
                    can("commercial") &&
                    button("Allocate", () => {
                      void run(() =>
                        command("order.allocate", {
                          orderId: o.id,
                          revision: o.revision,
                        }),
                      ).catch(() => {});
                    })}
                  {o.state === "open" &&
                    can("commercial", "buyer") &&
                    button("Cancel units", () =>
                      simple(
                        "Cancel open units",
                        [
                          select(
                            "lineId",
                            "Order line",
                            o.lines,
                            (l) =>
                              `${productName(l.product_id)} · ${l.quantity - l.shipped - l.canceled} open`,
                          ),
                          {
                            name: "quantity",
                            label: "Units",
                            type: "number",
                            value: 1,
                          },
                          reason,
                        ],
                        "order.cancel",
                        (v) => ({ ...v, orderId: o.id, revision: o.revision }),
                      ),
                    )}
                  {o.state === "open" &&
                    can("warehouse") &&
                    button("Pick / pack", () => {
                      void request(`/api/orders/${o.id}/picks`)
                        .then((picks) =>
                          open(
                            "Confirm picked stock",
                            [
                              select(
                                "allocationId",
                                "Allocation",
                                picks.filter(
                                  (a: Item) =>
                                    a.quantity > a.consumed + a.released,
                                ),
                                (a) =>
                                  `${productName(a.product_id)} · ${a.serial ?? "bulk"} · bin ${a.bin}`,
                              ),
                              {
                                name: "serial",
                                scan: "single",
                                label: "Scan serial (leave blank for bulk)",
                                optional: true,
                              },
                              {
                                name: "unpick",
                                label: "Unpick instead",
                                type: "checkbox",
                              },
                            ],
                            (v) =>
                              command("fulfillment.pick", {
                                orderId: o.id,
                                allocationId: v.allocationId,
                                serial: v.serial || null,
                                unpick: !!v.unpick,
                              }),
                          ),
                        )
                        .catch((e) => setError(e.message));
                    })}
                  {o.state === "open" &&
                    can("warehouse") &&
                    button("Pack shipment", () => {
                      void request(`/api/orders/${o.id}/picks`)
                        .then((picks) => {
                          const available = picks.filter(
                            (a: Item) => a.packable > 0,
                          );
                          if (!available.length) {
                            setError(
                              "No picked units are available to pack. Pick stock or void active packing first.",
                            );
                            return;
                          }
                          open(
                            "Pack picked units",
                            [
                              {
                                name: "mode",
                                label: "Delivery method",
                                options: [
                                  {
                                    value: "collection",
                                    label: "Customer collection",
                                  },
                                  { value: "carrier", label: "Carrier" },
                                ],
                              },
                              {
                                name: "address",
                                label: "Destination / collection point",
                                type: "textarea",
                              },
                              ...available.map((a: Item): Field => ({
                                name: `pack-${a.id}`,
                                label: `${productName(a.product_id)} · ${a.serial ?? "bulk"} · bin ${a.bin} · units to pack`,
                                type: "number",
                                value: a.packable,
                                max: a.packable,
                                help: `${a.packable} available; ${a.packed} already packed. Use 0 to leave this allocation for a later shipment.`,
                              })),
                            ],
                            (v) => {
                              const lines = available
                                .map((a: Item) => ({
                                  allocationId: a.id,
                                  quantity: v[`pack-${a.id}`],
                                }))
                                .filter((l: Item) => l.quantity > 0);
                              if (!lines.length)
                                throw new Error(
                                  "Select at least one unit to pack.",
                                );
                              return command("fulfillment.pack", {
                                orderId: o.id,
                                revision: o.revision,
                                mode: v.mode,
                                address: v.address,
                                lines,
                              });
                            },
                            "Choose the picked quantities for this shipment. Remaining units stay on the order. Packing holds stock; handover creates the invoice.",
                          );
                        })
                        .catch((e) => setError(e.message));
                    })}
                </div>,
              ],
            )}
            <h2>Shipments</h2>
            {table(
              ["Shipment", "Destination", "Units", "Status", "Actions"],
              data.shipments,
              (s: Item) => [
                s.id.slice(0, 8),
                s.address,
                s.lines.reduce(
                  (total: number, l: Item) => total + l.quantity,
                  0,
                ),
                s.state,
                <div className="actions">
                  {s.state === "packed" &&
                    can("warehouse") &&
                    button(
                      s.mode === "collection"
                        ? "Confirm collection"
                        : "Confirm shipment",
                      () =>
                        simple(
                          "Confirm handover",
                          [
                            ...(s.mode === "carrier"
                              ? ([
                                  { name: "carrier", label: "Carrier" },
                                  {
                                    name: "tracking",
                                    label: "Tracking / consignment",
                                  },
                                ] as Field[])
                              : []),
                            {
                              name: "handoverEvidence",
                              label: "Handover evidence",
                              type: "textarea",
                            },
                          ],
                          "fulfillment.ship",
                          (v) => ({ ...v, shipmentId: s.id }),
                        ),
                    )}
                  {s.state === "packed" &&
                    can("warehouse") &&
                    button("Void packing", () =>
                      simple(
                        "Void packed shipment",
                        [reason],
                        "fulfillment.void",
                        (v) => ({ ...v, shipmentId: s.id }),
                      ),
                    )}
                </div>,
              ],
            )}
            {extra.carts?.length > 0 && (
              <>
                <h2>Saved carts</h2>
                {table(
                  ["Customer", "Warehouse", "Items", "Actions"],
                  extra.carts,
                  (c: Item) => [
                    accountName(c.account_id),
                    warehouseName(c.warehouse_id),
                    c.lines
                      .map(
                        (l: Item) =>
                          `${productName(l.productId)} × ${l.quantity}`,
                      )
                      .join(", "),
                    button("Resume", () =>
                      placeOrder(c.account_id, c.warehouse_id, c.lines),
                    ),
                  ],
                )}
              </>
            )}
          </>
        )}
        {page === "Inventory" && (
          <>
            <div className="actions">
              {admin &&
                button("Add warehouse", () =>
                  simple(
                    "Add warehouse",
                    [{ name: "name", label: "Warehouse name" }],
                    "warehouse.create",
                  ),
                )}
              {button("Find serial", () =>
                open(
                  "Serial history",
                  [
                    {
                      name: "serial",
                      scan: "single",
                      label: "Scan or enter serial",
                    },
                  ],
                  async (v) => {
                    const trace = await request(
                      `/api/serials/${encodeURIComponent(v.serial)}`,
                    );
                    open(
                      `Serial ${trace.unit.serial}`,
                      [],
                      async () => ({}),
                      trace.movements
                        .map(
                          (m: Item) =>
                            `${new Date(m.created_at).toLocaleString()} · ${m.type} · ${m.quantity} · ${m.reason}`,
                        )
                        .join("\n"),
                    );
                    return { keepDialog: true };
                  },
                ),
              )}
            </div>
            {table(
              [
                "Product / serial",
                "Warehouse / bin",
                "Condition",
                "Physical / reserved / available",
                "Actions",
              ],
              data.stock,
              (u: Item) => [
                <>
                  <strong>{productName(u.product_id)}</strong>
                  <small>
                    {u.serial ?? "Bulk lot"} · {u.state}
                  </small>
                </>,
                `${warehouseName(u.warehouse_id)} / ${u.bin}`,
                u.condition,
                `${u.quantity} / ${u.reserved} / ${u.available}`,
                <div className="actions">
                  {can("warehouse") &&
                    u.state === "stock" &&
                    !u.serial &&
                    button("Start count", () =>
                      simple(
                        "Start stock count",
                        [
                          {
                            name: "countRef",
                            label: "Count reference (unique)",
                          },
                        ],
                        "count.start",
                        (v) => ({ ...v, unitId: u.id, revision: u.revision }),
                      ),
                    )}
                  {can("warehouse") &&
                    u.state === "stock" &&
                    u.quantity > 0 &&
                    button("Prepare QR label", () =>
                      open(
                        "Prepare stock QR label",
                        [
                          {
                            name: "copies",
                            label: "Copies (including deliberate duplicates)",
                            type: "number",
                            value: 1,
                            min: 1,
                            max: 20,
                          },
                        ],
                        (v) => downloadStockLabel(u.id, u.revision, v.copies),
                        `100 × 50 mm identity label. SKU ${data.products.find((p: Item) => p.id === u.product_id)?.sku ?? "unavailable"}; ${u.serial ? `serial ${u.serial}` : "bulk product: QR contains the SKU"}. Review the identity and copy count. Download preparation does not confirm printing. Open the PDF and print at actual size; verify a sample before attaching labels.`,
                        "Prepare and download",
                      ),
                    )}
                  {can("warehouse") &&
                    u.state === "stock" &&
                    button("Inspect", () =>
                      simple(
                        "Inspect stock",
                        [
                          {
                            name: "condition",
                            label: "Condition",
                            options: ["usable", "quarantine", "damaged"].map(
                              (v) => ({ value: v, label: v }),
                            ),
                          },
                          reason,
                        ],
                        "stock.inspect",
                        (v) => ({ ...v, unitId: u.id, revision: u.revision }),
                      ),
                    )}
                  {can("warehouse") &&
                    u.available > 0 &&
                    button("Transfer", () =>
                      simple(
                        "Dispatch transfer",
                        [
                          select(
                            "destinationId",
                            "Destination",
                            extra.transferDestinations.filter(
                              (w: Item) => w.id !== u.warehouse_id,
                            ),
                            (w) => w.name,
                          ),
                          {
                            name: "quantity",
                            label: "Units",
                            type: "number",
                            value: 1,
                            max: u.available,
                          },
                          reason,
                        ],
                        "transfer.dispatch",
                        (v) => ({ ...v, unitId: u.id, revision: u.revision }),
                      ),
                    )}
                </div>,
              ],
            )}
            {extra.labels?.length > 0 && (
              <>
                <h2>Prepared stock labels</h2>
                <p>
                  These receipts record PDF preparation only. Printing and
                  attachment require physical verification.
                </p>
                {table(
                  ["SKU / serial", "Copies", "Prepared", "Receipt"],
                  extra.labels,
                  (r: Item) => [
                    `${r.facts.sku} / ${r.facts.serial ?? "bulk SKU"}`,
                    r.copies,
                    r.requested_at,
                    r.id,
                  ],
                )}
              </>
            )}
            {extra.counts?.length > 0 && (
              <>
                <h2>Cycle counts</h2>
                <p>
                  A saved snapshot does not freeze stock. Approval checks the
                  stock revision and current reservations; a changed snapshot
                  needs a new count. Serialized discrepancies need custody
                  review.
                </p>
                {table(
                  [
                    "Reference / stock",
                    "Snapshot / observation",
                    "Status / evidence",
                    "Actions",
                  ],
                  extra.counts,
                  (c: Item) => [
                    <>
                      <strong>{c.count_ref}</strong>
                      <small>
                        {productName(c.product_id)} ·{" "}
                        {warehouseName(c.warehouse_id)} / {c.bin} ·{" "}
                        {c.condition}
                      </small>
                    </>,
                    <>
                      {c.expected_quantity} expected ·{" "}
                      {c.observed_quantity ?? "not yet"} observed
                      <small>
                        {c.delta === null
                          ? "Awaiting observation"
                          : `${c.delta > 0 ? "+" : ""}${c.delta} units · ${money(c.valueDelta, currency)} value adjustment`}{" "}
                        · cutoff {new Date(c.created_at).toLocaleString()}
                      </small>
                    </>,
                    <>
                      {c.state}
                      <small>{c.observation_reason ?? ""}</small>
                      <small>{c.decision_reason ?? ""}</small>
                    </>,
                    <div className="actions">
                      {c.state === "draft" &&
                        can("warehouse") &&
                        button("Record observation", () =>
                          simple(
                            "Record count observation",
                            [
                              {
                                name: "quantity",
                                label: "Physical units observed",
                                type: "number",
                                value: c.expected_quantity,
                                max: 100000,
                              },
                              reason,
                            ],
                            "count.submit",
                            (v) => ({ ...v, countId: c.id }),
                          ),
                        )}
                      {c.state === "submitted" &&
                        admin &&
                        button("Approve count", () =>
                          open(
                            "Approve stock correction",
                            [reason],
                            (v) =>
                              command("count.decide", {
                                ...v,
                                countId: c.id,
                                decision: "approve",
                              }),
                            `${c.count_ref}: ${c.expected_quantity} expected, ${c.observed_quantity} observed. Adjustment ${c.delta} units / ${money(c.valueDelta, currency)} at original unit cost. Approval does not post an accounting entry.`,
                          ),
                        )}
                      {["draft", "submitted"].includes(c.state) &&
                        admin &&
                        button("Reject count", () =>
                          simple(
                            "Reject stock count",
                            [reason],
                            "count.decide",
                            (v) => ({
                              ...v,
                              countId: c.id,
                              decision: "reject",
                            }),
                          ),
                        )}
                    </div>,
                  ],
                )}
              </>
            )}
            {extra.transfers && (
              <>
                <h2>Transfers</h2>
                {table(
                  ["Route", "Status", "Quantities / arrivals", "Actions"],
                  extra.transfers,
                  (t: Item) => [
                    `${t.source_name} → ${t.destination_name}`,
                    t.state,
                    <div>
                      {t.lines.map((line: Item) => (
                        <div key={line.line_id}>
                          <strong>
                            {productName(line.product_id)} ·{" "}
                            {line.serial ?? "Bulk lot"}
                          </strong>
                          <small>
                            {line.quantity} dispatched · {line.receivedQuantity}{" "}
                            received · {line.remainingQuantity} in transit
                            {line.lossQuantity > 0 && (
                              <>
                                {" "}
                                · {line.lostQuantity} unrecovered loss ·{" "}
                                {line.recoveredQuantity} recovered
                              </>
                            )}
                          </small>
                          {line.legacyReceived && (
                            <small>
                              Historical whole receipt; portion evidence
                              unavailable
                            </small>
                          )}
                          {line.receipts.map((r: Item) => (
                            <small key={r.id}>
                              {r.receipt_ref} · {r.quantity} {r.condition} ·{" "}
                              {r.bin}
                            </small>
                          ))}
                          {line.losses.map((loss: Item) => (
                            <div key={loss.id}>
                              <small>
                                {loss.loss_ref} · {loss.quantity} loss approved
                                · {loss.remainingLostQuantity} unrecovered ·{" "}
                                {loss.reason}
                              </small>
                              {loss.recoveries.map((r: Item) => (
                                <small key={r.id}>
                                  {r.receipt_ref} · {r.quantity} recovered{" "}
                                  {r.condition} · {r.bin}
                                </small>
                              ))}
                              {actor?.role === "admin" &&
                                loss.remainingLostQuantity > 0 &&
                                button("Recover lost stock", () =>
                                  simple(
                                    "Recover lost stock",
                                    [
                                      {
                                        name: "quantity",
                                        label: "Units found",
                                        type: "number",
                                        value: loss.remainingLostQuantity,
                                        max: loss.remainingLostQuantity,
                                      },
                                      {
                                        name: "serial",
                                        scan: "single",
                                        label:
                                          "Scan recovered serial (leave blank for bulk)",
                                        optional: !line.serial,
                                      },
                                      {
                                        name: "receiptRef",
                                        label:
                                          "Recovery reference (unique per portion)",
                                      },
                                      { name: "bin", label: "Destination bin" },
                                      {
                                        name: "condition",
                                        label: "Condition",
                                        value: "quarantine",
                                        options: [
                                          "usable",
                                          "quarantine",
                                          "damaged",
                                        ].map((v) => ({ value: v, label: v })),
                                      },
                                      reason,
                                    ],
                                    "transfer.recover",
                                    (v) => ({
                                      ...v,
                                      serial: v.serial || null,
                                      lossId: loss.id,
                                    }),
                                  ),
                                )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>,
                    can("warehouse") &&
                      (actor?.role === "admin" ||
                        actor?.sites.includes(t.destination_id)) && (
                        <div className="actions">
                          {t.lines
                            .filter((line: Item) => line.remainingQuantity > 0)
                            .map((line: Item) => (
                              <React.Fragment key={line.line_id}>
                                {button("Receive transfer", () =>
                                  simple(
                                    "Receive transfer",
                                    [
                                      {
                                        name: "quantity",
                                        label: "Units arriving",
                                        type: "number",
                                        value: line.remainingQuantity,
                                        max: line.remainingQuantity,
                                      },
                                      {
                                        name: "serial",
                                        scan: "single",
                                        label:
                                          "Scan transferred serial (leave blank for bulk)",
                                        optional: !line.serial,
                                      },
                                      {
                                        name: "receiptRef",
                                        label:
                                          "Arrival reference (unique per portion)",
                                        help: "Use a distinct reference for each quantity and condition received.",
                                      },
                                      { name: "bin", label: "Destination bin" },
                                      {
                                        name: "condition",
                                        label: "Condition",
                                        options: [
                                          "usable",
                                          "quarantine",
                                          "damaged",
                                        ].map((v) => ({ value: v, label: v })),
                                      },
                                      reason,
                                    ],
                                    "transfer.receive",
                                    (v) => ({
                                      ...v,
                                      serial: v.serial || null,
                                      transferId: t.id,
                                      lineId: line.line_id,
                                    }),
                                  ),
                                )}
                                {actor?.role === "admin" &&
                                  button("Approve transit loss", () =>
                                    simple(
                                      "Approve transit loss",
                                      [
                                        {
                                          name: "quantity",
                                          label: "Missing units to write off",
                                          type: "number",
                                          value: line.remainingQuantity,
                                          max: line.remainingQuantity,
                                        },
                                        {
                                          name: "serial",
                                          scan: "single",
                                          label:
                                            "Confirm missing serial (leave blank for bulk)",
                                          optional: !line.serial,
                                        },
                                        {
                                          name: "lossRef",
                                          label:
                                            "Loss evidence reference (unique per portion)",
                                        },
                                        reason,
                                      ],
                                      "transfer.loss",
                                      (v) => ({
                                        ...v,
                                        serial: v.serial || null,
                                        transferId: t.id,
                                        lineId: line.line_id,
                                        revision: line.transitRevision,
                                      }),
                                    ),
                                  )}
                              </React.Fragment>
                            ))}
                        </div>
                      ),
                  ],
                )}
              </>
            )}
          </>
        )}
        {page === "Purchasing" && (
          <>
            <div className="actions">
              {can("commercial") &&
                button("Add supplier", () =>
                  simple(
                    "Add supplier",
                    [{ name: "name", label: "Supplier name" }],
                    "supplier.create",
                  ),
                )}
              {can("commercial") &&
                button("Purchase order", () =>
                  simple(
                    "Create purchase order",
                    [
                      select(
                        "supplierId",
                        "Supplier",
                        extra.purchases?.suppliers,
                        (s) => s.name,
                      ),
                      select(
                        "warehouseId",
                        "Warehouse",
                        data.warehouses,
                        (w) => w.name,
                      ),
                      select(
                        "productId",
                        "Product",
                        data.products,
                        (p) => `${p.sku} · ${p.name}`,
                      ),
                      {
                        name: "quantity",
                        label: "Units",
                        type: "number",
                        value: 1,
                      },
                      {
                        name: "unitCost",
                        label: "Unit cost in cents",
                        type: "number",
                      },
                    ],
                    "purchase.create",
                    (v) => ({
                      supplierId: v.supplierId,
                      warehouseId: v.warehouseId,
                      lines: [
                        {
                          productId: v.productId,
                          quantity: v.quantity,
                          unitCost: v.unitCost,
                        },
                      ],
                    }),
                  ),
                )}
            </div>
            {table(
              ["Purchase order", "Warehouse", "Lines", "Status", "Actions"],
              extra.purchases?.orders ?? [],
              (po: Item) => [
                po.id.slice(0, 8),
                warehouseName(po.warehouse_id),
                po.lines.map((l: Item) => (
                  <div key={l.id}>
                    {productName(l.product_id)} · {l.received}/{l.quantity}{" "}
                    received
                  </div>
                )),
                po.state,
                po.state === "open" &&
                  can("warehouse") &&
                  button("Start receipt draft", () => receiptDraft(po)),
              ],
            )}
            <h2>Saved receipt scans</h2>
            <p>
              Drafts do not reserve or receive stock. Review the saved SKU,
              quantity, serials, bin and inspection choice before receiving.
            </p>
            {table(
              ["Delivery", "Warehouse / SKU", "Scans", "Status", "Actions"],
              extra.purchases?.drafts ?? [],
              (draft: Item) => [
                draft.delivery_ref,
                `${warehouseName(draft.warehouse_id)} · ${draft.input.observedSku}`,
                <div>
                  {draft.input.serials.length} scans · {draft.input.quantity}{" "}
                  units · {draft.input.bin}
                  <br />
                  {draft.input.quarantine
                    ? "Inspection required"
                    : "Available on receipt"}
                </div>,
                `${draft.state} · v${draft.revision}`,
                <div className="actions">
                  {draft.state === "draft" && can("warehouse") && (
                    <>
                      {button("Resume scans", () =>
                        receiptDraft(
                          extra.purchases.orders.find(
                            (po: Item) => po.id === draft.po_id,
                          ),
                          draft,
                        ),
                      )}
                      {button("Review and receive", () =>
                        open(
                          "Review physical receipt",
                          [],
                          () =>
                            command("purchase.draft.confirm", {
                              draftId: draft.id,
                              revision: draft.revision,
                            }),
                          `Delivery ${draft.delivery_ref} · ${warehouseName(draft.warehouse_id)} · SKU ${draft.input.observedSku} · ${draft.input.quantity} units · bin ${draft.input.bin} · ${draft.input.quarantine ? "inspection required" : "available stock"}. Serials: ${draft.input.serials.join(", ") || "bulk (no serials)"}. Confirm only after checking the physical delivery.`,
                          "Receive stock",
                        ),
                      )}
                      {button("Discard draft", () =>
                        simple(
                          "Discard receipt draft",
                          [reason],
                          "purchase.draft.discard",
                          (v) => ({
                            draftId: draft.id,
                            revision: draft.revision,
                            reason: v.reason,
                          }),
                        ),
                      )}
                    </>
                  )}
                  {button(
                    "View draft history",
                    () =>
                      void run(async () => {
                        const history = await request(
                          `/api/purchases/drafts/${encodeURIComponent(draft.id)}/history`,
                        );
                        open(
                          "Receipt draft history",
                          [],
                          async () => ({}),
                          history
                            .map(
                              (entry: Item) =>
                                `v${entry.revision} · ${entry.state} · ${entry.created_at} · ${entry.actor_id} · ${entry.reason} · SKU ${entry.input.observedSku} · ${entry.input.quantity} units · ${entry.input.bin} · ${entry.input.serials.join(", ") || "bulk"}`,
                            )
                            .join("\n"),
                        );
                      }),
                  )}
                </div>,
              ],
            )}
            <h2>Purchase receipts and supplier returns</h2>
            <p>
              Confirm a physical handover at original stock cost. Supplier
              credit and accounting reconciliation remain pending; a return does
              not reopen the purchase order.
            </p>
            {table(
              ["Delivery", "Purchased / returned", "Held stock", "Actions"],
              extra.purchases?.receipts ?? [],
              (receipt: Item) => [
                receipt.delivery_ref,
                `${receipt.quantity} purchased · ${receipt.returnedQuantity} returned`,
                receipt.candidates.map((u: Item) => (
                  <div key={u.id}>
                    {productName(u.product_id)} ·{" "}
                    {warehouseName(u.warehouse_id)} · {u.bin} ·{" "}
                    {u.serial ?? "bulk"} · {u.quantity - u.reserved} unreserved
                    · {u.condition}
                  </div>
                )),
                actor.role === "admin" &&
                  receipt.candidates.length > 0 &&
                  receipt.returnedQuantity < receipt.quantity &&
                  button("Return to supplier", () =>
                    simple(
                      "Confirm supplier return",
                      [
                        select(
                          "unitId",
                          "Held stock lot",
                          receipt.candidates,
                          (u) =>
                            `${productName(u.product_id)} · ${warehouseName(u.warehouse_id)} · ${u.bin} · ${u.serial ?? "bulk"} · ${u.quantity - u.reserved} units`,
                        ),
                        {
                          name: "quantity",
                          label: "Units handed over",
                          type: "number",
                          value: 1,
                          min: 1,
                          max: receipt.quantity - receipt.returnedQuantity,
                        },
                        {
                          name: "serial",
                          scan: "single",
                          label: "Scan serial (blank for bulk)",
                          optional: true,
                        },
                        {
                          name: "returnRef",
                          label: "Supplier return reference (unique)",
                        },
                        {
                          name: "handoverEvidence",
                          label: "Supplier handover evidence",
                        },
                        { name: "reason", label: "Reason / evidence" },
                      ],
                      "purchase.return",
                      (v) => ({
                        ...v,
                        receiptId: receipt.id,
                        revision: receipt.candidates.find(
                          (u: Item) => u.id === v.unitId,
                        ).revision,
                        serial: v.serial || null,
                      }),
                    ),
                  ),
              ],
            )}
            {extra.purchases?.returns?.length > 0 &&
              table(
                [
                  "Return reference",
                  "Custody",
                  "Quantity / original cost",
                  "Evidence",
                  "Financial status",
                ],
                extra.purchases.returns,
                (r: Item) => [
                  r.return_ref,
                  `${warehouseName(r.warehouse_id)} · ${r.serial ?? "bulk"}`,
                  `${r.quantity} units · ${money(r.quantity * r.unit_cost, data.currency)} cost`,
                  `${r.reason} · ${r.handover_evidence}`,
                  "Supplier credit pending",
                ],
              )}
          </>
        )}
        {page === "Catalog" && (
          <>
            <div className="actions">
              {can("commercial") &&
                button("Add product", () =>
                  simple(
                    "Add product",
                    [
                      { name: "sku", label: "SKU" },
                      { name: "name", label: "Product name" },
                      {
                        name: "serialized",
                        label: "Track each serial",
                        type: "checkbox",
                        value: true,
                      },
                      {
                        name: "unitPrice",
                        label: "Unit price in cents",
                        type: "number",
                      },
                      {
                        name: "taxBasisPoints",
                        label: "Tax rate in basis points",
                        type: "number",
                        help: "100 basis points = 1%. Tax registrations/rules require finance approval.",
                      },
                    ],
                    "product.create",
                  ),
                )}
            </div>
            {table(
              [
                "SKU",
                "Product",
                "Serial tracking",
                "Base price",
                "Tax",
                "Actions",
              ],
              data.products,
              (p: Item) => [
                p.sku,
                p.name,
                p.serialized ? "Required" : "Bulk",
                money(p.unit_price, currency),
                `${p.tax_bp / 100}%`,
                can("commercial") &&
                  button("Tier price", () =>
                    simple(
                      "Set tier price",
                      [
                        { name: "tier", label: "Customer price tier" },
                        {
                          name: "unitPrice",
                          label: "Unit price in cents",
                          type: "number",
                        },
                      ],
                      "product.price",
                      (v) => ({ ...v, productId: p.id }),
                    ),
                  ),
              ],
            )}
          </>
        )}
        {page === "Billing" && (
          <>
            <div className="actions">
              {can("finance") && (
                <a className="button secondary" href="/api/accounting.csv">
                  Export reconciliation CSV
                </a>
              )}
            </div>
            {table(
              ["Invoice", "Customer", "Total", "Balance", "Actions"],
              data.invoices,
              (i: Item) => [
                <>
                  <strong>{i.number}</strong>
                  <small>{new Date(i.created_at).toLocaleDateString()}</small>
                  {i.opening && (
                    <small>
                      Historical opening document · source {i.opening.source_id}
                      <br />
                      Due {new Date(i.opening.due_at).toLocaleDateString()} ·
                      cutoff {i.opening.cutoff_at}
                      <br />
                      At cutoff: {money(i.opening.credited, i.currency)}{" "}
                      credited · {money(i.opening.paid, i.currency)} paid ·{" "}
                      {money(i.opening.refunded, i.currency)} refunded
                    </small>
                  )}
                </>,
                accountName(i.account_id),
                money(i.total, i.currency),
                money(i.balance, i.currency),
                <div className="actions">
                  {can("finance") &&
                    i.balance > 0 &&
                    button("Record payment", () =>
                      simple(
                        "Record verified manual payment",
                        [
                          {
                            name: "amount",
                            label: "Amount in cents",
                            type: "number",
                            value: i.balance,
                          },
                          {
                            name: "reference",
                            label: "Bank / payment reference",
                          },
                          reason,
                        ],
                        "billing.payment.manual",
                        (v) => ({ ...v, invoiceId: i.id }),
                      ),
                    )}
                  {can("finance", "buyer") &&
                    i.balance > 0 &&
                    button("Request Stripe checkout", () => {
                      void run(() =>
                        command("stripe.checkout", { invoiceId: i.id }),
                      ).catch(() => {});
                    })}
                  {can("finance") &&
                    i.lines.some((l: Item) => l.creditable_quantity > 0) &&
                    button("Credit units", () =>
                      simple(
                        "Issue credit against original invoice",
                        [
                          select(
                            "lineId",
                            "Invoice line",
                            i.lines.filter(
                              (l: Item) => l.creditable_quantity > 0,
                            ),
                            (l) =>
                              `${l.description} · ${l.quantity} invoiced · ${l.credited_quantity} credited · ${l.creditable_quantity} remaining`,
                          ),
                          {
                            name: "quantity",
                            label: "Units to credit",
                            type: "number",
                            value: 1,
                          },
                          {
                            name: "reference",
                            label: "Unique business reference",
                          },
                          reason,
                        ],
                        "billing.credit",
                        (v) => ({
                          invoiceId: i.id,
                          reference: v.reference,
                          reason: v.reason,
                          lines: [{ lineId: v.lineId, quantity: v.quantity }],
                        }),
                      ),
                    )}
                  {button("Download invoice PDF", () => {
                    void run(() => downloadDocument("invoice", i.id))
                      .then(() =>
                        setNotice(
                          "PDF download prepared. Receipt does not confirm delivery.",
                        ),
                      )
                      .catch(() => {});
                  })}
                  {can("finance") &&
                    !i.hasActivePublication &&
                    button("Review and publish invoice", () =>
                      publishDocument("invoice", i.id, i.number, i.account_id),
                    )}
                </div>,
              ],
            )}
            {extra.credits?.length > 0 && (
              <>
                <h2>Credit notes</h2>
                {table(
                  ["Credit", "Original invoice", "Total", "Actions"],
                  extra.credits,
                  (c: Item) => [
                    c.number,
                    data.invoices.find((i: Item) => i.id === c.invoice_id)
                      ?.number ?? c.invoice_id,
                    money(c.total, currency),
                    <div className="actions">
                      {button("Download credit PDF", () => {
                        void run(() => downloadDocument("credit", c.id))
                          .then(() =>
                            setNotice(
                              "PDF download prepared. Receipt does not confirm delivery.",
                            ),
                          )
                          .catch(() => {});
                      })}
                      {can("finance") &&
                        !c.hasActivePublication &&
                        button("Review and publish credit", () =>
                          publishDocument(
                            "credit",
                            c.id,
                            c.number,
                            data.invoices.find(
                              (i: Item) => i.id === c.invoice_id,
                            )?.account_id,
                          ),
                        )}
                    </div>,
                  ],
                )}
              </>
            )}
            {extra.inbox && (
              <BillingInbox
                key={extra.inboxRefresh}
                initial={extra.inbox}
                personal={actor.role === "buyer"}
                accountName={accountName}
                renderActions={(p) => (
                  <div className="actions">
                    {actor.role === "buyer" &&
                      p.state === "available" &&
                      button(
                        p.acknowledgments.some(
                          (a: Item) => a.actor_id === actor.id,
                        )
                          ? "Download received PDF"
                          : "Download and review receipt",
                        () => receiveDocument(p),
                      )}
                    {can("finance") &&
                      p.state === "available" &&
                      button("Withdraw publication", () =>
                        open(
                          "Withdraw portal publication",
                          [reason],
                          (v) =>
                            command("billing.portal.withdraw", {
                              publicationId: p.id,
                              revision: p.revision,
                              reason: v.reason,
                            }),
                          `Withdraw ${p.number} from the customer inbox. Existing copies and receipt confirmations remain. This does not cancel or change the financial document.`,
                          "Withdraw from inbox",
                        ),
                      )}
                  </div>
                )}
              />
            )}
            {extra.aging && (
              <>
                <h2>Account aging</h2>
                <p>
                  Current ledger balances · due dates use UTC calendar days.
                  Missing due dates remain unknown. Credit balances and pending
                  refunds appear separately.
                </p>
                {can("finance") && (
                  <a className="button secondary" href="/api/billing/aging.csv">
                    Export aging CSV
                  </a>
                )}
                {table(
                  [
                    "Customer",
                    "Not due",
                    "1–30 days",
                    "31–60 days",
                    "61–90 days",
                    "Over 90 days",
                    "Unknown due",
                    "Credit balance",
                    "Net",
                    "Holds / pending refunds",
                  ],
                  extra.aging.accounts,
                  (a: Item) => [
                    a.name,
                    money(a.notDue, a.currency),
                    money(a.days1to30, a.currency),
                    money(a.days31to60, a.currency),
                    money(a.days61to90, a.currency),
                    money(a.daysOver90, a.currency),
                    money(a.unknownDue, a.currency),
                    money(a.creditBalance, a.currency),
                    money(a.net, a.currency),
                    `${money(a.holds, a.currency)} / ${money(a.pendingRefunds, a.currency)}`,
                  ],
                )}
                <small>Observed {extra.aging.observedAt}</small>
              </>
            )}
            {extra.billingProfiles && (
              <>
                <h2>Billing identities and terms</h2>
                <p>
                  Changes apply to new invoices. Existing native documents
                  retain issuance details; reconstructed documents identify
                  missing historical details.
                </p>
                {table(
                  ["Party", "Address", "Tax registration", "Terms", "Actions"],
                  [
                    { ...extra.billingProfiles.issuer, accountId: null },
                    ...extra.billingProfiles.customers,
                  ],
                  (p: Item) => [
                    p.name,
                    p.address || "Not recorded",
                    p.taxRegistration || "Not recorded",
                    p.accountId === null
                      ? "Issuer"
                      : p.termDays === null
                        ? "Not recorded"
                        : `${p.termDays} calendar days`,
                    button("Edit billing details", () =>
                      open(
                        "Edit billing details",
                        [
                          {
                            name: "name",
                            label: "Billing name",
                            value: p.name,
                          },
                          {
                            name: "address",
                            label: "Billing address",
                            type: "textarea",
                            value: p.address,
                            optional: true,
                          },
                          {
                            name: "taxRegistration",
                            label: "Tax registration",
                            value: p.taxRegistration,
                            optional: true,
                          },
                          ...(p.accountId === null
                            ? []
                            : [
                                {
                                  name: "termsChoice",
                                  label: "Terms basis",
                                  value:
                                    p.termDays === null
                                      ? "unknown"
                                      : "configured",
                                  options: [
                                    { value: "unknown", label: "Not recorded" },
                                    {
                                      value: "configured",
                                      label: "Specified calendar days",
                                    },
                                  ],
                                },
                                {
                                  name: "termDays",
                                  label: "Calendar days",
                                  type: "number" as const,
                                  value: p.termDays ?? 0,
                                  min: 0,
                                  max: 365,
                                },
                              ]),
                          reason,
                        ],
                        (v) =>
                          command("billing.profile", {
                            accountId: p.accountId,
                            name: v.name,
                            address: v.address,
                            taxRegistration: v.taxRegistration,
                            termDays:
                              p.accountId === null ||
                              v.termsChoice === "unknown"
                                ? null
                                : v.termDays,
                            version: p.version,
                            reason: v.reason,
                          }),
                      ),
                    ),
                  ],
                )}
              </>
            )}
            {extra.downloads?.length > 0 && (
              <>
                <h2>Prepared document downloads</h2>
                <p>
                  These receipts record an authorized request and prepared
                  bytes. They do not establish receipt, reading or delivery to
                  the customer.
                </p>
                {table(
                  ["Document", "Requested", "Bytes", "SHA-256", "State"],
                  extra.downloads,
                  (d: Item) => [
                    d.number,
                    d.requested_at,
                    d.size,
                    <code>{d.content_hash}</code>,
                    d.state,
                  ],
                )}
              </>
            )}
            {extra.effects && (
              <>
                <h2>Provider operations</h2>
                {table(
                  ["Provider", "Status", "Result", "Actions"],
                  extra.effects,
                  (e: Item) => [
                    e.provider,
                    e.state,
                    checkoutUrl(e.result?.checkoutUrl) ? (
                      <a
                        href={checkoutUrl(e.result.checkoutUrl)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open secure checkout
                      </a>
                    ) : (
                      (e.error ?? "Awaiting configured provider processing")
                    ),
                    can("finance", "support") ? (
                      <div className="actions">
                        {e.state === "pending" &&
                          button("Send to provider", () => {
                            void run(() =>
                              request(`/api/effects/${e.id}/execute`, {
                                method: "POST",
                              }),
                            ).catch(() => {});
                          })}
                        {e.state === "unknown" &&
                          button("Check provider outcome", () => {
                            void run(() =>
                              request(`/api/effects/${e.id}/reconcile`, {
                                method: "POST",
                              }),
                            ).catch(() => {});
                          })}
                      </div>
                    ) : (
                      ""
                    ),
                  ],
                )}
              </>
            )}
            {extra.callbacks?.length > 0 && (
              <>
                <h2>Payment confirmations</h2>
                {table(
                  ["Event", "Status", "Review", "Actions"],
                  extra.callbacks,
                  (c: Item) => [
                    c.event_id,
                    c.state,
                    c.error ?? "",
                    can("finance") &&
                    ["waiting", "blocked", "failed"].includes(c.state)
                      ? button("Retry verification", () => {
                          void run(() =>
                            request(`/api/provider-callbacks/${c.id}/retry`, {
                              method: "POST",
                            }),
                          ).catch(() => {});
                        })
                      : "",
                  ],
                )}
              </>
            )}
          </>
        )}
        {page === "Returns" && (
          <>
            <div className="actions">
              {can("warranty", "commercial", "buyer") &&
                button("Submit claim / return", () => {
                  const sold = data.shipments
                    .filter((s: Item) => s.state === "shipped")
                    .flatMap((s: Item) =>
                      s.units
                        .filter((u: Item) => u.serial)
                        .map((u: Item) => ({
                          ...u,
                          id: u.unitId,
                          accountId: s.account_id,
                        })),
                    );
                  open(
                    "Request return or warranty review",
                    [
                      select(
                        "unitId",
                        "Sold serial",
                        sold,
                        (u) => `${u.serial} · ${productName(u.productId)}`,
                      ),
                      {
                        name: "type",
                        label: "Request type",
                        options: [
                          { value: "return", label: "Return" },
                          { value: "warranty", label: "Warranty" },
                        ],
                      },
                      {
                        name: "issue",
                        label: "Issue / reason",
                        type: "textarea",
                      },
                      {
                        name: "evidence",
                        label: "Evidence reference",
                        type: "textarea",
                      },
                    ],
                    (v) =>
                      command("warranty.submit", {
                        ...v,
                        accountId: sold.find((u: Item) => u.id === v.unitId)
                          ?.accountId,
                      }),
                  );
                })}
            </div>
            {table(
              ["Claim", "Customer", "Issue", "State", "Actions"],
              data.claims,
              (c: Item) => [
                c.id.slice(0, 8),
                accountName(c.account_id),
                c.issue,
                c.state,
                <div className="actions">
                  {c.state === "submitted" &&
                    can("warranty") &&
                    button("Review", () =>
                      simple(
                        "Review request",
                        [
                          {
                            name: "approved",
                            label: "Approve return authorization",
                            type: "checkbox",
                          },
                          reason,
                        ],
                        "warranty.review",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                  {c.state === "approved" &&
                    can("warehouse") &&
                    button("Receive return", () =>
                      simple(
                        "Receive authorized return",
                        [
                          select(
                            "warehouseId",
                            "Warehouse",
                            data.warehouses,
                            (w) => w.name,
                          ),
                          { name: "bin", label: "Quarantine bin" },
                          {
                            name: "serial",
                            scan: "single",
                            label: "Scan returned serial",
                          },
                        ],
                        "warranty.receive",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                  {c.type === "warranty" &&
                    ["approved", "received", "inspected", "repair"].includes(
                      c.state,
                    ) &&
                    can("warranty") &&
                    !c.manufacturerCases?.some(
                      (m: Item) => m.state === "pending",
                    ) &&
                    button("Record manufacturer referral", () =>
                      open(
                        "Record manufacturer referral",
                        [
                          { name: "manufacturer", label: "Manufacturer" },
                          {
                            name: "reference",
                            label: "Manufacturer case reference",
                          },
                          {
                            name: "evidence",
                            label: "Referral evidence reference",
                            type: "textarea",
                          },
                          reason,
                        ],
                        (v) =>
                          command("warranty.manufacturer.refer", {
                            ...v,
                            claimId: c.id,
                          }),
                        "Record a referral already arranged outside Distributor. This does not contact the manufacturer, move equipment or authorize a customer credit.",
                        "Record referral",
                      ),
                    )}
                  {c.state === "received" &&
                    can("warehouse", "warranty") &&
                    button("Inspect", () =>
                      simple(
                        "Inspect returned equipment",
                        [
                          {
                            name: "findings",
                            label: "Inspection findings",
                            type: "textarea",
                          },
                        ],
                        "warranty.inspect",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                  {["inspected", "repair"].includes(c.state) &&
                    can("warranty") &&
                    button("Disposition", () =>
                      simple(
                        "Approve stock disposition",
                        [
                          {
                            name: "disposition",
                            label: "Disposition",
                            options: ["restock", "scrap", "repair"].map(
                              (v) => ({ value: v, label: v }),
                            ),
                          },
                          reason,
                        ],
                        "warranty.disposition",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                  {c.state === "disposed" &&
                    !c.credit_id &&
                    can("finance") &&
                    button("Issue return credit", () =>
                      simple(
                        "Approve return credit",
                        [reason],
                        "warranty.credit",
                        (v) => ({ ...v, claimId: c.id }),
                      ),
                    )}
                </div>,
              ],
            )}
            {can("warranty", "warehouse", "finance", "commercial") && (
              <section aria-label="Manufacturer case history">
                <h2>Manufacturer case history</h2>
                <p>
                  Staff record referrals and responses obtained outside
                  Distributor. Acceptance does not move equipment, approve a
                  replacement or issue a credit. Follow the separate authorized
                  return and billing tasks.
                </p>
                {table(
                  [
                    "Claim",
                    "Manufacturer / reference",
                    "State",
                    "Evidence history",
                    "Actions",
                  ],
                  data.claims.flatMap((c: Item) =>
                    (c.manufacturerCases ?? []).map((m: Item) => ({
                      ...m,
                      claim: c,
                    })),
                  ),
                  (m: Item) => [
                    m.claim.id.slice(0, 8),
                    <>
                      {m.manufacturer}
                      <small>{m.reference}</small>
                    </>,
                    `${m.state} · revision ${m.revision}`,
                    m.history.map((h: Item) => (
                      <div key={h.revision}>
                        <small>
                          {h.state} · {h.created_at} · {h.actor_id}
                        </small>
                        <small>
                          {h.evidence} · {h.reason}
                        </small>
                      </div>
                    )),
                    m.state === "pending" && can("warranty")
                      ? button("Record manufacturer response", () =>
                          open(
                            "Record manufacturer response",
                            [
                              {
                                name: "outcome",
                                label: "Manufacturer outcome",
                                options: [
                                  "accepted",
                                  "denied",
                                  "cancelled",
                                ].map((v) => ({ value: v, label: v })),
                              },
                              {
                                name: "evidence",
                                label: "Response evidence reference",
                                type: "textarea",
                              },
                              reason,
                            ],
                            (v) =>
                              command("warranty.manufacturer.decide", {
                                ...v,
                                caseId: m.id,
                                revision: m.revision,
                              }),
                            `${m.manufacturer} · ${m.reference} · ${m.state}. Record the actual external response or cancellation evidence. This does not change stock, claim disposition or money.`,
                            "Record response",
                          ),
                        )
                      : "",
                  ],
                  "No manufacturer cases have been recorded.",
                )}
              </section>
            )}
          </>
        )}
        {page === "Customers" && (
          <>
            <div className="actions">
              {can("commercial") &&
                button("Add customer", () =>
                  simple(
                    "Add customer account",
                    [
                      { name: "name", label: "Customer name" },
                      { name: "tier", label: "Price tier", value: "standard" },
                      {
                        name: "creditLimit",
                        label: "Credit limit in cents",
                        type: "number",
                      },
                    ],
                    "account.create",
                  ),
                )}
            </div>
            {table(
              [
                "Customer",
                "Tier",
                "Credit limit",
                "Hold",
                "Residency",
                "Actions",
              ],
              data.accounts,
              (a: Item) => [
                a.name,
                a.tier,
                money(a.credit_limit, a.currency),
                a.held ? "On hold" : "Clear",
                `${data.organization.region} · ${a.residency_mode}`,
                <div className="actions">
                  {can("finance") &&
                    button(a.held ? "Clear hold" : "Apply hold", () =>
                      simple("Finance hold", [reason], "account.hold", (v) => ({
                        ...v,
                        accountId: a.id,
                        held: !a.held,
                      })),
                    )}
                  {can("commercial", "buyer") &&
                    button("Residency choice", () =>
                      simple(
                        "Choose data residency",
                        [
                          {
                            name: "region",
                            label: "Application storage region",
                            options: [
                              { value: "CA", label: "Canada" },
                              { value: "US", label: "United States" },
                            ],
                            value: data.organization.region,
                          },
                          {
                            name: "mode",
                            label: "Processor policy",
                            options: [
                              {
                                value: "strict",
                                label: "Strict regional residency",
                              },
                              {
                                value: "provider-exceptions",
                                label: "Accept selected processor exceptions",
                              },
                            ],
                            value: a.residency_mode,
                          },
                          {
                            name: "stripe",
                            label:
                              "Allow Stripe processing outside the storage region",
                            type: "checkbox",
                            value: JSON.parse(a.provider_exceptions).includes(
                              "stripe",
                            ),
                          },
                          {
                            name: "quickbooks",
                            label:
                              "Allow QuickBooks processing outside the storage region",
                            type: "checkbox",
                            value: JSON.parse(a.provider_exceptions).includes(
                              "quickbooks",
                            ),
                          },
                          {
                            name: "carrier",
                            label:
                              "Allow selected carrier processing outside the storage region",
                            type: "checkbox",
                            value: JSON.parse(a.provider_exceptions).includes(
                              "carrier",
                            ),
                          },
                          {
                            name: "acknowledgment",
                            label: "Acknowledgment of reviewed processor terms",
                            type: "textarea",
                          },
                        ],
                        "account.residency",
                        (v) => ({
                          accountId: a.id,
                          region: v.region,
                          mode: v.mode,
                          providers: ["stripe", "quickbooks", "carrier"].filter(
                            (p) => v[p],
                          ),
                          version: a.residency_version,
                          acknowledgment: v.acknowledgment,
                        }),
                      ),
                    )}
                </div>,
              ],
            )}
          </>
        )}
        {page === "Imports" && admin && (
          <>
            <section className="panel">
              <h2>Opening stock review</h2>
              <p>
                Import a reviewed opening balance before this product has stock
                at its destination warehouse. A dry run changes no stock. Any
                rejected row or unmatched quantity/value blocks the whole batch.
              </p>
              {button("Dry run opening stock", () =>
                open(
                  "Dry run opening stock",
                  [
                    {
                      name: "batchRef",
                      label: "Batch reference (new for each correction)",
                    },
                    {
                      name: "sourceRef",
                      label:
                        "Source dataset reference (keep for corrected batches)",
                    },
                    { name: "sourceHash", label: "Original source SHA-256" },
                    {
                      name: "cutoffAt",
                      label: "Source cutoff (UTC)",
                      value: new Date().toISOString(),
                    },
                    {
                      name: "expectedQuantity",
                      label: "Independent source quantity",
                      type: "number",
                      max: 1e9,
                    },
                    {
                      name: "expectedValue",
                      label: `Independent source cost (${currency} cents)`,
                      type: "number",
                      max: 1e12,
                    },
                    {
                      name: "acknowledgment",
                      label: "Source rights, mapping and cutoff evidence",
                      type: "textarea",
                    },
                    {
                      name: "rows",
                      label: "Opening rows (JSON)",
                      type: "textarea",
                      help: "Array of objects: sourceId, sku, warehouse (exact name), bin, serial (null for bulk), quantity, unitCost (cents), condition (usable/quarantine/damaged). Maximum 500 rows. Use the source evidence, not sample balances.",
                    },
                  ],
                  async (v) => {
                    let rows;
                    try {
                      rows = JSON.parse(v.rows);
                    } catch {
                      throw new Error(
                        "Opening rows must be valid JSON. Correct the file before creating a dry run.",
                      );
                    }
                    return command("import.opening.preview", {
                      ...v,
                      rows,
                      version: 1,
                      region: data.organization.region,
                      currency,
                    });
                  },
                ),
              )}
            </section>
            <section className="panel">
              <h2>Customer and catalog review</h2>
              <p>
                Dry runs create no accounts or products. Every row explicitly
                creates a new record (targetId null) or matches an existing ID
                with all reviewed fields equal. Approval applies the whole
                batch. New customers start with strict residency; matching
                preserves existing choices. No users, provider consent, stock,
                unpaid balances or accounting entries are imported here.
              </p>
              <details>
                <summary>Existing record IDs for explicit matching</summary>
                {table(
                  ["Type", "Target ID", "Name / SKU"],
                  [
                    ...data.accounts.map((a: Item) => ({
                      ...a,
                      kind: "customer",
                      label: a.name,
                    })),
                    ...data.products.map((p: Item) => ({
                      ...p,
                      kind: "catalog",
                      label: `${p.sku} · ${p.name}`,
                    })),
                  ],
                  (r: Item) => [r.kind, r.id, r.label],
                )}
              </details>
              {button("Dry run customer/catalog", () =>
                open(
                  "Dry run customer/catalog",
                  [
                    {
                      name: "kind",
                      label: "Import type",
                      options: [
                        { value: "customer", label: "Customers" },
                        { value: "catalog", label: "Catalog" },
                      ],
                      value: "customer",
                    },
                    {
                      name: "batchRef",
                      label: "Batch reference (new for each correction)",
                    },
                    {
                      name: "sourceRef",
                      label:
                        "Source dataset reference (keep for corrected batches)",
                    },
                    { name: "sourceHash", label: "Original source SHA-256" },
                    {
                      name: "cutoffAt",
                      label: "Source cutoff (UTC)",
                      value: new Date().toISOString(),
                    },
                    {
                      name: "expectedQuantity",
                      label: "Independent source record count",
                      type: "number",
                      max: 500,
                    },
                    {
                      name: "expectedValue",
                      label: `Independent control amount (${currency} cents)`,
                      type: "number",
                      max: 1e12,
                      help: "Sum of customer credit limits or catalog base unit prices. This is a migration control total, not stock value or an account balance.",
                    },
                    {
                      name: "acknowledgment",
                      label: "Source rights, mapping and cutoff evidence",
                      type: "textarea",
                    },
                    {
                      name: "rows",
                      label: "Master rows (JSON)",
                      type: "textarea",
                      help: "Maximum 500 objects. Customers: sourceId, targetId, name, tier, creditLimit (cents), held (boolean). Catalog: sourceId, targetId, sku, name, serialized (boolean), unitPrice (cents), taxBasisPoints. targetId is null for creation or an exact existing ID for matching; no other fields.",
                    },
                  ],
                  async (v) => {
                    let rows;
                    try {
                      rows = JSON.parse(v.rows);
                    } catch {
                      throw new Error(
                        "Master rows must be valid JSON. Correct the file before creating a dry run.",
                      );
                    }
                    return command("import.masters.preview", {
                      ...v,
                      rows,
                      version: 1,
                      region: data.organization.region,
                      currency,
                    });
                  },
                ),
              )}
            </section>
            <section className="panel">
              <h2>Unpaid document review</h2>
              <p>
                Carry forward original invoices and their reconciled outstanding
                balances. Historical credits, payments and refunds remain source
                evidence. Approval creates no stock, shipment, new cash receipt
                or accounting delivery.
              </p>
              <details>
                <summary>Customer and product IDs for document mapping</summary>
                {table(
                  ["Type", "ID", "Name / SKU"],
                  [
                    ...data.accounts.map((a: Item) => ({
                      id: a.id,
                      kind: "Customer",
                      label: a.name,
                    })),
                    ...data.products.map((p: Item) => ({
                      id: p.id,
                      kind: "Product",
                      label: `${p.sku} · ${p.name}`,
                    })),
                  ],
                  (r: Item) => [r.kind, r.id, r.label],
                )}
              </details>
              {button("Dry run unpaid documents", () =>
                open(
                  "Dry run unpaid documents",
                  [
                    {
                      name: "batchRef",
                      label: "Batch reference (new for each correction)",
                    },
                    {
                      name: "sourceRef",
                      label:
                        "Source dataset reference (keep for corrected batches)",
                    },
                    { name: "sourceHash", label: "Original source SHA-256" },
                    {
                      name: "cutoffAt",
                      label: "Source cutoff (UTC)",
                      value: new Date().toISOString(),
                    },
                    {
                      name: "expectedQuantity",
                      label: "Independent document count",
                      type: "number",
                      min: 1,
                      max: 500,
                    },
                    ...[
                      ["expectedNet", "Independent original net"],
                      ["expectedTax", "Independent original tax"],
                      ["expectedCredited", "Independent historical credits"],
                      ["expectedPaid", "Independent historical payments"],
                      ["expectedRefunded", "Independent historical refunds"],
                      ["expectedValue", "Independent outstanding balance"],
                    ].map(([name, label]) => ({
                      name: name!,
                      label: `${label} (${currency} cents)`,
                      type: "number" as const,
                      min: 0,
                      max: 1e12,
                    })),
                    {
                      name: "acknowledgment",
                      label: "Source rights, mapping and cutoff evidence",
                      type: "textarea",
                    },
                    {
                      name: "rows",
                      label: "Unpaid document rows (JSON)",
                      type: "textarea",
                      help: "Maximum 500 documents: sourceId, accountId, number, issuedAt, dueAt, net, tax, total, credited, paid, refunded, balance, lines. Each original line: productId, description, quantity, unitPrice, unitTax, creditedQuantity. Money is integer cents; dates are canonical UTC. Preserve original amounts and credited units; do not substitute the remaining balance for the invoice total.",
                    },
                  ],
                  async (v) => {
                    let rows;
                    try {
                      rows = JSON.parse(v.rows);
                    } catch {
                      throw new Error(
                        "Unpaid document rows must be valid JSON. Correct the file before creating a dry run.",
                      );
                    }
                    return command("import.documents.preview", {
                      ...v,
                      rows,
                      version: 1,
                      region: data.organization.region,
                      currency,
                    });
                  },
                ),
              )}
            </section>
            {(extra.documentImports ?? []).map((b: Item) => (
              <section
                className="panel"
                key={b.id}
                aria-label={`Document batch ${b.batchRef}`}
              >
                <h2>
                  {b.batchRef} · unpaid documents · {b.state}
                </h2>
                <p>
                  Source {b.sourceRef} · cutoff {b.cutoffAt}
                </p>
                <p>
                  Source hash: <code>{b.sourceHash}</code>
                </p>
                <p>{b.acknowledgment}</p>
                <p>
                  Independent source: {b.expectedQuantity} documents. Eligible:{" "}
                  {b.report.quantity} documents. {b.report.issues.length} review
                  issues.
                </p>
                {table(
                  ["Control", "Independent source", "Eligible documents"],
                  [
                    {
                      label: "Original net",
                      expected: b.expectedNet,
                      actual: b.report.net,
                    },
                    {
                      label: "Original tax",
                      expected: b.expectedTax,
                      actual: b.report.tax,
                    },
                    {
                      label: "Historical credits",
                      expected: b.expectedCredited,
                      actual: b.report.credited,
                    },
                    {
                      label: "Historical payments",
                      expected: b.expectedPaid,
                      actual: b.report.paid,
                    },
                    {
                      label: "Historical refunds",
                      expected: b.expectedRefunded,
                      actual: b.report.refunded,
                    },
                    {
                      label: "Outstanding balance",
                      expected: b.expectedValue,
                      actual: b.report.value,
                    },
                  ],
                  (r: Item) => [
                    r.label,
                    money(r.expected, b.currency),
                    money(r.actual, b.currency),
                  ],
                )}
                {table(
                  [
                    "Row / source",
                    "Original invoice / customer",
                    "Source fields",
                    "Outstanding",
                    "Review",
                  ],
                  b.report.rows,
                  (r: Item) => [
                    `${r.row} · ${r.sourceId ?? "missing source ID"}`,
                    r.entry
                      ? `${r.entry.matchKey} · ${r.entry.name}`
                      : "Unmapped",
                    <code>{JSON.stringify(r.source)}</code>,
                    r.entry ? money(r.entry.value, b.currency) : "Rejected",
                    r.issues.length
                      ? r.issues.map((i: Item) => i.message).join(" ")
                      : "Eligible",
                  ],
                )}
                {b.report.issues
                  .filter((i: Item) => i.row === null)
                  .map((i: Item, index: number) => (
                    <p role="alert" key={index}>
                      {i.message}
                    </p>
                  ))}
                <p>
                  Review fingerprint: <code>{b.reviewHash}</code>
                </p>
                {b.result ? (
                  <>
                    <p>
                      {b.result.decision} · {b.result.reason} ·{" "}
                      {b.result.quantity} documents /{" "}
                      {money(b.result.value, b.currency)} outstanding
                    </p>
                    {table(
                      [
                        "Source row",
                        "Original number",
                        "Permanent invoice",
                        "Original total",
                        "Opening outstanding",
                      ],
                      b.result.mappings,
                      (m: Item) => [
                        m.sourceId,
                        m.number,
                        m.invoiceId,
                        money(m.total, b.currency),
                        money(m.balance, b.currency),
                      ],
                    )}
                  </>
                ) : (
                  <div className="actions">
                    {b.state === "ready" &&
                      button("Approve document batch", () =>
                        open(
                          "Approve document batch",
                          [reason],
                          (v) =>
                            command("import.documents.decide", {
                              batchId: b.id,
                              reviewHash: b.reviewHash,
                              decision: "approve",
                              reason: v.reason,
                            }),
                          `Review the original documents, historical credits/cash/refunds and independent ${money(b.expectedValue, b.currency)} outstanding balance. This records historical debt without posting new cash or accounting entries.`,
                        ),
                      )}
                    {button("Reject document batch", () =>
                      open("Reject document batch", [reason], (v) =>
                        command("import.documents.decide", {
                          batchId: b.id,
                          reviewHash: b.reviewHash,
                          decision: "reject",
                          reason: v.reason,
                        }),
                      ),
                    )}
                  </div>
                )}
              </section>
            ))}
            {(extra.masterImports ?? []).map((b: Item) => (
              <section
                className="panel"
                key={b.id}
                aria-label={`Master batch ${b.batchRef}`}
              >
                <h2>
                  {b.batchRef} · {b.kind} · {b.state}
                </h2>
                <p>
                  Source {b.sourceRef} · cutoff {b.cutoffAt}
                </p>
                <p>
                  Source hash: <code>{b.sourceHash}</code>
                </p>
                <p>{b.acknowledgment}</p>
                <p>
                  Independent source: {b.expectedQuantity} records /{" "}
                  {money(b.expectedValue, b.currency)} control amount. Eligible:{" "}
                  {b.report.quantity} records /{" "}
                  {money(b.report.value, b.currency)}. {b.report.creates} create
                  / {b.report.matches} match. {b.report.issues.length} review
                  issues.
                </p>
                {table(
                  [
                    "Row / source",
                    "Reviewed record",
                    "Source fields",
                    "Action / control amount",
                    "Review",
                  ],
                  b.report.rows,
                  (r: Item) => [
                    `${r.row} · ${r.sourceId ?? "missing source ID"}`,
                    r.entry
                      ? `${r.entry.name} · ${r.entry.matchKey}`
                      : "Unmapped",
                    <code>{JSON.stringify(r.source)}</code>,
                    r.entry
                      ? `${r.entry.targetId ? `Match ${r.entry.targetId}` : "Create"} / ${money(r.entry.value, b.currency)}`
                      : "Rejected",
                    r.issues.length
                      ? r.issues.map((i: Item) => i.message).join(" ")
                      : "Eligible",
                  ],
                )}
                {b.report.issues
                  .filter((i: Item) => i.row === null)
                  .map((i: Item, index: number) => (
                    <p role="alert" key={index}>
                      {i.message}
                    </p>
                  ))}
                <p>
                  Review fingerprint: <code>{b.reviewHash}</code>
                </p>
                {b.result ? (
                  <>
                    <p>
                      {b.result.decision} · {b.result.reason} ·{" "}
                      {b.result.quantity} records /{" "}
                      {money(b.result.value, b.currency)}
                    </p>
                    {table(
                      [
                        "Source row",
                        "Permanent target",
                        "Action",
                        "Control amount",
                      ],
                      b.result.mappings,
                      (m: Item) => [
                        m.sourceId,
                        m.targetId,
                        m.action,
                        money(m.value, b.currency),
                      ],
                    )}
                  </>
                ) : (
                  <div className="actions">
                    {b.state === "ready" &&
                      button("Approve master batch", () =>
                        open(
                          "Approve master batch",
                          [reason],
                          (v) =>
                            command("import.masters.decide", {
                              batchId: b.id,
                              reviewHash: b.reviewHash,
                              decision: "approve",
                              reason: v.reason,
                            }),
                          `Review ${b.report.creates} creations and ${b.report.matches} exact matches. Control amount is ${money(b.expectedValue, b.currency)}; it is not an opening balance. Residency choices remain protected.`,
                        ),
                      )}
                    {button("Reject master batch", () =>
                      open("Reject master batch", [reason], (v) =>
                        command("import.masters.decide", {
                          batchId: b.id,
                          reviewHash: b.reviewHash,
                          decision: "reject",
                          reason: v.reason,
                        }),
                      ),
                    )}
                  </div>
                )}
              </section>
            ))}
            {(extra.openingImports ?? []).map((b: Item) => (
              <section
                className="panel"
                key={b.id}
                aria-label={`Opening batch ${b.batchRef}`}
              >
                <h2>
                  {b.batchRef} · {b.state}
                </h2>
                <p>
                  Source {b.sourceRef} · cutoff {b.cutoffAt}
                </p>
                <p>
                  Source hash: <code>{b.sourceHash}</code>
                </p>
                <p>{b.acknowledgment}</p>
                <p>
                  Independent source: {b.expectedQuantity} units /{" "}
                  {money(b.expectedValue, b.currency)}. Eligible rows:{" "}
                  {b.report.quantity} units /{" "}
                  {money(b.report.value, b.currency)}. {b.report.issues.length}{" "}
                  review issues.
                </p>
                {table(
                  ["Row / source", "Target stock", "Quantity / cost", "Review"],
                  b.report.rows,
                  (r: Item) => [
                    `${r.row} · ${r.sourceId ?? "missing source ID"}`,
                    r.entry
                      ? `${productName(r.entry.productId)} · ${warehouseName(r.entry.warehouseId)} / ${r.entry.bin} · ${r.entry.serial ?? "bulk"} · ${r.entry.condition}`
                      : "Unmapped",
                    r.entry
                      ? `${r.entry.quantity} × ${money(r.entry.unitCost, b.currency)}`
                      : "Rejected",
                    r.issues.length
                      ? r.issues.map((i: Item) => i.message).join(" ")
                      : "Eligible",
                  ],
                )}
                {b.report.issues
                  .filter((i: Item) => i.row === null)
                  .map((i: Item, index: number) => (
                    <p role="alert" key={index}>
                      {i.message}
                    </p>
                  ))}
                {b.result ? (
                  <>
                    <p>
                      {b.result.decision} · {b.result.reason} ·{" "}
                      {b.result.quantity} units /{" "}
                      {money(b.result.value, b.currency)}
                    </p>
                    {table(
                      [
                        "Source row",
                        "Permanent stock record",
                        "Applied quantity / value",
                      ],
                      b.result.mappings,
                      (m: Item) => [
                        m.sourceId,
                        m.unitId,
                        `${m.quantity} / ${money(m.value, b.currency)}`,
                      ],
                    )}
                  </>
                ) : (
                  <div className="actions">
                    {b.state === "ready" &&
                      button("Approve opening stock", () =>
                        open(
                          "Approve opening stock",
                          [reason],
                          (v) =>
                            command("import.opening.decide", {
                              batchId: b.id,
                              reviewHash: b.reviewHash,
                              decision: "approve",
                              reason: v.reason,
                            }),
                          `Review ${b.expectedQuantity} units valued at ${money(b.expectedValue, b.currency)} from ${b.sourceRef}. All rows apply together. This creates opening custody, without supplier purchase or accounting entries.`,
                        ),
                      )}
                    {button("Reject opening batch", () =>
                      open("Reject opening batch", [reason], (v) =>
                        command("import.opening.decide", {
                          batchId: b.id,
                          reviewHash: b.reviewHash,
                          decision: "reject",
                          reason: v.reason,
                        }),
                      ),
                    )}
                  </div>
                )}
              </section>
            ))}
          </>
        )}
        {page === "Security" && (
          <section className="panel">
            <h2>Your sign-in security</h2>
            <p>
              {extra.security?.email} · {extra.security?.sessions ?? 0} active
              sessions. Password changes end every session.
            </p>
            <PasswordChangeForm
              busy={busy}
              submit={(values) =>
                run(() => command("user.password.change", values))
              }
            />
            <hr />
            {button("End all my sessions", () =>
              open(
                "End all my sessions",
                [],
                () => command("user.sessions.end-own", {}),
                "This ends your signed-in sessions on every device.",
                "End sessions",
              ),
            )}
            <p>You will need to sign in again on every device.</p>
          </section>
        )}
        {page === "Administration" && admin && (
          <>
            <section className="panel">
              <h2>Staff and buyer access</h2>
              {button("Create user", () =>
                simple(
                  "Create user",
                  [
                    { name: "name", label: "Name" },
                    { name: "email", label: "Email" },
                    {
                      name: "password",
                      label: "Initial password (14+ characters)",
                      type: "password",
                    },
                    {
                      name: "currentPassword",
                      label: "Your current password",
                      type: "password",
                    },
                    {
                      name: "role",
                      label: "Role",
                      options: [
                        "warehouse",
                        "commercial",
                        "finance",
                        "warranty",
                        "buyer",
                        "support",
                        "admin",
                      ].map((v) => ({ value: v, label: v })),
                    },
                    {
                      ...select(
                        "accountId",
                        "Buyer account (buyer role only)",
                        data.accounts,
                        (a) => a.name,
                      ),
                      optional: true,
                    },
                    {
                      name: "sites",
                      label: "Permitted warehouses",
                      type: "multiselect",
                      options: options(data.warehouses, (w) => w.name),
                      optional: true,
                      help: "Select each warehouse this user may operate.",
                    },
                  ],
                  "user.create",
                  (v) => ({
                    ...v,
                    ...(v.role !== "buyer" ? { accountId: undefined } : {}),
                    requirePasswordChange: true,
                    sites: v.sites ?? [],
                  }),
                ),
              )}
              <p>
                New users must change their initial password. Access changes,
                resets and revocations end every session for the affected user.
              </p>
              {table(
                ["User", "Role / scope", "Status", "Sessions", "Actions"],
                extra.users ?? [],
                (u: Item) => [
                  <span>
                    {u.name}
                    <br />
                    {u.email}
                  </span>,
                  <span>
                    {u.role}
                    {u.accountId ? ` · ${accountName(u.accountId)}` : ""}
                    <br />
                    {u.sites.map(warehouseName).join(", ") ||
                      (u.role === "admin"
                        ? "All warehouses"
                        : "No warehouse operations")}
                  </span>,
                  `${u.active ? "Active" : "Inactive"}${u.passwordChangeRequired ? " · Password change required" : ""} · v${u.revision}`,
                  u.sessions,
                  <div className="actions">
                    {button(`Edit access: ${u.name}`, () =>
                      simple(
                        `Edit access: ${u.name}`,
                        [
                          { name: "name", label: "Name", value: u.name },
                          { name: "email", label: "Email", value: u.email },
                          {
                            name: "role",
                            label: "Role",
                            value: u.role,
                            options: [
                              "warehouse",
                              "commercial",
                              "finance",
                              "warranty",
                              "buyer",
                              "support",
                              "admin",
                            ].map((value) => ({ value, label: value })),
                          },
                          {
                            ...select(
                              "accountId",
                              "Buyer account (buyer role only)",
                              data.accounts,
                              (a) => a.name,
                              u.accountId ?? "",
                            ),
                            optional: true,
                          },
                          {
                            name: "sites",
                            label: "Permitted warehouses",
                            type: "multiselect",
                            options: options(data.warehouses, (w) => w.name),
                            optional: true,
                            value: u.sites,
                          },
                          {
                            name: "active",
                            label: "Active user",
                            type: "checkbox",
                            value: u.active,
                          },
                          {
                            name: "currentPassword",
                            label: "Your current password",
                            type: "password",
                          },
                          reason,
                        ],
                        "user.update",
                        (v) => ({
                          ...v,
                          accountId:
                            v.role === "buyer" ? v.accountId : undefined,
                          userId: u.id,
                          revision: u.revision,
                        }),
                      ),
                    )}
                    {button(`Reset password: ${u.name}`, () =>
                      simple(
                        `Reset password: ${u.name}`,
                        [
                          {
                            name: "password",
                            label: "New initial password (14+ characters)",
                            type: "password",
                          },
                          {
                            name: "currentPassword",
                            label: "Your current password",
                            type: "password",
                          },
                          reason,
                        ],
                        "user.password.reset",
                        (v) => ({ ...v, userId: u.id, revision: u.revision }),
                      ),
                    )}
                    {button(`Revoke sessions: ${u.name}`, () =>
                      simple(
                        `Revoke sessions: ${u.name}`,
                        [
                          {
                            name: "currentPassword",
                            label: "Your current password",
                            type: "password",
                          },
                          reason,
                        ],
                        "user.sessions.revoke",
                        (v) => ({ ...v, userId: u.id, revision: u.revision }),
                      ),
                    )}
                  </div>,
                ],
              )}
            </section>
            <section className="panel">
              <h2>Audit history</h2>
              {button("Load audit trail", () => {
                void request("/api/audit")
                  .then((audit) => setExtra((e) => ({ ...e, audit })))
                  .catch((e) => setError(e.message));
              })}
              {extra.audit &&
                table(
                  ["Time", "Action", "Reference"],
                  extra.audit,
                  (a: Item) => [
                    new Date(a.created_at).toLocaleString(),
                    a.action,
                    a.reference,
                  ],
                )}
            </section>
          </>
        )}
      </main>
      {dialog && (
        <Modal
          dialog={dialog}
          busy={busy}
          error={error}
          close={() => setDialog(null)}
          submit={async (values) => {
            try {
              const result = await run(() => dialog.perform(values));
              if (!(result as Item)?.keepDialog) setDialog(null);
            } catch {}
          }}
        />
      )}
    </div>
  );
}
function PasswordChangeForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit: (values: {
    currentPassword: string;
    password: string;
  }) => Promise<unknown>;
}) {
  const [currentPassword, setCurrentPassword] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        if (password !== confirmation) {
          setError("New passwords must match.");
          return;
        }
        try {
          await submit({ currentPassword, password });
          setCurrentPassword("");
          setPassword("");
          setConfirmation("");
        } catch {}
      }}
    >
      <label>
        Current password
        <input
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </label>
      <label>
        New password (14–256 characters)
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={14}
          maxLength={256}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={14}
          maxLength={256}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button disabled={busy}>Change password</button>
    </form>
  );
}
function Modal({
  dialog,
  busy,
  error,
  close,
  submit,
}: {
  dialog: Dialog;
  busy: boolean;
  error: string;
  close: () => void;
  submit: (values: Item) => Promise<void>;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current!;
    const focusables = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          "input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href]",
        ),
      );
    focusables()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = focusables(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    element.addEventListener("keydown", keyboard);
    return () => {
      element.removeEventListener("keydown", keyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, [dialog.title]);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2 id="dialog-title">{dialog.title}</h2>
        {dialog.description && (
          <p className="description">{dialog.description}</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <form
          key={dialog.title}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget),
              values: Item = {};
            for (const f of dialog.fields)
              values[f.name] =
                f.type === "multiselect"
                  ? form.getAll(f.name).map(String)
                  : f.type === "checkbox"
                    ? form.get(f.name) === "on"
                    : f.type === "number"
                      ? Number(form.get(f.name))
                      : String(form.get(f.name) ?? "");
            void submit(values);
          }}
        >
          {dialog.fields.map((f) => (
            <div
              key={f.name}
              className={
                f.type === "checkbox" ? "form-field check" : "form-field"
              }
            >
              {f.type === "checkbox" ? (
                <input
                  name={f.name}
                  aria-labelledby={`field-label-${f.name}`}
                  type="checkbox"
                  defaultChecked={Boolean(f.value)}
                />
              ) : null}
              <span id={`field-label-${f.name}`}>{f.label}</span>
              {f.type === "checkbox" ? null : f.options ? (
                <select
                  name={f.name}
                  aria-labelledby={`field-label-${f.name}`}
                  multiple={f.type === "multiselect"}
                  required={!f.optional}
                  defaultValue={
                    f.type === "multiselect"
                      ? Array.isArray(f.value)
                        ? f.value
                        : []
                      : String(f.value ?? f.options[0]?.value ?? "")
                  }
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.scan ? (
                <ScanInput
                  name={f.name}
                  label={f.label}
                  value={String(f.value ?? "")}
                  multiline={f.scan === "lines"}
                  optional={Boolean(f.optional)}
                  disabled={busy}
                />
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.name}
                  aria-labelledby={`field-label-${f.name}`}
                  required={!f.optional}
                  defaultValue={String(f.value ?? "")}
                />
              ) : (
                <input
                  name={f.name}
                  aria-labelledby={`field-label-${f.name}`}
                  type={f.type ?? "text"}
                  required={!f.optional}
                  min={f.type === "number" ? (f.min ?? 0) : undefined}
                  max={f.max}
                  step={f.type === "number" ? 1 : undefined}
                  defaultValue={String(f.value ?? "")}
                />
              )}{" "}
              {f.help && <small>{f.help}</small>}
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button disabled={busy}>
              {busy
                ? "Saving…"
                : (dialog.submitLabel ??
                  (dialog.fields.length ? "Continue" : "Close"))}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
