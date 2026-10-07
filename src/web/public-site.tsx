import { Wordmark } from "./wordmark.tsx";
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

// Present single- and multi-zone equipment together without losing either range.
const homepageCategories = [
  {
    ...preview.categories[0]!,
    id: "ductless",
    title: "Ductless mini-splits",
    count: preview.categories
      .filter((c) => ["mini-splits", "multi-zone-mini-splits"].includes(c.id))
      .reduce((total, c) => total + c.count, 0),
  },
  { ...preview.categories[1]!, title: "Central heat pumps" },
  { ...preview.categories[3]!, title: "Commercial systems" },
];

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
  catalogHref,
  sessionAudience,
  signOut,
  signOutPending = false,
  signOutError,
}: {
  route: PublicRoute;
  activationToken: string;
  login: ReactNode;
  workspaceHref?: string;
  catalogHref?: string;
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
  const [configAttempt, setConfigAttempt] = useState(0);
  useEffect(() => {
    setConfigError(false);
    const controller = new AbortController();
    void request<{ enabled: boolean }>("/api/enrollment/config", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setConfig(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigError(true);
      });
    return () => controller.abort();
  }, [configAttempt]);
  useEffect(() => {
    if (configAttempt && config?.enabled)
      document.getElementById("public-entry-form")?.focus();
  }, [configAttempt, config]);
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
      <header className="public-header">
        <a href="#home" className="public-wordmark" aria-label="dstrbtr home">
          <Wordmark />
        </a>
        <nav aria-label="Public navigation">
          {signedIn ? (
            <>
              {catalogHref && <a href={catalogHref}>Manage catalog</a>}
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
              <a
                className="public-entry-sign-in"
                href="#customer-sign-in"
                aria-current={
                  route === "customer-sign-in" || route === "sign-in"
                    ? "page"
                    : undefined
                }
              >
                Sign in
              </a>
              <a
                className="public-entry-apply"
                href="#apply"
                aria-current={route === "apply" ? "page" : undefined}
              >
                Apply for a trade account
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
                <p className="public-eyebrow">GREE HEATING & COOLING</p>
                <h1>
                  Equipment for your
                  <br />
                  next installation.
                </h1>
                <p className="public-lead">
                  Explore systems, specifications and technical documents.
                  <br />
                  Sign in to see your account pricing and order.
                </p>
                <div className="public-hero-actions">
                  <a href="#products" className="public-primary">
                    Explore products <span aria-hidden="true">→</span>
                  </a>
                </div>
              </div>
              <FeaturedCarousel />
            </section>
            <section className="public-products-section">
              <div className="public-section-heading">
                <div>
                  <h2>Find your system.</h2>
                </div>
                <a href="#products">
                  All products <span aria-hidden="true">→</span>
                </a>
              </div>
              <div className="public-category-grid">
                {homepageCategories.map((category) => (
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
            <div
              className="public-form-card"
              id="public-entry-form"
              tabIndex={-1}
            >
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
              <a
                className="public-text-link public-form-jump"
                href="#public-entry-form"
                onClick={(event) => {
                  event.preventDefault();
                  document
                    .getElementById("public-entry-form")
                    ?.scrollIntoView({ block: "start" });
                  document.getElementById("public-entry-form")?.focus();
                }}
              >
                Enter business details ↓
              </a>
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
            <div
              className="public-form-card"
              id="public-entry-form"
              tabIndex={-1}
            >
              <h2>Business details</h2>
              {config?.enabled ? (
                <ApplicationForm requestedReference={requestedReference} />
              ) : (
                <>
                  <p role="status">
                    {configError
                      ? "Applications are temporarily unavailable. Retry to check availability."
                      : config
                        ? "Trade account applications are currently closed."
                        : "Checking application availability…"}
                  </p>
                  {configError && (
                    <button
                      className="public-primary"
                      onClick={() => setConfigAttempt((attempt) => attempt + 1)}
                    >
                      Retry application availability
                    </button>
                  )}
                </>
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
            <div
              className="public-form-card"
              id="public-entry-form"
              tabIndex={-1}
            >
              <ActivationForm key={activationToken} token={activationToken} />
            </div>
          </div>
        )}
      </main>
      <footer className="public-footer">
        <a className="public-wordmark" href="#home">
          <Wordmark />
        </a>
        <p>
          Canadian HVAC trade
          <br />
          Equipment information · Business purchasing by approved account
        </p>
        <nav aria-label="Public tools">
          <a href="#scanner">Barcode scanner</a>
          <a href={signedIn ? accountHref : "#admin-sign-in"}>
            {signedIn ? accountLabel : "Administration entrance"}{" "}
            <span aria-hidden="true">→</span>
          </a>
        </nav>
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
  const resultRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (received) resultRef.current?.focus();
    else if (error) errorRef.current?.focus();
  }, [received, error]);
  if (received)
    return (
      <div
        ref={resultRef}
        tabIndex={-1}
        role="status"
        className="public-received"
      >
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
        <p ref={errorRef} tabIndex={-1} role="alert" className="error">
          {error}
        </p>
      )}
      <button className="public-primary" disabled={busy}>
        {busy ? "Submitting…" : "Submit application"}
        <span aria-hidden="true">→</span>
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
  const resultRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (activated) resultRef.current?.focus();
    else if (error) errorRef.current?.focus();
  }, [activated, error]);
  if (activated)
    return (
      <div ref={resultRef} tabIndex={-1} role="status">
        <h2>Your account is activated.</h2>
        <p>Sign in with your approved business email and your new password.</p>
        <a href="#customer-sign-in" className="public-primary">
          Continue to sign in →
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
        <a href="#customer-sign-in">Return to customer sign in</a>
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
        <p ref={errorRef} tabIndex={-1} role="alert" className="error">
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

// User pause is independent of temporary hover/focus stops. Motion changes
// take effect immediately without overriding the visitor’s pause choice.
function FeaturedCarousel() {
  const [index, setIndex] = useState(0),
    [paused, setPaused] = useState(false),
    [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false),
    [reducedMotion, setReducedMotion] = useState(
      () =>
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
        false,
    );
  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!preference) return;
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || hovered || focused || reducedMotion || featured.length < 2)
      return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % featured.length),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [paused, hovered, focused, reducedMotion]);
  const product = featured[index];
  if (!product) return null;
  return (
    <div
      className="public-feature-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured systems"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
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
          <span aria-hidden="true">→</span>
        </div>
      </a>
      {featured.length > 1 && (
        <div className="public-feature-controls">
          <button
            type="button"
            aria-label="Previous system"
            title="Previous system"
            onClick={() =>
              setIndex((i) => (i + featured.length - 1) % featured.length)
            }
          >
            <span aria-hidden="true">←</span>
          </button>
          <div className="public-feature-dots">
            {featured.map((p, i) => (
              <button
                key={p.id}
                type="button"
                aria-label={`Show ${p.title}`}
                title={p.title}
                aria-current={i === index ? "true" : undefined}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Next system"
            title="Next system"
            onClick={() => setIndex((i) => (i + 1) % featured.length)}
          >
            <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            disabled={reducedMotion}
            aria-label={
              reducedMotion
                ? "Rotation off"
                : paused
                  ? "Play rotation"
                  : "Pause rotation"
            }
            title={
              reducedMotion
                ? "Rotation is off for your reduced motion preference"
                : paused
                  ? "Play rotation"
                  : "Pause rotation"
            }
            onClick={() => setPaused((value) => !value)}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="currentColor"
            >
              {paused && !reducedMotion ? (
                <path d="M5 3l10 6-10 6z" />
              ) : (
                <path d="M4 3h3v12H4zM11 3h3v12h-3z" />
              )}
            </svg>
          </button>
          <span
            className="public-visually-hidden"
            aria-live={paused || reducedMotion ? "polite" : "off"}
          >
            {index + 1} of {featured.length}
          </span>
        </div>
      )}
    </div>
  );
}
