import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const paths: Record<string, string> = {
  Overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  Orders: "M7 3h10v3h3v15H4V6h3M8 11h8M8 15h5",
  Inventory: "m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7 5l9 4",
  Purchasing: "M3 5h2l3 11h10l3-8H6M9 20h.01M18 20h.01",
  Catalog: "M4 3h16v18H4zM8 7h8M8 11h8M8 15h4",
  Billing: "M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM9 7h6M9 11h6M9 15h3",
  Returns: "M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12h-4",
  Customers:
    "M16 21v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 4a4 4 0 0 1 0 7M21 21v-3a4 4 0 0 0-3-4",
  Security: "m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Zm-4 9 3 3 5-6",
  "Operations health": "M3 12h4l3-8 4 16 3-8h4",
  "Audit history": "M4 7V3M4 7h4M4 7a9 9 0 1 1-1 8M12 7v5l3 2",
  "Event reporting": "M4 21V11h4v10M10 21V3h4v18M16 21V7h4v14",
  Reconciliation: "M3 6h18M7 3v6M3 18h18M17 15v6M3 12h18M12 9v6",
  Imports: "M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6",
  Administration: "M4 7h16M4 17h16M8 3v8M16 13v8",
  arrow: "M5 12h14m-5-5 5 5-5 5",
};
export function WorkspaceIcon({ name }: { name: string }) {
  return (
    <svg
      className="workspace-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.Inventory} />
    </svg>
  );
}
export const workspaceGroups = [
  { name: "Workspace", pages: ["Overview"] },
  { name: "Sales & customers", pages: ["Orders", "Customers", "Catalog"] },
  {
    name: "Stock & fulfillment",
    pages: ["Inventory", "Purchasing", "Returns"],
  },
  { name: "Finance", pages: ["Billing", "Reconciliation"] },
  {
    name: "System & controls",
    pages: [
      "Operations health",
      "Audit history",
      "Event reporting",
      "Imports",
      "Administration",
      "Security",
    ],
  },
];
export const pageDescriptions: Record<string, string> = {
  Shop: "Browse your approved products, account prices and product resources.",
  Account:
    "Your commercial account, residency preferences and sign-in security.",
  Overview: "A clear view of orders, availability and outstanding balances.",
  Orders: "Prepare orders, manage reservations and follow fulfillment.",
  Customers: "Manage customer accounts, terms and service access.",
  Catalog:
    "Add products and manage their images, documents, prices and customer availability.",
  Inventory: "Find stock, trace serials and manage warehouse movements.",
  Purchasing: "Manage suppliers, incoming stock and purchase receipts.",
  Returns: "Review returns, warranty coverage and replacement decisions.",
  Billing: "Review invoices, payments, credits and accounting records.",
  Reconciliation: "Compare records and resolve accounting differences.",
  "Operations health": "Review service status and work that needs attention.",
  "Audit history": "Trace recorded actions and the people behind them.",
  "Event reporting": "Inspect event delivery and reporting activity.",
  Imports: "Review source records before importing them.",
  Administration: "Configure your organization and operating policies.",
  Security: "Manage your password, authentication and account security.",
};
export function WorkspaceNavigation({
  pages,
  page,
  organization,
  name,
  role,
  region,
  navigate,
  signOut,
}: {
  pages: string[];
  page: string;
  organization: string;
  name: string;
  role: string;
  region: string;
  navigate: (page: string) => void;
  signOut: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const group = workspaceGroups.find((item) => item.pages.includes(page));
    if (group) setOpenGroups((current) => ({ ...current, [group.name]: true }));
  }, [page]);
  const visit = (destination: string) => {
    if (destination !== page) navigate(destination);
    setExpanded(false);
    document.getElementById("workspace-title")?.focus();
  };
  if (role === "buyer")
    return (
      <header className="customer-header">
        <div className="customer-masthead">
          <button
            className="customer-wordmark"
            onClick={() => navigate("Shop")}
            aria-label="dstrbtr. — Shop"
          >
            dstrbtr<span>.</span>
          </button>
          <span className="customer-trade-label">
            GREE equipment · Trade portal
          </span>
          <div className="customer-identity">
            <strong>{name}</strong>
            <span>{organization}</span>
          </div>
          <button className="customer-signout" onClick={signOut}>
            Sign out
          </button>
          <button
            className="customer-menu-toggle"
            aria-expanded={expanded}
            aria-controls="customer-navigation"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Close menu" : "Menu"}
          </button>
        </div>
        <nav
          id="customer-navigation"
          className={expanded ? "is-expanded" : ""}
          aria-label="Workspace"
        >
          {pages.map((destination) => (
            <button
              key={destination}
              aria-current={page === destination ? "page" : undefined}
              onClick={() => {
                if (destination !== page) navigate(destination);
                setExpanded(false);
                document.getElementById("workspace-title")?.focus();
              }}
            >
              {destination === "Billing"
                ? "Invoices & payments"
                : destination === "Overview"
                  ? "Reports"
                  : destination === "Returns"
                    ? "Returns & warranty"
                    : destination}
            </button>
          ))}
        </nav>
      </header>
    );
  return (
    <aside className="workspace-sidebar">
      <div className="sidebar-heading">
        <div className="brand">
          <span className="brand-mark">
            <WorkspaceIcon name="Inventory" />
          </span>
          <span>Distributor</span>
        </div>
        <button
          className="navigation-toggle"
          aria-expanded={expanded}
          aria-controls="workspace-navigation"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Close menu" : "Menu"}
        </button>
      </div>
      <p className="workspace">{organization}</p>
      <nav
        id="workspace-navigation"
        aria-label="Workspace"
        className={expanded ? "is-expanded" : ""}
      >
        {workspaceGroups.map((group, index) => {
          const visible = group.pages.filter((p) => pages.includes(p));
          if (!visible.length) return null;
          if (visible.length === 1)
            return (
              <button
                key={group.name}
                aria-current={page === visible[0] ? "page" : undefined}
                onClick={() => visit(visible[0]!)}
              >
                <WorkspaceIcon name={visible[0]!} />
                <span>{visible[0]}</span>
              </button>
            );
          const open = openGroups[group.name] ?? group.pages.includes(page);
          return (
            <div className="workspace-nav-group" key={group.name}>
              <button
                className="workspace-group-toggle"
                aria-expanded={open}
                aria-controls={`workspace-group-${index}`}
                onClick={() =>
                  setOpenGroups((current) => ({
                    ...current,
                    [group.name]: !open,
                  }))
                }
              >
                <span>{group.name}</span>
                <span aria-hidden="true">{open ? "−" : "+"}</span>
              </button>
              <nav
                id={`workspace-group-${index}`}
                aria-label={`${group.name} pages`}
                hidden={!open}
              >
                {visible.map((destination) => (
                  <button
                    key={destination}
                    aria-current={page === destination ? "page" : undefined}
                    onClick={() => visit(destination)}
                  >
                    <WorkspaceIcon name={destination} />
                    <span>{destination}</span>
                  </button>
                ))}
              </nav>
            </div>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <a className="sidebar-resource-link" href="#scanner">
          <WorkspaceIcon name="Inventory" />
          <span>Phone scanner</span>
          <span aria-hidden="true">↗</span>
        </a>
        <div className="user-identity">
          <span className="user-avatar" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{name}</strong>
            <span>
              {role} · {region}
            </span>
          </div>
        </div>
        <button onClick={signOut}>Sign out</button>
      </div>
    </aside>
  );
}

type PageSectionItem = { id: string; label: string };
const PageSectionContext = createContext<{
  active: string;
  items: PageSectionItem[];
} | null>(null);

export function PageSections({
  items,
  label,
  defaultSection,
  selectedSection,
  selectSection,
  children,
}: {
  items: PageSectionItem[];
  label: string;
  defaultSection?: string;
  selectedSection?: string;
  selectSection?: (section: string) => void;
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState(
    defaultSection ?? items[0]?.id ?? "",
  );
  const selection = selectedSection ?? selected;
  const active = items.some((item) => item.id === selection)
    ? selection
    : (items[0]?.id ?? "");
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabs.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);
  const choose = (id: string) => {
    setSelected(id);
    selectSection?.(id);
  };
  useEffect(() => {
    if (selectedSection && !items.some((item) => item.id === selectedSection))
      selectSection?.(active);
  }, [selectedSection, active]);
  return (
    <PageSectionContext.Provider value={{ active, items }}>
      {items.length > 1 && (
        <>
          <p className="page-sections-scroll-hint">
            Scroll sideways for more sections.
          </p>
          <div
            className="page-sections"
            role="tablist"
            aria-label={label}
            title="More sections may be available by scrolling across"
            ref={tabs}
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${item.id}-tab`}
                aria-controls={`${item.id}-panel`}
                aria-selected={active === item.id}
                tabIndex={active === item.id ? 0 : -1}
                onClick={() => choose(item.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % items.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + items.length) % items.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? items.length - 1
                            : null;
                  if (next === null || !items[next]) return;
                  event.preventDefault();
                  choose(items[next].id);
                  tabs.current
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [next]?.focus();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
      {children}
    </PageSectionContext.Provider>
  );
}

export function PageSection({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const sections = useContext(PageSectionContext);
  if (!sections) throw new Error("PageSection requires PageSections");
  if (!sections.items.some((item) => item.id === id)) return null;
  return (
    <div
      className="page-tab-panel"
      role={sections.items.length > 1 ? "tabpanel" : "region"}
      id={`${id}-panel`}
      aria-labelledby={sections.items.length > 1 ? `${id}-tab` : undefined}
      aria-label={
        sections.items.length === 1 ? sections.items[0]?.label : undefined
      }
      tabIndex={0}
      hidden={sections.active !== id}
    >
      {children}
    </div>
  );
}
