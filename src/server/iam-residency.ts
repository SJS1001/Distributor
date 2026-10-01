import {
  canonical,
  check,
  digest,
  id,
  now,
  permit,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import {
  isProviderName,
  providerNames,
  type ProviderName,
} from "../shared/provider-choices.ts";
import type { Customer, Region } from "./iam.ts";

export type DisclosureInput = {
  provider: ProviderName;
  region: Region;
  previousDisclosureId: string | null;
  version: string;
  purposes: string;
  minimumData: string[];
  processingCountries: string[];
  subprocessors: string[];
  retention: string;
  withdrawal: string;
  termsReference: string;
  reviewEvidence: string;
};
export type ProviderAcceptance = {
  basis: "buyer" | "recorded";
  representative?: string;
  evidenceRef?: string;
  disclosures: { provider: ProviderName; disclosureId: string }[];
};
export type Disclosure = Omit<
  DisclosureInput,
  "previousDisclosureId" | "reviewEvidence"
> & {
  id: string;
  hash: string;
  createdAt: string;
};

// IAM owns immutable terms and acceptance evidence; selection never qualifies a vendor.
export class ProviderResidency {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private region: Region,
    private authority: (actor: Actor) => Actor,
    private customer: (actor: Actor, accountId: string) => Customer,
  ) {
    this.store = database.owned("iam");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS iam_provider_disclosures(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,provider TEXT NOT NULL,region TEXT NOT NULL,version TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,review_evidence TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,provider,region,version)) STRICT;
      CREATE TABLE IF NOT EXISTS iam_provider_disclosure_current(org_id TEXT NOT NULL,provider TEXT NOT NULL,region TEXT NOT NULL,disclosure_id TEXT NOT NULL REFERENCES iam_provider_disclosures(id),PRIMARY KEY(org_id,provider,region)) STRICT;
      CREATE TABLE IF NOT EXISTS iam_provider_acceptances(org_id TEXT NOT NULL,account_id TEXT NOT NULL,choice_version INTEGER NOT NULL,provider TEXT NOT NULL,disclosure_id TEXT NOT NULL REFERENCES iam_provider_disclosures(id),disclosure_hash TEXT NOT NULL,basis TEXT NOT NULL,representative TEXT NOT NULL,evidence_ref TEXT,actor_id TEXT NOT NULL,accepted_at TEXT NOT NULL,PRIMARY KEY(org_id,account_id,choice_version,provider)) STRICT;
    `);
  }
  private head(actor: Actor, provider: ProviderName) {
    return this.store.get(
      "SELECT disclosure_id FROM iam_provider_disclosure_current WHERE org_id=? AND provider=? AND region=?",
      actor.orgId,
      provider,
      this.region,
    );
  }
  private read(actor: Actor, disclosureId: string): Disclosure {
    const row = this.store.get(
      "SELECT * FROM iam_provider_disclosures WHERE org_id=? AND region=? AND id=?",
      actor.orgId,
      this.region,
      disclosureId,
    );
    check(row, "NOT_FOUND", "Provider disclosure is unavailable.", 404);
    const body = JSON.parse(String(row.body)) as Omit<
      Disclosure,
      "id" | "hash" | "createdAt"
    >;
    check(
      digest(canonical(body)) === row.hash,
      "DISCLOSURE_INTEGRITY",
      "Provider disclosure integrity check failed.",
    );
    return {
      ...body,
      id: String(row.id),
      hash: String(row.hash),
      createdAt: String(row.created_at),
    };
  }
  disclosure(actor: Actor, disclosureId: string) {
    return this.read(this.authority(actor), disclosureId);
  }
  current(actor: Actor): Disclosure[] {
    actor = this.authority(actor);
    return providerNames.flatMap((provider) => {
      const head = this.head(actor, provider);
      return head ? [this.read(actor, String(head.disclosure_id))] : [];
    });
  }
  publish(actor: Actor, key: string, input: DisclosureInput) {
    return this.platform.command(
      actor,
      "provider.disclosure.publish",
      key,
      input,
      () => permit(this.authority(actor), []),
      () => {
        const current = this.authority(actor);
        check(
          isProviderName(input.provider),
          "VALIDATION",
          "Choose a named provider.",
          400,
        );
        check(
          input.region === this.region,
          "REGIONAL_MIGRATION_REQUIRED",
          "Publish terms for this application's storage region.",
        );
        check(
          input.previousDisclosureId ===
            (this.head(current, input.provider)?.disclosure_id ?? null),
          "REVISION",
          "Provider disclosure changed; review its current version.",
        );
        const list = (values: string[], name: string, empty = false) => {
          check(
            Array.isArray(values) &&
              values.length <= 30 &&
              (empty || values.length > 0),
            "VALIDATION",
            `${name} must contain ${empty ? "0" : "1"}–30 entries.`,
            400,
          );
          const result = Array.from(values).map((value) =>
            text(value, name, 200),
          );
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
          countries.every((country) => /^[A-Z]{2}$/.test(country)),
          "VALIDATION",
          "Processing countries must use uppercase two-letter codes.",
          400,
        );
        const body = {
          provider: input.provider,
          region: input.region,
          version: text(input.version, "Disclosure version", 160),
          purposes: text(input.purposes, "Processing purposes", 2000),
          minimumData: list(input.minimumData, "Minimum data"),
          processingCountries: countries,
          subprocessors: list(input.subprocessors, "Subprocessors", true),
          retention: text(input.retention, "Retention and deletion", 2000),
          withdrawal: text(input.withdrawal, "Withdrawal consequences", 2000),
          termsReference: text(input.termsReference, "Terms reference", 2000),
        };
        check(
          !this.store.get(
            "SELECT id FROM iam_provider_disclosures WHERE org_id=? AND provider=? AND region=? AND version=?",
            current.orgId,
            body.provider,
            body.region,
            body.version,
          ),
          "DISCLOSURE_VERSION_USED",
          "This version already identifies immutable terms. Publish a new version.",
        );
        const disclosureId = id(),
          hash = digest(canonical(body)),
          createdAt = now();
        this.store.run(
          "INSERT INTO iam_provider_disclosures VALUES(?,?,?,?,?,?,?,?,?,?)",
          disclosureId,
          current.orgId,
          body.provider,
          body.region,
          body.version,
          canonical(body),
          hash,
          text(
            input.reviewEvidence,
            "Vendor/business qualification evidence",
            2000,
          ),
          current.id,
          createdAt,
        );
        this.store.run(
          "INSERT INTO iam_provider_disclosure_current VALUES(?,?,?,?) ON CONFLICT(org_id,provider,region) DO UPDATE SET disclosure_id=excluded.disclosure_id",
          current.orgId,
          body.provider,
          body.region,
          disclosureId,
        );
        this.platform.audit(
          current,
          "provider.disclosure.published",
          disclosureId,
          {
            provider: body.provider,
            region: body.region,
            version: body.version,
            hash,
            previousDisclosureId: input.previousDisclosureId,
          },
        );
        return { ...body, id: disclosureId, hash, createdAt };
      },
    );
  }
  withdraw(
    actor: Actor,
    key: string,
    input: { provider: ProviderName; disclosureId: string; reason: string },
  ) {
    return this.platform.command(
      actor,
      "provider.disclosure.withdraw",
      key,
      input,
      () => permit(this.authority(actor), []),
      () => {
        const current = this.authority(actor);
        check(
          isProviderName(input.provider),
          "VALIDATION",
          "Choose a named provider.",
          400,
        );
        check(
          this.head(current, input.provider)?.disclosure_id ===
            input.disclosureId,
          "REVISION",
          "Provider disclosure changed; review its current version.",
        );
        const reason = text(input.reason, "Withdrawal reason", 2000);
        this.store.run(
          "DELETE FROM iam_provider_disclosure_current WHERE org_id=? AND provider=? AND region=?",
          current.orgId,
          input.provider,
          this.region,
        );
        this.platform.audit(
          current,
          "provider.disclosure.withdrawn",
          input.disclosureId,
          { provider: input.provider, reason },
        );
        return {
          provider: input.provider,
          disclosureId: input.disclosureId,
          withdrawn: true,
        };
      },
    );
  }
  record(
    actor: Actor,
    accountId: string,
    version: number,
    providers: string[],
    acceptance?: ProviderAcceptance,
  ) {
    actor = this.authority(actor);
    this.customer(actor, accountId);
    if (!providers.length) {
      check(
        acceptance === undefined,
        "VALIDATION",
        "No provider acceptance is needed for a choice without exceptions.",
        400,
      );
      return;
    }
    check(
      acceptance &&
        (acceptance.basis === "buyer" || acceptance.basis === "recorded"),
      "CUSTOMER_ACCEPTANCE_REQUIRED",
      "Record the customer's acceptance of the current named provider disclosures.",
      400,
    );
    check(
      (actor.role === "buyer") === (acceptance.basis === "buyer"),
      "FORBIDDEN",
      "Buyers accept for their own account; staff must record externally obtained customer acceptance.",
      403,
    );
    check(
      Array.isArray(acceptance.disclosures) &&
        acceptance.disclosures.length === providers.length &&
        new Set(acceptance.disclosures.map((d) => d?.provider)).size ===
          providers.length,
      "VALIDATION",
      "Acceptance must identify each selected provider disclosure exactly once.",
      400,
    );
    const representative =
      acceptance.basis === "buyer"
        ? actor.name
        : text(
            acceptance.representative,
            "Authorized customer representative",
            200,
          );
    const evidenceRef =
      acceptance.basis === "buyer"
        ? null
        : text(
            acceptance.evidenceRef,
            "External customer acceptance evidence",
            2000,
          );
    check(
      acceptance.basis !== "buyer" ||
        (acceptance.representative === undefined &&
          acceptance.evidenceRef === undefined),
      "VALIDATION",
      "Personal buyer acceptance uses the authenticated buyer identity.",
      400,
    );
    const acceptedAt = now();
    for (const selected of acceptance.disclosures) {
      check(
        selected &&
          isProviderName(selected.provider) &&
          providers.includes(selected.provider),
        "VALIDATION",
        "Acceptance contains an unselected provider.",
        400,
      );
      const disclosureId = text(
        selected.disclosureId,
        "Reviewed disclosure ID",
        160,
      );
      check(
        this.head(actor, selected.provider)?.disclosure_id === disclosureId,
        "DISCLOSURE_REVIEW_REQUIRED",
        "Provider terms changed or are unavailable; review the current disclosure.",
      );
      const disclosure = this.read(actor, disclosureId);
      this.store.run(
        "INSERT INTO iam_provider_acceptances VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        actor.orgId,
        accountId,
        version,
        selected.provider,
        disclosure.id,
        disclosure.hash,
        acceptance.basis,
        representative,
        evidenceRef,
        actor.id,
        acceptedAt,
      );
    }
  }
  assertCurrent(actor: Actor, customer: Customer, provider: ProviderName) {
    const row = this.store.get(
      "SELECT a.disclosure_id,a.disclosure_hash FROM iam_provider_acceptances a JOIN iam_provider_disclosure_current c ON c.org_id=a.org_id AND c.provider=a.provider AND c.disclosure_id=a.disclosure_id WHERE a.org_id=? AND a.account_id=? AND a.choice_version=? AND a.provider=? AND c.region=?",
      actor.orgId,
      customer.id,
      customer.residency_version,
      provider,
      this.region,
    );
    check(
      row,
      "DISCLOSURE_REVIEW_REQUIRED",
      "Current provider terms require customer review before processing.",
    );
    check(
      this.read(actor, String(row.disclosure_id)).hash === row.disclosure_hash,
      "DISCLOSURE_INTEGRITY",
      "Customer acceptance integrity check failed.",
    );
  }
  acceptances(actor: Actor, accountId: string, version: number) {
    actor = this.authority(actor);
    permit(actor, ["commercial", "buyer", "finance", "support"]);
    this.customer(actor, accountId);
    check(
      Number.isSafeInteger(version) && version > 0,
      "VALIDATION",
      "Choose a positive choice version.",
      400,
    );
    return this.store.all(
      "SELECT provider,disclosure_id,disclosure_hash,basis,representative,evidence_ref,actor_id,accepted_at FROM iam_provider_acceptances WHERE org_id=? AND account_id=? AND choice_version=? ORDER BY provider LIMIT 8",
      actor.orgId,
      accountId,
      version,
    );
  }
  acceptanceVersions(actor: Actor, accountId: string, after?: number) {
    actor = this.authority(actor);
    permit(actor, ["commercial", "buyer", "finance", "support"]);
    this.customer(actor, accountId);
    if (after !== undefined) {
      check(
        Number.isSafeInteger(after) && after > 0,
        "VALIDATION",
        "Choose a positive acceptance history cursor.",
        400,
      );
      check(
        this.store.get(
          "SELECT 1 FROM iam_provider_acceptances WHERE org_id=? AND account_id=? AND choice_version=? LIMIT 1",
          actor.orgId,
          accountId,
          after,
        ),
        "CURSOR",
        "Acceptance history cursor is unavailable.",
        400,
      );
    }
    const rows = this.store.all(
      `SELECT choice_version AS version,MIN(accepted_at) AS acceptedAt,COUNT(*) AS providerCount FROM iam_provider_acceptances WHERE org_id=? AND account_id=?${after === undefined ? "" : " AND choice_version<?"} GROUP BY choice_version ORDER BY choice_version DESC LIMIT 21`,
      actor.orgId,
      accountId,
      ...(after === undefined ? [] : [after]),
    );
    const items = rows.slice(0, 20).map((row) => ({
      version: Number(row.version),
      acceptedAt: String(row.acceptedAt),
      providerCount: Number(row.providerCount),
    }));
    return {
      items,
      next: rows.length > 20 ? String(items[19]!.version) : null,
    };
  }
  status(actor: Actor, customer: Customer) {
    actor = this.authority(actor);
    customer = this.customer(actor, customer.id);
    return this.store.all(
      "SELECT a.provider,a.disclosure_id,d.version,CASE WHEN c.disclosure_id=a.disclosure_id AND d.hash=a.disclosure_hash THEN 1 ELSE 0 END AS current FROM iam_provider_acceptances a JOIN iam_provider_disclosures d ON d.id=a.disclosure_id AND d.org_id=a.org_id LEFT JOIN iam_provider_disclosure_current c ON c.org_id=a.org_id AND c.provider=a.provider AND c.region=? WHERE a.org_id=? AND a.account_id=? AND a.choice_version=? ORDER BY a.provider LIMIT 8",
      this.region,
      actor.orgId,
      customer.id,
      customer.residency_version,
    );
  }
}
