import { CustomerMinimumOrders } from "./iam-customer-minimum-order.ts";
import { SESSION_DETAILS_INITIALIZE } from "./session-details-schema.ts";
import {
  sessionDeviceDescription,
  type SessionDetail,
} from "../shared/session-details.ts";
import { OrganizationResidency } from "./organization-residency.ts";
import { CustomerContactsModule } from "./iam-customer-contacts.ts";
import { coverageDays, readCoveragePolicy } from "./coverage-policy.ts";
import { validateMfaPolicy } from "./mfa-policy.ts";
import {
  countReviewMode,
  readCountReviewPolicy,
  type CountReviewMode,
} from "./count-policy.ts";
import { MultiFactor } from "./iam-mfa.ts";
import { ProviderResidency, type ProviderAcceptance } from "./iam-residency.ts";
import {
  isProviderName,
  type ProviderName,
} from "../shared/provider-choices.ts";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  account,
  canonical,
  check,
  digest,
  DomainError,
  id,
  integer,
  now,
  permit,
  site,
  text,
  type Actor,
  type Role,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import {
  importFields,
  type MasterMapping,
  type MasterReview,
} from "./import-manifest.ts";

export type Region = "CA" | "US";
export type Organization = {
  id: string;
  name: string;
  region: Region;
  currency: "CAD" | "USD";
  policy: string;
};
export type Customer = {
  id: string;
  org_id: string;
  name: string;
  currency: string;
  tier: string;
  credit_limit: number;
  held: number;
  residency_mode: string;
  provider_exceptions: string;
  residency_version: number;
};
const roles: Role[] = [
  "admin",
  "warehouse",
  "commercial",
  "finance",
  "warranty",
  "buyer",
  "support",
];
function passwordHash(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}
export class Identity {
  private store: Store;
  readonly mfa: MultiFactor;
  private readonly mfaRequiredRoles: readonly Role[];
  readonly residency: ProviderResidency;
  readonly organizationResidency: OrganizationResidency;
  readonly minimumOrders: CustomerMinimumOrders;
  readonly contacts: CustomerContactsModule;
  constructor(
    private database: Database,
    private platform: Platform,
    public region: Region,
    private validateSites: (actor: Actor, sites: string[]) => void,
    mfaEncryptionKey?: string,
    mfaRequiredRoles: readonly Role[] = [],
    startupMaintenance = true,
  ) {
    this.mfaRequiredRoles = validateMfaPolicy(
      mfaRequiredRoles,
      mfaEncryptionKey,
    );
    this.store = database.owned("iam");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS iam_organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,region TEXT NOT NULL CHECK(region IN ('CA','US')),currency TEXT NOT NULL CHECK(currency IN ('CAD','USD')),policy TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS iam_accounts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,currency TEXT NOT NULL,tier TEXT NOT NULL,credit_limit INTEGER NOT NULL CHECK(credit_limit>=0),held INTEGER NOT NULL DEFAULT 0 CHECK(held IN(0,1)),residency_mode TEXT NOT NULL DEFAULT 'strict' CHECK(residency_mode IN('strict','provider-exceptions')),provider_exceptions TEXT NOT NULL DEFAULT '[]',residency_version INTEGER NOT NULL DEFAULT 1) STRICT;
      CREATE TABLE IF NOT EXISTS iam_users(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,account_id TEXT,role TEXT NOT NULL,sites TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1))) STRICT;
      CREATE TABLE IF NOT EXISTS iam_sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS iam_attempts(email TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS iam_user_security(user_id TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>0),password_change_required INTEGER NOT NULL CHECK(password_change_required IN(0,1)),updated_at TEXT NOT NULL) STRICT;
    `);
    this.store.migrate(SESSION_DETAILS_INITIALIZE);
    this.residency = new ProviderResidency(
      database,
      platform,
      region,
      (actor) => this.residencyActor(actor),
      (actor, accountId) => this.customer(actor, accountId),
    );
    this.contacts = new CustomerContactsModule(database, platform, this);
    this.minimumOrders = new CustomerMinimumOrders(database, platform, this);
    this.organizationResidency = new OrganizationResidency(
      database,
      platform,
      region,
      (actor) => this.residencyActor(actor),
      (actor) => this.organization(actor),
    );
    this.mfa = new MultiFactor(
      database,
      platform,
      {
        authenticate: (actor, password, throttle) => {
          const current = this.reauthenticate(
            actor,
            password,
            false,
            throttle,
            false,
          );
          check(
            !this.passwordChangeRequired(current.id),
            "PASSWORD_CHANGE_REQUIRED",
            "Change your password before configuring an authenticator.",
            403,
          );
          return current;
        },
        required: (actor) =>
          this.mfaRequiredRoles.includes(this.currentActor(actor).role),
        revision: (actor) => Number(this.user(actor, actor.id).revision),
        changed: (actor) => ({
          revision: this.advance(this.user(actor, actor.id)),
          sessionsEnded: this.endSessions(actor.id),
        }),
        failed: (actor) =>
          this.recordAuthenticationFailure(
            String(this.user(actor, actor.id).email),
            Date.now(),
          ),
      },
      mfaEncryptionKey,
      startupMaintenance,
    );
  }
  bootstrap(
    name: string,
    email: string,
    password: string,
    currency: "CAD" | "USD",
  ): Actor {
    check(
      password.length >= 14 && password.length <= 256,
      "VALIDATION",
      "Use a password of 14–256 characters.",
      400,
    );
    check(
      ["CAD", "USD"].includes(currency),
      "VALIDATION",
      "Unsupported currency.",
      400,
    );
    return this.database.transaction(() => {
      check(
        !this.store.get("SELECT id FROM iam_organizations LIMIT 1"),
        "ALREADY_CONFIGURED",
        "Bootstrap is only allowed for an empty store.",
      );
      const orgId = id();
      const userId = id();
      const salt = randomBytes(24).toString("hex");
      this.store.run(
        "INSERT INTO iam_organizations VALUES(?,?,?,?,?)",
        orgId,
        text(name, "organization"),
        this.region,
        currency,
        JSON.stringify({
          version: 1,
          approved: false,
          invoiceTrigger: "shipment",
          negativeStock: false,
          coverageDays: 365,
          taxBasisPoints: null,
        }),
      );
      this.store.run(
        "INSERT INTO iam_users(id,org_id,email,name,role,sites,salt,password_hash) VALUES(?,?,?,?,?,?,?,?)",
        userId,
        orgId,
        text(email, "email").toLowerCase(),
        "Administrator",
        "admin",
        "[]",
        salt,
        passwordHash(password, salt),
      );
      const actor: Actor = {
        id: userId,
        orgId,
        accountId: null,
        role: "admin",
        sites: [],
        name: "Administrator",
      };
      this.platform.audit(actor, "organization.bootstrap", orgId, {
        region: this.region,
        currency,
      });
      return actor;
    });
  }
  organization(actor: Actor): Organization {
    return this.configurationOrganization(actor.orgId);
  }
  countReviewPolicy(actor: Actor) {
    actor = this.currentActor(actor);
    permit(actor, ["warehouse", "support"]);
    check(
      !this.passwordChangeRequired(actor.id),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing inventory counts.",
      403,
    );
    return readCountReviewPolicy(JSON.parse(this.organization(actor).policy));
  }
  configureCountReview(
    actor: Actor,
    key: string,
    input: { mode: CountReviewMode; revision: number; reason: string },
  ) {
    return this.platform.command(
      actor,
      "count.policy",
      key,
      input,
      () => {
        actor = this.currentActor(actor);
        permit(actor, []);
        this.countReviewPolicy(actor);
      },
      () => {
        const policy = JSON.parse(this.organization(actor).policy) as Record<
          string,
          unknown
        >;
        const prior = readCountReviewPolicy(policy);
        check(
          integer(input.revision, "count policy revision", 1) ===
            prior.revision,
          "REVISION",
          "Count review policy changed; refresh before saving.",
        );
        const selected = {
          mode: countReviewMode(input.mode),
          revision: prior.revision + 1,
          reason: text(input.reason, "count policy review reason", 1000),
          updatedBy: actor.id,
          updatedAt: now(),
        };
        policy.inventoryCountReview = selected;
        this.store.run(
          "UPDATE iam_organizations SET policy=? WHERE id=?",
          canonical(policy),
          actor.orgId,
        );
        this.platform.event(actor, "CountReviewPolicyChanged", actor.orgId, {
          previous: prior,
          selected,
        });
        return selected;
      },
    );
  }
  coveragePolicy(actor: Actor) {
    actor = this.currentActor(actor);
    permit(actor, ["warranty", "commercial", "buyer"]);
    check(
      !this.passwordChangeRequired(actor.id),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing warranty coverage.",
      403,
    );
    return readCoveragePolicy(JSON.parse(this.organization(actor).policy));
  }
  shipmentCoveragePolicy(actor: Actor, warehouseId: string) {
    actor = this.currentActor(actor);
    permit(actor, ["warehouse"]);
    site(actor, warehouseId);
    check(
      !this.passwordChangeRequired(actor.id),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before handover.",
      403,
    );
    const selected = readCoveragePolicy(
      JSON.parse(this.organization(actor).policy),
    );
    return {
      revision: selected.revision,
      days: selected.days,
      configuredAt: selected.configuredAt,
    };
  }
  configureCoverage(
    actor: Actor,
    key: string,
    input: { days: number; revision: number; reason: string },
  ) {
    return this.platform.command(
      actor,
      "warranty.policy",
      key,
      input,
      () => {
        actor = this.currentActor(actor);
        permit(actor, []);
        this.coveragePolicy(actor);
      },
      () => {
        const policy = JSON.parse(this.organization(actor).policy) as Record<
          string,
          unknown
        >;
        const prior = readCoveragePolicy(policy);
        check(
          integer(input.revision, "coverage policy revision", 1) ===
            prior.revision,
          "REVISION",
          "Coverage policy changed; refresh before saving.",
        );
        const selected = {
          days: coverageDays(input.days),
          revision: prior.revision + 1,
          reason: text(input.reason, "coverage policy review reason", 1000),
          configuredBy: actor.id,
          configuredAt: now(),
        };
        policy.warrantyCoverage = selected;
        this.store.run(
          "UPDATE iam_organizations SET policy=? WHERE id=?",
          canonical(policy),
          actor.orgId,
        );
        this.platform.event(
          actor,
          "WarrantyCoveragePolicyChanged",
          actor.orgId,
          { previous: prior, selected },
        );
        return selected;
      },
    );
  }
  // Trusted local startup may validate a binding without inventing a user/grant.
  // Browser/business callers must continue to use their current actor authority.
  configurationOrganization(orgId: string): Organization {
    const row = this.store.get(
      "SELECT * FROM iam_organizations WHERE id=? AND region=?",
      orgId,
      this.region,
    );
    check(row, "FORBIDDEN", "Organization is unavailable in this region.", 403);
    return {
      id: String(row.id),
      name: String(row.name),
      region: row.region as Region,
      currency: row.currency as Organization["currency"],
      policy: String(row.policy),
    };
  }
  // Filesystem-authorized local workers must not process a differently tagged store.
  assertRegionalStore() {
    check(
      !this.store.get(
        "SELECT id FROM iam_organizations WHERE region<>? LIMIT 1",
        this.region,
      ),
      "REGION",
      "Database organizations do not match the selected region.",
      403,
    );
  }
  private recordAuthenticationFailure(email: string, timestamp: number) {
    // Count in SQL so simultaneous processes cannot overwrite a prior failure.
    this.store.run(
      "INSERT INTO iam_attempts VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET count=CASE WHEN iam_attempts.reset_at<=? THEN 1 ELSE iam_attempts.count+1 END,reset_at=CASE WHEN iam_attempts.reset_at<=? THEN excluded.reset_at ELSE iam_attempts.reset_at END",
      email,
      timestamp + 900000,
      timestamp,
      timestamp,
    );
  }
  login(email: string, password: string, code?: string, userAgent?: unknown) {
    email = text(email, "email", 254).toLowerCase();
    check(
      typeof password === "string" && password.length <= 256,
      "LOGIN",
      "Invalid credentials.",
      401,
    );
    const timestamp = Date.now();
    const attempts = this.store.get(
      "SELECT * FROM iam_attempts WHERE email=?",
      email,
    );
    check(
      !attempts ||
        Number(attempts.reset_at) <= timestamp ||
        Number(attempts.count) < 8,
      "RATE_LIMIT",
      "Too many login attempts. Try again later.",
      429,
    );
    const user = this.store.get("SELECT * FROM iam_users WHERE email=?", email);
    // Perform the same expensive calculation when no principal exists.
    const computed = passwordHash(
      password,
      String(user?.salt ?? "unrecognized-account"),
    );
    const expected = String(user?.password_hash ?? "0".repeat(128));
    const valid =
      timingSafeEqual(
        Buffer.from(computed, "hex"),
        Buffer.from(expected, "hex"),
      ) && user?.active === 1;
    if (!valid) {
      this.recordAuthenticationFailure(email, timestamp);
      check(false, "LOGIN", "Invalid credentials.", 401);
    }
    try {
      return this.database.transaction(() => {
        // A reset/deactivation may have committed while password hashing ran.
        const current = this.store.get(
          "SELECT * FROM iam_users WHERE id=? AND email=?",
          String(user!.id),
          email,
        );
        check(
          current?.active === 1 &&
            current.salt === user!.salt &&
            current.password_hash === user!.password_hash,
          "LOGIN",
          "Invalid credentials.",
          401,
        );
        const actor = this.actor(current);
        this.organization(actor);
        const attempts = this.store.get(
          "SELECT * FROM iam_attempts WHERE email=?",
          email,
        );
        check(
          !attempts ||
            Number(attempts.reset_at) <= Date.now() ||
            Number(attempts.count) < 8,
          "RATE_LIMIT",
          "Too many authentication attempts. Try again later.",
          429,
        );
        this.mfa.verifyLogin(actor, code, Date.now());
        this.store.run("DELETE FROM iam_attempts WHERE email=?", email);
        const token = randomBytes(32).toString("base64url"),
          csrf = randomBytes(32).toString("base64url");
        this.store.run(
          "INSERT INTO iam_sessions VALUES(?,?,?,?)",
          digest(token),
          actor.id,
          csrf,
          timestamp + 8 * 3600000,
        );
        this.store.run(
          "INSERT INTO iam_session_details VALUES(?,?,?,?,?)",
          digest(token),
          randomBytes(16).toString("hex"),
          timestamp,
          timestamp,
          sessionDeviceDescription(userAgent),
        );
        this.platform.audit(actor, "session.login", actor.id, {});
        return {
          token,
          csrf,
          actor,
          passwordChangeRequired: this.passwordChangeRequired(actor.id),
          mfaEnrollmentRequired: this.mfaEnrollmentRequired(actor),
        };
      });
    } catch (error) {
      if (
        ["MFA_INVALID", "LOGIN"].includes(
          (error as { code?: string }).code ?? "",
        )
      )
        this.recordAuthenticationFailure(email, Date.now());
      throw error;
    }
  }
  session(token: string | undefined) {
    check(token, "UNAUTHENTICATED", "Sign in to continue.", 401);
    const row = this.store.get(
      "SELECT s.csrf,u.* FROM iam_sessions s JOIN iam_users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.active=1",
      digest(token),
      Date.now(),
    );
    check(row, "UNAUTHENTICATED", "Session has expired. Sign in again.", 401);
    const actor = this.actor(row);
    this.organization(actor);
    return {
      actor,
      csrf: String(row.csrf),
      passwordChangeRequired: this.passwordChangeRequired(actor.id),
      mfaEnrollmentRequired: this.mfaEnrollmentRequired(actor),
    };
  }
  logout(token: string) {
    this.store.run("DELETE FROM iam_sessions WHERE hash=?", digest(token));
  }
  // HTTP composition calls this after cookie/CSRF/security fences, never for
  // assets. Sample at most once per minute; restored evidence stays unchanged.
  recordSessionActivity(token: string) {
    const timestamp = Date.now(),
      hash = digest(token);
    const row = this.store.get(
      "SELECT last_activity_at FROM iam_session_details WHERE session_hash=?",
      hash,
    );
    if (
      !row ||
      (row.last_activity_at !== null &&
        Number(row.last_activity_at) > timestamp - 60000)
    )
      return;
    this.database.transaction(() => {
      try {
        if (this.platform.recoveryHold()) return;
        this.platform.restore.assertCommandAccess();
      } catch (error) {
        if (error instanceof DomainError) return;
        throw error;
      }
      this.store.run(
        "UPDATE iam_session_details SET last_activity_at=? WHERE session_hash=? AND (last_activity_at IS NULL OR last_activity_at<=?) AND EXISTS(SELECT 1 FROM iam_sessions WHERE hash=? AND expires_at>?)",
        timestamp,
        hash,
        timestamp - 60000,
        hash,
        timestamp,
      );
    });
  }
  // Filesystem-authorized recovery invalidates copied sessions across this regional store.
  invalidateRestoredSessions() {
    this.mfa.invalidateRestoredFactors();
    return Number(this.store.run("DELETE FROM iam_sessions").changes);
  }
  // A worker uses a configured principal, never grants copied from an old session.
  workerActor(orgId: string, userId: string): Actor {
    const row = this.store.get(
      "SELECT * FROM iam_users WHERE org_id=? AND id=? AND active=1",
      orgId,
      userId,
    );
    check(row, "FORBIDDEN", "Provider worker principal is unavailable.", 403);
    const actor = this.actor(row);
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "A buyer cannot run provider work.",
      403,
    );
    this.organization(actor);
    check(
      !this.passwordChangeRequired(actor.id),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before running provider work.",
      403,
    );
    return actor;
  }
  private actor(row: Record<string, unknown>): Actor {
    return {
      id: String(row.id),
      orgId: String(row.org_id),
      accountId: row.account_id ? String(row.account_id) : null,
      role: row.role as Role,
      sites: JSON.parse(String(row.sites)),
      name: String(row.name),
    };
  }
  // Re-read grants after asynchronous local work; a captured Actor is not a durable grant.
  currentActor(actor: Actor): Actor {
    const row = this.store.get(
      "SELECT * FROM iam_users WHERE org_id=? AND id=? AND active=1",
      actor.orgId,
      actor.id,
    );
    check(row, "FORBIDDEN", "Principal is unavailable.", 403);
    const current = this.actor(row);
    this.organization(current);
    return current;
  }
  private passwordChangeRequired(userId: string) {
    return (
      this.store.get(
        "SELECT password_change_required FROM iam_user_security WHERE user_id=?",
        userId,
      )?.password_change_required === 1
    );
  }
  private user(actor: Actor, userId: string) {
    const row = this.store.get(
      "SELECT u.*,COALESCE(s.revision,1) AS revision,COALESCE(s.password_change_required,0) AS password_change_required FROM iam_users u LEFT JOIN iam_user_security s ON s.user_id=u.id WHERE u.org_id=? AND u.id=?",
      actor.orgId,
      text(userId, "user ID"),
    );
    check(row, "NOT_FOUND", "User not found.", 404);
    return row;
  }
  private mfaEnrollmentRequired(actor: Actor) {
    return (
      this.mfaRequiredRoles.includes(actor.role) &&
      !this.mfa.summary(actor).enabled
    );
  }
  security(actor: Actor, currentSessionToken?: string) {
    const current = this.currentActor(actor),
      row = this.user(current, current.id),
      currentHash = currentSessionToken ? digest(currentSessionToken) : null,
      // Native authority preflight needs scalar security status before any row
      // materialization. Only the HTTP self read supplies its exact session token.
      sessionDetails =
        currentSessionToken === undefined
          ? undefined
          : this.store
              .all(
                "SELECT s.hash,s.expires_at,d.reference,d.created_at,d.last_activity_at,d.device_description FROM iam_sessions s LEFT JOIN iam_session_details d ON d.session_hash=s.hash JOIN iam_users u ON u.id=s.user_id WHERE u.id=? AND u.org_id=? AND u.active=1 AND s.expires_at>? ORDER BY s.expires_at,s.hash",
                current.id,
                current.orgId,
                Date.now(),
              )
              .map((session, index): SessionDetail => ({
                reference:
                  session.reference === null ? null : String(session.reference),
                createdAt:
                  session.created_at === null
                    ? null
                    : Number(session.created_at),
                lastActivityAt:
                  session.last_activity_at === null
                    ? null
                    : Number(session.last_activity_at),
                deviceDescription:
                  session.device_description === null
                    ? null
                    : String(session.device_description),
                // Ordinal labels are presentation only, never session credentials or handles.
                label: `Session ${index + 1}`,
                expiresAt: Number(session.expires_at),
                current: currentHash !== null && session.hash === currentHash,
              }));
    return {
      id: current.id,
      email: String(row.email),
      revision: Number(row.revision),
      passwordChangeRequired: row.password_change_required === 1,
      mfa: {
        ...this.mfa.summary(current),
        required: this.mfaRequiredRoles.includes(current.role),
      },
      sessions:
        sessionDetails?.length ??
        Number(
          this.store.get(
            "SELECT COUNT(*) AS total FROM iam_sessions WHERE user_id=? AND expires_at>?",
            current.id,
            Date.now(),
          )!.total,
        ),
      sessionDetails,
    };
  }
  // HTTP composition only, after the owning module has authorized and paged
  // these records. This is a current-name annotation, not historical identity
  // evidence or a user-directory operation.
  currentNamesForRecordActors<T extends Record<string, unknown>>(
    actor: Actor,
    records: readonly T[],
  ): (T & { currentActorName: string | null })[] {
    const current = this.currentActor(actor);
    permit(current, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
    ]);
    check(
      !this.passwordChangeRequired(current.id),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reading staff records.",
      403,
    );
    check(records.length <= 20, "LIMIT", "Record page is too large.", 400);
    const ids = [...new Set(records.map((record) => record.actor_id))].filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0 && value.length <= 128,
    );
    const names = new Map(
      ids.length
        ? this.store
            .all<{ id: string; name: string }>(
              `SELECT id,name FROM iam_users WHERE org_id=? AND id IN (${ids.map(() => "?").join(",")}) LIMIT ?`,
              current.orgId,
              ...ids,
              ids.length,
            )
            .map((row) => [row.id, row.name] as const)
        : [],
    );
    return records.map((record) => ({
      ...record,
      currentActorName:
        typeof record.actor_id === "string"
          ? (names.get(record.actor_id) ?? null)
          : null,
    }));
  }
  users(actor: Actor) {
    const current = this.currentActor(actor);
    permit(current, []);
    check(
      !this.passwordChangeRequired(current.id),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before administering users.",
      403,
    );
    return this.store
      .all(
        "SELECT u.id,u.email,u.name,u.account_id AS accountId,u.role,u.sites,u.active,COALESCE(s.revision,1) AS revision,COALESCE(s.password_change_required,0) AS passwordChangeRequired,(SELECT COUNT(*) FROM iam_sessions t WHERE t.user_id=u.id AND t.expires_at>?) AS sessions FROM iam_users u LEFT JOIN iam_user_security s ON s.user_id=u.id WHERE u.org_id=? ORDER BY u.name,u.id",
        Date.now(),
        current.orgId,
      )
      .map((row) => ({
        id: String(row.id),
        email: String(row.email),
        name: String(row.name),
        accountId: row.accountId ? String(row.accountId) : null,
        role: row.role as Role,
        revision: Number(row.revision),
        sessions: Number(row.sessions),
        active: row.active === 1,
        passwordChangeRequired: row.passwordChangeRequired === 1,
        sites: JSON.parse(String(row.sites)) as string[],
      }));
  }
  private validPassword(password: unknown) {
    check(
      typeof password === "string" &&
        password.length >= 14 &&
        password.length <= 256,
      "VALIDATION",
      "Use a password of 14–256 characters.",
      400,
    );
  }
  private passwordMatches(actor: Actor, password: string) {
    const row = this.user(actor, actor.id);
    const computed = passwordHash(password, String(row.salt));
    return timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(String(row.password_hash), "hex"),
    );
  }
  private reauthenticate(
    actor: Actor,
    password: string,
    administrator: boolean,
    throttle = false,
    clearFailures = true,
  ) {
    const current = this.currentActor(actor);
    if (administrator) {
      permit(current, []);
      check(
        !this.passwordChangeRequired(current.id),
        "PASSWORD_CHANGE_REQUIRED",
        "Change your password before administering users.",
        403,
      );
    }
    check(
      typeof password === "string" && password.length <= 256,
      "REAUTHENTICATE",
      "Current password is incorrect.",
      403,
    );
    const email = String(this.user(current, current.id).email),
      timestamp = Date.now();
    const attempts = this.store.get(
      "SELECT * FROM iam_attempts WHERE email=?",
      email,
    );
    check(
      !attempts ||
        Number(attempts.reset_at) <= timestamp ||
        Number(attempts.count) < 8,
      "RATE_LIMIT",
      "Too many authentication attempts. Try again later.",
      429,
    );
    if (!this.passwordMatches(current, password)) {
      // Outside the business transaction so a denied command cannot roll back throttling.
      if (throttle) this.recordAuthenticationFailure(email, timestamp);
      check(false, "REAUTHENTICATE", "Current password is incorrect.", 403);
    }
    if (throttle && clearFailures)
      this.store.run("DELETE FROM iam_attempts WHERE email=?", email);
    return current;
  }
  private grants(
    actor: Actor,
    input: { role: Role; accountId?: string; sites: string[] },
  ) {
    check(roles.includes(input.role), "VALIDATION", "Unknown role.", 400);
    check(
      Array.isArray(input.sites) &&
        input.sites.length <= 100 &&
        input.sites.every((v) => typeof v === "string" && v.length > 0) &&
        new Set(input.sites).size === input.sites.length,
      "VALIDATION",
      "Choose at most 100 distinct warehouses.",
      400,
    );
    this.validateSites(actor, input.sites);
    if (input.role === "buyer") {
      check(input.accountId, "VALIDATION", "Buyer requires an account.", 400);
      this.customer(actor, input.accountId);
    }
  }
  private email(value: string, exceptId?: string) {
    const email = text(value, "email", 254).toLowerCase();
    check(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      "VALIDATION",
      "Enter a valid email address.",
      400,
    );
    check(
      !this.store.get(
        "SELECT id FROM iam_users WHERE email=? AND id<>?",
        email,
        exceptId ?? "",
      ),
      "EMAIL_IN_USE",
      "Email address is already in use.",
    );
    return email;
  }
  private revision(row: Record<string, unknown>, expected: number) {
    integer(expected, "user revision", 1, 1e12);
    check(
      Number(row.revision) === expected,
      "STALE_USER",
      "User access changed. Refresh and review the current version.",
    );
  }
  private advance(
    row: Record<string, unknown>,
    required = Number(row.password_change_required),
  ) {
    const revision = Number(row.revision) + 1;
    this.store.run(
      "INSERT INTO iam_user_security VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,password_change_required=excluded.password_change_required,updated_at=excluded.updated_at",
      String(row.id),
      revision,
      required,
      now(),
    );
    this.mfa.invalidatePending({
      id: String(row.id),
      orgId: String(row.org_id),
    });
    return revision;
  }
  private endSessions(userId: string) {
    return Number(
      this.store.run("DELETE FROM iam_sessions WHERE user_id=?", userId)
        .changes,
    );
  }
  updateUser(
    actor: Actor,
    key: string,
    input: {
      userId: string;
      revision: number;
      email: string;
      name: string;
      role: Role;
      accountId?: string;
      sites: string[];
      active: boolean;
      currentPassword: string;
      reason: string;
    },
  ) {
    this.reauthenticate(actor, input.currentPassword, true, true);
    return this.platform.command(
      actor,
      "user.update",
      key,
      { ...input, currentPassword: digest(input.currentPassword) },
      () => {
        this.reauthenticate(actor, input.currentPassword, true);
        this.user(actor, input.userId);
      },
      () => {
        const row = this.user(actor, input.userId);
        this.revision(row, input.revision);
        this.grants(this.currentActor(actor), input);
        check(
          typeof input.active === "boolean",
          "VALIDATION",
          "active must be a boolean.",
          400,
        );
        if (
          row.role === "admin" &&
          row.active === 1 &&
          (!input.active || input.role !== "admin")
        )
          check(
            Number(
              this.store.get(
                "SELECT COUNT(*) AS total FROM iam_users WHERE org_id=? AND role='admin' AND active=1",
                actor.orgId,
              )!.total,
            ) > 1,
            "LAST_ADMIN",
            "Keep at least one active administrator.",
          );
        const email = this.email(input.email, input.userId),
          name = text(input.name, "name"),
          reason = text(input.reason, "reason", 1000);
        this.store.run(
          "UPDATE iam_users SET email=?,name=?,role=?,account_id=?,sites=?,active=? WHERE org_id=? AND id=?",
          email,
          name,
          input.role,
          input.role === "buyer" ? input.accountId! : null,
          JSON.stringify(input.sites),
          Number(input.active),
          actor.orgId,
          input.userId,
        );
        const revision = this.advance(row),
          sessionsEnded = this.endSessions(input.userId);
        this.platform.audit(actor, "user.access.changed", input.userId, {
          revision,
          reason,
          before: {
            role: row.role,
            accountId: row.account_id,
            sites: JSON.parse(String(row.sites)),
            active: row.active === 1,
          },
          after: {
            role: input.role,
            accountId: input.role === "buyer" ? input.accountId : null,
            sites: input.sites,
            active: input.active,
          },
          sessionsEnded,
        });
        return {
          id: input.userId,
          revision,
          sessionsEnded,
          sessionEnded: actor.id === input.userId,
        };
      },
    );
  }
  resetPassword(
    actor: Actor,
    key: string,
    input: {
      userId: string;
      revision: number;
      password: string;
      currentPassword: string;
      reason: string;
    },
  ) {
    this.reauthenticate(actor, input.currentPassword, true, true);
    return this.platform.command(
      actor,
      "user.password.reset",
      key,
      {
        ...input,
        password: digest(input.password),
        currentPassword: digest(input.currentPassword),
      },
      () => {
        this.reauthenticate(actor, input.currentPassword, true);
        this.user(actor, input.userId);
      },
      () => {
        const row = this.user(actor, input.userId);
        this.revision(row, input.revision);
        this.validPassword(input.password);
        check(
          !this.passwordMatches(this.actor(row), input.password),
          "PASSWORD_UNCHANGED",
          "Choose a different password.",
          400,
        );
        const reason = text(input.reason, "reason", 1000),
          salt = randomBytes(24).toString("hex");
        this.store.run(
          "UPDATE iam_users SET salt=?,password_hash=? WHERE org_id=? AND id=?",
          salt,
          passwordHash(input.password, salt),
          actor.orgId,
          input.userId,
        );
        const revision = this.advance(row, 1),
          sessionsEnded = this.endSessions(input.userId);
        this.platform.audit(
          actor,
          "user.password.reset.approved",
          input.userId,
          { revision, reason, sessionsEnded },
        );
        return {
          id: input.userId,
          revision,
          sessionsEnded,
          passwordChangeRequired: true,
          sessionEnded: actor.id === input.userId,
        };
      },
    );
  }
  changePassword(
    actor: Actor,
    key: string,
    input: { currentPassword: string; password: string },
  ) {
    this.reauthenticate(actor, input.currentPassword, false, true);
    return this.platform.command(
      actor,
      "user.password.change",
      key,
      {
        currentPassword: digest(input.currentPassword),
        password: digest(input.password),
      },
      () => {
        this.reauthenticate(actor, input.currentPassword, false);
      },
      () => {
        this.validPassword(input.password);
        check(
          input.password !== input.currentPassword,
          "PASSWORD_UNCHANGED",
          "Choose a different password.",
          400,
        );
        const row = this.user(actor, actor.id),
          salt = randomBytes(24).toString("hex");
        this.store.run(
          "UPDATE iam_users SET salt=?,password_hash=? WHERE org_id=? AND id=?",
          salt,
          passwordHash(input.password, salt),
          actor.orgId,
          actor.id,
        );
        const revision = this.advance(row, 0),
          sessionsEnded = this.endSessions(actor.id);
        this.platform.audit(actor, "user.password.changed", actor.id, {
          revision,
          sessionsEnded,
        });
        return { id: actor.id, revision, sessionsEnded, sessionEnded: true };
      },
    );
  }
  revokeSessions(
    actor: Actor,
    key: string,
    input: {
      userId: string;
      revision: number;
      currentPassword: string;
      reason: string;
    },
  ) {
    this.reauthenticate(actor, input.currentPassword, true, true);
    return this.platform.command(
      actor,
      "user.sessions.revoke",
      key,
      { ...input, currentPassword: digest(input.currentPassword) },
      () => {
        this.reauthenticate(actor, input.currentPassword, true);
        this.user(actor, input.userId);
      },
      () => {
        const row = this.user(actor, input.userId);
        this.revision(row, input.revision);
        const reason = text(input.reason, "reason", 1000),
          revision = this.advance(row),
          sessionsEnded = this.endSessions(input.userId);
        this.platform.audit(actor, "user.sessions.revoked", input.userId, {
          reason,
          revision,
          sessionsEnded,
        });
        return {
          id: input.userId,
          revision,
          sessionsEnded,
          sessionEnded: actor.id === input.userId,
        };
      },
    );
  }
  revokeOwnSessions(actor: Actor, key: string) {
    return this.platform.command(
      actor,
      "user.sessions.end-own",
      key,
      {},
      () => {
        this.currentActor(actor);
      },
      () => {
        const sessionsEnded = this.endSessions(actor.id);
        return { id: actor.id, sessionsEnded, sessionEnded: true };
      },
    );
  }
  revokeOwnSession(
    actor: Actor,
    key: string,
    input: { sessionReference: string; currentPassword: string },
    currentSessionToken: string | undefined,
  ) {
    const caller = this.session(currentSessionToken);
    check(
      caller.actor.id === actor.id && caller.actor.orgId === actor.orgId,
      "FORBIDDEN",
      "Session does not belong to the current principal.",
      403,
    );
    const reference = text(input.sessionReference, "session reference", 32);
    check(
      /^[a-f0-9]{32}$/.test(reference),
      "VALIDATION",
      "Invalid session reference.",
      400,
    );
    this.reauthenticate(actor, input.currentPassword, false, true);
    const currentReference = this.store.get(
      "SELECT reference FROM iam_session_details WHERE session_hash=?",
      digest(currentSessionToken!),
    )?.reference;
    const receipt = this.platform.command(
      actor,
      "user.session.end-own",
      key,
      {
        sessionReference: reference,
        currentPassword: digest(input.currentPassword),
      },
      () => {
        const authenticated = this.session(currentSessionToken);
        check(
          authenticated.actor.id === actor.id &&
            authenticated.actor.orgId === actor.orgId,
          "FORBIDDEN",
          "Session does not belong to the current principal.",
          403,
        );
        this.reauthenticate(actor, input.currentPassword, false);
      },
      () => {
        const target = this.store.get(
          "SELECT s.hash FROM iam_session_details d JOIN iam_sessions s ON s.hash=d.session_hash JOIN iam_users u ON u.id=s.user_id WHERE d.reference=? AND u.id=? AND u.org_id=? AND u.active=1 AND s.expires_at>?",
          reference,
          actor.id,
          actor.orgId,
          Date.now(),
        );
        check(
          target,
          "NOT_FOUND",
          "Active session not found. Refresh your sessions.",
          404,
        );
        this.store.run(
          "DELETE FROM iam_sessions WHERE hash=?",
          String(target.hash),
        );
        this.platform.audit(actor, "user.session.ended", reference, {
          sessionsEnded: 1,
        });
        return { id: actor.id, sessionReference: reference, sessionsEnded: 1 };
      },
    );
    // Replays from a fresh login must never clear that replacement session.
    return { ...receipt, sessionEnded: currentReference === reference };
  }
  private customerActor(actor: Actor, allowed: Role[]) {
    actor = this.currentActor(actor);
    permit(actor, allowed);
    check(
      !this.passwordChangeRequired(actor.id),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing customer accounts.",
      403,
    );
    return actor;
  }
  private customerReader(actor: Actor) {
    return this.customerActor(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
      "buyer",
    ]);
  }
  customer(actor: Actor, accountId: string): Customer {
    actor = this.customerReader(actor);
    account(actor, accountId);
    const row = this.store.get(
      "SELECT * FROM iam_accounts WHERE org_id=? AND id=?",
      actor.orgId,
      accountId,
    );
    check(row, "NOT_FOUND", "Account not found.", 404);
    return row as Customer;
  }
  customers(actor: Actor) {
    actor = this.customerReader(actor);
    return this.store.all<Customer>(
      "SELECT * FROM iam_accounts WHERE org_id=? AND (?=0 OR id=?) ORDER BY name",
      actor.orgId,
      actor.role === "buyer" ? 1 : 0,
      actor.accountId,
    );
  }
  reviewCustomerImport(actor: Actor, raw: unknown): MasterReview {
    actor = this.customerActor(actor, []);
    const r = importFields(raw, [
      "sourceId",
      "targetId",
      "name",
      "tier",
      "creditLimit",
      "held",
    ]);
    const sourceId = text(r.sourceId, "source row ID"),
      name = text(r.name, "account name"),
      tier = text(r.tier, "price tier"),
      value = integer(r.creditLimit, "credit limit", 0, 1e12);
    check(
      typeof r.held === "boolean",
      "VALIDATION",
      "held must be a boolean.",
      400,
    );
    const targetId =
      r.targetId === null ? null : text(r.targetId, "target account ID");
    let targetHash: string | null = null;
    if (targetId) {
      const c = this.customer(actor, targetId);
      check(
        c.name === name &&
          c.tier === tier &&
          c.credit_limit === value &&
          c.held === Number(r.held) &&
          c.currency === this.organization(actor).currency,
        "TARGET_MISMATCH",
        "Selected account must match every reviewed field and currency.",
      );
      targetHash = digest(canonical(c));
    } else {
      check(
        !this.store.get(
          "SELECT id FROM iam_accounts WHERE org_id=? AND name=?",
          actor.orgId,
          name,
        ),
        "TARGET_EXISTS",
        "Account name already exists; explicitly select its matching target ID.",
      );
    }
    return { sourceId, targetId, targetHash, matchKey: name, name, value };
  }
  // Owning operation inside the migration command's transaction. Consent is never imported.
  applyCustomerImport(actor: Actor, raw: unknown): MasterMapping {
    actor = this.customerActor(actor, []);
    const reviewed = this.reviewCustomerImport(actor, raw),
      r = raw as Record<string, unknown>;
    const targetId = reviewed.targetId ?? id();
    if (!reviewed.targetId)
      this.store.run(
        "INSERT INTO iam_accounts(id,org_id,name,currency,tier,credit_limit,held) VALUES(?,?,?,?,?,?,?)",
        targetId,
        actor.orgId,
        reviewed.name,
        this.organization(actor).currency,
        text(r.tier, "price tier"),
        reviewed.value,
        Number(r.held),
      );
    return {
      sourceId: reviewed.sourceId,
      targetId,
      action: reviewed.targetId ? "match" : "create",
      value: reviewed.value,
    };
  }
  createCustomer(
    actor: Actor,
    key: string,
    input: { name: string; tier: string; creditLimit: number },
  ) {
    return this.platform.command(
      actor,
      "account.create",
      key,
      input,
      () => {
        actor = this.customerActor(actor, ["commercial"]);
      },
      () => {
        return this.insertCustomer(actor, input);
      },
    );
  }
  // Corrects a customer account's display name; issued documents keep their copies.
  renameCustomer(
    actor: Actor,
    key: string,
    input: {
      accountId: string;
      name: string;
      expectedName: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "account.rename",
      key,
      input,
      () => {
        actor = this.customerActor(actor, ["commercial"]);
        this.customer(actor, text(input.accountId, "Account ID", 128));
      },
      () => {
        const name = text(input.name, "account name"),
          reason = text(input.reason, "Reason", 1000),
          before = this.customer(actor, input.accountId);
        check(
          before.name === input.expectedName,
          "REVISION",
          "Account changed; reload before renaming.",
        );
        this.store.run(
          "UPDATE iam_accounts SET name=? WHERE org_id=? AND id=?",
          name,
          actor.orgId,
          input.accountId,
        );
        this.platform.audit(actor, "account.renamed", input.accountId, {
          before: before.name,
          after: name,
          reason,
        });
        return { id: input.accountId, name };
      },
    );
  }
  private insertCustomer(
    actor: Actor,
    input: { name: string; tier: string; creditLimit: number },
  ) {
    const accountId = id();
    const org = this.organization(actor);
    this.store.run(
      "INSERT INTO iam_accounts(id,org_id,name,currency,tier,credit_limit) VALUES(?,?,?,?,?,?)",
      accountId,
      actor.orgId,
      text(input.name, "account name"),
      org.currency,
      text(input.tier, "price tier"),
      integer(input.creditLimit, "credit limit", 0, 1e12),
    );
    return { id: accountId };
  }
  /** Enrollment composition only; all writes stay with Identity and join the
   * caller's atomic invitation transaction. No public generic CRUD endpoint. */
  enrollmentAuthority(actor: Actor, password?: string, throttle = true) {
    const current =
      password === undefined
        ? this.currentActor(actor)
        : this.reauthenticate(actor, password, true, throttle);
    permit(current, []);
    const security = this.security(current);
    check(
      !security.passwordChangeRequired && !this.mfaEnrollmentRequired(current),
      "FORBIDDEN",
      "Administrator security setup is incomplete.",
      403,
    );
    return { actor: current, revision: security.revision };
  }
  enrollmentOrganization(orgId: string) {
    const org = this.store.get(
      "SELECT region,currency FROM iam_organizations WHERE id=?",
      orgId,
    );
    check(
      this.region === "CA" && org?.region === "CA" && org.currency === "CAD",
      "ENROLLMENT_CONFIGURATION",
      "Enrollment requires a configured Canadian CAD organization.",
      503,
    );
  }
  enrollmentEmailAvailable(email: string) {
    return !this.store.get("SELECT id FROM iam_users WHERE email=?", email);
  }
  enrollmentCustomer(
    actor: Actor,
    input: { name: string; tier: string; creditLimit: number },
  ) {
    this.database.requireTransaction();
    const current = this.enrollmentAuthority(actor).actor;
    this.enrollmentOrganization(current.orgId);
    const result = this.insertCustomer(current, input);
    this.platform.audit(
      current,
      "enrollment.customer.create",
      result.id,
      input,
    );
    return result;
  }
  enrollmentBuyer(
    actor: Actor,
    sponsorRevision: number,
    input: { email: string; name: string; password: string; accountId: string },
  ) {
    this.database.requireTransaction();
    const current = this.enrollmentAuthority(actor);
    check(
      current.revision === sponsorRevision,
      "FORBIDDEN",
      "Approval authority changed.",
      403,
    );
    this.enrollmentOrganization(current.actor.orgId);
    const customer = this.customer(current.actor, input.accountId);
    check(
      !customer.held &&
        customer.residency_mode === "strict" &&
        customer.provider_exceptions === "[]",
      "FORBIDDEN",
      "Approved account terms changed.",
      403,
    );
    const result = this.insertUser(current.actor, {
      ...input,
      role: "buyer",
      sites: [],
      requirePasswordChange: false,
    });
    this.platform.audit(current.actor, "enrollment.buyer.create", result.id, {
      accountId: customer.id,
    });
    return result;
  }
  setHold(
    actor: Actor,
    key: string,
    input: { accountId: string; held: boolean; reason: string },
  ) {
    return this.platform.command(
      actor,
      "account.hold",
      key,
      input,
      () => {
        actor = this.customerActor(actor, ["finance"]);
        this.customer(actor, input.accountId);
      },
      () => {
        check(
          typeof input.held === "boolean",
          "VALIDATION",
          "held must be a boolean.",
          400,
        );
        text(input.reason, "reason", 1000);
        this.store.run(
          "UPDATE iam_accounts SET held=? WHERE id=? AND org_id=?",
          input.held ? 1 : 0,
          input.accountId,
          actor.orgId,
        );
        this.platform.audit(actor, "account.hold.reason", input.accountId, {
          held: input.held,
          reason: input.reason,
        });
        return { id: input.accountId, held: input.held };
      },
    );
  }
  residencyChoice(
    actor: Actor,
    key: string,
    input: {
      accountId: string;
      region: Region;
      mode: "strict" | "provider-exceptions";
      providers: string[];
      version: number;
      acknowledgment: string;
      acceptance?: ProviderAcceptance;
    },
  ) {
    return this.platform.command(
      actor,
      "account.residency",
      key,
      input,
      () => {
        const current = this.residencyActor(actor);
        permit(current, ["commercial", "buyer"]);
        this.customer(current, input.accountId);
      },
      () => {
        const current = this.residencyActor(actor),
          customer = this.customer(current, input.accountId),
          org = this.organization(current);
        check(
          input.region === org.region,
          "REGIONAL_MIGRATION_REQUIRED",
          "A different storage region requires a separately reviewed regional migration.",
        );
        check(
          customer.residency_version === input.version,
          "REVISION",
          "Residency choice changed; review the current choice.",
        );
        check(
          ["strict", "provider-exceptions"].includes(input.mode) &&
            Array.isArray(input.providers) &&
            Array.from(input.providers).every(isProviderName) &&
            new Set(input.providers).size === input.providers.length,
          "VALIDATION",
          "Invalid residency mode or provider choices.",
          400,
        );
        check(
          input.mode !== "strict" || input.providers.length === 0,
          "VALIDATION",
          "Strict residency cannot include external processor exceptions.",
          400,
        );
        text(input.acknowledgment, "reviewed residency acknowledgment", 2000);
        this.residency.record(
          current,
          customer.id,
          customer.residency_version + 1,
          input.providers,
          input.acceptance,
        );
        this.store.run(
          "UPDATE iam_accounts SET residency_mode=?,provider_exceptions=?,residency_version=residency_version+1 WHERE org_id=? AND id=?",
          input.mode,
          JSON.stringify(input.providers),
          actor.orgId,
          input.accountId,
        );
        this.platform.audit(current, "account.residency.choice", customer.id, {
          region: org.region,
          mode: input.mode,
          providers: input.providers,
          acknowledgment: input.acknowledgment,
          version: customer.residency_version + 1,
        });
        return {
          id: customer.id,
          region: org.region,
          mode: input.mode,
          providers: input.providers,
          version: customer.residency_version + 1,
        };
      },
    );
  }
  providerAllowed(actor: Actor, accountId: string, provider: ProviderName) {
    const current = this.residencyActor(actor),
      customer = this.customer(current, accountId);
    check(
      isProviderName(provider) &&
        customer.residency_mode === "provider-exceptions" &&
        (JSON.parse(customer.provider_exceptions) as string[]).includes(
          provider,
        ),
      "RESIDENCY_BLOCKED",
      `Customer has not accepted ${provider} processing outside the application's storage region.`,
    );
    this.residency.assertCurrent(current, customer, provider);
    return customer.residency_version;
  }
  private residencyActor(actor: Actor) {
    const current = this.currentActor(actor);
    check(
      !this.passwordChangeRequired(current.id),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing provider residency.",
      403,
    );
    return current;
  }
  createUser(
    actor: Actor,
    key: string,
    input: {
      email: string;
      name: string;
      password: string;
      role: Role;
      accountId?: string;
      sites: string[];
      requirePasswordChange?: boolean;
      currentPassword?: string;
    },
  ) {
    // Password is not retained in command receipts or audit details.
    if (input.currentPassword !== undefined)
      this.reauthenticate(actor, input.currentPassword, true, true);
    const fingerprint = {
      ...input,
      password: digest(String(input.password)),
      currentPassword:
        input.currentPassword === undefined
          ? undefined
          : digest(input.currentPassword),
    };
    return this.platform.command(
      actor,
      "user.create",
      key,
      fingerprint,
      () => {
        const current = this.currentActor(actor);
        permit(current, []);
        check(
          !this.passwordChangeRequired(current.id),
          "PASSWORD_CHANGE_REQUIRED",
          "Change your password before administering users.",
          403,
        );
        if (input.currentPassword !== undefined)
          this.reauthenticate(actor, input.currentPassword, true);
      },
      () => {
        return this.insertUser(actor, input);
      },
    );
  }
  private insertUser(
    actor: Actor,
    input: {
      email: string;
      name: string;
      password: string;
      role: Role;
      accountId?: string;
      sites: string[];
      requirePasswordChange?: boolean;
    },
  ) {
    this.grants(this.currentActor(actor), input);
    this.validPassword(input.password);
    check(
      input.requirePasswordChange === undefined ||
        typeof input.requirePasswordChange === "boolean",
      "VALIDATION",
      "requirePasswordChange must be a boolean.",
      400,
    );
    const email = this.email(input.email);
    const userId = id(),
      salt = randomBytes(24).toString("hex");
    this.store.run(
      "INSERT INTO iam_users(id,org_id,email,name,account_id,role,sites,salt,password_hash) VALUES(?,?,?,?,?,?,?,?,?)",
      userId,
      actor.orgId,
      email,
      text(input.name, "name"),
      input.role === "buyer" ? input.accountId! : null,
      input.role,
      JSON.stringify(input.sites),
      salt,
      passwordHash(input.password, salt),
    );
    this.store.run(
      "INSERT INTO iam_user_security VALUES(?,?,?,?)",
      userId,
      1,
      Number(input.requirePasswordChange ?? false),
      now(),
    );
    return { id: userId };
  }
}
