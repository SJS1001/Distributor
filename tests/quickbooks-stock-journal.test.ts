// Synthetic protocol fixtures. All fetches are mocked; no provider qualification.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { canonical, digest, DomainError } from "../src/server/core.ts";
import {
  QuickBooksStockJournalAdapter,
  stockJournalIntent,
  type StockJournalIntent,
} from "../src/server/quickbooks-stock-journal.ts";
import type { Effect } from "../src/server/integration.ts";
import { fixture } from "./fixtures.ts";
import { setup, approvedCorrection } from "./cost-correction-fixture.ts";

function journal(
  t: TestContext,
  region: "CA" | "US" = "CA",
  leg: StockJournalIntent["leg"] = "original",
  outcome: "posted" | "unposted" = "posted",
) {
  const f = fixture(t, {}, region);
  const source =
    leg === "original"
      ? f.app.integration.costs.download(f.actor, setup(f).original.id)
      : (() => {
          const c = approvedCorrection(f, outcome);
          return c.c.download(f.actor, c.approved.id);
        })();
  const document = JSON.parse(source.bytes),
    rows = leg === "original" ? document.report.journal : document[leg];
  const intent = {
    version: 1 as const,
    realmId: "12345",
    organizationId: f.actor.orgId,
    source: { bytes: source.bytes, hash: source.hash },
    leg,
    postingDate: rows[0]?.date ?? "2026-10-03",
    closedThrough: "1900-01-01",
    accounts: [
      ...new Set<string>(rows.map((r: { account: string }) => r.account)),
    ].map((sourceAccount, index) => ({
      sourceAccount,
      accountId: String(10 + index),
    })),
  };
  const effect: Effect = {
    id: "synthetic-journal-effect",
    org_id: f.actor.orgId,
    account_id: "",
    provider: "quickbooks",
    kind: "stock-cost-journal",
    reference: "synthetic-reference",
    payload: canonical(stockJournalIntent(intent)),
    state: "running",
    external_ref: null,
    result: null,
    created_at: new Date().toISOString(),
    residency_version: 1,
    started_at: Date.now(),
    error: null,
  };
  return { f, intent, effect };
}
function receiver(t: TestContext, region: "CA" | "US" = "CA") {
  const state = {
    writes: 0,
    reads: 0,
    body: null as Record<string, any> | null,
    journals: [] as unknown[],
    change: (_body: Record<string, any>) => {},
    account: { Active: true, AccountType: "Other Current Asset" } as Record<
      string,
      unknown
    >,
    company: region as string,
    homeCurrency: region === "CA" ? "CAD" : "USD",
    query: null as Record<string, unknown> | null,
    loseReply: false,
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options?: RequestInit) => {
      assert.ok(
        String(url).startsWith(
          "https://sandbox-quickbooks.api.intuit.com/v3/company/12345/",
        ),
      );
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal);
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        "Bearer synthetic-token",
      );
      let response;
      if (options?.method === "POST") {
        state.writes++;
        const body = JSON.parse(String(options.body));
        assert.equal(
          new URL(String(url)).searchParams.get("requestid"),
          "synthetic-journal-effect",
        );
        assert.equal(
          new URL(String(url)).searchParams.has("allowduplicatedocnum"),
          false,
        );
        state.body = structuredClone(body);
        const observed = {
          ...body,
          Id: "999",
          SyncToken: "0",
          TotalAmt: 0,
          HomeTotalAmt: 0,
          domain: "QBO",
          sparse: false,
          TxnTaxDetail: {},
        };
        state.change(observed);
        state.journals = [observed];
        if (state.loseReply)
          throw new Error("Synthetic lost response after receiver commit");
        response = { JournalEntry: observed };
      } else {
        state.reads++;
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/companyinfo/12345"))
          response = { CompanyInfo: { Country: state.company } };
        else if (path.endsWith("/preferences"))
          response = {
            Preferences: {
              CurrencyPrefs: { HomeCurrency: { value: state.homeCurrency } },
            },
          };
        else if (path.includes("/account/"))
          response = {
            Account: { Id: path.split("/").at(-1), ...state.account },
          };
        else {
          const query = new URL(String(url)).searchParams.get("query");
          assert.match(
            query!,
            /^select \* from JournalEntry where DocNumber = 'DJ-[a-f0-9]{18}' maxresults 2$/,
          );
          response = {
            QueryResponse: state.query ?? {
              JournalEntry: state.journals,
              totalCount: state.journals.length,
            },
          };
        }
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  return state;
}
const adapter = (
  guard: ConstructorParameters<
    typeof QuickBooksStockJournalAdapter
  >[2] = () => {},
) =>
  new QuickBooksStockJournalAdapter(
    "12345",
    async () => "synthetic-token",
    guard,
    true,
  );
function changeSource(
  intent: StockJournalIntent,
  change: (document: any) => void,
) {
  const result = structuredClone(intent),
    document = JSON.parse(result.source.bytes);
  change(document);
  result.source.bytes = canonical(document) + "\n";
  result.source.hash = digest(result.source.bytes);
  return result;
}

for (const region of ["CA", "US"] as const) {
  test(`stock journal ${region} preserves actual reviewed file and receiver projections`, async (t) => {
    const { f, intent, effect } = journal(t, region),
      state = receiver(t, region),
      phases: string[] = [];
    const original = f.app.integration.costs.source(f.actor);
    let fenced = 0;
    const result = await adapter((_e, phase) => {
      phases.push(phase);
    }).execute(effect, () => {
      fenced++;
    });
    assert.equal(result.reference, "999");
    assert.equal(result.result.debit, 18000);
    assert.equal(result.result.credit, 18000);
    assert.equal(result.result.sourceHash, intent.source.hash);
    assert.equal(fenced, 1);
    assert.equal(state.writes, 1);
    assert.equal(phases.at(-1), "write");
    assert.equal(state.body!.TxnDate, intent.postingDate);
    assert.equal(
      state.body!.CurrencyRef.value,
      region === "CA" ? "CAD" : "USD",
    );
    assert.equal(
      state.body!.GlobalTaxCalculation,
      region === "CA" ? "TaxExcluded" : undefined,
    );
    assert.equal(state.body!.Line.length, 6);
    assert.equal(state.body!.TotalAmt, undefined);
    assert.deepEqual(f.app.integration.costs.source(f.actor), original);
    assert.equal(
      f.app.integration.costs.download(
        f.actor,
        JSON.parse(intent.source.bytes).packetId,
      ).bytes,
      intent.source.bytes,
    );
  });
}
for (const leg of ["reversal", "replacement"] as const) {
  test(`stock journal ${leg} extracts exact independently approved correction`, async (t) => {
    const { intent, effect } = journal(t, "CA", leg),
      state = receiver(t);
    await adapter().execute(effect, () => {});
    const rows = JSON.parse(intent.source.bytes)[leg];
    assert.equal(state.body!.TxnDate, "2026-10-03");
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index],
        sent = state.body!.Line[index];
      assert.equal(sent.Amount, (row.debit || row.credit) / 100);
      assert.equal(
        sent.JournalEntryLineDetail.PostingType,
        row.debit ? "Debit" : "Credit",
      );
      assert.equal(
        sent.JournalEntryLineDetail.AccountRef.value,
        intent.accounts.find((a) => a.sourceAccount === row.account)!.accountId,
      );
    }
  });
}
test("unposted corrections allow replacement but never synthesize a reversal", (t) => {
  const { intent } = journal(t, "CA", "replacement", "unposted");
  assert.doesNotThrow(() => stockJournalIntent(intent));
  assert.throws(() => stockJournalIntent({ ...intent, leg: "reversal" }));
});
test("journal file validation refuses changed bytes, scope, dates, mappings and money", (t) => {
  const { intent } = journal(t);
  for (const changed of [
    { ...intent, source: { ...intent.source, hash: "0".repeat(64) } },
    { ...intent, organizationId: "other" },
    { ...intent, realmId: "../other" },
    { ...intent, postingDate: "2026-02-30" },
    { ...intent, closedThrough: intent.postingDate },
    { ...intent, postingDate: "2099-01-01" },
    { ...intent, accounts: [] },
    { ...intent, accounts: [...intent.accounts, intent.accounts[0]!] },
    {
      ...intent,
      accounts: intent.accounts.map((a) => ({ ...a, accountId: "10" })),
    },
    changeSource(intent, (d) => {
      d.reviewHash = "bad";
    }),
    changeSource(intent, (d) => {
      delete d.reviewedBy;
    }),
    changeSource(intent, (d) => {
      d.currency = "USD";
    }),
    changeSource(intent, (d) => {
      d.report.issues = ["Unresolved"];
    }),
    changeSource(intent, (d) => {
      d.report.debit++;
    }),
    changeSource(intent, (d) => {
      d.report.journal[0].credit = 1;
    }),
    changeSource(intent, (d) => {
      d.report.journal[0].debit = -1;
    }),
    changeSource(intent, (d) => {
      d.report.journal[0].debit = 1.5;
    }),
    changeSource(intent, (d) => {
      d.report.journal[0].debit = Number.MAX_SAFE_INTEGER;
    }),
    changeSource(intent, (d) => {
      d.report.journal[0].date = "2099-01-01";
    }),
    changeSource(intent, (d) => {
      d.report.journal[0].entity = "unexpected";
    }),
  ])
    assert.throws(() => stockJournalIntent(changed));
});
test("original multi-date journals select one balanced date without redating or aggregating", async (t) => {
  const { intent, effect } = journal(t),
    changed = changeSource(intent, (d) => {
      d.report.journal[0].date = "2099-01-01";
      d.report.journal[1].date = "2099-01-01";
    });
  effect.payload = canonical(stockJournalIntent(changed));
  const state = receiver(t);
  const result = await adapter().execute(effect, () => {});
  assert.equal(state.body!.Line.length, 4);
  assert.equal(result.result.debit, 12000);
  effect.payload = canonical(
    stockJournalIntent({ ...changed, postingDate: "2099-01-01" }),
  );
  state.journals = [];
  const future = await adapter().execute(effect, () => {});
  assert.equal(state.body!.Line.length, 2);
  assert.equal(state.body!.TxnDate, "2099-01-01");
  assert.equal(future.result.debit, 6000);
});
test("disabled/missing fence/current authority/scope refuse before provider or credential IO", async (t) => {
  const { effect } = journal(t),
    state = receiver(t);
  let tokens = 0;
  const token = async () => {
    tokens++;
    return "synthetic-token";
  };
  await assert.rejects(
    new QuickBooksStockJournalAdapter("12345", token, () => {}).execute(
      effect,
      () => {},
    ),
    { code: "PROVIDER_DISABLED" },
  );
  await assert.rejects(adapter().execute(effect), {
    code: "JOURNAL_AUTHORITY",
  });
  await assert.rejects(
    new QuickBooksStockJournalAdapter(
      "12345",
      token,
      () => {
        throw new DomainError(
          "RESIDENCY_BLOCKED",
          "Synthetic organization refusal",
        );
      },
      true,
    ).lookup(effect),
    { code: "RESIDENCY_BLOCKED" },
  );
  await assert.rejects(
    adapter().execute({ ...effect, org_id: "other" }, () => {}),
    { code: "JOURNAL_SCOPE" },
  );
  await assert.rejects(adapter().lookup({ ...effect, kind: "accounting" }), {
    code: "JOURNAL_INPUT",
  });
  assert.equal(tokens, 0);
  assert.equal(state.reads, 0);
  assert.equal(state.writes, 0);
});
test("refreshed authority and final native write fence can refuse after preflight", async (t) => {
  const { effect } = journal(t),
    state = receiver(t);
  await assert.rejects(
    adapter((_e, phase) => {
      if (phase === "write")
        throw new DomainError(
          "RESIDENCY_BLOCKED",
          "Synthetic withdrawn organization choice",
        );
    }).execute(effect, () => {}),
    { code: "RESIDENCY_BLOCKED" },
  );
  assert.ok(state.reads > 0);
  assert.equal(state.writes, 0);
  await assert.rejects(
    adapter().execute(effect, () => {
      throw new DomainError("LEASE_EXPIRED", "Synthetic lease lost");
    }),
    { code: "LEASE_EXPIRED" },
  );
  assert.equal(state.writes, 0);
});
test("an asynchronous native write fence cannot authorize a POST", async (t) => {
  const { effect } = journal(t),
    state = receiver(t);
  for (const fence of [
    () => Promise.resolve(),
    () => Promise.reject(new Error("Synthetic late fence refusal")),
  ]) {
    await assert.rejects(adapter().execute(effect, fence), {
      code: "JOURNAL_AUTHORITY",
    });
    assert.equal(state.writes, 0);
  }
});
test("locale/home currency/inactive/control/foreign accounts refuse before posting", async (t) => {
  const { effect } = journal(t),
    state = receiver(t);
  state.company = "US";
  await assert.rejects(
    adapter().execute(effect, () => {}),
    { code: "JOURNAL_REALM" },
  );
  state.company = "CA";
  state.homeCurrency = "USD";
  await assert.rejects(
    adapter().execute(effect, () => {}),
    { code: "JOURNAL_REALM" },
  );
  state.homeCurrency = "CAD";
  for (const account of [
    { Active: false, AccountType: "Other Current Asset" },
    { Active: true, AccountType: "Accounts Receivable" },
    { Active: true, AccountType: "Accounts Payable" },
    { Active: true, AccountType: "Bank" },
    {
      Active: true,
      AccountType: "Other Current Asset",
      CurrencyRef: { value: "USD" },
    },
    { Id: "other", Active: true, AccountType: "Other Current Asset" },
  ]) {
    state.account = account;
    await assert.rejects(
      adapter().execute(effect, () => {}),
      { code: "JOURNAL_ACCOUNT" },
    );
  }
  assert.equal(state.writes, 0);
});
test("lost reply reconciles exact existing journal without another write", async (t) => {
  const { effect } = journal(t),
    state = receiver(t),
    client = adapter();
  state.loseReply = true;
  await assert.rejects(
    client.execute(effect, () => {}),
    /lost response/,
  );
  assert.equal(state.writes, 1);
  assert.equal((await client.lookup(effect))!.reference, "999");
  assert.equal(
    (
      await client.execute(effect, () => {
        assert.fail("Existing journal must not send");
      })
    ).reference,
    "999",
  );
  assert.equal(state.writes, 1);
  state.journals = [];
  assert.equal(await client.lookup(effect), null);
  assert.equal(state.writes, 1);
});
test("reconciliation rejects altered/duplicate/partial journals and only reads", async (t) => {
  const { effect } = journal(t),
    state = receiver(t),
    client = adapter();
  await client.execute(effect, () => {});
  const valid = structuredClone(state.journals[0]) as Record<string, any>;
  for (const change of [
    (v: any) => {
      v.Id = "bad";
    },
    (v: any) => {
      v.SyncToken = 0;
    },
    (v: any) => {
      v.DocNumber = "other";
    },
    (v: any) => {
      v.PrivateNote = "other";
    },
    (v: any) => {
      v.TxnDate = "2099-01-01";
    },
    (v: any) => {
      v.CurrencyRef.value = "USD";
    },
    (v: any) => {
      v.TotalAmt = 180;
    },
    (v: any) => {
      v.HomeTotalAmt = 180;
    },
    (v: any) => {
      v.ExchangeRate = 2;
    },
    (v: any) => {
      v.Adjustment = true;
    },
    (v: any) => {
      v.HomeCurrencyAdjustment = true;
    },
    (v: any) => {
      v.TxnTaxDetail = { TotalTax: 1 };
    },
    (v: any) => {
      v.GlobalTaxCalculation = "TaxInclusive";
    },
    (v: any) => {
      v.LinkedTxn = [{ TxnId: "1" }];
    },
    (v: any) => {
      v.Line.pop();
    },
    (v: any) => {
      v.Line[0].Amount++;
    },
    (v: any) => {
      v.Line[0].Amount = "60";
    },
    (v: any) => {
      v.Line[0].JournalEntryLineDetail.AccountRef.value = "900";
    },
    (v: any) => {
      v.Line[0].JournalEntryLineDetail.PostingType = "Credit";
    },
    (v: any) => {
      v.Line[0].Description = "other";
    },
    (v: any) => {
      v.Line[0].JournalEntryLineDetail.Entity = { EntityRef: { value: "1" } };
    },
    (v: any) => {
      v.Line[0] = structuredClone(v.Line[1]);
    },
    (v: any) => {
      v.DepartmentRef = { value: "1" };
    },
    (v: any) => {
      v.sparse = true;
    },
  ]) {
    const changed = structuredClone(valid);
    change(changed);
    state.journals = [changed];
    await assert.rejects(client.lookup(effect));
  }
  state.journals = [valid, valid];
  await assert.rejects(client.lookup(effect), { code: "JOURNAL_DUPLICATE" });
  for (const query of [
    { JournalEntry: null },
    { JournalEntry: [], totalCount: 1 },
    { error: "missing authority" },
  ]) {
    state.query = query;
    await assert.rejects(client.lookup(effect));
  }
  state.query = null;
  state.journals = [{ ...valid, Line: [...valid.Line].reverse() }];
  assert.equal((await client.lookup(effect))!.reference, "999");
  assert.equal(state.writes, 1);
});
test("caller mutation during token wait cannot change source, realm or write identity", async (t) => {
  const { effect } = journal(t),
    state = receiver(t);
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  let first = true;
  const client = new QuickBooksStockJournalAdapter(
    "12345",
    async (frozen) => {
      assert.ok(Object.isFrozen(frozen));
      if (first) {
        first = false;
        entered();
        await waiting;
      }
      return "synthetic-token";
    },
    () => {},
    true,
  );
  const operation = client.execute(effect, () => {});
  await started;
  effect.id = "other";
  effect.org_id = "other";
  effect.payload = "{}";
  release();
  assert.equal((await operation).reference, "999");
  assert.equal(state.writes, 1);
  assert.match(state.body!.PrivateNote, /synthetic-journal-effect/);
});

test("authority withdrawal during credential refresh refuses the next fetch", async (t) => {
  const { effect } = journal(t),
    state = receiver(t);
  let allowed = true;
  const client = new QuickBooksStockJournalAdapter(
    "12345",
    async () => {
      allowed = false;
      return "synthetic-token";
    },
    () => {
      if (!allowed)
        throw new DomainError(
          "RESIDENCY_BLOCKED",
          "Synthetic withdrawn consent",
        );
    },
    true,
  );
  await assert.rejects(client.lookup(effect), { code: "RESIDENCY_BLOCKED" });
  assert.equal(state.reads, 0);
  assert.equal(state.writes, 0);
});

test("invalid tokens and failed/malformed provider responses are never confirmed or retried", async (t) => {
  const { effect } = journal(t),
    state = receiver(t);
  for (const token of ["", "synthetic\r\ninvalid"]) {
    await assert.rejects(
      new QuickBooksStockJournalAdapter(
        "12345",
        async () => token,
        () => {},
        true,
      ).lookup(effect),
      { code: "PROVIDER_CREDENTIAL" },
    );
  }
  assert.equal(state.reads, 0);
  for (const reply of [
    new Response("failure", { status: 503 }),
    new Response("not JSON", { status: 200 }),
    new Response("{}", { status: 200 }),
  ]) {
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return reply;
    });
    await assert.rejects(adapter().lookup(effect));
    assert.equal(requests, 1);
  }
});

test("unsupported and oversized payloads refuse before provider IO", async (t) => {
  const { intent, effect } = journal(t),
    state = receiver(t);
  for (const invalid of [
    { ...intent, version: 2 },
    { ...intent, extra: true },
    { ...intent, source: { ...intent.source, bytes: " ".repeat(2_000_001) } },
    {
      ...intent,
      accounts: intent.accounts.map((a) => ({ ...a, accountId: "10' OR 1=1" })),
    },
    { ...intent, source: { bytes: "{}", hash: digest("{}") } },
  ])
    await assert.rejects(
      adapter().execute({ ...effect, payload: canonical(invalid) }, () => {}),
    );
  await assert.rejects(adapter().lookup({ ...effect, id: "a".repeat(51) }));
  await assert.rejects(
    adapter().lookup({ ...effect, payload: " ".repeat(4_000_001) }),
  );
  const tooMany = changeSource(intent, (document) => {
    document.report.journal = Array.from({ length: 167 }, () =>
      structuredClone(document.report.journal),
    ).flat();
    document.report.debit *= 167;
    document.report.credit *= 167;
  });
  assert.throws(() => stockJournalIntent(tooMany), { code: "JOURNAL_SOURCE" });
  assert.equal(state.reads, 0);
  assert.equal(state.writes, 0);
});

test("a mismatched create reply stays unconfirmed and reconciliation never resends", async (t) => {
  const { effect } = journal(t),
    state = receiver(t),
    client = adapter();
  state.change = (body) => {
    body.Line[0].Amount += 1;
  };
  await assert.rejects(
    client.execute(effect, () => {}),
    { code: "JOURNAL_RESPONSE" },
  );
  await assert.rejects(client.lookup(effect), { code: "JOURNAL_RESPONSE" });
  assert.equal(state.writes, 1);
});
