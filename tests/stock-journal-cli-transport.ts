// Synthetic sandbox boundary for protected child-process commands. No network.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
let writes = 0;
let reads = 0;
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(String(url));
  assert.equal(path.host, "sandbox-quickbooks.api.intuit.com");
  assert.ok(path.pathname.startsWith("/v3/company/12345/"));
  assert.equal(options.redirect, "error");
  assert.ok(options.signal);
  options.signal.throwIfAborted();
  assert.equal(
    new Headers(options.headers).get("Authorization"),
    "Bearer synthetic-journal-access",
  );
  const file = process.env.SYNTHETIC_JOURNAL_FILE!;
  let body;
  if (options.method === "POST") {
    assert.equal(path.pathname, "/v3/company/12345/journalentry");
    assert.ok(path.searchParams.get("requestid"));
    writes++;
    const journal = {
      ...JSON.parse(String(options.body)),
      Id: "501",
      SyncToken: "0",
      domain: "QBO",
      sparse: false,
    };
    writeFileSync(file, JSON.stringify(journal), { mode: 0o600 });
    if (process.env.SYNTHETIC_LOST_REPLY === "true")
      throw new Error("sensitive-provider-body");
    body = { JournalEntry: journal };
  } else {
    assert.equal(options.method ?? "GET", "GET");
    reads++;
    if (process.env.SYNTHETIC_INTERRUPT === "true") {
      setImmediate(() => process.kill(process.pid, "SIGTERM"));
      await new Promise<never>((_resolve, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(new Error("sensitive-provider-body")),
          { once: true },
        );
      });
    }
    if (path.pathname.endsWith("/companyinfo/12345"))
      body = { CompanyInfo: { Country: process.env.DATA_REGION } };
    else if (path.pathname.endsWith("/preferences"))
      body = {
        Preferences: {
          CurrencyPrefs: {
            HomeCurrency: {
              value: process.env.DATA_REGION === "CA" ? "CAD" : "USD",
            },
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
      const journal = existsSync(file)
        ? JSON.parse(readFileSync(file, "utf8"))
        : null;
      body = {
        QueryResponse: {
          JournalEntry:
            journal?.DocNumber === query.split("'")[1] ? [journal] : [],
        },
      };
    }
  }
  return Response.json(body);
};
process.on("beforeExit", () => {
  assert.equal(writes, Number(process.env.SYNTHETIC_EXPECT_WRITES ?? "0"));
  if (process.env.SYNTHETIC_EXPECT_READS === "none") assert.equal(reads, 0);
  else if (process.env.SYNTHETIC_EXPECT_READS !== "allowed")
    assert.equal(reads, Number(process.env.SYNTHETIC_EXPECT_READS));
});
