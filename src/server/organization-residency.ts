import {
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import type { Organization, Region } from "./iam.ts";
import type { DisclosureInput } from "./iam-residency.ts";
import { ORGANIZATION_RESIDENCY_INITIALIZE_DDL } from "./organization-residency-schema.ts";

const scope = {
  provider: "quickbooks",
  purpose: "stock-cost-journal",
  environment: "sandbox",
} as const;
export type LedgerDisclosureInput = Omit<DisclosureInput, "provider">;
type Terms = Omit<LedgerDisclosureInput, "previousDisclosureId"> &
  typeof scope & { orgId: string };
export type LedgerDisclosure = Terms & {
  id: string;
  hash: string;
  createdBy: string;
  createdAt: string;
};
export type LedgerChoiceInput = {
  region: Region;
  revision: number;
  mode: "strict" | "provider-exception";
  realm: string | null;
  acknowledgment: string;
  acceptance?: {
    disclosureId: string;
    disclosureHash: string;
    representative: string;
    evidenceRef: string;
  };
};
export type LedgerChoice = typeof scope & {
  orgId: string;
  region: Region;
  revision: number;
  mode: LedgerChoiceInput["mode"];
  realm: string | null;
  acceptance: LedgerChoiceInput["acceptance"] | null;
  acknowledgment: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
};
export type LedgerAuthority = typeof scope & {
  orgId: string;
  region: Region;
  realm: string;
  revision: number;
  disclosureId: string;
  disclosureHash: string;
};

// Organization-owned permission for one ledger operation. Buyer acceptance and
// existing customer-scoped credential/effect permissions cannot satisfy it.
export class OrganizationResidency {
  private readonly store: Store;
  constructor(
    private readonly database: Database,
    private readonly platform: Platform,
    private readonly region: Region,
    private readonly authority: (actor: Actor) => Actor,
    private readonly organization: (actor: Actor) => Organization,
  ) {
    this.store = database.owned("iam");
    this.store.migrate(ORGANIZATION_RESIDENCY_INITIALIZE_DDL);
  }
  private actor(actor: Actor, publish = false) {
    const current = this.authority(actor);
    permit(current, publish ? [] : ["finance"]);
    check(
      !current.accountId,
      "FORBIDDEN",
      "An account-bound principal cannot authorize organization ledger processing.",
      403,
    );
    check(
      this.organization(current).region === this.region,
      "REGION",
      "Organization storage region differs.",
    );
    return current;
  }
  private head(actor: Actor) {
    return (
      this.store.get(
        "SELECT disclosure_id FROM iam_ledger_disclosure_current WHERE org_id=?",
        actor.orgId,
      )?.disclosure_id ?? null
    );
  }
  private read(actor: Actor, disclosureId: string): LedgerDisclosure {
    const row = this.store.get(
      "SELECT * FROM iam_ledger_disclosures WHERE org_id=? AND region=? AND id=?",
      actor.orgId,
      this.region,
      disclosureId,
    );
    check(
      row,
      "NOT_FOUND",
      "Organization ledger disclosure is unavailable.",
      404,
    );
    const body = JSON.parse(String(row.body)) as Terms;
    check(
      digest(canonical(body)) === row.hash &&
        body.orgId === actor.orgId &&
        body.region === this.region &&
        body.version === row.version &&
        body.provider === scope.provider &&
        body.purpose === scope.purpose &&
        body.environment === scope.environment,
      "DISCLOSURE_INTEGRITY",
      "Organization ledger disclosure integrity check failed.",
    );
    return {
      ...body,
      id: String(row.id),
      hash: String(row.hash),
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
    };
  }
  disclosure(actor: Actor, disclosureId: string) {
    return this.read(this.actor(actor), disclosureId);
  }
  publish(actor: Actor, key: string, input: LedgerDisclosureInput) {
    return this.platform.command(
      actor,
      "organization.ledger-disclosure.publish",
      key,
      input,
      () => {
        this.actor(actor, true);
      },
      () => {
        const current = this.actor(actor, true);
        check(
          input.region === this.region,
          "REGIONAL_MIGRATION_REQUIRED",
          "Publish terms for this application's storage region.",
        );
        check(
          input.previousDisclosureId === this.head(current),
          "REVISION",
          "Organization ledger disclosure changed; review current terms.",
        );
        const list = (values: string[], name: string, empty = false) => {
          check(
            Array.isArray(values) &&
              values.length <= 30 &&
              (empty || values.length > 0),
            "VALIDATION",
            `${name} requires ${empty ? "0" : "1"}–30 entries.`,
            400,
          );
          const result = Array.from(values).map((v) => text(v, name, 200));
          check(
            new Set(result).size === result.length,
            "VALIDATION",
            `${name} contains duplicate entries.`,
            400,
          );
          return result;
        };
        const countries = list(
          input.processingCountries,
          "Processing countries",
        );
        check(
          countries.every((c) => /^[A-Z]{2}$/.test(c)),
          "VALIDATION",
          "Processing countries require uppercase two-letter codes.",
          400,
        );
        const body: Terms = {
          ...scope,
          orgId: current.orgId,
          region: this.region,
          version: text(input.version, "Disclosure version"),
          purposes: text(input.purposes, "Processing purposes", 2000),
          minimumData: list(input.minimumData, "Minimum data"),
          processingCountries: countries,
          subprocessors: list(input.subprocessors, "Subprocessors", true),
          retention: text(input.retention, "Retention and deletion", 2000),
          withdrawal: text(input.withdrawal, "Withdrawal consequences", 2000),
          termsReference: text(input.termsReference, "Terms reference", 2000),
          reviewEvidence: text(
            input.reviewEvidence,
            "Reviewed provider evidence",
            2000,
          ),
        };
        check(
          !this.store.get(
            "SELECT id FROM iam_ledger_disclosures WHERE org_id=? AND region=? AND version=?",
            current.orgId,
            this.region,
            body.version,
          ),
          "DISCLOSURE_VERSION",
          "Organization ledger disclosure version already exists.",
        );
        const disclosureId = id(),
          hash = digest(canonical(body)),
          createdAt = now();
        this.store.run(
          "INSERT INTO iam_ledger_disclosures VALUES(?,?,?,?,?,?,?,?)",
          disclosureId,
          current.orgId,
          this.region,
          body.version,
          canonical(body),
          hash,
          current.id,
          createdAt,
        );
        this.store.run(
          "INSERT INTO iam_ledger_disclosure_current VALUES(?,?) ON CONFLICT(org_id) DO UPDATE SET disclosure_id=excluded.disclosure_id",
          current.orgId,
          disclosureId,
        );
        this.platform.audit(
          current,
          "organization.ledger-disclosure.published",
          disclosureId,
          {
            ...scope,
            region: this.region,
            hash,
            version: body.version,
            previousDisclosureId: input.previousDisclosureId,
          },
        );
        return this.read(current, disclosureId);
      },
    );
  }
  withdrawDisclosure(
    actor: Actor,
    key: string,
    input: { disclosureId: string; reason: string },
  ) {
    return this.platform.command(
      actor,
      "organization.ledger-disclosure.withdraw",
      key,
      input,
      () => {
        this.actor(actor, true);
      },
      () => {
        const current = this.actor(actor, true),
          terms = this.read(current, input.disclosureId);
        check(
          this.head(current) === terms.id,
          "REVISION",
          "Organization ledger disclosure changed; review current terms.",
        );
        const reason = text(input.reason, "Withdrawal reason", 2000);
        this.store.run(
          "DELETE FROM iam_ledger_disclosure_current WHERE org_id=? AND disclosure_id=?",
          current.orgId,
          terms.id,
        );
        this.platform.audit(
          current,
          "organization.ledger-disclosure.withdrawn",
          terms.id,
          { ...scope, hash: terms.hash, reason },
        );
        return {
          disclosureId: terms.id,
          hash: terms.hash,
          withdrawn: true as const,
        };
      },
    );
  }
  private choiceRow(actor: Actor, row: Row): LedgerChoice {
    const body = JSON.parse(String(row.body)) as LedgerChoice;
    check(
      digest(canonical(body)) === row.hash &&
        body.orgId === actor.orgId &&
        body.region === this.region &&
        body.region === row.region &&
        body.revision === row.revision &&
        body.mode === row.mode &&
        body.realm === row.realm &&
        (body.acceptance?.disclosureId ?? null) === row.disclosure_id &&
        (body.acceptance?.disclosureHash ?? null) === row.disclosure_hash &&
        body.recordedBy === row.recorded_by &&
        body.recordedAt === row.recorded_at &&
        body.provider === scope.provider &&
        body.purpose === scope.purpose &&
        body.environment === scope.environment,
      "CONSENT_INTEGRITY",
      "Organization ledger choice integrity check failed.",
    );
    if (body.acceptance)
      check(
        this.read(actor, body.acceptance.disclosureId).hash ===
          body.acceptance.disclosureHash,
        "CONSENT_INTEGRITY",
        "Organization ledger acceptance differs from retained terms.",
      );
    return body;
  }
  private latest(actor: Actor): LedgerChoice {
    const row = this.store.get(
      "SELECT * FROM iam_ledger_choices WHERE org_id=? ORDER BY revision DESC LIMIT 1",
      actor.orgId,
    );
    return row
      ? this.choiceRow(actor, row)
      : {
          ...scope,
          orgId: actor.orgId,
          region: this.region,
          revision: 1,
          mode: "strict",
          realm: null,
          acceptance: null,
          acknowledgment: null,
          recordedBy: null,
          recordedAt: null,
        };
  }
  private status(actor: Actor) {
    const choice = this.latest(actor),
      head = this.head(actor),
      terms = head ? this.read(actor, String(head)) : null;
    const reason =
      choice.mode === "strict"
        ? "strict"
        : !terms
          ? "terms-unavailable"
          : terms.id !== choice.acceptance?.disclosureId ||
              terms.hash !== choice.acceptance?.disclosureHash
            ? "terms-changed"
            : null;
    return { choice, terms, allowed: reason === null, reason };
  }
  current(actor: Actor) {
    return this.database.transaction(() => this.status(this.actor(actor)));
  }
  choose(actor: Actor, key: string, input: LedgerChoiceInput) {
    return this.platform.command(
      actor,
      "organization.ledger-residency.choose",
      key,
      input,
      () => {
        this.actor(actor);
      },
      () => {
        const current = this.actor(actor),
          previous = this.latest(current);
        integer(
          input.revision,
          "Choice revision",
          1,
          Number.MAX_SAFE_INTEGER - 1,
        );
        check(
          input.region === this.region,
          "REGIONAL_MIGRATION_REQUIRED",
          "A different storage region requires a reviewed regional migration.",
        );
        check(
          input.revision === previous.revision,
          "REVISION",
          "Organization ledger choice changed; review its current revision.",
        );
        check(
          input.mode === "strict" || input.mode === "provider-exception",
          "VALIDATION",
          "Choose strict residency or the named QuickBooks sandbox exception.",
          400,
        );
        const acknowledgment = text(
          input.acknowledgment,
          "Reviewed residency acknowledgment",
          2000,
        );
        let acceptance: LedgerChoice["acceptance"] = null;
        if (input.mode === "strict") {
          check(
            input.realm === null && input.acceptance === undefined,
            "VALIDATION",
            "Strict residency cannot include a company or processor acceptance.",
            400,
          );
        } else {
          check(
            typeof input.realm === "string" &&
              /^[1-9][0-9]{0,39}$/.test(input.realm),
            "VALIDATION",
            "Choose an exact numeric QuickBooks sandbox company.",
            400,
          );
          check(
            input.acceptance && typeof input.acceptance === "object",
            "ORGANIZATION_ACCEPTANCE_REQUIRED",
            "Record the organization's authorized representative and exact reviewed terms.",
          );
          const terms = this.read(current, input.acceptance.disclosureId);
          check(
            this.head(current) === terms.id &&
              input.acceptance.disclosureHash === terms.hash,
            "DISCLOSURE_CHANGED",
            "Review the current organization ledger terms and exact hash.",
          );
          acceptance = {
            disclosureId: terms.id,
            disclosureHash: terms.hash,
            representative: text(
              input.acceptance.representative,
              "Organization representative",
              200,
            ),
            evidenceRef: text(
              input.acceptance.evidenceRef,
              "Organization acceptance evidence",
              2000,
            ),
          };
        }
        const body: LedgerChoice = {
          ...scope,
          orgId: current.orgId,
          region: this.region,
          revision: previous.revision + 1,
          mode: input.mode,
          realm: input.realm,
          acceptance,
          acknowledgment,
          recordedBy: current.id,
          recordedAt: now(),
        };
        this.store.run(
          "INSERT INTO iam_ledger_choices VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          current.orgId,
          body.revision,
          this.region,
          body.mode,
          body.realm,
          acceptance?.disclosureId ?? null,
          acceptance?.disclosureHash ?? null,
          canonical(body),
          digest(canonical(body)),
          body.recordedBy,
          body.recordedAt,
        );
        this.platform.audit(
          current,
          "organization.ledger-residency.chosen",
          current.orgId,
          body,
        );
        return body;
      },
    );
  }
  history(actor: Actor, after?: number) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      if (after !== undefined) {
        integer(after, "Choice history cursor", 2, Number.MAX_SAFE_INTEGER);
        check(
          this.store.get(
            "SELECT revision FROM iam_ledger_choices WHERE org_id=? AND revision=?",
            actor.orgId,
            after,
          ),
          "CURSOR",
          "Choice history cursor is unavailable.",
          400,
        );
      }
      const rows = this.store.all(
        "SELECT * FROM iam_ledger_choices WHERE org_id=? AND revision<=? ORDER BY revision DESC LIMIT 21",
        actor.orgId,
        after === undefined ? Number.MAX_SAFE_INTEGER : after - 1,
      );
      return {
        items: rows.slice(0, 20).map((row) => this.choiceRow(actor, row)),
        next: rows.length > 20 ? Number(rows[19]!.revision) : null,
      };
    });
  }
  // Capture a stamp for a prospective immutable effect. This is permission only:
  // it never supplies credentials, clears recovery holds, or authorizes sending.
  permission(actor: Actor, realm: string): LedgerAuthority {
    return this.database.transaction(() =>
      this.capturePermission(actor, realm),
    );
  }
  private capturePermission(actor: Actor, realm: string): LedgerAuthority {
    actor = this.actor(actor);
    this.platform.assertProviderAccess();
    const { choice, terms, allowed } = this.status(actor);
    check(
      allowed && choice.realm === realm && terms && choice.acceptance,
      "RESIDENCY_BLOCKED",
      "Organization has not accepted current stock-journal terms for this QuickBooks sandbox company.",
    );
    return {
      ...scope,
      orgId: actor.orgId,
      region: this.region,
      realm,
      revision: choice.revision,
      disclosureId: terms.id,
      disclosureHash: terms.hash,
    };
  }
  assertAllowed(actor: Actor, stamp: LedgerAuthority) {
    return this.database.transaction(() =>
      this.comparePermission(actor, stamp),
    );
  }
  // Vault/effect owners retain the same atomic transaction as their write.
  assertAllowedInTransaction(actor: Actor, stamp: LedgerAuthority) {
    this.database.requireTransaction();
    return this.comparePermission(actor, stamp);
  }
  private comparePermission(actor: Actor, stamp: LedgerAuthority) {
    const current = this.capturePermission(actor, stamp.realm);
    check(
      canonical(stamp) === canonical(current),
      "RESIDENCY_CHANGED",
      "Organization ledger authority changed; review a new effect.",
    );
    return current;
  }
}
