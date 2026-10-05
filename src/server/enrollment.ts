import { validateReference } from "./catalog-reference-index.ts";
import { randomBytes } from "node:crypto";
import {
  canadianProvinces,
  type EnrollmentApplication,
  type EnrollmentConfig,
  type EnrollmentDecision,
  type EnrollmentDecisionResult,
  type EnrollmentInvitationAction,
  type EnrollmentQueue,
  type EnrollmentSubmission,
} from "../shared/enrollment.ts";
import {
  check,
  digest,
  id,
  integer,
  now,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { ENROLLMENT_INITIALIZE } from "./enrollment-schema.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";

const invitationLifetime = 24 * 60 * 60 * 1000;
const received = Object.freeze({ received: true });
const invalidInvitation = () =>
  check(
    false,
    "INVITATION_INVALID",
    "This invitation is unavailable. Ask the distributor for a new invitation.",
    400,
  );

/** Public enrollment is deliberately separate from staff-created identities.
 * The HTTP host supplies the single organization; applicants never select it. */
export class Enrollment {
  private store: Store;
  constructor(
    private database: Database,
    private identity: Identity,
    private platform: Platform,
  ) {
    this.store = database.owned("enrollment");
    this.store.migrate(ENROLLMENT_INITIALIZE);
  }
  config(orgId?: string): EnrollmentConfig {
    if (orgId) this.identity.enrollmentOrganization(orgId);
    return {
      enabled: !!orgId,
      country: "CA",
      currency: "CAD",
      approvalRequired: true,
    };
  }
  private enabled(orgId?: string): asserts orgId is string {
    check(
      orgId,
      "ENROLLMENT_DISABLED",
      "Contractor applications are currently unavailable.",
      503,
    );
    this.identity.enrollmentOrganization(orgId);
  }
  private write<T>(fn: () => T): T {
    return this.database.transaction(() => {
      const revision = this.platform.restore.assertCommandAccess();
      check(
        !this.platform.recoveryHold(),
        "RECOVERY_HOLD",
        "Enrollment is temporarily unavailable.",
        503,
      );
      const result = fn();
      check(
        this.platform.restore.assertCommandAccess() === revision,
        "RECOVERY_HOLD",
        "Enrollment is temporarily unavailable.",
        503,
      );
      return result;
    });
  }
  /** Run before body validation; durable limits survive rejected requests and
   * process restarts. Hash transport-qualified addresses; generic forwarded IPs are not trusted.
   * Global budgets bound writes even when all clients share a reverse proxy. */
  throttle(kind: "apply" | "activate", address: string, orgId?: string) {
    this.enabled(orgId);
    const allowed = this.write(() => {
      const clock = Date.now();
      this.store.run("DELETE FROM enrollment_limits WHERE reset_at<=?", clock);
      const keys = [
        { key: `${kind}:global`, maximum: kind === "apply" ? 100 : 300 },
        {
          key: `${kind}:ip:${digest(address)}`,
          maximum: kind === "apply" ? 10 : 30,
        },
      ];
      const buckets = keys.map((item) => ({
        ...item,
        old: this.store.get(
          "SELECT count FROM enrollment_limits WHERE key=?",
          item.key,
        ),
      }));
      if (
        buckets.some(
          (item) => item.old && Number(item.old.count) >= item.maximum,
        )
      )
        return false;
      const existing = Number(
        this.store.get("SELECT COUNT(*) AS n FROM enrollment_limits")!.n,
      );
      if (existing + buckets.filter((item) => !item.old).length > 1024)
        return false;
      // An already-blocked peer must not consume the shared budget.
      for (const item of buckets) {
        this.store.run(
          "INSERT INTO enrollment_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
          item.key,
          clock + 3600000,
        );
      }
      return true;
    });
    check(allowed, "RATE_LIMIT", "Too many requests. Try again later.", 429);
  }
  submit(orgId: string | undefined, input: EnrollmentSubmission) {
    this.enabled(orgId);
    const email = text(input.email, "email", 254).toLowerCase();
    check(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      "VALIDATION",
      "Enter a valid email address.",
      400,
    );
    check(
      canadianProvinces.includes(input.province) &&
        input.acknowledgment === true,
      "VALIDATION",
      "Choose a Canadian province and acknowledge the application review.",
      400,
    );
    const businessName = text(input.businessName, "business name"),
      contactName = text(input.contactName, "contact name"),
      phone = text(input.phone, "business phone", 40),
      businessNumber = input.businessNumber?.trim() ?? "",
      notes = input.notes?.trim() ?? "";
    check(
      businessNumber.length <= 80 && notes.length <= 1000,
      "VALIDATION",
      "Application fields are too long.",
      400,
    );
    const requested =
      input.requestedReference === undefined
        ? undefined
        : validateReference(input.requestedReference);
    const reviewedNotes = requested
      ? `${notes}${notes ? "\n\n" : ""}Requested manufacturer reference: ${requested.label} [family ${requested.familyId}${requested.modelId ? `, model ${requested.modelId}` : ""}]. Availability and native product mapping require distributor review.`
      : notes;
    return this.write(() => {
      check(
        Number(
          this.store.get("SELECT COUNT(*) AS n FROM enrollment_applications")!
            .n,
        ) < 5000,
        "ENROLLMENT_UNAVAILABLE",
        "Contractor applications are temporarily unavailable.",
        503,
      );
      // Deliberately the same public result for existing users/applications.
      if (
        !this.identity.enrollmentEmailAvailable(email) ||
        this.store.get(
          "SELECT id FROM enrollment_applications WHERE org_id=? AND email=?",
          orgId,
          email,
        )
      )
        return received;
      this.store.run(
        `INSERT INTO enrollment_applications
        (id,org_id,business_name,contact_name,email,phone,province,business_number,notes,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`,
        id(),
        orgId,
        businessName,
        contactName,
        email,
        phone,
        input.province,
        businessNumber,
        reviewedNotes,
        now(),
      );
      return received;
    });
  }
  queue(actor: Actor, after?: string): EnrollmentQueue {
    return this.database.transaction(() => {
      actor = this.identity.enrollmentAuthority(actor).actor;
      const cursor = after === undefined ? "" : text(after, "cursor", 64);
      const rows = this.store.all(
        "SELECT * FROM enrollment_applications WHERE org_id=? AND id>? ORDER BY id LIMIT 21",
        actor.orgId,
        cursor,
      );
      const items = rows.slice(0, 20).map((row) => this.view(row));
      return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
    });
  }
  private row(actor: Actor, applicationId: string) {
    const row = this.store.get(
      "SELECT * FROM enrollment_applications WHERE org_id=? AND id=?",
      actor.orgId,
      text(applicationId, "application ID", 64),
    );
    check(row, "NOT_FOUND", "Application not found.", 404);
    return row;
  }
  private view(row: Row): EnrollmentApplication {
    return {
      id: String(row.id),
      businessName: String(row.business_name),
      contactName: String(row.contact_name),
      email: String(row.email),
      phone: String(row.phone),
      province: String(row.province),
      businessNumber: String(row.business_number),
      notes: String(row.notes),
      status: row.status as EnrollmentApplication["status"],
      createdAt: String(row.created_at),
      reviewedAt: row.reviewed_at as string | null,
      reviewReason: row.review_reason as string | null,
      tier: row.tier as string | null,
      creditLimit: row.credit_limit as number | null,
      accountId: row.account_id as string | null,
      invitationExpiresAt: row.expires_at
        ? new Date(Number(row.expires_at)).toISOString()
        : null,
      invitationActive:
        row.status === "approved" &&
        !!row.token_hash &&
        Number(row.expires_at) > Date.now(),
    };
  }
  private issue(actor: Actor, row: Row): EnrollmentDecisionResult {
    const authority = this.identity.enrollmentAuthority(actor),
      token = randomBytes(32).toString("base64url"),
      expiresAt = Date.now() + invitationLifetime;
    this.store.run(
      "UPDATE enrollment_applications SET token_hash=?,expires_at=?,sponsor=?,sponsor_revision=? WHERE id=?",
      digest(token),
      expiresAt,
      JSON.stringify(authority.actor),
      authority.revision,
      String(row.id),
    );
    return {
      id: String(row.id),
      status: "approved",
      activationToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
  decide(
    actor: Actor,
    applicationId: string,
    input: EnrollmentDecision,
  ): EnrollmentDecisionResult {
    // Password failure counters are committed outside the business transaction.
    check(
      typeof input.currentPassword === "string",
      "REAUTHENTICATE",
      "Current password is required.",
      403,
    );
    actor = this.identity.enrollmentAuthority(
      actor,
      input.currentPassword,
    ).actor;
    const reason = text(input.reason, "review reason", 1000);
    check(
      ["approve", "reject"].includes(input.decision),
      "VALIDATION",
      "Choose approve or reject.",
      400,
    );
    return this.write(() => {
      actor = this.identity.enrollmentAuthority(
        actor,
        input.currentPassword,
        false,
      ).actor;
      const row = this.row(actor, applicationId);
      check(
        row.status === "pending",
        "APPLICATION_REVIEWED",
        "This application has already been reviewed. Refresh the queue.",
      );
      if (input.decision === "reject") {
        this.store.run(
          "UPDATE enrollment_applications SET status='rejected',reviewed_at=?,review_reason=? WHERE id=?",
          now(),
          reason,
          String(row.id),
        );
        this.platform.audit(actor, "enrollment.reject", String(row.id), {
          reason,
        });
        return { id: String(row.id), status: "rejected" };
      }
      const tier = text(input.tier, "reviewed price tier"),
        creditLimit = integer(
          input.creditLimit,
          "reviewed credit limit",
          0,
          1e12,
        );
      check(
        this.identity.enrollmentEmailAvailable(String(row.email)),
        "EMAIL_IN_USE",
        "An identity already uses this email. Review the existing identity separately.",
      );
      const customer = this.identity.enrollmentCustomer(actor, {
        name: String(row.business_name),
        tier,
        creditLimit,
      });
      this.store.run(
        "UPDATE enrollment_applications SET status='approved',reviewed_at=?,review_reason=?,tier=?,credit_limit=?,account_id=? WHERE id=?",
        now(),
        reason,
        tier,
        creditLimit,
        customer.id,
        String(row.id),
      );
      const result = this.issue(actor, row);
      this.platform.audit(actor, "enrollment.approve", String(row.id), {
        reason,
        tier,
        creditLimit,
        accountId: customer.id,
        expiresAt: result.expiresAt,
      });
      return result;
    });
  }
  invitation(
    actor: Actor,
    applicationId: string,
    input: EnrollmentInvitationAction,
  ): EnrollmentDecisionResult {
    check(
      typeof input.currentPassword === "string",
      "REAUTHENTICATE",
      "Current password is required.",
      403,
    );
    actor = this.identity.enrollmentAuthority(
      actor,
      input.currentPassword,
    ).actor;
    const reason = text(input.reason, "invitation reason", 1000);
    check(
      ["reissue", "revoke"].includes(input.action),
      "VALIDATION",
      "Choose reissue or revoke.",
      400,
    );
    return this.write(() => {
      actor = this.identity.enrollmentAuthority(
        actor,
        input.currentPassword,
        false,
      ).actor;
      const row = this.row(actor, applicationId);
      check(
        row.status === "approved",
        "APPLICATION_STATE",
        "Only approved, unactivated applications have invitations.",
      );
      const result: EnrollmentDecisionResult =
        input.action === "reissue"
          ? this.issue(actor, row)
          : { id: String(row.id), status: "approved" };
      if (input.action === "revoke")
        this.store.run(
          "UPDATE enrollment_applications SET token_hash=NULL,expires_at=NULL WHERE id=?",
          String(row.id),
        );
      this.platform.audit(
        actor,
        `enrollment.invitation.${input.action}`,
        String(row.id),
        { reason, expiresAt: result.expiresAt ?? null },
      );
      return result;
    });
  }
  activate(orgId: string | undefined, token: string, password: string) {
    this.enabled(orgId);
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      return invalidInvitation();
    check(
      typeof password === "string" &&
        password.length >= 14 &&
        password.length <= 256,
      "VALIDATION",
      "Use a password of 14–256 characters.",
      400,
    );
    try {
      return this.write(() => {
        const row = this.store.get(
          "SELECT * FROM enrollment_applications WHERE org_id=? AND token_hash=? AND status='approved' AND expires_at>?",
          orgId,
          digest(token),
          Date.now(),
        );
        if (!row) return invalidInvitation();
        const sponsor = JSON.parse(String(row.sponsor)) as Actor;
        const customer = this.identity.customer(
          this.identity.enrollmentAuthority(sponsor).actor,
          String(row.account_id),
        );
        check(
          customer.tier === row.tier &&
            customer.credit_limit === row.credit_limit,
          "APPLICATION_TERMS_CHANGED",
          "Account terms require a new staff review.",
        );
        const user = this.identity.enrollmentBuyer(
          sponsor,
          Number(row.sponsor_revision),
          {
            email: String(row.email),
            name: String(row.contact_name),
            password,
            accountId: String(row.account_id),
          },
        );
        this.store.run(
          "UPDATE enrollment_applications SET status='activated',token_hash=NULL,expires_at=NULL,user_id=? WHERE id=?",
          user.id,
          String(row.id),
        );
        this.platform.audit(sponsor, "enrollment.activate", String(row.id), {
          userId: user.id,
          accountId: row.account_id,
        });
        return { activated: true };
      });
    } catch {
      // No identity, approval state, SQL, password, or token details escape.
      return invalidInvitation();
    }
  }
}
