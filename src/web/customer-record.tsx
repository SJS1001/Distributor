import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { PageSections, PageSection } from "./workspace.tsx";
import {
  customerTabs,
  type CustomerTab,
  type NavigationIntent,
  navigationHash,
} from "./navigation.ts";
import { CustomerPricingControls } from "./customer-pricing.tsx";
import { CustomerPurchasingRules } from "./purchasing-rules.tsx";
import { RecordNotes } from "./record-notes.tsx";
import type {
  CustomerContacts,
  CustomerContact,
  SaveCustomerContact,
} from "../shared/customer-record.ts";
import "./record-forms.css";
import "./customer-record.css";
type Account = {
  id: string;
  name: string;
  tier: string;
  currency: string;
  credit_limit: number;
  held: number;
  residency_mode: string;
};
const money = (n: number, c: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency: c }).format(
    n / 100,
  );
export function CustomerDirectory({
  accounts,
  onNavigate,
  actions,
}: {
  accounts: Account[];
  onNavigate: (r: NavigationIntent) => void;
  actions: React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const rows = accounts.filter((a) =>
    `${a.name} ${a.tier}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="customer-directory">
      <div
        className="queue-controls customer-directory-tools"
        role="search"
        aria-label="Customer filters"
      >
        <label className="queue-field">
          Find customer
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Company or price tier"
          />
        </label>
        <div className="queue-field-actions">{actions}</div>
      </div>
      <p className="customer-directory-count" role="status">
        {search.trim()
          ? `${rows.length} of ${accounts.length} ${accounts.length === 1 ? "customer" : "customers"}`
          : `${rows.length} ${rows.length === 1 ? "customer" : "customers"}`}
      </p>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="customer-directory-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>Price tier</th>
                <th className="numeric">Credit limit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <a
                      className="record-title-link customer-name-link"
                      title={`Customer ${a.id}`}
                      href={navigationHash({
                        page: "Customers",
                        customerId: a.id,
                        customerTab: "overview",
                      })}
                      onClick={(e) => {
                        if (
                          e.button ||
                          e.metaKey ||
                          e.ctrlKey ||
                          e.shiftKey ||
                          e.altKey
                        )
                          return;
                        e.preventDefault();
                        onNavigate({
                          page: "Customers",
                          customerId: a.id,
                          customerTab: "overview",
                        });
                      }}
                    >
                      {a.name}
                    </a>
                  </td>
                  <td>
                    <span
                      className="record-status"
                      data-status={a.held ? "due" : undefined}
                    >
                      {a.held ? "On hold" : "Active"}
                    </span>
                  </td>
                  <td className="customer-tier">{a.tier}</td>
                  <td className="numeric">
                    {money(a.credit_limit, a.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!rows.length && (
        <p className="record-detail-empty">
          {accounts.length
            ? "No customers match this search."
            : "No customer accounts yet."}
        </p>
      )}
    </section>
  );
}
export function CustomerRecord({
  account,
  tab = "overview",
  onTab,
  onBack,
  role,
  actorId,
  recoveryScope,
  terms,
  editBilling,
  billingEpoch,
  onNavigate,
}: {
  account: Account;
  tab?: CustomerTab;
  onTab: (t: CustomerTab) => void;
  onBack: () => void;
  role: string;
  actorId: string;
  recoveryScope: string;
  terms: React.ReactNode;
  editBilling?: (p: any) => void;
  billingEpoch?: number;
  onNavigate: (route: NavigationIntent) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [account.id]);
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  const finance = ["admin", "finance"].includes(role),
    commercial = ["admin", "commercial"].includes(role);
  return (
    <div ref={root} className="customer-record">
      <button className="secondary" onClick={onBack}>
        ← All customers
      </button>
      <header className="customer-record-header">
        <div>
          <p className="eyebrow">Customer record</p>
          <h2 ref={heading} tabIndex={-1}>
            {account.name}
          </h2>
          <p>
            <span className={`customer-status ${account.held ? "held" : ""}`}>
              {account.held ? "On hold" : "Active"}
            </span>{" "}
            · {account.tier} price tier
          </p>
        </div>
        <dl className="customer-key-facts">
          <div>
            <dt>Credit limit</dt>
            <dd>{money(account.credit_limit, account.currency)}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{account.currency}</dd>
          </div>
        </dl>
      </header>
      <PageSections
        label="Customer record sections"
        items={customerTabs.map((id) => ({
          id: `record-${id}`,
          label: id[0]!.toUpperCase() + id.slice(1),
        }))}
        selectedSection={`record-${tab}`}
        selectSection={(s) => onTab(s.replace("record-", "") as CustomerTab)}
      >
        <PageSection id="record-overview">
          <CustomerSummary
            account={account}
            role={role}
            onTab={onTab}
            onNavigate={onNavigate}
          />
          <section className="panel">
            <h3>Account standing</h3>
            <dl className="customer-detail-facts">
              <div>
                <dt>Purchasing status</dt>
                <dd>
                  {account.held ? "Finance hold applied" : "No finance hold"}
                </dd>
              </div>
              <div>
                <dt>Price agreement</dt>
                <dd>
                  {account.tier} tier · Customer-specific agreements are managed
                  in Pricing.
                </dd>
              </div>
              <div>
                <dt>Data residency</dt>
                <dd>
                  {account.residency_mode === "strict"
                    ? "Strict regional storage"
                    : "Named provider exceptions"}{" "}
                  · Review current acceptances in Terms.
                </dd>
              </div>
            </dl>
          </section>
        </PageSection>
        <PageSection id="record-history">
          <CustomerHistory
            account={account}
            role={role}
            onNavigate={onNavigate}
          />
        </PageSection>
        <PageSection id="record-terms">
          <section className="panel customer-terms-panel">
            <h3>Credit and residency</h3>
            <dl className="customer-detail-facts">
              <div>
                <dt>Credit limit</dt>
                <dd>{money(account.credit_limit, account.currency)}</dd>
              </div>
              <div>
                <dt>Finance hold</dt>
                <dd>{account.held ? "On hold" : "No finance hold"}</dd>
              </div>
              <div>
                <dt>Data residency</dt>
                <dd>
                  {account.residency_mode === "strict"
                    ? "Strict regional storage"
                    : "Named provider exceptions"}
                </dd>
              </div>
              <div>
                <dt>Shipping terms</dt>
                <dd>Reviewed for each saved cart and retained on its quote</dd>
              </div>
            </dl>
            <div className="customer-panel-actions">{terms}</div>
          </section>
          {finance ? (
            <CustomerBillingTerms
              accountId={account.id}
              edit={editBilling}
              epoch={billingEpoch}
            />
          ) : (
            <section className="panel customer-terms-panel">
              <h3>Billing terms</h3>
              <p className="record-detail-empty">
                Billing terms are available to finance staff.
              </p>
            </section>
          )}
          {commercial && (
            <CustomerPurchasingRules
              key={account.id}
              accounts={[account]}
              selectedOnly
            />
          )}
        </PageSection>
        <PageSection id="record-pricing">
          {role === "admin" ? (
            <CustomerPricingControls
              key={account.id}
              accounts={[account]}
              selectedOnly
              recoveryScope={recoveryScope}
            />
          ) : (
            <section className="panel">
              <h3>Customer pricing</h3>
              <p>Customer price agreements are managed by an administrator.</p>
            </section>
          )}
        </PageSection>
        <PageSection id="record-notes">
          <RecordNotes
            kind="customer"
            recordId={account.id}
            actorId={actorId}
            recoveryScope={recoveryScope}
          />
        </PageSection>
        <PageSection id="record-contacts">
          <CustomerContactsEditor
            accountId={account.id}
            recoveryScope={recoveryScope}
          />
        </PageSection>
      </PageSections>
    </div>
  );
}
type SummaryFigure = {
  value: string;
  detail: string;
  state: "loading" | "ready" | "unavailable";
};
const pending: SummaryFigure = { value: "…", detail: "", state: "loading" };
/** Figures come from the same scoped queue reads as History; nothing is inferred. */
function CustomerSummary({
  account,
  role,
  onTab,
  onNavigate,
}: {
  account: Account;
  role: string;
  onTab: (t: CustomerTab) => void;
  onNavigate: (route: NavigationIntent) => void;
}) {
  const staffRoles = ["admin", "commercial", "finance", "support"];
  const canOrders = [...staffRoles, "warehouse", "warranty"].includes(role),
    canInvoices = [...staffRoles, "warranty"].includes(role),
    canContacts = [...staffRoles, "warehouse", "warranty"].includes(role);
  const [orders, setOrders] = useState<SummaryFigure>(pending),
    [due, setDue] = useState<SummaryFigure>(pending),
    [contact, setContact] = useState<SummaryFigure>(pending);
  useEffect(() => {
    const c = new AbortController();
    const id = encodeURIComponent(account.id);
    const unavailable = (set: (f: SummaryFigure) => void) => () => {
      if (!c.signal.aborted)
        set({ value: "—", detail: "Unavailable", state: "unavailable" });
    };
    setOrders(pending);
    setDue(pending);
    setContact(pending);
    if (canOrders)
      void request<{ items: any[]; next: string | null }>(
        `/api/orders/page?accountId=${id}&state=open`,
        { signal: c.signal },
      )
        .then((p) =>
          setOrders({
            value: `${p.items.length}${p.next ? "+" : ""}`,
            detail: p.items[0]
              ? `Latest ${new Date(p.items[0].created_at).toLocaleDateString()}`
              : "No open orders",
            state: "ready",
          }),
        )
        .catch(unavailable(setOrders));
    if (canInvoices)
      void request<{ items: any[]; next: string | null }>(
        `/api/billing/invoices/page?accountId=${id}&state=unpaid`,
        { signal: c.signal },
      )
        .then((p) => {
          const total = p.items.reduce((sum, i) => sum + i.balance, 0);
          setDue({
            value: p.next
              ? `${p.items.length}+ invoices`
              : money(total, account.currency),
            detail: p.next
              ? "Open the invoice history for the full balance"
              : `${p.items.length} unpaid ${p.items.length === 1 ? "invoice" : "invoices"}`,
            state: "ready",
          });
        })
        .catch(unavailable(setDue));
    if (canContacts)
      void request<CustomerContacts>(`/api/accounts/${id}/contacts`, {
        signal: c.signal,
      })
        .then((p) => {
          const active = p.items.filter((x) => !x.archived);
          const first = active[0];
          setContact({
            value: first ? first.name : "None recorded",
            detail: first
              ? [first.title, first.email || first.phone]
                  .filter(Boolean)
                  .join(" · ") || "Contact details not recorded"
              : "Add people in Contacts",
            state: "ready",
          });
        })
        .catch(unavailable(setContact));
    return () => c.abort();
  }, [account.id, role]);
  const card = (
    label: string,
    figure: SummaryFigure,
    action: string,
    go: () => void,
  ) => (
    <div className="customer-summary-card" data-state={figure.state}>
      <dt>{label}</dt>
      <dd>
        <strong>{figure.value}</strong>
        <span>{figure.detail}</span>
        <button type="button" className="text-action" onClick={go}>
          {action} →
        </button>
      </dd>
    </div>
  );
  return (
    <dl className="customer-summary" aria-label="Account summary">
      {canOrders &&
        card("Open orders", orders, "Order history", () => onTab("history"))}
      {canInvoices &&
        card("Balance due", due, "Invoice history", () => onTab("history"))}
      {canContacts &&
        card("Primary contact", contact, "Contacts", () => onTab("contacts"))}
    </dl>
  );
}
function CustomerBillingTerms({
  accountId,
  edit,
  epoch,
}: {
  epoch?: number;
  accountId: string;
  edit?: (p: any) => void;
}) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setState(null);
    void request<any>("/api/billing/profiles", { signal: c.signal })
      .then((p) =>
        setState(
          p.customers.find((a: any) => a.accountId === accountId) ?? false,
        ),
      )
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [accountId, epoch]);
  return (
    <section className="panel customer-terms-panel">
      <div className="customer-panel-header">
        <h3>Billing terms</h3>
        {state && edit && (
          <button className="secondary" onClick={() => edit(state)}>
            Edit customer billing terms
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {state ? (
        <dl className="customer-detail-facts">
          <div>
            <dt>Payment terms</dt>
            <dd>
              {state.termDays === null
                ? "Not recorded"
                : `${state.termDays} calendar days`}
            </dd>
          </div>
          <div>
            <dt>Billing name</dt>
            <dd>{state.name}</dd>
          </div>
          <div>
            <dt>Billing address</dt>
            <dd>{state.address || "Not recorded"}</dd>
          </div>
          <div>
            <dt>Tax registration</dt>
            <dd>{state.taxRegistration || "Not recorded"}</dd>
          </div>
          <div className="customer-fact-wide">
            <dt>Last review</dt>
            <dd>
              {state.reason} ·{" "}
              {state.updatedAt
                ? new Date(state.updatedAt).toLocaleString()
                : "No retained review"}
            </dd>
          </div>
        </dl>
      ) : state === false ? (
        <p className="record-detail-empty">
          No billing profile is recorded for this customer.
        </p>
      ) : (
        !error && <p role="status">Loading billing terms…</p>
      )}
    </section>
  );
}
function CustomerHistory({
  account,
  role,
  onNavigate,
}: {
  onNavigate: (route: NavigationIntent) => void;
  account: Account;
  role: string;
}) {
  const sources = [
    {
      key: "orders",
      label: "Orders",
      path: "/api/orders/page",
      allowed: [
        "admin",
        "commercial",
        "warehouse",
        "finance",
        "support",
        "warranty",
      ],
    },
    {
      key: "invoices",
      label: "Invoices",
      path: "/api/billing/invoices/page",
      allowed: ["admin", "finance", "commercial", "warranty", "support"],
    },
    {
      key: "payments",
      label: "Payments",
      path: "/api/billing/payments/page",
      allowed: ["admin", "finance", "support"],
    },
  ];
  const [selected, setSelected] = useState("orders");
  return (
    <section className="panel">
      <h3>Account history</h3>
      <p>
        Retained records for {account.name}. Each list has its own paging;
        payments are receipts rather than an inferred sales total.
      </p>
      <PageSections
        label="Customer history sections"
        items={sources
          .filter((s) => s.allowed.includes(role))
          .map((s) => ({ id: `history-${s.key}`, label: s.label }))}
        selectedSection={`history-${selected}`}
        selectSection={(s) => setSelected(s.replace("history-", ""))}
      >
        {sources
          .filter((s) => s.allowed.includes(role))
          .map((s) => (
            <PageSection key={s.key} id={`history-${s.key}`}>
              <HistoryList
                path={s.path}
                kind={s.key}
                account={account}
                onNavigate={onNavigate}
              />
            </PageSection>
          ))}
      </PageSections>
    </section>
  );
}
function HistoryList({
  path,
  kind,
  account,
  onNavigate,
}: {
  onNavigate: (route: NavigationIntent) => void;
  path: string;
  kind: string;
  account: Account;
}) {
  const [items, setItems] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  async function load(after?: string) {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    try {
      const p = await request<{ items: any[]; next: string | null }>(
        `${path}?accountId=${encodeURIComponent(account.id)}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        { signal: c.signal },
      );
      if (!c.signal.aborted) {
        setItems((old) => (after ? [...old, ...p.items] : p.items));
        setNext(p.next);
      }
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [account.id, path]);
  const link = (route: NavigationIntent, label: string) => (
    <a
      className="record-title-link"
      href={navigationHash(route)}
      onClick={(e) => {
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
          return;
        e.preventDefault();
        onNavigate(route);
      }}
    >
      {label}
    </a>
  );
  const when = (value?: string) =>
    value ? new Date(value).toLocaleDateString() : "";
  const headings =
    kind === "orders"
      ? ["Order", "Placed", "Status", "Total"]
      : kind === "invoices"
        ? ["Invoice", "Issued", "Total", "Balance"]
        : ["Invoice", "Received", "Source", "Amount"];
  return (
    <>
      <div className="customer-history-toolbar">
        <p role="status">
          {busy
            ? `Loading ${kind}…`
            : `${items.length}${next ? "+" : ""} ${items.length === 1 ? kind.slice(0, -1) : kind} shown`}
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh {kind}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="customer-history-table">
            <thead>
              <tr>
                {headings.map((h, index) => (
                  <th key={h} className={index === 3 ? "numeric" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  {kind === "orders" ? (
                    <>
                      <td>
                        {link(
                          { page: "Orders", orderId: i.id },
                          i.number ?? `Order ${String(i.id).slice(0, 8)}`,
                        )}
                      </td>
                      <td>{when(i.created_at)}</td>
                      <td>
                        <span className="badge">{i.state}</span>
                      </td>
                      <td className="numeric">
                        {money(i.total, i.currency ?? account.currency)}
                      </td>
                    </>
                  ) : kind === "invoices" ? (
                    <>
                      <td>
                        {link(
                          { page: "Billing", invoiceId: i.id },
                          i.number ?? i.id,
                        )}
                      </td>
                      <td>{when(i.created_at)}</td>
                      <td>{money(i.total, i.currency)}</td>
                      <td className="numeric">
                        {money(i.balance, i.currency)}
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        {link(
                          { page: "Billing", invoiceId: i.invoice_id },
                          i.invoiceNumber ?? i.invoice_id,
                        )}
                      </td>
                      <td>{when(i.created_at)}</td>
                      <td>{i.provider}</td>
                      <td className="numeric">{money(i.amount, i.currency)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!busy && !error && !items.length && (
        <p className="record-detail-empty">
          No retained {kind} for this customer.
        </p>
      )}
      {next && (
        <button disabled={busy} onClick={() => void load(next)}>
          Load more {kind}
        </button>
      )}
    </>
  );
}
function CustomerContactsEditor({
  accountId,
  recoveryScope,
}: {
  accountId: string;
  recoveryScope: string;
}) {
  const key = `distributor-customer-contact:${recoveryScope}:${accountId}`;
  type Attempt = { key: string; payload: SaveCustomerContact };
  const [recovery] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { attempt: null as Attempt | null, error: "" };
      const a = JSON.parse(raw) as Attempt;
      const p = a.payload;
      if (
        raw.length > 10000 ||
        !/^[a-f0-9-]{36}$/.test(a.key) ||
        !p ||
        p.accountId !== accountId ||
        !Number.isInteger(p.expectedRevision) ||
        p.expectedRevision < 0 ||
        typeof p.archived !== "boolean" ||
        (p.contactId !== undefined &&
          !/^[a-zA-Z0-9_-]{1,128}$/.test(p.contactId)) ||
        Object.keys(a).some((k) => !["key", "payload"].includes(k)) ||
        Object.keys(p).some(
          (k) =>
            ![
              "accountId",
              "contactId",
              "expectedRevision",
              "name",
              "title",
              "email",
              "phone",
              "archived",
            ].includes(k),
        ) ||
        !p.name.trim() ||
        (
          [
            ["name", 200],
            ["title", 200],
            ["email", 254],
            ["phone", 80],
          ] as const
        ).some(
          ([field, max]) =>
            typeof p[field] !== "string" || p[field].length > max,
        )
      )
        throw Error();
      return { attempt: a, error: "" };
    } catch {
      return {
        attempt: null as Attempt | null,
        error:
          "Saved contact change cannot be read. Restore browser storage before editing this customer.",
      };
    }
  });
  const [attempt, setAttempt] = useState(recovery.attempt);
  const [page, setPage] = useState<CustomerContacts | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0),
    [notice, setNotice] = useState("");
  const empty = (): SaveCustomerContact => ({
    accountId,
    expectedRevision: 0,
    name: "",
    title: "",
    email: "",
    phone: "",
    archived: false,
  });
  const [draft, setDraft] = useState<SaveCustomerContact>(empty),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void request<CustomerContacts>(
      `/api/accounts/${encodeURIComponent(accountId)}/contacts`,
      { signal: c.signal },
    )
      .then(setPage)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [accountId, epoch]);
  async function save(a: Attempt) {
    setBusy(true);
    setError("");
    try {
      const raw = JSON.stringify(a),
        previous = localStorage.getItem(key);
      if (previous && previous !== raw)
        throw Error(
          "Another tab has an unresolved contact change. Reload and review it before continuing.",
        );
      localStorage.setItem(key, raw);
      setAttempt(a);
      await request("/api/commands/account.contact.save", {
        method: "POST",
        headers: { "idempotency-key": a.key },
        body: JSON.stringify(a.payload),
      });
      if (localStorage.getItem(key) !== JSON.stringify(a))
        throw Error(
          "Contact change was saved, but another tab changed recovery storage. Reload to review the retained change.",
        );
      localStorage.removeItem(key);
      setAttempt(null);
      setEditing(false);
      setDraft(empty());
      setNotice("Contact saved.");
      setEpoch((e) => e + 1);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && [400, 409, 422].includes(e.status)) {
        if (localStorage.getItem(key) === JSON.stringify(a)) {
          localStorage.removeItem(key);
          setAttempt(null);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const active = page?.items.filter((c) => !c.archived).length ?? 0,
    archived = (page?.items.length ?? 0) - active;
  return (
    <section className="panel customer-contacts">
      <div className="customer-panel-header">
        <div>
          <h3>Company contacts</h3>
          <p className="customer-panel-intro">
            Staff-only contact directory. Archiving retains the person’s
            recorded details.
          </p>
        </div>
        {!attempt && page?.canManage && !recovery.error && !editing && (
          <button
            onClick={() => {
              setDraft(empty());
              setEditing(true);
            }}
          >
            Add contact
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {attempt && (
        <div role="status" className="customer-contact-recovery">
          <p>
            A saved contact change needs confirmation. Retry the identical
            change before editing another contact.
          </p>
          <p>
            {attempt.payload.name} · {attempt.payload.email}
          </p>
          <button disabled={busy} onClick={() => void save(attempt)}>
            Retry saved contact change
          </button>
        </div>
      )}
      {editing && !attempt && (
        <form
          className="customer-contact-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ key: crypto.randomUUID(), payload: draft });
          }}
        >
          <fieldset disabled={busy} className="record-form-card">
            <legend>{draft.contactId ? "Edit contact" : "New contact"}</legend>
            <div className="record-form-grid">
              {(
                [
                  ["name", "Contact name", 200, "text"],
                  ["title", "Job title", 200, "text"],
                  ["email", "Contact email", 254, "email"],
                  ["phone", "Contact phone", 80, "tel"],
                ] as const
              ).map(([field, label, max, inputMode]) => (
                <label key={field}>
                  {label}
                  <input
                    inputMode={inputMode}
                    required={field === "name"}
                    maxLength={max}
                    value={draft[field]}
                    onChange={(e) =>
                      setDraft({ ...draft, [field]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="record-form-check">
              <input
                type="checkbox"
                checked={draft.archived}
                onChange={(e) =>
                  setDraft({ ...draft, archived: e.target.checked })
                }
              />
              Archived contact
            </label>
            <div className="record-form-footer">
              <button>Save contact</button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(false)}
              >
                Cancel contact edit
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {page && page.items.length > 0 && (
        <p className="customer-contact-count">
          {active} active {active === 1 ? "contact" : "contacts"}
          {archived > 0 && ` · ${archived} archived`}
        </p>
      )}
      <ul className="customer-contact-list">
        {page?.items.map((c: CustomerContact) => (
          <li key={c.id} data-archived={c.archived || undefined}>
            <div className="customer-contact-card-head">
              <strong>{c.name}</strong>
              {c.archived && <span className="badge">Archived</span>}
            </div>
            <p className="customer-contact-title">
              {c.title || "Job title not recorded"}
            </p>
            <dl className="customer-contact-details">
              <div>
                <dt>Email</dt>
                <dd>{c.email || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{c.phone || "Not recorded"}</dd>
              </div>
            </dl>
            <div className="customer-contact-card-foot">
              <small>
                Updated {new Date(c.updatedAt).toLocaleString()} · revision{" "}
                {c.revision}
              </small>
              {page.canManage && (
                <button
                  disabled={busy || !!attempt || !!recovery.error}
                  className="secondary"
                  onClick={() => {
                    setDraft({
                      accountId,
                      contactId: c.id,
                      expectedRevision: c.revision,
                      name: c.name,
                      title: c.title,
                      email: c.email,
                      phone: c.phone,
                      archived: c.archived,
                    });
                    setEditing(true);
                  }}
                >
                  Edit {c.name}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {page && !page.items.length && !editing && (
        <p className="record-detail-empty">No contacts recorded.</p>
      )}
      {!page && !error && <p role="status">Loading contacts…</p>}
    </section>
  );
}
