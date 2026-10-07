import { ReferenceRequestSummary } from "./gree-reference-loader.tsx";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readReference, referenceHref } from "./reference-context.ts";
import { request } from "./api.ts";
import "./public-site.css";
import { ScannerPage } from "./scanner-page.tsx";
import preview from "./gree-catalog-preview.json" with { type: "json" };
const GreeProductLibrary = lazy(() =>
  import("./gree-product-library.tsx").then((module) => ({
    default: module.GreeProductLibrary,
  })),
);

export type PublicRoute =
  | "products"
  | "product"
  | "scanner"
  | "home"
  | "sign-in"
  | "customer-sign-in"
  | "admin-sign-in"
  | "apply"
  | "activate";
export function readPublicRoute(hash: string): PublicRoute {
  if (hash.startsWith("#product=")) return "product";
  if (hash === "#products" || hash.startsWith("#products?")) return "products";
  if (hash.startsWith("#activate=") || hash === "#activate") return "activate";
  if (hash === "#scanner") return "scanner";
  if (hash.split("?")[0] === "#apply") return "apply";
  if (hash === "#admin-sign-in") return "admin-sign-in";
  if (hash.split("?")[0] === "#customer-sign-in") return "customer-sign-in";
  if (hash === "#sign-in") return "sign-in";
  return "home";
}

export function PublicSite({
  route,
  activationToken,
  login,
  workspaceHref,
  sessionAudience,
  signOut,
  signOutPending = false,
  signOutError,
}: {
  route: PublicRoute;
  activationToken: string;
  login: ReactNode;
  workspaceHref?: string;
  sessionAudience?: "customer" | "staff";
  signOut?: () => void;
  signOutPending?: boolean;
  signOutError?: string;
}) {
  const signedIn = !!sessionAudience;
  const customerSignedIn = sessionAudience === "customer";
  const accountLabel = customerSignedIn ? "My workspace" : "Staff workspace";
  const accountHref = workspaceHref || "#customer-sign-in";
  const requestedReference = readReference(window.location.hash);
  const applyHref = requestedReference
    ? referenceHref("#apply", requestedReference)
    : "#apply";
  const [config, setConfig] = useState<{ enabled: boolean } | null>(null);
  const [configError, setConfigError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ enabled: boolean }>("/api/enrollment/config", {
      signal: controller.signal,
    })
      .then(setConfig)
      .catch(() => {
        if (!controller.signal.aborted) setConfigError(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    document.title =
      route === "home"
        ? "dstrbtr · Canadian HVAC trade"
        : `${route === "products" || route === "product" ? "GREE product library" : route === "scanner" ? "Barcode scanner" : route === "apply" ? "Apply for a trade account" : route === "activate" ? "Activate your account" : route === "admin-sign-in" ? "Administration sign in" : "Customer sign in"} · dstrbtr`;
    document.querySelector<HTMLElement>(".public-main")?.focus();
    window.scrollTo(0, 0);
  }, [route]);
  const signIn =
    route === "sign-in" ||
    route === "customer-sign-in" ||
    route === "admin-sign-in";
  return (
    <div className="public-site">
      <a
        className="public-skip"
        href="#public-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("public-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="public-utility">
        <span>Canadian HVAC trade supply</span>
        {!signedIn && <a href="#apply">Become a trade customer →</a>}
      </div>
      <header className="public-header">
        <a href="#home" className="public-wordmark" aria-label="dstrbtr home">
          dstrbtr<span className="public-brand-dot">.</span>
        </a>
        <span className="public-header-descriptor">
          HEATING & COOLING
          <br />
          FOR THE CANADIAN TRADE
        </span>
        <nav aria-label="Public navigation">
          <a href="#products">Products</a>
          {!signedIn && <a href="#apply">Trade application</a>}
          {signedIn ? (
            <>
              <a href={accountHref}>{accountLabel}</a>
              <button
                className="public-sign-out"
                onClick={signOut}
                disabled={signOutPending}
              >
                {signOutPending ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <a href="#admin-sign-in">Administration</a>
              <a href="#customer-sign-in">
                Customer sign in <span aria-hidden="true">↗</span>
              </a>
            </>
          )}
        </nav>
      </header>
      <main className="public-main" id="public-content" tabIndex={-1}>
        {signedIn && signOutError && (
          <p role="alert" className="error">
            {signOutError}
          </p>
        )}
        {route !== "home" && route !== "product" && (
          <nav className="public-breadcrumb" aria-label="Breadcrumb">
            <a href="#home">Home</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">
              {route === "products"
                ? "Products"
                : route === "scanner"
                  ? "Barcode scanner"
                  : route === "apply"
                    ? "Trade application"
                    : route === "activate"
                      ? "Activate account"
                      : route === "admin-sign-in"
                        ? "Administration sign in"
                        : "Customer sign in"}
            </span>
          </nav>
        )}
        {route === "home" ? (
          <>
            <section className="public-hero">
              <div className="public-hero-copy">
                <p className="public-eyebrow">GREE HEATING & COOLING SYSTEMS</p>
                <h1>
                  Comfort starts
                  <br />
                  with the right system.
                </h1>
                <p className="public-lead">
                  Explore equipment for your next installation. Product
                  information, technical documents and a trade account built
                  around your business.
                </p>
                <div className="public-hero-actions">
                  <a href="#products" className="public-primary">
                    Explore products <span aria-hidden="true">→</span>
                  </a>
                </div>
                <div className="public-hero-assurance">
                  <span>Residential & commercial</span>
                  <span>Manufacturer documentation</span>
                </div>
              </div>
              <FeaturedCarousel />
            </section>
            <div className="public-equipment-strip">
              <span>DUCTLESS MINI-SPLITS</span>
              <span>CENTRAL HEAT PUMPS</span>
              <span>COMMERCIAL SYSTEMS</span>
              <a href="#products">View the full range →</a>
            </div>
            <section className="public-products-section">
              <div className="public-section-heading">
                <div>
                  <p className="public-eyebrow">
                    EQUIPMENT FOR EVERY APPLICATION
                  </p>
                  <h2>Find your system.</h2>
                </div>
                <a href="#products">
                  Browse all products <span aria-hidden="true">→</span>
                </a>
              </div>
              <div className="public-category-grid">
                {preview.categories.map((category) => (
                  <a
                    key={category.id}
                    className="public-category-card"
                    href={`#products?category=${encodeURIComponent(category.id)}`}
                  >
                    <div>
                      <img
                        src={category.imageUrl}
                        alt={category.title}
                        loading="lazy"
                      />
                    </div>
                    <h3>
                      {category.title}
                      <span aria-hidden="true">→</span>
                    </h3>
                    <p>
                      {category.count}{" "}
                      {category.count === 1
                        ? "product family"
                        : "product families"}
                    </p>
                  </a>
                ))}
              </div>
            </section>
            <section
              className="public-access"
              aria-labelledby="public-access-title"
            >
              <div className="public-access-heading">
                <p className="public-eyebrow">YOUR TRADE WORKSPACE</p>
                <h2 id="public-access-title">
                  Everything you need to get to work.
                </h2>
              </div>
              <div
                className={`public-access-paths${signedIn ? " is-signed-in" : ""}`}
              >
                {sessionAudience === "staff" && (
                  <a
                    className="public-access-link public-scanner-tool"
                    href="#scanner"
                  >
                    <span className="public-index">WAREHOUSE TOOL</span>
                    <span className="public-access-title">
                      Barcode scanner <span aria-hidden="true">↗</span>
                    </span>
                    <span className="public-access-description">
                      Open it here or send the link to your phone.
                    </span>
                  </a>
                )}

                <a
                  className="public-access-link public-customer"
                  href={signedIn ? accountHref : "#customer-sign-in"}
                >
                  <span className="public-index">
                    {signedIn ? "" : "01 / "}
                    {sessionAudience === "staff"
                      ? "DISTRIBUTOR STAFF"
                      : signedIn
                        ? "YOUR ACCOUNT"
                        : "EXISTING CUSTOMERS"}
                  </span>
                  <span className="public-access-title">
                    {signedIn ? accountLabel : "Customer sign in"}{" "}
                    <span aria-hidden="true">↗</span>
                  </span>
                  <span className="public-access-description">
                    {sessionAudience === "staff"
                      ? "Return to your administration workspace."
                      : "Open your catalog, account pricing and orders."}
                  </span>
                </a>
                {!signedIn && (
                  <a className="public-access-link" href="#apply">
                    <span className="public-index">
                      02 / NEW TRADE CUSTOMERS
                    </span>
                    <span className="public-access-title">
                      Apply for a trade account{" "}
                      <span aria-hidden="true">↗</span>
                    </span>
                    <span className="public-access-description">
                      Send your business details for review.
                    </span>
                  </a>
                )}
                {!signedIn && (
                  <div className="public-staff-entrances">
                    <a
                      className="public-access-link public-admin"
                      href="#admin-sign-in"
                    >
                      <span className="public-index">
                        03 / DISTRIBUTOR STAFF
                      </span>
                      <span className="public-access-title">
                        Administration entrance{" "}
                        <span aria-hidden="true">↗</span>
                      </span>
                      <span className="public-access-description">
                        Sign in to your staff workspace.
                      </span>
                    </a>
                    <a className="public-scanner-link" href="#scanner">
                      Barcode scanner <span aria-hidden="true">↗</span>
                      <small>
                        Open it here or send the link to your phone.
                      </small>
                    </a>
                  </div>
                )}
              </div>
            </section>
            <section className="public-trade-note">
              <div>
                <p className="public-eyebrow">ACCOUNT ACCESS</p>
                <h2>
                  Product knowledge.
                  <br />
                  Business confidence.
                </h2>
              </div>
              <div>
                <p>
                  Browse the public manufacturer library to compare equipment,
                  view product photography and download supporting documents.
                  Your approved account gives you the equipment, pricing and
                  purchasing options available to your business.
                </p>
                {!signedIn && (
                  <>
                    <p>
                      New to dstrbtr? Applications are reviewed before access is
                      granted. If approved, an administrator provides a private
                      invitation to activate your account.
                    </p>
                    <a href="#apply" className="public-text-link">
                      Apply for a trade account{" "}
                      <span aria-hidden="true">→</span>
                    </a>
                  </>
                )}
              </div>
            </section>
          </>
        ) : route === "products" || route === "product" ? (
          <Suspense
            fallback={
              <div className="public-library-loading" role="status">
                Loading the product library…
              </div>
            }
          >
            <GreeProductLibrary
              detail={route === "product"}
              authenticated={signedIn}
              customerAuthenticated={customerSignedIn}
            />
          </Suspense>
        ) : route === "scanner" ? (
          <ScannerPage />
        ) : signIn ? (
          <div className="public-form-layout">
            <div>
              <p className="public-eyebrow">
                {route === "admin-sign-in"
                  ? "DISTRIBUTOR STAFF"
                  : "APPROVED TRADE CUSTOMERS"}
              </p>
              <h1>
                {route === "admin-sign-in"
                  ? "Administration sign in."
                  : "Customer sign in."}
              </h1>
              <p>
                {route === "admin-sign-in" ? (
                  "Use your staff credentials to open your administration workspace. Your account determines your access."
                ) : (
                  <>
                    Sign in with your approved business account. Applying for
                    the first time?{" "}
                    <a href={applyHref}>Start an application.</a>
                  </>
                )}
              </p>
              {sessionAudience === "staff" && route === "customer-sign-in" && (
                <p>
                  You are signed in to staff operations. Log in with an approved
                  customer account to see account pricing.
                </p>
              )}
              <a className="public-text-link" href="#home">
                ← Back to the entrance
              </a>
            </div>
            <div className="public-form-card">
              {requestedReference && (
                <ReferenceRequestSummary reference={requestedReference} />
              )}{" "}
              {login}
            </div>
          </div>
        ) : route === "apply" ? (
          <div className="public-form-layout">
            <div>
              <p className="public-eyebrow">CANADIAN BUSINESS ACCOUNTS</p>
              <h1>Apply for a trade account.</h1>
              <p>
                Tell us about your business. We will review your application
                before any purchasing access is granted.
              </p>
              <div className="public-form-note">
                <strong>What happens next</strong>
                <ol className="public-steps">
                  <li>
                    <span>Send your business details.</span>
                  </li>
                  <li>
                    <span>We review your application.</span>
                  </li>
                  <li>
                    <span>
                      If approved, you receive a private invitation to activate
                      your buyer account.
                    </span>
                  </li>
                </ol>
                <p>
                  No account is created automatically, and submitting this form
                  does not approve credit.
                </p>
              </div>
            </div>
            <div className="public-form-card">
              <h2>Business details</h2>
              {config?.enabled ? (
                <ApplicationForm requestedReference={requestedReference} />
              ) : (
                <p role="status">
                  {configError
                    ? "Applications are temporarily unavailable. Please try again later."
                    : config
                      ? "Trade account applications are currently closed."
                      : "Checking application availability…"}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="public-form-layout">
            <div>
              <p className="public-eyebrow">YOUR PRIVATE INVITATION</p>
              <h1>Activate your trade account.</h1>
              <p>
                Choose a password to activate your approved buyer account. Your
                invitation is single-use and expires.
              </p>
            </div>
            <div className="public-form-card">
              <ActivationForm key={activationToken} token={activationToken} />
            </div>
          </div>
        )}
      </main>
      <footer className="public-footer">
        <a className="public-wordmark" href="#home">
          dstrbtr<span className="public-brand-dot">.</span>
        </a>
        <p>
          Canadian HVAC trade
          <br />
          Equipment information · Business purchasing by approved account
          <br />
          <small className="demo-notice">
            Demonstration site — prices and stock are illustrative.
          </small>
        </p>
        <a href={signedIn ? accountHref : "#admin-sign-in"}>
          {signedIn ? accountLabel : "Administration entrance"}{" "}
          <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </div>
  );
}

const provinces = [
  ["AB", "Alberta"],
  ["BC", "British Columbia"],
  ["MB", "Manitoba"],
  ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"],
  ["NT", "Northwest Territories"],
  ["NU", "Nunavut"],
  ["ON", "Ontario"],
  ["PE", "Prince Edward Island"],
  ["QC", "Quebec"],
  ["SK", "Saskatchewan"],
  ["YT", "Yukon"],
];
function ApplicationForm({
  requestedReference,
}: {
  requestedReference: ReturnType<typeof readReference>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [received, setReceived] = useState(false);
  if (received)
    return (
      <div role="status" className="public-received">
        <span aria-hidden="true">✓</span>
        <h3>Application received.</h3>
        <p>
          Thank you. Your business details have been submitted for review.
          Purchasing access is not yet approved.
        </p>
        <p>
          If approved, an administrator will provide a private account
          activation invitation using your contact details.
        </p>
        <a href="#home" className="public-text-link">
          Return to home →
        </a>
      </div>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = event.currentTarget,
          values = new FormData(form);
        try {
          await request("/api/enrollment/applications", {
            method: "POST",
            body: JSON.stringify({
              businessName: values.get("businessName"),
              contactName: values.get("contactName"),
              email: values.get("email"),
              phone: values.get("phone"),
              province: values.get("province"),
              businessNumber: values.get("businessNumber") || undefined,
              notes: values.get("notes") || undefined,
              acknowledgment: true,
              ...(requestedReference ? { requestedReference } : {}),
            }),
          });
          form.reset();
          setReceived(true);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {requestedReference && (
        <ReferenceRequestSummary reference={requestedReference} />
      )}
      <p className="public-form-helper">
        All fields are required unless marked optional.
      </p>
      <fieldset className="public-form-group">
        <legend>Business</legend>
        <label>
          Business name
          <input
            name="businessName"
            required
            maxLength={160}
            autoComplete="organization"
          />
        </label>
        <div className="public-form-row">
          <label>
            Province or territory
            <select name="province" required defaultValue="">
              <option value="" disabled>
                Select province or territory
              </option>
              {provinces.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Business registration number (optional)
            <input name="businessNumber" maxLength={80} />
          </label>
        </div>
        <p className="public-form-helper">
          Do not provide a Social Insurance Number or personal identity
          documents.
        </p>
      </fieldset>
      <fieldset className="public-form-group">
        <legend>Contact</legend>
        <label>
          Contact name
          <input
            name="contactName"
            required
            maxLength={120}
            autoComplete="name"
          />
        </label>
        <div className="public-form-row">
          <label>
            Business email
            <input
              name="email"
              required
              type="email"
              maxLength={254}
              autoComplete="email"
            />
          </label>
          <label>
            Phone
            <input
              name="phone"
              required
              type="tel"
              maxLength={40}
              autoComplete="tel"
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="public-form-group">
        <legend>About your business</legend>
        <label>
          Business details (optional)
          <textarea name="notes" maxLength={1000} rows={3} />
          <span className="public-form-helper">
            Tell us your type of business. Please omit sensitive personal or
            financial information.
          </span>
        </label>
      </fieldset>
      <label className="public-checkbox">
        <input name="acknowledgment" type="checkbox" required />
        <span>
          I am applying on behalf of a Canadian business and understand that
          access and account terms require approval.
        </span>
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="public-primary" disabled={busy}>
        {busy ? "Submitting…" : "Submit application"}
        <span aria-hidden="true">↗</span>
      </button>
      <p className="public-form-helper">
        Your details are used to review this application and contact your
        business about the account.
      </p>
    </form>
  );
}
function ActivationForm({ token }: { token: string }) {
  const retainedToken = useRef(token);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [activated, setActivated] = useState(false);
  if (activated)
    return (
      <div role="status">
        <h2>Your account is activated.</h2>
        <p>Sign in with your approved business email and your new password.</p>
        <a href="#sign-in" className="public-primary">
          Continue to sign in ↗
        </a>
      </div>
    );
  if (!retainedToken.current)
    return (
      <>
        <h2>Invitation required</h2>
        <p>
          Open the private activation invitation provided by your administrator.
          If it has expired, ask them for a replacement.
        </p>
        <a href="#sign-in">Return to sign in</a>
      </>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const form = event.currentTarget,
          values = new FormData(form);
        if (values.get("password") !== values.get("confirmation")) {
          setError("Passwords must match.");
          return;
        }
        setBusy(true);
        try {
          await request("/api/enrollment/activate", {
            method: "POST",
            body: JSON.stringify({
              token: retainedToken.current,
              password: values.get("password"),
            }),
          });
          retainedToken.current = "";
          form.reset();
          setActivated(true);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Activate your trade account</h2>
      <label>
        New password (14–256 characters)
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={14}
          maxLength={256}
        />
      </label>
      <label>
        Confirm password
        <input
          type="password"
          name="confirmation"
          autoComplete="new-password"
          required
          minLength={14}
          maxLength={256}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="public-primary" disabled={busy}>
        {busy ? "Activating…" : "Activate account"}
      </button>
    </form>
  );
}

const featured = preview.products.filter((p) => p.imageUrl);

// Rotates the featured systems; pauses while hovered or focused and stays
// still when the visitor prefers reduced motion.
function FeaturedCarousel() {
  const [index, setIndex] = useState(0),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    if (
      paused ||
      featured.length < 2 ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % featured.length),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [paused]);
  const product = featured[index];
  if (!product) return null;
  return (
    <div
      className="public-feature-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured systems"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <a
        key={product.id}
        className="public-equipment-feature"
        href={`#product=${encodeURIComponent(product.id)}`}
        aria-roledescription="slide"
        aria-label={`${index + 1} of ${featured.length}: ${product.title}`}
      >
        <div className="public-feature-brand">
          GREE <span>HEATING & COOLING</span>
        </div>
        <img
          src={product.imageUrl}
          alt={product.title}
          fetchPriority={index === 0 ? "high" : "auto"}
        />
        <div className="public-feature-caption">
          <div>
            <small>FEATURED SYSTEM</small>
            <strong>{product.title}</strong>
          </div>
          <span aria-hidden="true">↗</span>
        </div>
      </a>
      {featured.length > 1 && (
        <div className="public-feature-dots">
          {featured.map((p, i) => (
            <button
              key={p.id}
              type="button"
              aria-label={`Show ${p.title}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
