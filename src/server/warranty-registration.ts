import { check, id, integer, now, permit, text, type Actor } from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import { Identity } from "./iam.ts";
import { coverageDate } from "./coverage-policy.ts";
import { WARRANTY_REGISTRATION_INITIALIZE } from "./warranty-registration-schema.ts";
import type {
  ClaimEligibilityReview,
  ClaimEligibilitySnapshot,
  InstallationRegistration,
  InstallationRegistrationHistory,
  ProductWarrantyTerms,
  RegisteredWarrantyEligibility,
  ReturnWindowPolicy,
  SaveInstallationRegistration,
  SaveProductWarrantyTerms,
  WarrantyRegistrationReview,
} from "../shared/warranty-registration.ts";

export type RegistrationContext = {
  unitId: string;
  accountId: string;
  serial: string;
  productId: string;
  shipmentId: string;
  ownershipId: string;
  shippedAt: string;
  returnStartedAt: string;
  inheritedFromClaimId: string | null;
  inheritedCoverageEnd: string;
};
function dateOnly(value: unknown): string {
  check(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "VALIDATION",
    "Installation date must be a valid YYYY-MM-DD date.",
    400,
  );
  return value;
}
function days(value: number | null) {
  return value === null ? null : integer(value, "Duration in days", 0, 36500);
}
function endAt(start: string, duration: number): string {
  const result = new Date(
    Date.parse(coverageDate(start)) + duration * 86400000,
  );
  check(
    Number.isFinite(result.getTime()),
    "COVERAGE_DATE",
    "Calculated end is outside the supported date range.",
  );
  return result.toISOString();
}
function position(start: string, end: string, assessed: string) {
  return assessed < start
    ? "before_start"
    : assessed >= end
      ? "elapsed"
      : "within_dates";
}
export class WarrantyRegistration {
  private store: Store;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private sold: (
      actor: Actor,
      unitId: string,
      accountId: string,
    ) => RegistrationContext,
    private claimContext: (
      actor: Actor,
      claimId: string,
    ) => RegistrationContext,
    private productExists: (actor: Actor, productId: string) => void,
  ) {
    this.store = database.owned("warranty");
    this.store.migrate(WARRANTY_REGISTRATION_INITIALIZE);
  }
  private authority(actor: Actor, admin = false): Actor {
    const current = this.identity.currentActor(actor);
    permit(current, admin ? [] : ["warranty", "commercial", "buyer"]);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing warranty records.",
      403,
    );
    return current;
  }
  private policyRecord(actor: Actor): ReturnWindowPolicy {
    const row = this.store.get<{ snapshot: string }>(
      "SELECT snapshot FROM warranty_return_policy WHERE org_id=?",
      actor.orgId,
    );
    return row
      ? JSON.parse(row.snapshot)
      : { revision: 0, days: null, updatedAt: null, reason: null };
  }
  returnPolicy(actor: Actor): ReturnWindowPolicy {
    return this.database.transaction(() =>
      this.policyRecord(this.authority(actor)),
    );
  }
  saveReturnPolicy(
    actor: Actor,
    key: string,
    input: { expectedRevision: number; days: number | null; reason: string },
  ): ReturnWindowPolicy {
    return this.platform.command(
      actor,
      "warranty.return-policy.save",
      key,
      input,
      () => {
        actor = this.authority(actor, true);
      },
      () => {
        const previous = this.policyRecord(actor);
        check(
          integer(input.expectedRevision, "Reviewed return policy revision") ===
            previous.revision,
          "REVISION",
          "Return policy changed. Refresh and review.",
        );
        const snapshot: ReturnWindowPolicy = {
          revision: previous.revision + 1,
          days: days(input.days),
          updatedAt: now(),
          reason: text(input.reason, "Policy reason", 1000),
        };
        this.store.run(
          "INSERT INTO warranty_return_policy VALUES(?,?,?) ON CONFLICT(org_id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot",
          actor.orgId,
          snapshot.revision,
          JSON.stringify(snapshot),
        );
        this.policyHistory(
          actor,
          "return",
          actor.orgId,
          snapshot.revision,
          snapshot,
          snapshot.reason!,
        );
        return snapshot;
      },
    );
  }
  private termsRecord(actor: Actor, productId: string): ProductWarrantyTerms {
    const row = this.store.get<{ snapshot: string }>(
      "SELECT snapshot FROM warranty_product_terms WHERE org_id=? AND product_id=?",
      actor.orgId,
      productId,
    );
    return row
      ? JSON.parse(row.snapshot)
      : {
          productId,
          revision: 0,
          manufacturer: null,
          reference: null,
          startsAt: null,
          days: null,
          notes: null,
          updatedAt: null,
        };
  }
  terms(actor: Actor, productId: string): ProductWarrantyTerms {
    return this.database.transaction(() => {
      actor = this.authority(actor, true);
      productId = text(productId, "Product ID");
      this.productExists(actor, productId);
      return this.termsRecord(actor, productId);
    });
  }
  saveTerms(
    actor: Actor,
    key: string,
    input: SaveProductWarrantyTerms,
  ): ProductWarrantyTerms {
    return this.platform.command(
      actor,
      "warranty.terms.save",
      key,
      input,
      () => {
        actor = this.authority(actor, true);
        this.productExists(actor, text(input.productId, "Product ID"));
      },
      () => {
        const previous = this.termsRecord(actor, input.productId);
        check(
          integer(input.expectedRevision, "Reviewed terms revision") ===
            previous.revision,
          "REVISION",
          "Warranty terms changed. Refresh and review.",
        );
        check(
          ["shipment", "installation"].includes(input.startsAt),
          "VALIDATION",
          "Unknown warranty start basis.",
          400,
        );
        const snapshot: ProductWarrantyTerms = {
          productId: input.productId,
          revision: previous.revision + 1,
          manufacturer: text(input.manufacturer, "Manufacturer"),
          reference: text(input.reference, "Terms reference", 1000),
          startsAt: input.startsAt,
          days: days(input.days),
          notes: text(input.notes, "Terms notes", 2000),
          updatedAt: now(),
        };
        const reason = text(input.reason, "Terms reason", 1000);
        this.store.run(
          "INSERT INTO warranty_product_terms VALUES(?,?,?,?) ON CONFLICT(org_id,product_id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot",
          actor.orgId,
          input.productId,
          snapshot.revision,
          JSON.stringify(snapshot),
        );
        this.policyHistory(
          actor,
          "terms",
          input.productId,
          snapshot.revision,
          snapshot,
          reason,
        );
        return snapshot;
      },
    );
  }
  private policyHistory(
    actor: Actor,
    kind: "return" | "terms",
    target: string,
    revision: number,
    snapshot: unknown,
    reason: string,
  ) {
    const historyId = id();
    this.store.run(
      "INSERT INTO warranty_policy_history VALUES(?,?,?,?,?,?,?,?,?)",
      historyId,
      actor.orgId,
      kind,
      target,
      revision,
      JSON.stringify(snapshot),
      reason,
      actor.id,
      now(),
    );
    this.platform.audit(actor, `warranty.${kind}.saved`, target, {
      historyId,
      revision,
      reason,
    });
  }
  private registrationRecord(
    actor: Actor,
    context: RegistrationContext,
  ): InstallationRegistration | null {
    const row = this.store.get<{ snapshot: string }>(
      "SELECT snapshot FROM warranty_installations WHERE org_id=? AND account_id=? AND unit_id=? AND shipment_id=? AND ownership_id=?",
      actor.orgId,
      context.accountId,
      context.unitId,
      context.shipmentId,
      context.ownershipId,
    );
    return row ? JSON.parse(row.snapshot) : null;
  }
  private snapshotRecord(
    actor: Actor,
    claimId: string,
  ): ClaimEligibilitySnapshot | null {
    const row = this.store.get<{ snapshot: string }>(
      "SELECT snapshot FROM warranty_claim_eligibility WHERE org_id=? AND claim_id=?",
      actor.orgId,
      claimId,
    );
    return row ? JSON.parse(row.snapshot) : null;
  }
  private assessment(
    actor: Actor,
    context: RegistrationContext,
  ): ClaimEligibilitySnapshot {
    const capturedAt = now(),
      policy = this.policyRecord(actor),
      terms = this.termsRecord(actor, context.productId),
      registration = this.registrationRecord(actor, context);
    const shipmentStart = coverageDate(context.shippedAt),
      returnStart = coverageDate(context.returnStartedAt),
      returnEnd = policy.days === null ? null : endAt(returnStart, policy.days);
    let warranty: RegisteredWarrantyEligibility = {
      source: "unconfigured",
      startsAt: null,
      endAt: null,
      assessedAt: capturedAt,
      datePosition: "unconfigured",
      terms,
      registrationRevision: registration?.revision ?? 0,
      provisional: false,
      requiresReview: true,
    };
    if (context.inheritedFromClaimId) {
      const prior = this.snapshotRecord(
        actor,
        context.inheritedFromClaimId,
      )?.warrantyEligibility;
      const start = prior ? prior.startsAt : shipmentStart,
        end = prior ? prior.endAt : context.inheritedCoverageEnd;
      warranty = {
        ...warranty,
        terms: prior?.terms ?? {
          ...terms,
          manufacturer: null,
          reference: null,
          startsAt: null,
          days: null,
          notes: null,
          revision: 0,
          updatedAt: null,
        },
        provisional: prior?.provisional ?? !prior,
        source: "replacement_inherited",
        startsAt: start,
        endAt: end,
        datePosition:
          start && end
            ? position(start, end, capturedAt)
            : prior?.datePosition === "registration_required"
              ? "registration_required"
              : "unconfigured",
      };
    } else if (terms.days !== null) {
      const start =
        terms.startsAt === "installation"
          ? registration
            ? `${registration.installedOn}T00:00:00.000Z`
            : null
          : shipmentStart;
      const end = start ? endAt(start, terms.days) : null;
      warranty = {
        ...warranty,
        source: "product_terms",
        startsAt: start,
        endAt: end,
        datePosition:
          start && end
            ? position(start, end, capturedAt)
            : "registration_required",
      };
    }
    return {
      registration,
      warrantyEligibility: warranty,
      returnEligibility: {
        policy,
        startsAt: returnStart,
        endAt: returnEnd,
        assessedAt: capturedAt,
        datePosition:
          returnEnd === null
            ? "unconfigured"
            : position(returnStart, returnEnd, capturedAt) === "within_dates"
              ? "within_window"
              : (position(returnStart, returnEnd, capturedAt) as
                  "before_start" | "elapsed"),
        requiresReview: true,
      },
      capturedAt,
    };
  }
  review(
    actor: Actor,
    unitId: string,
    accountId: string,
  ): WarrantyRegistrationReview {
    return this.database.transaction(() => {
      actor = this.authority(actor);
      const context = this.sold(
        actor,
        text(unitId, "Sold unit ID"),
        text(accountId, "Customer account ID"),
      );
      const assessment = this.assessment(actor, context);
      const history = this.store
        .all<{ snapshot: string }>(
          "SELECT snapshot FROM warranty_installation_history WHERE org_id=? AND account_id=? AND unit_id=? AND shipment_id=? AND ownership_id=? ORDER BY revision",
          actor.orgId,
          context.accountId,
          context.unitId,
          context.shipmentId,
          context.ownershipId,
        )
        .map(
          (row) => JSON.parse(row.snapshot) as InstallationRegistrationHistory,
        );
      return {
        unitId: context.unitId,
        accountId: context.accountId,
        serial: context.serial,
        productId: context.productId,
        shipmentId: context.shipmentId,
        ownershipId: context.ownershipId,
        registration: assessment.registration,
        history,
        terms: this.termsRecord(actor, context.productId),
        returnEligibility: assessment.returnEligibility,
        warrantyEligibility: assessment.warrantyEligibility,
      };
    });
  }
  save(
    actor: Actor,
    key: string,
    input: SaveInstallationRegistration,
  ): InstallationRegistration {
    let context: RegistrationContext;
    return this.platform.command(
      actor,
      "warranty.registration.save",
      key,
      input,
      () => {
        actor = this.authority(actor);
        context = this.sold(
          actor,
          text(input.unitId, "Sold unit ID"),
          text(input.accountId, "Customer account ID"),
        );
        check(
          context.shipmentId ===
            text(input.shipmentId, "Reviewed shipment ID") &&
            context.ownershipId ===
              text(input.ownershipId, "Reviewed ownership ID"),
          "REVISION",
          "Sold ownership changed. Refresh the installation record.",
        );
      },
      () => {
        const prior = this.registrationRecord(actor, context);
        check(
          integer(input.expectedRevision, "Reviewed installation revision") ===
            (prior?.revision ?? 0),
          "REVISION",
          "Installation registration changed. Refresh and review.",
        );
        const installedOn = dateOnly(input.installedOn);
        check(
          installedOn >= context.returnStartedAt.slice(0, 10) &&
            installedOn <= now().slice(0, 10),
          "INSTALLATION_DATE",
          "Installation must be on or after recorded shipment or replacement handover and cannot be in the future.",
          400,
        );
        const snapshot: InstallationRegistration = {
          revision: (prior?.revision ?? 0) + 1,
          installedOn,
          installer: text(input.installer, "Installer", 1000),
          site: text(input.site, "Installation site", 2000),
          evidence: text(
            input.evidence,
            "Installation evidence reference",
            2000,
          ),
          updatedAt: now(),
        };
        const reason = text(
            input.reason,
            "Registration or correction reason",
            1000,
          ),
          history: InstallationRegistrationHistory = {
            ...snapshot,
            reason,
            actorId: actor.id,
          };
        const identity = [
          actor.orgId,
          context.accountId,
          context.unitId,
          context.shipmentId,
          context.ownershipId,
        ];
        this.store.run(
          "INSERT INTO warranty_installations VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,account_id,unit_id,shipment_id,ownership_id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot",
          ...identity,
          snapshot.revision,
          JSON.stringify(snapshot),
        );
        this.store.run(
          "INSERT INTO warranty_installation_history VALUES(?,?,?,?,?,?,?)",
          ...identity,
          snapshot.revision,
          JSON.stringify(history),
        );
        this.platform.audit(
          actor,
          "warranty.registration.saved",
          context.unitId,
          {
            accountId: context.accountId,
            shipmentId: context.shipmentId,
            ownershipId: context.ownershipId,
            revision: snapshot.revision,
            reason,
          },
        );
        return snapshot;
      },
    );
  }
  /** Only the native claim owner calls this inside its command transaction. */
  capture(
    actor: Actor,
    claimId: string,
    context: RegistrationContext,
    revisions: {
      registrationRevision?: number;
      termsRevision?: number;
      returnPolicyRevision?: number;
    },
  ): void {
    const snapshot = this.assessment(actor, context);
    for (const [reviewed, current] of [
      [revisions.registrationRevision, snapshot.registration?.revision ?? 0],
      [
        revisions.termsRevision,
        this.termsRecord(actor, context.productId).revision,
      ],
      [
        revisions.returnPolicyRevision,
        snapshot.returnEligibility.policy.revision,
      ],
    ])
      check(
        reviewed === undefined ||
          integer(reviewed, "Reviewed eligibility revision") === current,
        "REVISION",
        "Registration, warranty terms or return policy changed. Refresh and review.",
      );
    this.store.run(
      "INSERT INTO warranty_claim_eligibility VALUES(?,?,?)",
      claimId,
      actor.orgId,
      JSON.stringify(snapshot),
    );
  }
  claimAssessment(actor: Actor, claimId: string): ClaimEligibilityReview {
    return this.database.transaction(() => {
      // The claim owner checks all reader roles and current claim/account authority.
      const context = this.claimContext(actor, text(claimId, "Claim ID"));
      actor = this.identity.currentActor(actor);
      return {
        claimId,
        snapshot: this.snapshotRecord(actor, claimId),
        current: this.assessment(actor, context),
      };
    });
  }
}
