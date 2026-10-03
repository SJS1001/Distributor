import { canonical, check, digest, integer, text } from "./core.ts";
import { accountingDate } from "./cost-corrections.ts";
import type { Adapter, Effect, EffectResult } from "./integration.ts";

// Sandbox protocol candidate only. No native queue or startup binding. A source
// hash verifies bytes, not approval/authority; the supplied guard must re-read
// native approval, organization consent, period, lease and correction ordering.
export type StockJournalIntent = {
  version: 1;
  realmId: string;
  organizationId: string;
  source: { bytes: string; hash: string };
  leg: "original" | "reversal" | "replacement";
  postingDate: string;
  closedThrough: string;
  accounts: { sourceAccount: string; accountId: string }[];
};
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "JOURNAL_INPUT",
    "Expected a journal object.",
  );
  return value as ObjectValue;
}
function keys(value: ObjectValue, expected: string[]) {
  check(
    canonical(Object.keys(value).sort()) === canonical(expected.sort()),
    "JOURNAL_INPUT",
    "Journal fields differ from the supported contract.",
  );
}
function identifier(value: unknown): string {
  check(
    typeof value === "string" && /^[1-9][0-9]{0,29}$/.test(value),
    "JOURNAL_INPUT",
    "QuickBooks identity must be numeric.",
  );
  return value;
}
function amount(cents: number) {
  const value = Number(
    `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
  );
  check(
    Math.round(value * 100) === cents,
    "JOURNAL_INPUT",
    "Amount cannot be represented exactly in cents.",
  );
  return value;
}
type SourceLine = {
  movementId: string;
  sequence: number;
  date: string;
  account: string;
  debit: number;
  credit: number;
};
function lines(value: unknown): SourceLine[] {
  check(
    Array.isArray(value) && value.length > 0 && value.length <= 20000,
    "JOURNAL_INPUT",
    "A bounded nonempty source journal is required.",
  );
  return value.map((v) => {
    const row = object(v);
    keys(row, ["movementId", "sequence", "date", "account", "debit", "credit"]);
    const debit = integer(row.debit, "debit", 0, 1_000_000_000_000),
      credit = integer(row.credit, "credit", 0, 1_000_000_000_000);
    check(
      debit > 0 !== credit > 0,
      "JOURNAL_INPUT",
      "Each journal line must have exactly one positive posting.",
    );
    amount(debit || credit);
    return {
      movementId: text(row.movementId, "movement", 160),
      sequence: integer(row.sequence, "sequence", 1, Number.MAX_SAFE_INTEGER),
      date: accountingDate(text(row.date, "journal date", 10)),
      account: text(row.account, "account", 160),
      debit,
      credit,
    };
  });
}
function totals(rows: SourceLine[]) {
  let debit = 0n,
    credit = 0n;
  for (const row of rows) {
    debit += BigInt(row.debit);
    credit += BigInt(row.credit);
  }
  check(
    debit > 0n && debit === credit && debit <= BigInt(Number.MAX_SAFE_INTEGER),
    "JOURNAL_INPUT",
    "Journal must balance with safe positive totals.",
  );
  return { debit: Number(debit), credit: Number(credit) };
}

/** Validates downloaded immutable files; current native authorization is separate. */
export function stockJournalIntent(
  input: StockJournalIntent,
): StockJournalIntent {
  const intent = structuredClone(input),
    row = object(intent);
  keys(row, [
    "version",
    "realmId",
    "organizationId",
    "source",
    "leg",
    "postingDate",
    "closedThrough",
    "accounts",
  ]);
  check(
    intent.version === 1,
    "JOURNAL_INPUT",
    "Unsupported journal intent version.",
  );
  identifier(intent.realmId);
  text(intent.organizationId, "organization");
  accountingDate(intent.postingDate);
  accountingDate(intent.closedThrough);
  check(
    intent.postingDate > intent.closedThrough,
    "JOURNAL_PERIOD",
    "Posting date is in a closed period.",
  );
  keys(object(intent.source), ["bytes", "hash"]);
  check(
    typeof intent.source.bytes === "string" &&
      Buffer.byteLength(intent.source.bytes) <= 2_000_000 &&
      /^[a-f0-9]{64}$/.test(intent.source.hash) &&
      digest(intent.source.bytes) === intent.source.hash,
    "JOURNAL_SOURCE",
    "Journal source failed its integrity check.",
  );
  let document: ObjectValue;
  try {
    document = object(JSON.parse(intent.source.bytes));
  } catch {
    check(
      false,
      "JOURNAL_SOURCE",
      "Journal source is not a supported JSON object.",
    );
  }
  check(
    document.version === 1 &&
      typeof document.reviewHash === "string" &&
      /^[a-f0-9]{64}$/.test(document.reviewHash) &&
      typeof document.reviewedBy === "string" &&
      document.reviewedBy.length > 0 &&
      typeof document.reviewedAt === "string" &&
      Number.isFinite(Date.parse(document.reviewedAt)),
    "JOURNAL_SOURCE",
    "Source requires review metadata.",
  );
  check(
    (document.region === "CA" && document.currency === "CAD") ||
      (document.region === "US" && document.currency === "USD"),
    "JOURNAL_SOURCE",
    "Source region and currency must agree.",
  );
  let journal: SourceLine[];
  if (intent.leg === "original") {
    check(
      document.format === "distributor-stock-cost" &&
        document.organizationId === intent.organizationId,
      "JOURNAL_SOURCE",
      "Original source does not belong to this organization.",
    );
    text(document.packetId, "source packet");
    const report = object(document.report);
    check(
      Array.isArray(report.issues) && report.issues.length === 0,
      "JOURNAL_SOURCE",
      "Blocked cost report cannot be sent.",
    );
    journal = lines(report.journal);
    const total = totals(journal);
    check(
      report.debit === total.debit && report.credit === total.credit,
      "JOURNAL_SOURCE",
      "Original journal totals differ from the reviewed report.",
    );
  } else {
    check(
      (intent.leg === "reversal" || intent.leg === "replacement") &&
        document.kind === "stock-cost-account-mapping-correction" &&
        document.orgId === intent.organizationId,
      "JOURNAL_SOURCE",
      "Correction source does not belong to this organization.",
    );
    text(document.correctionId, "source correction");
    const sourceInput = object(document.input);
    check(
      sourceInput.postingDate === intent.postingDate &&
        (sourceInput.outcome === "posted" ||
          (intent.leg === "replacement" && sourceInput.outcome === "unposted")),
      "JOURNAL_SOURCE",
      "Correction leg does not match the approved outcome/date.",
    );
    journal = lines(document[intent.leg]);
    check(
      journal.every((line) => line.date === intent.postingDate),
      "JOURNAL_SOURCE",
      "Correction journal dates differ from approval.",
    );
    const total = totals(journal);
    check(
      document.debit === total.debit && document.credit === total.credit,
      "JOURNAL_SOURCE",
      "Correction journal totals differ from approval.",
    );
  }
  const byDate = new Map<string, SourceLine[]>();
  for (const line of journal) {
    const group = byDate.get(line.date) ?? [];
    group.push(line);
    byDate.set(line.date, group);
  }
  for (const rows of byDate.values()) totals(rows);
  const selected = byDate.get(intent.postingDate);
  check(
    selected && selected.length <= 1000,
    "JOURNAL_SOURCE",
    "Select a reviewed date with at most 1,000 lines; dates cannot be changed.",
  );
  check(
    Array.isArray(intent.accounts) && intent.accounts.length <= 1000,
    "JOURNAL_INPUT",
    "A bounded account mapping is required.",
  );
  const required = new Set(selected.map((line) => line.account)),
    seen = new Set<string>(),
    external = new Set<string>();
  for (const mapping of intent.accounts) {
    keys(object(mapping), ["sourceAccount", "accountId"]);
    check(
      typeof mapping.sourceAccount === "string" &&
        required.has(mapping.sourceAccount) &&
        !seen.has(mapping.sourceAccount),
      "JOURNAL_INPUT",
      "Account mapping must cover each selected source account exactly once.",
    );
    identifier(mapping.accountId);
    check(
      !external.has(mapping.accountId),
      "JOURNAL_INPUT",
      "Distinct reviewed accounts must not collapse into one receiver account.",
    );
    seen.add(mapping.sourceAccount);
    external.add(mapping.accountId);
  }
  check(
    seen.size === required.size,
    "JOURNAL_INPUT",
    "Account mapping is incomplete.",
  );
  return intent;
}

function projection(effect: Effect, realmId: string) {
  check(
    typeof effect.payload === "string" &&
      Buffer.byteLength(effect.payload) <= 4_000_000,
    "JOURNAL_INPUT",
    "Journal effect payload is oversized.",
  );
  check(
    effect.provider === "quickbooks" && effect.kind === "stock-cost-journal",
    "JOURNAL_INPUT",
    "Unsupported journal effect.",
  );
  const intent = stockJournalIntent(
    JSON.parse(effect.payload) as StockJournalIntent,
  );
  check(
    intent.organizationId === effect.org_id && intent.realmId === realmId,
    "JOURNAL_SCOPE",
    "Effect organization or realm differs from its journal.",
  );
  check(
    /^[A-Za-z0-9_-]{1,50}$/.test(effect.id),
    "JOURNAL_INPUT",
    "Effect identity must fit the provider request identity.",
  );
  const document = object(JSON.parse(intent.source.bytes));
  const journal = lines(
    intent.leg === "original"
      ? object(document.report).journal
      : document[intent.leg],
  ).filter((line) => line.date === intent.postingDate);
  const total = totals(journal),
    docNumber = `DJ-${digest(effect.id).slice(0, 18)}`;
  const note = `Distributor stock journal ${effect.id}; ${intent.leg}; ${intent.source.hash}; ${digest(canonical(intent))}`;
  const body = {
    DocNumber: docNumber,
    PrivateNote: note,
    TxnDate: intent.postingDate,
    CurrencyRef: { value: document.currency },
    ...(document.region === "CA"
      ? { GlobalTaxCalculation: "TaxExcluded" }
      : {}),
    Adjustment: false,
    Line: journal.map((line, index) => ({
      Description: `Distributor ${index + 1}: ${digest(canonical(line))}`,
      DetailType: "JournalEntryLineDetail",
      Amount: amount(line.debit || line.credit),
      JournalEntryLineDetail: {
        PostingType: line.debit ? "Debit" : "Credit",
        AccountRef: {
          value: intent.accounts.find((a) => a.sourceAccount === line.account)!
            .accountId,
        },
      },
    })),
  };
  return {
    intent,
    body,
    total,
    region: document.region,
    currency: document.currency,
  };
}
type Projection = ReturnType<typeof projection>;
type Guard = (
  effect: Readonly<Effect>,
  phase: "read" | "write",
) => void | Promise<void>;
export class QuickBooksStockJournalAdapter implements Adapter {
  constructor(
    private realmId: string,
    private token: (effect: Readonly<Effect>) => Promise<string>,
    private guard: Guard,
    private enabled = false,
  ) {
    identifier(realmId);
  }
  private snapshot(effect: Effect) {
    check(
      this.enabled,
      "PROVIDER_DISABLED",
      "Stock journal sandbox transport is disabled.",
    );
    check(
      typeof this.guard === "function",
      "JOURNAL_AUTHORITY",
      "A current native authority guard is required.",
    );
    const snapshot = Object.freeze(structuredClone(effect));
    return { effect: snapshot, projected: projection(snapshot, this.realmId) };
  }
  private async request(
    effect: Readonly<Effect>,
    path: string,
    body?: unknown,
    beforeWrite?: () => void,
  ) {
    await this.guard(effect, "read");
    const token = await this.token(effect);
    check(
      typeof token === "string" && token.length > 0 && !/[\r\n]/.test(token),
      "PROVIDER_CREDENTIAL",
      "Provider token is invalid.",
    );
    await this.guard(effect, body === undefined ? "read" : "write");
    if (body !== undefined) {
      check(
        typeof beforeWrite === "function",
        "JOURNAL_AUTHORITY",
        "A native write fence is required.",
      );
      const outcome: unknown = beforeWrite();
      if (outcome instanceof Promise) void outcome.catch(() => {});
      check(
        outcome === undefined,
        "JOURNAL_AUTHORITY",
        "The native write fence must finish synchronously.",
      );
    }
    const response = await fetch(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${this.realmId}/${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      },
    );
    check(
      response.ok,
      "PROVIDER_RESPONSE",
      "QuickBooks journal request failed.",
    );
    return object(await response.json());
  }
  private result(value: unknown, p: Projection): EffectResult {
    const journal = object(value);
    check(
      Object.keys(journal).every((key) =>
        [
          "Id",
          "SyncToken",
          "DocNumber",
          "PrivateNote",
          "TxnDate",
          "CurrencyRef",
          "GlobalTaxCalculation",
          "Adjustment",
          "HomeCurrencyAdjustment",
          "EnteredInHomeCurrency",
          "ExchangeRate",
          "TotalAmt",
          "HomeTotalAmt",
          "TxnTaxDetail",
          "Line",
          "LinkedTxn",
          "MetaData",
          "domain",
          "sparse",
        ].includes(key),
      ) &&
        (journal.domain === undefined || journal.domain === "QBO") &&
        (journal.sparse === undefined || journal.sparse === false),
      "JOURNAL_RESPONSE",
      "Unsupported or partial receiver journal.",
    );
    const reference = identifier(journal.Id);
    check(
      typeof journal.SyncToken === "string" &&
        /^[0-9]+$/.test(journal.SyncToken) &&
        journal.DocNumber === p.body.DocNumber &&
        journal.PrivateNote === p.body.PrivateNote &&
        journal.TxnDate === p.body.TxnDate &&
        object(journal.CurrencyRef).value === p.currency,
      "JOURNAL_RESPONSE",
      "Receiver identity/date/currency/source differs from the approved journal.",
    );
    check(
      (journal.TotalAmt === undefined || journal.TotalAmt === 0) &&
        (journal.HomeTotalAmt === undefined || journal.HomeTotalAmt === 0) &&
        (journal.ExchangeRate === undefined || journal.ExchangeRate === 1) &&
        (journal.Adjustment === undefined || journal.Adjustment === false) &&
        (journal.HomeCurrencyAdjustment === undefined ||
          journal.HomeCurrencyAdjustment === false) &&
        (journal.LinkedTxn === undefined ||
          (Array.isArray(journal.LinkedTxn) && journal.LinkedTxn.length === 0)),
      "JOURNAL_RESPONSE",
      "Unexpected tax, adjustment, exchange or linked journal behavior.",
    );
    if (journal.TxnTaxDetail !== undefined) {
      const tax = object(journal.TxnTaxDetail);
      check(
        Object.keys(tax).length === 0 ||
          (tax.TotalTax === 0 &&
            Object.keys(tax).every((k) => k === "TotalTax")),
        "JOURNAL_RESPONSE",
        "Unexpected journal tax.",
      );
    }
    check(
      p.region !== "CA" || journal.GlobalTaxCalculation === "TaxExcluded",
      "JOURNAL_RESPONSE",
      "Canadian journal tax mode differs from the request.",
    );
    check(
      Array.isArray(journal.Line) && journal.Line.length === p.body.Line.length,
      "JOURNAL_RESPONSE",
      "Receiver journal line count differs.",
    );
    const actual = journal.Line.map((value) => {
      const row = object(value),
        detail = object(row.JournalEntryLineDetail);
      check(
        row.DetailType === "JournalEntryLineDetail" &&
          Object.keys(row).every((key) =>
            [
              "Id",
              "LineNum",
              "Description",
              "DetailType",
              "Amount",
              "JournalEntryLineDetail",
            ].includes(key),
          ) &&
          Object.keys(detail).every((key) =>
            ["PostingType", "AccountRef"].includes(key),
          ),
        "JOURNAL_RESPONSE",
        "Unexpected journal line semantics.",
      );
      return {
        Description: row.Description,
        DetailType: row.DetailType,
        Amount: row.Amount,
        JournalEntryLineDetail: {
          PostingType: detail.PostingType,
          AccountRef: { value: object(detail.AccountRef).value },
        },
      };
    });
    check(
      canonical(actual.map(canonical).sort()) ===
        canonical(p.body.Line.map(canonical).sort()),
      "JOURNAL_RESPONSE",
      "Receiver journal lines differ from approved amounts/accounts/source.",
    );
    return {
      reference,
      result: {
        realmId: p.intent.realmId,
        sourceHash: p.intent.source.hash,
        leg: p.intent.leg,
        postingDate: p.intent.postingDate,
        currency: p.currency as string,
        ...p.total,
        syncToken: journal.SyncToken,
      },
    };
  }
  private async find(effect: Readonly<Effect>, p: Projection) {
    const result = await this.request(
      effect,
      `query?query=${encodeURIComponent(`select * from JournalEntry where DocNumber = '${p.body.DocNumber}' maxresults 2`)}`,
    );
    const query = object(result.QueryResponse),
      found = query.JournalEntry === undefined ? [] : query.JournalEntry;
    check(
      Object.keys(query).every((key) =>
        ["JournalEntry", "startPosition", "maxResults", "totalCount"].includes(
          key,
        ),
      ),
      "JOURNAL_RESPONSE",
      "Unexpected receiver query response.",
    );
    check(
      Array.isArray(found) &&
        found.length <= 1 &&
        (query.totalCount === undefined || query.totalCount === found.length),
      "JOURNAL_DUPLICATE",
      "Ambiguous receiver journal query; reconcile independently.",
    );
    return found.length ? this.result(found[0], p) : null;
  }
  async lookup(effect: Effect): Promise<EffectResult | null> {
    const frozen = this.snapshot(effect);
    return this.find(frozen.effect, frozen.projected);
  }
  async execute(
    effect: Effect,
    beforeWrite?: () => void,
  ): Promise<EffectResult> {
    check(
      typeof beforeWrite === "function",
      "JOURNAL_AUTHORITY",
      "A native write fence is required before any journal IO.",
    );
    const { effect: snapshot, projected: p } = this.snapshot(effect);
    await this.guard(snapshot, "read");
    const company = object(
      (await this.request(snapshot, `companyinfo/${this.realmId}`)).CompanyInfo,
    );
    const prefs = object(
      (await this.request(snapshot, "preferences")).Preferences,
    );
    check(
      company.Country === p.region &&
        object(object(prefs.CurrencyPrefs).HomeCurrency).value === p.currency,
      "JOURNAL_REALM",
      "Receiver company locale/home currency differs from source; FX is unsupported.",
    );
    for (const mapping of p.intent.accounts) {
      const account = object(
        (await this.request(snapshot, `account/${mapping.accountId}`)).Account,
      );
      check(
        account.Id === mapping.accountId &&
          account.Active === true &&
          [
            "Other Current Asset",
            "Fixed Asset",
            "Other Asset",
            "Other Current Liability",
            "Long Term Liability",
            "Equity",
            "Income",
            "Other Income",
            "Cost of Goods Sold",
            "Expense",
            "Other Expense",
          ].includes(account.AccountType as string) &&
          (account.CurrencyRef === undefined ||
            object(account.CurrencyRef).value === p.currency),
        "JOURNAL_ACCOUNT",
        "Receiver account is inactive, foreign or requires unsupported entity/cash semantics.",
      );
    }
    const existing = await this.find(snapshot, p);
    if (existing) return existing;
    return this.result(
      (
        await this.request(
          snapshot,
          `journalentry?requestid=${encodeURIComponent(snapshot.id)}`,
          p.body,
          beforeWrite,
        )
      ).JournalEntry,
      p,
    );
  }
}
