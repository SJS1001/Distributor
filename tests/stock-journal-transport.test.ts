// Synthetic sandbox/refresh responses only. No provider I/O or qualification.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { canonical, type Actor } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import {
  ProviderCredentials,
  type TokenBundle,
} from "../src/server/provider-credentials.ts";
import { QuickBooksStockJournalAdapter } from "../src/server/quickbooks-stock-journal.ts";
import { StockJournalTransport } from "../src/server/stock-journal-transport.ts";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";
import type { Effect } from "../src/server/integration.ts";

const encryptionKey = "ab".repeat(32);
function bundle(expired = false): TokenBundle {
  return {
    accessToken: "synthetic-organization-access",
    refreshToken: "synthetic-organization-refresh",
    accessExpiresAt: Date.now() + (expired ? -1 : 3_600_000),
    refreshExpiresAt: Date.now() + 100 * 86_400_000,
    hardExpiresAt: Date.now() + 180 * 86_400_000,
  };
}
function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  correction = false,
  install = true,
) {
  const f = journalFixture(t, region, correction),
    vault = new ProviderCredentials(
      f.f.app.database,
      f.f.app.platform,
      f.f.app.identity,
      encryptionKey,
    );
  t.after(() => vault.close());
  const binding = {
    id: f.make().bindingId,
    orgId: f.f.actor.orgId,
    workerUserId: f.f.actor.id,
    realm: f.make().realm,
    clientId: "synthetic-client",
  };
  if (install) vault.ledger.install(binding, 0, bundle(), f.make().authority);
  const transport = new StockJournalTransport(
    f.j,
    vault,
    binding,
    "synthetic-secret",
    true,
  );
  return { ...f, vault, binding, transport };
}
function network(t: TestContext, region: "CA" | "US" = "CA") {
  const state = {
    writes: 0,
    reads: 0,
    refreshes: 0,
    journals: [] as Record<string, any>[],
    lostReply: false,
    before: async (_path: string, _options: RequestInit) => {},
    after: async (_path: string, _body: Record<string, any>) => {},
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options: RequestInit = {}) => {
      const path = new URL(String(url));
      assert.ok(options.signal);
      assert.equal(options.redirect, "error");
      options.signal.throwIfAborted();
      await state.before(path.pathname, options);
      options.signal.throwIfAborted();
      let body: Record<string, any>;
      if (path.host === "oauth.platform.intuit.com") {
        assert.equal(path.pathname, "/oauth2/v1/tokens/bearer");
        state.refreshes++;
        body = {
          access_token: "synthetic-organization-access",
          refresh_token: "synthetic-next-refresh",
          token_type: "bearer",
          expires_in: 3600,
          x_refresh_token_expires_in: 100 * 86400,
        };
      } else {
        assert.equal(path.host, "sandbox-quickbooks.api.intuit.com");
        assert.ok(path.pathname.startsWith("/v3/company/12345/"));
        assert.equal(
          (options.headers as Record<string, string>).Authorization,
          "Bearer synthetic-organization-access",
        );
        if (options.method === "POST") {
          state.writes++;
          assert.ok(path.searchParams.get("requestid"));
          const journal = {
            ...JSON.parse(String(options.body)),
            Id: String(500 + state.writes),
            SyncToken: "0",
            domain: "QBO",
            sparse: false,
          };
          state.journals.push(journal);
          body = { JournalEntry: journal };
        } else {
          state.reads++;
          if (path.pathname.endsWith("/companyinfo/12345"))
            body = { CompanyInfo: { Country: region } };
          else if (path.pathname.endsWith("/preferences"))
            body = {
              Preferences: {
                CurrencyPrefs: {
                  HomeCurrency: { value: region === "CA" ? "CAD" : "USD" },
                },
              },
            };
          else if (path.pathname.includes("/account/"))
            body = {
              Account: {
                Id: path.pathname.split("/").at(-1),
                Active: true,
                AccountType: "Other Current Asset",
              },
            };
          else {
            assert.equal(path.pathname, "/v3/company/12345/query");
            const query = path.searchParams.get("query")!;
            assert.match(
              query,
              /^select \* from JournalEntry where DocNumber = 'DJ-[a-f0-9]{18}' maxresults 2$/,
            );
            const reference = query.split("'")[1];
            body = {
              QueryResponse: {
                JournalEntry: state.journals.filter(
                  (j) => j.DocNumber === reference,
                ),
              },
            };
          }
        }
      }
      await state.after(path.pathname, body);
      if (state.lostReply && path.pathname.endsWith("/journalentry"))
        throw new Error("Synthetic lost reply with synthetic secret material");
      return Response.json(body);
    },
  );
  return state;
}
function state(
  f: ReturnType<typeof setup>,
  journalId: string,
  actor: Actor = f.f.actor,
) {
  return f.j.detail(actor, journalId);
}
for (const region of ["CA", "US"] as const) {
  test(`${region} explicit transport posts the exact native journal once without accepting the source`, async (t) => {
    const f = setup(t, region),
      n = network(t, region),
      a = f.approve();
    const before = f.f.app.integration.costs.download(f.f.actor, f.original.id);
    assert.deepEqual(await f.transport.run(f.f.actor, a.id, "write"), {
      journalId: a.id,
      outcome: "posted",
      reference: "501",
    });
    const posted = state(f, a.id);
    assert.equal(posted.state, "posted");
    assert.equal(posted.dispatched, true);
    assert.equal(posted.observations.length, 1);
    assert.equal(n.writes, 1);
    assert.equal(n.refreshes, 0);
    assert.deepEqual(
      f.f.app.integration.costs.download(f.f.actor, f.original.id),
      before,
    );
    const calls = n.reads;
    assert.deepEqual(await f.transport.run(f.f.actor, a.id, "write"), {
      journalId: a.id,
      outcome: "idle",
    });
    assert.equal(n.writes, 1);
    assert.equal(n.reads, calls);
  });
}
test("disabled transport refuses before native claim or credential access", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  const disabled = new StockJournalTransport(
    f.j,
    f.vault,
    f.binding,
    "synthetic-secret",
  );
  await assert.rejects(disabled.run(f.f.actor, a.id, "write"), {
    code: "PROVIDER_DISABLED",
  });
  assert.equal(state(f, a.id).state, "pending");
  assert.equal(n.reads + n.writes + n.refreshes, 0);
});
test("missing organization credentials refuse before claiming even with a buyer binding", async (t) => {
  const f = setup(t, "CA", false, false),
    a = f.approve(),
    n = network(t);
  f.vault.install(f.binding, 0, bundle());
  await assert.rejects(f.transport.run(f.f.actor, a.id, "write"), {
    code: "CREDENTIAL_RECONNECT",
  });
  assert.equal(state(f, a.id).state, "pending");
  assert.equal(n.reads + n.writes + n.refreshes, 0);
});
for (const field of ["id", "realm", "orgId", "workerUserId"] as const) {
  test(`transport refuses mismatched ${field} before changing ownership`, async (t) => {
    const f = setup(t),
      a = f.approve(),
      n = network(t);
    const binding = {
      ...f.binding,
      [field]: field === "realm" ? "6789" : "synthetic-wrong",
    };
    const transport = new StockJournalTransport(
      f.j,
      f.vault,
      binding,
      "synthetic-secret",
      true,
    );
    await assert.rejects(transport.run(f.f.actor, a.id, "write"), {
      code: "JOURNAL_BINDING",
    });
    assert.equal(state(f, a.id).state, "pending");
    assert.equal(n.reads + n.writes + n.refreshes, 0);
  });
}
test("caller configuration mutation cannot change the frozen transport binding", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  f.binding.realm = "6789";
  f.binding.id = "mutated-binding";
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "write")).outcome,
    "posted",
  );
  assert.equal(n.writes, 1);
});
test("an atomic versioned token receipt survives a later installation without borrowing its revision", async (t) => {
  const f = setup(t),
    receipt = await f.vault.ledger.accessVersioned(
      f.binding,
      "synthetic-secret",
      f.make().authority,
      1,
    );
  const revision = f.vault.ledger.status(f.binding).revision;
  f.vault.ledger.install(
    f.binding,
    revision,
    { ...bundle(), accessToken: "synthetic-replacement" },
    f.make().authority,
  );
  assert.equal(receipt.revision, revision);
  assert.equal(receipt.accessToken, "synthetic-organization-access");
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(f.vault.ledger.status(f.binding).revision, revision + 1);
});
test("one token refresh advances transport authority atomically then sends one journal", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  f.vault.ledger.install(f.binding, 1, bundle(true), f.make().authority);
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "write")).outcome,
    "posted",
  );
  assert.equal(n.refreshes, 1);
  assert.equal(n.writes, 1);
  assert.equal(f.vault.ledger.status(f.binding).revision, 3);
});
test("replacement during refresh refuses the late token and preserves the replacement", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  f.vault.ledger.install(f.binding, 1, bundle(true), f.make().authority);
  n.after = async (path) => {
    if (path.includes("tokens/bearer"))
      f.vault.ledger.install(f.binding, 2, bundle(), f.make().authority);
  };
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "write")).outcome,
    "unknown",
  );
  assert.equal(n.writes + n.reads, 0);
  assert.equal(n.refreshes, 1);
  assert.equal(f.vault.ledger.status(f.binding).state, "ready");
  assert.equal(f.vault.ledger.status(f.binding).revision, 3);
  assert.equal(state(f, a.id).dispatched, false);
});
test("credential replacement during a preliminary read stops the native operation before dispatch", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  n.after = async (path) => {
    if (path.endsWith("companyinfo/12345"))
      f.vault.ledger.install(f.binding, 1, bundle(), f.make().authority);
  };
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "write")).outcome,
    "unknown",
  );
  assert.equal(n.writes, 0);
  assert.equal(state(f, a.id).state, "unknown");
  assert.equal(state(f, a.id).dispatched, false);
});
test("credential disable after provider posting retains uncertainty until explicit reconnection and lookup", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  n.after = async (path) => {
    if (path.endsWith("journalentry")) f.vault.ledger.disable(f.binding, 1);
  };
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "write")).outcome,
    "unknown",
  );
  assert.equal(n.writes, 1);
  assert.equal(state(f, a.id).state, "unknown");
  assert.equal(state(f, a.id).externalId, null);
  f.vault.ledger.install(f.binding, 2, bundle(), f.make().authority);
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "lookup")).outcome,
    "posted",
  );
  assert.equal(n.writes, 1);
});
test("lost posting reply is retained without secrets and reconciled by one explicit read-only operation", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  n.lostReply = true;
  const result = await f.transport.run(f.f.actor, a.id, "write");
  assert.deepEqual(result, {
    journalId: a.id,
    outcome: "unknown",
    reason: "transport-uncertain",
  });
  assert.ok(!JSON.stringify(state(f, a.id).observations).includes("secret"));
  const reads = n.reads;
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "lookup")).outcome,
    "posted",
  );
  assert.equal(n.writes, 1);
  assert.equal(n.reads, reads + 1);
  assert.deepEqual(
    state(f, a.id).observations.map((o) => o.body.outcome),
    ["posted", "unknown"],
  );
});
test("lookup absence stays unknown and never authorizes another write or cancellation", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  n.lostReply = true;
  await f.transport.run(f.f.actor, a.id, "write");
  n.journals = [];
  assert.deepEqual(await f.transport.run(f.f.actor, a.id, "lookup"), {
    journalId: a.id,
    outcome: "unknown",
    reason: "lookup-miss",
  });
  await assert.rejects(f.transport.run(f.f.actor, a.id, "write"), {
    code: "JOURNAL_STATE",
  });
  assert.equal(state(f, a.id).state, "unknown");
  assert.equal(n.writes, 1);
});
test("existing receiver match before dispatch requires a separately claimed native lookup", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  // Seed an independently existing synthetic receiver journal through the actual
  // protocol projection, with no native delivery or external provider involved.
  const effect: Effect = {
    id: a.id,
    org_id: f.f.actor.orgId,
    account_id: "",
    provider: "quickbooks",
    kind: "stock-cost-journal",
    reference: a.requestRef,
    payload: canonical(a.plan.intent),
    state: "running",
    external_ref: null,
    result: null,
    created_at: a.createdAt,
    residency_version: 1,
    started_at: Date.now(),
    error: null,
  };
  const seed = new QuickBooksStockJournalAdapter(
    f.binding.realm,
    async () => "synthetic-organization-access",
    () => {},
    true,
  );
  await seed.execute(effect, () => {});
  assert.deepEqual(await f.transport.run(f.f.actor, a.id, "write"), {
    journalId: a.id,
    outcome: "unknown",
    reason: "existing-requires-lookup",
  });
  assert.equal(state(f, a.id).dispatched, false);
  assert.equal(state(f, a.id).externalId, null);
  assert.equal(n.writes, 1);
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "lookup")).outcome,
    "posted",
  );
  assert.equal(n.writes, 1);
});
for (const boundary of ["preclaim", "read", "posted"] as const) {
  test(`interruption at ${boundary} stops further requests and retains the correct native state`, async (t) => {
    const f = setup(t),
      a = f.approve(),
      n = network(t),
      controller = new AbortController();
    if (boundary === "preclaim") controller.abort();
    n.after = async (path) => {
      if (
        (boundary === "read" && path.endsWith("companyinfo/12345")) ||
        (boundary === "posted" && path.endsWith("journalentry"))
      )
        controller.abort();
    };
    if (boundary === "preclaim")
      await assert.rejects(
        f.transport.run(f.f.actor, a.id, "write", controller.signal),
        { code: "JOURNAL_INTERRUPTED" },
      );
    else
      assert.deepEqual(
        await f.transport.run(f.f.actor, a.id, "write", controller.signal),
        { journalId: a.id, outcome: "unknown", reason: "interrupted" },
      );
    assert.equal(
      state(f, a.id).state,
      boundary === "preclaim" ? "pending" : "unknown",
    );
    assert.equal(n.writes, boundary === "posted" ? 1 : 0);
  });
}
for (const changed of ["withdrawal", "role", "hold", "policy"] as const) {
  test(`late ${changed} refuses the posting response and retains uncertainty`, async (t) => {
    const f = setup(t),
      a = f.approve(),
      n = network(t);
    n.after = async (path) => {
      if (!path.endsWith("journalentry")) return;
      if (changed === "withdrawal") {
        const r = f.f.app.identity.organizationResidency;
        r.choose(f.f.actor, "transport-withdraw", {
          region: "CA",
          revision: r.current(f.f.actor).choice.revision,
          mode: "strict",
          realm: null,
          acknowledgment: "Synthetic withdrawal",
        });
      } else if (changed === "role")
        f.f.app.database
          .owned("iam")
          .run("UPDATE iam_users SET role='support' WHERE id=?", f.f.actor.id);
      else if (changed === "hold")
        f.f.app.platform.isolateRestore(
          "a".repeat(64),
          new Date().toISOString(),
        );
      else {
        const policy = f.c.policy(f.f.actor)!;
        f.c.configure(f.f.actor, "transport-policy", {
          ...policy.input,
          closedThrough: "2099-01-01",
        });
      }
    };
    assert.equal(
      (await f.transport.run(f.f.actor, a.id, "write")).outcome,
      "unknown",
    );
    assert.equal(n.writes, 1);
    assert.equal(state(f, a.id, f.reviewer).state, "unknown");
    assert.equal(state(f, a.id, f.reviewer).externalId, null);
  });
}
test("a competing invocation cannot acquire an unexpired posting operation", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  let reached!: () => void, release!: () => void;
  const posted = new Promise<void>((r) => (reached = r)),
    wait = new Promise<void>((r) => (release = r));
  n.after = async (path) => {
    if (path.endsWith("journalentry")) {
      reached();
      await wait;
    }
  };
  const first = f.transport.run(f.f.actor, a.id, "write");
  await posted;
  try {
    assert.equal(
      (await f.transport.run(f.f.actor, a.id, "write")).outcome,
      "idle",
    );
  } finally {
    release();
  }
  assert.equal((await first).outcome, "posted");
  assert.equal(n.writes, 1);
});
test("expired posting response cannot overwrite a successor's posted lookup", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  let reached!: () => void, release!: () => void;
  const posted = new Promise<void>((r) => (reached = r)),
    wait = new Promise<void>((r) => (release = r));
  n.after = async (path) => {
    if (path.endsWith("journalentry")) {
      reached();
      await wait;
    }
  };
  const first = f.transport.run(f.f.actor, a.id, "write");
  await posted;
  const instant = Date.now();
  t.mock.method(Date, "now", () => instant + 121_000);
  try {
    assert.equal(
      (await f.transport.run(f.f.actor, a.id, "lookup")).outcome,
      "posted",
    );
  } finally {
    release();
  }
  await assert.rejects(first, { code: "JOURNAL_RETENTION" });
  assert.equal(state(f, a.id).state, "posted");
  assert.equal(n.writes, 1);
  assert.equal(state(f, a.id).observations.length, 2);
});
test("posting audit retention failure cannot falsely report a persisted outcome", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t),
    audit = f.f.app.platform.audit.bind(f.f.app.platform);
  t.mock.method(
    f.f.app.platform,
    "audit",
    (actor: Actor, action: string, object: string, detail: unknown) => {
      if (action === "accounting.journal.observed")
        throw new Error("Synthetic audit refusal");
      return audit(actor, action, object, detail);
    },
  );
  await assert.rejects(f.transport.run(f.f.actor, a.id, "write"), {
    code: "JOURNAL_RETENTION",
  });
  assert.equal(state(f, a.id).state, "running");
  assert.equal(state(f, a.id).externalId, null);
  assert.equal(state(f, a.id).observations.length, 0);
  assert.equal(n.writes, 1);
});
test("receiver line mismatch after posting retains uncertainty and refuses blind resend", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  n.after = async (path) => {
    if (path.endsWith("journalentry")) n.journals[0]!.Line[0].Amount += 1;
  };
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "write")).outcome,
    "unknown",
  );
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "lookup")).outcome,
    "unknown",
  );
  await assert.rejects(f.transport.run(f.f.actor, a.id, "write"), {
    code: "JOURNAL_STATE",
  });
  assert.equal(n.writes, 1);
  assert.equal(state(f, a.id).externalId, null);
});
test("correction replacement waits for native reversal and retains distinct receiver results", async (t) => {
  const f = setup(t, "CA", true),
    n = network(t),
    reversal = f.approve(),
    replacement = f.approve(f.make("replacement"), "transport-replacement");
  await assert.rejects(f.transport.run(f.f.actor, replacement.id, "write"), {
    code: "JOURNAL_REVERSAL_REQUIRED",
  });
  assert.equal(n.writes, 0);
  assert.equal(
    (await f.transport.run(f.f.actor, reversal.id, "write")).outcome,
    "posted",
  );
  assert.equal(
    (await f.transport.run(f.f.actor, replacement.id, "write")).outcome,
    "posted",
  );
  assert.equal(n.writes, 2);
  assert.notEqual(
    state(f, reversal.id).externalId,
    state(f, replacement.id).externalId,
  );
  assert.equal(
    f.c
      .outcomes(f.f.actor, f.selected.id)
      .legs.every((l) => l.current === null),
    true,
  );
});
test("restart preserves an uncertain transport operation and reconciles without resending", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  n.lostReply = true;
  await f.transport.run(f.f.actor, a.id, "write");
  f.vault.close();
  f.f.app.close();
  f.f.app = new Application(f.f.path, "CA", {
    eventReports: false,
    providerEncryptionKey: encryptionKey,
  });
  const transport = new StockJournalTransport(
    f.f.app.integration.costs.journals,
    f.f.app.providerCredentials,
    f.binding,
    "synthetic-secret",
    true,
  );
  assert.equal(
    (await transport.run(f.f.actor, a.id, "lookup")).outcome,
    "posted",
  );
  assert.equal(n.writes, 1);
  assert.equal(
    f.f.app.integration.costs.journals.detail(f.f.actor, a.id).observations
      .length,
    2,
  );
});

test("the credential version fence requires its own native database transaction", (t) => {
  const f = setup(t);
  assert.throws(
    () =>
      f.vault.ledger.assertVersionInTransaction(
        f.binding,
        f.make().authority,
        1,
      ),
    { code: "TRANSACTION" },
  );
  f.f.app.database.transaction(() =>
    f.vault.ledger.assertVersionInTransaction(f.binding, f.make().authority, 1),
  );
});
test("a vault from a different database connection cannot fence this journal transaction", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  const other = new Application(f.f.path, "CA", {
    eventReports: false,
    providerEncryptionKey: encryptionKey,
  });
  t.after(() => other.close());
  const transport = new StockJournalTransport(
    f.j,
    other.providerCredentials,
    f.binding,
    "synthetic-secret",
    true,
  );
  assert.equal(
    (await transport.run(f.f.actor, a.id, "write")).outcome,
    "unknown",
  );
  assert.equal(n.reads + n.writes + n.refreshes, 0);
  assert.equal(state(f, a.id).state, "unknown");
});
test("credential disable between preliminary guard and native dispatch is refused within the write transaction", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t),
    beforeWrite = f.j.beforeWrite.bind(f.j);
  t.mock.method(
    f.j,
    "beforeWrite",
    (...args: Parameters<typeof beforeWrite>) => {
      f.vault.ledger.disable(f.binding, 1);
      return beforeWrite(...args);
    },
  );
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "write")).outcome,
    "unknown",
  );
  assert.equal(n.writes, 0);
  assert.equal(state(f, a.id).dispatched, false);
});
test("credential replacement between preliminary guard and outcome retention is refused within the posting transaction", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t),
    posted = f.j.posted.bind(f.j);
  t.mock.method(f.j, "posted", (...args: Parameters<typeof posted>) => {
    f.vault.ledger.install(f.binding, 1, bundle(), f.make().authority);
    return posted(...args);
  });
  assert.equal(
    (await f.transport.run(f.f.actor, a.id, "write")).outcome,
    "unknown",
  );
  assert.equal(n.writes, 1);
  assert.equal(state(f, a.id).externalId, null);
  assert.equal(state(f, a.id).state, "unknown");
});
test("asynchronous additional authority cannot pass native guard, dispatch or retention", (t) => {
  const f = setup(t),
    a = f.approve(),
    lease = f.j.claim(f.f.actor, a.id, "write")!;
  const asynchronous = async () => {};
  assert.throws(() => f.j.guard(lease, asynchronous), {
    code: "JOURNAL_AUTHORITY",
  });
  assert.throws(() => f.j.beforeWrite(lease, asynchronous), {
    code: "JOURNAL_AUTHORITY",
  });
  assert.equal(state(f, a.id).dispatched, false);
  f.j.beforeWrite(lease);
  assert.throws(() => f.j.posted(lease, postedResult(lease), asynchronous), {
    code: "JOURNAL_AUTHORITY",
  });
  assert.equal(state(f, a.id).state, "running");
  assert.equal(state(f, a.id).externalId, null);
});
test("replacement between the preliminary guard and token access cannot masquerade as this operation's refresh", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t);
  const vault = { ledger: { ...f.vault.ledger } } as ProviderCredentials;
  const access = f.vault.ledger.accessVersioned;
  vault.ledger.accessVersioned = async (...args) => {
    f.vault.ledger.install(f.binding, 1, bundle(), f.make().authority);
    return access(...args);
  };
  const transport = new StockJournalTransport(
    f.j,
    vault,
    f.binding,
    "synthetic-secret",
    true,
  );
  assert.equal(
    (await transport.run(f.f.actor, a.id, "write")).outcome,
    "unknown",
  );
  assert.equal(n.reads + n.writes + n.refreshes, 0);
  assert.equal(state(f, a.id).dispatched, false);
  assert.equal(f.vault.ledger.status(f.binding).revision, 2);
});
test("the caller interruption signal aborts an actual in-flight mocked read without reaching posting", async (t) => {
  const f = setup(t),
    a = f.approve(),
    n = network(t),
    controller = new AbortController();
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => (reached = resolve));
  n.before = async (path, options) => {
    if (!path.endsWith("companyinfo/12345")) return;
    reached();
    await new Promise<void>((_resolve, reject) =>
      options.signal!.addEventListener(
        "abort",
        () => reject(new Error("Synthetic abort")),
        { once: true },
      ),
    );
  };
  const running = f.transport.run(f.f.actor, a.id, "write", controller.signal);
  await waiting;
  controller.abort();
  assert.deepEqual(await running, {
    journalId: a.id,
    outcome: "unknown",
    reason: "interrupted",
  });
  assert.equal(n.writes, 0);
  assert.equal(state(f, a.id).dispatched, false);
});
