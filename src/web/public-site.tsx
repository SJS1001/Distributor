import { useEffect, useRef, useState, type ReactNode } from "react";
import { request } from "./api.ts";
import "./public-site.css";

export type PublicRoute = "home" | "sign-in" | "apply" | "activate";
export function readPublicRoute(hash: string): PublicRoute {
  if (hash.startsWith("#activate=") || hash === "#activate") return "activate";
  if (hash === "#apply") return "apply";
  if (hash === "#sign-in") return "sign-in";
  return "home";
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
        ? "dstrbtr · Canadian trade accounts"
        : `${route === "apply" ? "Apply for a trade account" : route === "activate" ? "Activate your account" : "Sign in"} · dstrbtr`;
    document.querySelector<HTMLElement>(".public-main")?.focus();
    window.scrollTo(0, 0);
  }, [route]);
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
        <nav aria-label="Public navigation">
          <a href="#apply">Trade accounts</a>
          <a href="#sign-in" className="public-signin">
            Sign in <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main className="public-main" id="public-content" tabIndex={-1}>
        {route === "home" ? (
          <>
            <section className="public-hero">
              <div className="public-hero-copy">
                <p className="public-eyebrow">
                  <span aria-hidden="true" /> Canadian trade pilot
                </p>
                <h1>
                  Built for the
                  <br />
                  work ahead.
                </h1>
                <p className="public-lead">
                  A dedicated ordering workspace for contractors. Bring your
                  business, get your trade account reviewed, and purchase
                  through one connected portal.
                </p>
                <div className="public-actions">
                  <a className="public-primary" href="#apply">
                    Apply for a trade account <span aria-hidden="true">↗</span>
                  </a>
                  <a className="public-text-link" href="#sign-in">
                    Already approved? Sign in
                  </a>
                </div>
                <p className="public-caption">
                  Business accounts · Canada · Approval required
                </p>
              </div>
              <div
                className="public-system"
                role="img"
                aria-label="A diagram connecting your trade account to ordering, fulfillment and billing"
              >
                <div className="public-system-top">
                  <span>THE TRADE WORKSPACE</span>
                  <span aria-hidden="true">CA / 01</span>
                </div>
                <div className="public-crate">
                  <span className="public-crate-mark">d.</span>
                  <span>YOUR BUSINESS</span>
                  <span className="public-crate-tag">TRADE ACCOUNT</span>
                </div>
                <div className="public-flow-line" aria-hidden="true" />
                <div className="public-flow-nodes">
                  <div>
                    <span>01</span>Order
                  </div>
                  <div>
                    <span>02</span>Track
                  </div>
                  <div>
                    <span>03</span>Invoice
                  </div>
                </div>
                <div className="public-system-bottom">
                  A clear path from account to order.
                  <span aria-hidden="true">↗</span>
                </div>
              </div>
            </section>
            <section className="public-intro">
              <p className="public-eyebrow">LESS ADMIN. MORE VISIBILITY.</p>
              <h2>
                Your purchasing,
                <br />
                with the details in reach.
              </h2>
              <p>
                Approved buyers can browse their available catalog and account
                pricing, submit orders, follow fulfillment, and review invoices
                in the same workspace. Availability and terms are specific to
                your account.
              </p>
            </section>
            <section
              className="public-capabilities"
              aria-label="Account workspace capabilities"
            >
              {[
                [
                  "01",
                  "Account pricing",
                  "See the catalog and pricing available to your approved business account.",
                ],
                [
                  "02",
                  "Order visibility",
                  "Keep order details and fulfillment progress together, from submission onward.",
                ],
                [
                  "03",
                  "Billing records",
                  "Review your invoices, credits and account balances in one place.",
                ],
              ].map(([number, title, text]) => (
                <article key={number}>
                  <span className="public-index">{number}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </section>
            <section className="public-process">
              <div>
                <p className="public-eyebrow">
                  A TRADE ACCOUNT, NOT AN INSTANT SIGNUP
                </p>
                <h2>
                  Apply. Review.
                  <br />
                  Get to work.
                </h2>
                <p>
                  We review business applications before granting purchasing
                  access. Submitting an application does not create an account
                  or approve credit.
                </p>
              </div>
              <ol>
                <li>
                  <span>01</span>
                  <div>
                    <h3>Tell us about your business</h3>
                    <p>
                      Share your business and contact details through the
                      application form.
                    </p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <h3>Your application is reviewed</h3>
                    <p>
                      An administrator reviews eligibility and sets your account
                      terms.
                    </p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <h3>Activate with a private invitation</h3>
                    <p>
                      If approved, receive a one-time invitation, choose a
                      password, then sign in.
                    </p>
                  </div>
                </li>
              </ol>
            </section>
            <section className="public-final-cta">
              <div>
                <p className="public-eyebrow">FOR YOUR NEXT ORDER</p>
                <h2>Start with your business.</h2>
              </div>
              <a className="public-primary" href="#apply">
                Apply for a trade account <span aria-hidden="true">↗</span>
              </a>
            </section>
          </>
        ) : route === "sign-in" ? (
          <div className="public-form-layout">
            <div>
              <p className="public-eyebrow">YOUR TRADE WORKSPACE</p>
              <h1>Welcome back.</h1>
              <p>
                Sign in with your approved business account. Applying for the
                first time? <a href="#apply">Start an application.</a>
              </p>
            </div>
            <div className="public-form-card">{login}</div>
          </div>
        ) : route === "apply" ? (
          <div className="public-form-layout">
            <div>
              <p className="public-eyebrow">CANADIAN BUSINESS ACCOUNTS</p>
              <h1>
                Work starts
                <br />
                here.
              </h1>
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
              <h2>Apply for a trade account</h2>
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
              <h1>
                Make it
                <br />
                yours.
              </h1>
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
        <p>Canadian trade pilot · Business purchasing by approved account</p>
        <a href="#sign-in">
          Account sign in <span aria-hidden="true">↗</span>
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
