import { useEffect, useRef, useState, type ReactNode } from "react";
import { request } from "./api.ts";
import "./public-site.css";
import { ScannerPage } from "./scanner-page.tsx";

export type PublicRoute =
  | "scanner"
  | "home"
  | "sign-in"
  | "customer-sign-in"
  | "admin-sign-in"
  | "apply"
  | "activate";
export function readPublicRoute(hash: string): PublicRoute {
  if (hash.startsWith("#activate=") || hash === "#activate") return "activate";
  if (hash === "#scanner") return "scanner";
  if (hash === "#apply") return "apply";
  if (hash === "#admin-sign-in") return "admin-sign-in";
  if (hash === "#customer-sign-in") return "customer-sign-in";
  if (hash === "#sign-in") return "sign-in";
  return "home";
}

function EquipmentDrawing() {
  return (
    <figure className="public-equipment">
      <div className="public-drawing-label">
        <span>HEATING / COOLING</span>
        <span>TRADE SUPPLY</span>
      </div>
      <svg
        viewBox="0 0 560 410"
        role="img"
        aria-label="Original illustration of an outdoor heat pump and an indoor wall unit"
      >
        <defs>
          <pattern
            id="public-grille"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 0V7" stroke="#8695a0" strokeWidth="1" />
          </pattern>
          <radialGradient id="public-fan">
            <stop stopColor="#293f51" />
            <stop offset="1" stopColor="#112635" />
          </radialGradient>
        </defs>
        <path
          d="M20 357H540M50 40V380M510 40V380"
          stroke="#c5c6bf"
          strokeWidth="1"
          strokeDasharray="3 7"
        />
        <path
          d="M89 76L421 59L468 84L135 103Z"
          fill="#ecebe4"
          stroke="#657481"
        />
        <path
          d="M89 76V132Q89 147 109 149L420 133V59"
          fill="#f9f8f1"
          stroke="#657481"
        />
        <path d="M420 59L468 84V139L420 133Z" fill="#c4ccc9" stroke="#657481" />
        <path
          d="M112 129L399 115M112 136L399 122"
          stroke="#617787"
          strokeWidth="3"
        />
        <path d="M127 96L180 93" stroke="#a34f2b" strokeWidth="3" />
        <path
          d="M388 133V165Q388 178 406 183L452 201"
          fill="none"
          stroke="#a34f2b"
          strokeWidth="3"
        />
        <path
          d="M103 206L357 179L439 211L184 243Z"
          fill="#e8e8e1"
          stroke="#536b7b"
        />
        <path d="M103 206V337L357 318V179Z" fill="#f9f8f1" stroke="#536b7b" />
        <path
          d="M357 179L439 211V349L357 318Z"
          fill="url(#public-grille)"
          stroke="#536b7b"
        />
        <path
          d="M103 337L184 373L439 349L357 318Z"
          fill="#a8b6bc"
          stroke="#536b7b"
        />
        <path
          d="M126 342V357L157 370V351M376 349V365L409 362V352"
          fill="#172f43"
        />
        <circle
          cx="225"
          cy="261"
          r="62"
          fill="url(#public-fan)"
          stroke="#697f8a"
          strokeWidth="5"
        />
        <g fill="#81949d" stroke="#142d40" strokeWidth="2">
          <path d="M225 261C184 250 167 232 185 217C209 208 229 231 225 261Z" />
          <path d="M225 261C234 220 252 203 268 222C278 246 254 266 225 261Z" />
          <path d="M225 261C266 271 283 289 265 305C241 314 220 291 225 261Z" />
          <path d="M225 261C215 302 197 319 181 300C172 276 196 256 225 261Z" />
        </g>
        <g fill="none" stroke="#abb9bf" opacity=".65">
          <circle cx="225" cy="261" r="52" />
          <circle cx="225" cy="261" r="42" />
          <circle cx="225" cy="261" r="31" />
          <path d="M164 261H286M225 200V322" />
        </g>
        <circle cx="225" cy="261" r="11" fill="#e6e9e3" />
        <path
          d="M119 225L147 222M119 233L147 230"
          stroke="#a34f2b"
          strokeWidth="3"
        />
        <path
          d="M37 188H81M37 184V192M81 184V192M478 226V329M474 226H482M474 329H482"
          stroke="#a34f2b"
        />
      </svg>
      <figcaption>
        <span>Equipment for the work ahead.</span>
        <span>Illustration / not a product specification</span>
      </figcaption>
    </figure>
  );
}

export function PublicSite({
  route,
  activationToken,
  login,
}: {
  route: PublicRoute;
  activationToken: string;
  login: ReactNode;
}) {
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
        : `${route === "scanner" ? "Barcode scanner" : route === "apply" ? "Apply for a trade account" : route === "activate" ? "Activate your account" : route === "admin-sign-in" ? "Administration sign in" : "Customer sign in"} · dstrbtr`;
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
          dstrbtr<span className="public-brand-dot">.</span>
        </a>
        <span className="public-header-descriptor">HVAC / CANADIAN TRADE</span>
        <nav aria-label="Public navigation">
          <a href="#customer-sign-in">
            Customer sign in <span aria-hidden="true">↗</span>
          </a>
          <a href="#admin-sign-in">Administration</a>
        </nav>
      </header>
      <main className="public-main" id="public-content" tabIndex={-1}>
        {route === "home" ? (
          <>
            <section className="public-hero">
              <div className="public-hero-copy">
                <p className="public-eyebrow">FOR CANADIAN HVAC CONTRACTORS</p>
                <h1>HVAC supply for the Canadian trade.</h1>
                <p className="public-lead">
                  Equipment, account pricing and order details. A dedicated
                  workspace for your next installation, service call or
                  replacement.
                </p>
                <div
                  className="public-hero-actions"
                  aria-label="Customer access"
                >
                  <a href="#customer-sign-in" className="public-primary">
                    Customer sign in <span aria-hidden="true">↗</span>
                  </a>
                  <a href="#apply" className="public-apply-link">
                    Apply for a trade account <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <p className="public-caption">
                  Business purchasing · Approved trade accounts
                </p>
              </div>
              <EquipmentDrawing />
            </section>
            <section
              className="public-access"
              aria-labelledby="public-access-title"
            >
              <div className="public-access-heading">
                <p className="public-eyebrow">YOUR WAY IN</p>
                <h2 id="public-access-title">Start here.</h2>
              </div>
              <div className="public-access-paths">
                <a
                  className="public-access-link public-customer"
                  href="#customer-sign-in"
                >
                  <span className="public-index">01 / EXISTING CUSTOMERS</span>
                  <span className="public-access-title">
                    Customer sign in <span aria-hidden="true">↗</span>
                  </span>
                  <span className="public-access-description">
                    Open your catalog, account pricing and orders.
                  </span>
                </a>
                <a className="public-access-link" href="#apply">
                  <span className="public-index">02 / NEW TRADE CUSTOMERS</span>
                  <span className="public-access-title">
                    Apply for a trade account <span aria-hidden="true">↗</span>
                  </span>
                  <span className="public-access-description">
                    Send your business details for review.
                  </span>
                </a>
                <div className="public-staff-entrances">
                  <a
                    className="public-access-link public-admin"
                    href="#admin-sign-in"
                  >
                    <span className="public-index">03 / DISTRIBUTOR STAFF</span>
                    <span className="public-access-title">
                      Administration entrance <span aria-hidden="true">↗</span>
                    </span>
                    <span className="public-access-description">
                      Sign in to your staff workspace.
                    </span>
                  </a>
                  <a className="public-scanner-link" href="#scanner">
                    Barcode scanner <span aria-hidden="true">↗</span>
                    <small>Open it here or send the link to your phone.</small>
                  </a>
                </div>
              </div>
            </section>
            <section className="public-trade-note">
              <div>
                <p className="public-eyebrow">ACCOUNT ACCESS</p>
                <h2>
                  Your business.
                  <br />
                  Your purchasing terms.
                </h2>
              </div>
              <div>
                <p>
                  Your approved account determines the equipment, pricing and
                  purchasing options available to you. Sign in to view product
                  details, supporting documents and your order history.
                </p>
                <p>
                  New to dstrbtr? Applications are reviewed before access is
                  granted. If approved, an administrator provides a private
                  invitation to activate your account.
                </p>
                <a href="#apply" className="public-text-link">
                  Apply for a trade account <span aria-hidden="true">→</span>
                </a>
              </div>
            </section>
          </>
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
                    the first time? <a href="#apply">Start an application.</a>
                  </>
                )}
              </p>
              <a className="public-text-link" href="#home">
                ← Back to the entrance
              </a>
            </div>
            <div className="public-form-card">{login}</div>
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
                <p>
                  Approval includes a private invitation to activate your buyer
                  account. No account is created automatically, and submitting
                  this form does not approve credit.
                </p>
              </div>
            </div>
            <div className="public-form-card">
              <h2>Business details</h2>
              {config?.enabled ? (
                <ApplicationForm />
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
        <p>Canadian HVAC trade · Business purchasing by approved account</p>
        <a href="#admin-sign-in">
          Administration entrance <span aria-hidden="true">↗</span>
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
function ApplicationForm() {
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
      <p className="public-form-helper">
        All fields are required unless marked optional.
      </p>
      <label>
        Business name
        <input
          name="businessName"
          required
          maxLength={160}
          autoComplete="organization"
        />
      </label>
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
        <span className="public-form-helper">
          Do not provide a Social Insurance Number or personal identity
          documents.
        </span>
      </label>
      <label>
        Business details (optional)
        <textarea name="notes" maxLength={1000} rows={3} />
        <span className="public-form-helper">
          Tell us your type of business. Please omit sensitive personal or
          financial information.
        </span>
      </label>
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
