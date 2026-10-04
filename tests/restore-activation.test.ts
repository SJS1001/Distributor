import { SCHEMA_VERSION } from "../src/server/schema.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import {
  captureRestoreCandidate,
  restoreApprovalMessage,
  type RestoreDossier,
} from "../src/server/restore-review.ts";
import {
  restoreReleaseApprovalMessage,
  type RestoreActivationAdapter,
  type RestoreControl,
  type RestoreReleaseInput,
} from "../src/server/restore-activation.ts";
import { type RestoreEvidenceManifest } from "../src/server/restore-evidence.ts";
import { providerNames } from "../src/shared/provider-choices.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import v16 from "./schema-version-sixteen.json" with { type: "json" };

function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  eventReports = false,
) {
  const f = fixture(t, { eventReports }, region);
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  chmodSync(f.path, 0o600);
  let at = Date.now();
  const root = join(dirname(f.path), "evidence");
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(
    join(root, "report"),
    "synthetic independently reconciled interval",
    { mode: 0o600 },
  );
  const evidence = {
    reference: "synthetic:report",
    sha256: digest("synthetic independently reconciled interval"),
  };
  const candidate = captureRestoreCandidate(f.path);
  const dossier: RestoreDossier = {
    version: 1,
    preparedBy: "preparer",
    preparedAt: new Date(at - 1000).toISOString(),
    expiresAt: new Date(at + 60000).toISOString(),
    candidate,
    source: {
      identity: "synthetic-source",
      logicalHash: digest("source"),
      durableCursor: "cutoff-43",
      auditSequence: 43,
      cutoff: evidence,
    },
    organizations: candidate.organizations.map((o) => ({
      orgId: o.id,
      inventory: evidence,
      billing: evidence,
      access: evidence,
      residency: evidence,
      providers: providerNames.map((provider) => ({
        provider,
        outcome: "not-used",
        evidence,
      })),
    })),
    operations: {
      fencing: evidence,
      routing: evidence,
      rollback: evidence,
      sourceWriters: [
        "source-app",
        "source-worker",
        "source-cli",
        "source-callback",
      ],
      candidateWriters: ["candidate-app", "candidate-worker"],
      rollbackMode: "source-before-effects-forward-recovery-after-effects",
      rpoMinutes: 15,
      rtoMinutes: 240,
    },
  };
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  let trust = pairs.map((p, i) => ({
    id: i ? "security" : "finance",
    role: i ? ("security" as const) : ("finance" as const),
    publicKey: p.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }));
  const approve = () =>
    trust.map((a, i) => ({
      signerId: a.id,
      role: a.role,
      dossierHash: digest(canonical(dossier)),
      signature: sign(
        null,
        Buffer.from(
          restoreApprovalMessage(digest(canonical(dossier)), a.id, a.role),
        ),
        pairs[i]!.privateKey,
      ).toString("base64"),
    }));
  const manifest: RestoreEvidenceManifest = {
    version: 1,
    root,
    files: [{ reference: evidence.reference, path: "report" }],
  };
  const input: RestoreReleaseInput = {
    id: "synthetic-release",
    dossier,
    approvals: approve(),
    manifest,
  };
  let route: "isolated" | "candidate" | "source" | "unknown" = "isolated",
    sourceFenced = false,
    candidateFenced = true,
    effects: "none" | "observed" | "unknown" = "none",
    settled = true;
  const calls: string[] = [];
  const adapter: RestoreActivationAdapter = {
    enabled: true,
    identity: "synthetic-only-v1",
    fence() {
      calls.push("fence");
      sourceFenced = true;
      candidateFenced = true;
    },
    routeCandidate() {
      calls.push("candidate");
      route = "candidate";
      candidateFenced = false;
    },
    stopCandidate() {
      calls.push("stop");
      candidateFenced = true;
      route = "isolated";
    },
    routeSource() {
      calls.push("source");
      route = "source";
      sourceFenced = false;
    },
    observe(c: RestoreControl) {
      return {
        releaseId: c.releaseId,
        binding: c.binding,
        token: "synthetic-fence-1",
        observedAt: at,
        validUntil: at + 1000,
        settled,
        sourceFenced,
        candidateFenced,
        route,
        sourceHash: dossier.source.logicalHash,
        sourceCursor: dossier.source.durableCursor,
        evidenceSetHash: c.evidenceSetHash,
        reconciliation: "complete",
        externalEffects: effects,
      };
    },
  };
  const configure = (app = f.app) =>
    app.platform.restore.configure(
      adapter,
      () => trust,
      () => at,
    );
  configure();
  const releaseApprovals = (binding: string) =>
    trust.map((a, i) => ({
      signerId: a.id,
      role: a.role,
      dossierHash: binding,
      signature: sign(
        null,
        Buffer.from(restoreReleaseApprovalMessage(binding, a.id, a.role)),
        pairs[i]!.privateKey,
      ).toString("base64"),
    }));
  const prepare = (value = input) => {
    const r = f.app.platform.restore.prepare(value);
    return f.app.platform.restore.approveRelease(
      r.id,
      releaseApprovals(r.binding),
    );
  };
  return {
    prepare,
    releaseApprovals,
    trust: () => trust,
    f,
    input,
    adapter,
    calls,
    configure,
    approve,
    clock: (value: number) => {
      at = value;
    },
    now: () => at,
    revoke: () => {
      trust = [];
    },
    effect: (value: typeof effects) => {
      effects = value;
    },
    unsettled: () => {
      settled = false;
    },
    mutate: () => {
      const db = new DatabaseSync(f.path);
      try {
        db.exec(
          "UPDATE iam_organizations SET name='synthetic post-cutoff edit'",
        );
      } finally {
        db.close();
      }
    },
  };
}

for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    test(`${region}/${reports} persistent release controls the real gate and restarts closed`, (t) => {
      const s = setup(t, region, reports),
        { f, input } = s,
        restore = f.app.platform.restore;
      const before = captureRestoreCandidate(f.path);
      assert.equal(s.prepare(input).state, "prepared");
      assert.deepEqual(
        captureRestoreCandidate(f.path),
        before,
        "release journal is separate from reviewed business state",
      );
      assert.throws(() => f.app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
      const release = restore.activate(input);
      assert.equal(release.state, "released");
      f.app.platform.assertProviderAccess();
      assert.equal(f.app.platform.recoveryHold(), null);
      const reopened = new Application(f.path, region, {
        eventReports: reports,
      });
      try {
        assert.equal(reopened.platform.restore.get(input.id).state, "released");
        assert.throws(() => reopened.platform.assertProviderAccess(), {
          code: "RECOVERY_HOLD",
        });
        s.configure(reopened);
        reopened.platform.assertProviderAccess();
        s.revoke();
        assert.throws(() => reopened.platform.assertProviderAccess(), {
          code: "RECOVERY_HOLD",
        });
      } finally {
        reopened.close();
      }
      const db = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(
          db.prepare("SELECT count(*) n FROM platform_recovery").get()!.n,
          1,
        );
      } finally {
        db.close();
      }
    });

test("default disabled rejects preparation before adapter IO", (t) => {
  const s = setup(t);
  Object.assign(s.adapter, { enabled: false });
  assert.throws(() => s.f.app.platform.restore.prepare(s.input), {
    code: "RESTORE_DISABLED",
  });
  assert.deepEqual(s.calls, []);
  assert.equal(s.f.app.platform.restore.current(), null);
});

test("unknown provider declaration and invalid signatures cannot prepare", (t) => {
  const s = setup(t);
  s.input.dossier.organizations[0]!.providers[0]!.outcome = "unknown";
  s.input.approvals = s.approve();
  assert.throws(() => s.f.app.platform.restore.prepare(s.input));
  assert.equal(s.f.app.platform.restore.current(), null);
  s.input.dossier.organizations[0]!.providers[0]!.outcome = "not-used";
  s.input.approvals[0]!.signature = "A".repeat(86) + "==";
  assert.throws(() => s.f.app.platform.restore.prepare(s.input), {
    code: "RESTORE_APPROVAL",
  });
  assert.deepEqual(s.calls, []);
});

for (const attack of [
  "candidate",
  "evidence",
  "trust",
  "expiry",
  "replacement",
  "backwards",
] as const)
  test(`${attack} changes retain a durable hold without routing`, (t) => {
    const s = setup(t),
      r = s.f.app.platform.restore;
    s.prepare();
    if (attack === "candidate") s.mutate();
    if (attack === "evidence")
      writeFileSync(join(s.input.manifest.root, "report"), "tampered");
    if (attack === "trust") s.revoke();
    if (attack === "expiry") s.clock(Date.parse(s.input.dossier.expiresAt));
    if (attack === "backwards") s.clock(s.now() - 10);
    if (attack === "replacement") {
      renameSync(s.f.path, s.f.path + ".retained");
      copyFileSync(s.f.path + ".retained", s.f.path);
    }
    assert.throws(() => r.activate(s.input));
    assert.equal(r.get(s.input.id).state, "held");
    assert.deepEqual(s.calls, []);
    assert.throws(() => s.f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

for (const method of ["fence", "routeCandidate"] as const)
  test(`${method} lost response resumes by observing, never resending`, (t) => {
    const s = setup(t),
      r = s.f.app.platform.restore;
    s.prepare();
    const original = s.adapter[method];
    s.adapter[method] = (c) => {
      original(c);
      throw new Error("synthetic lost response");
    };
    assert.throws(() => r.activate(s.input), /synthetic lost response/);
    assert.equal(r.get(s.input.id).state, "held");
    const reopened = new Application(s.f.path, "CA", { eventReports: false });
    try {
      s.configure(reopened);
      assert.equal(
        reopened.platform.restore.activate(s.input).state,
        "released",
      );
      assert.equal(
        s.calls.filter(
          (c) => c === (method === "fence" ? "fence" : "candidate"),
        ).length,
        1,
      );
      reopened.platform.assertProviderAccess();
    } finally {
      reopened.close();
    }
  });

test("failed fencing and unsettled controls never route or release", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  s.adapter.fence = () => {};
  assert.throws(() => r.activate(s.input), { code: "RESTORE_FENCING" });
  assert.deepEqual(s.calls, []);
  s.unsettled();
  assert.throws(() => r.activate(s.input), { code: "RESTORE_AUTHORITY" });
  assert.equal(r.current()!.state, "held");
});

test("concurrent operator cannot claim a second release or replay controls", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  const other = new Application(s.f.path, "CA", { eventReports: false });
  try {
    s.configure(other);
    assert.throws(
      () => other.platform.restore.prepare({ ...s.input, id: "competing" }),
      { code: "RESTORE_CONFLICT" },
    );
    const original = s.adapter.fence;
    s.adapter.fence = (c) => {
      assert.throws(() => other.platform.restore.activate(s.input));
      original(c);
    };
    assert.throws(() => r.activate(s.input), { code: "RESTORE_CONFLICT" });
    assert.equal(r.current()!.state, "held");
    assert.equal(r.activate(s.input).state, "released");
    assert.equal(s.calls.filter((c) => c === "fence").length, 1);
  } finally {
    other.close();
  }
});

test("internal writer in another process during routing invalidates release", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  const original = s.adapter.routeCandidate;
  s.adapter.routeCandidate = (c) => {
    original(c);
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);d.exec(\"UPDATE iam_organizations SET name='synthetic concurrent effect'\");d.close();",
        s.f.path,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(child.status, 0, child.stderr);
  };
  assert.throws(() => r.activate(s.input));
  assert.equal(
    s.f.app.database
      .owned("iam")
      .get("SELECT name FROM iam_organizations WHERE id=?", s.f.actor.orgId)!
      .name,
    "synthetic concurrent effect",
  );
  assert.equal(r.current()!.state, "held");
  assert.throws(() => s.f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});

test("ordinary application commands are held during the release lifecycle", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  let writes = 0;
  assert.throws(
    () =>
      s.f.app.platform.command(
        s.f.actor,
        "synthetic.command",
        "key",
        {},
        () => {},
        () => {
          writes++;
        },
      ),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(writes, 0);
});

for (const changed of ["none", "internal", "external", "unknown"] as const)
  test(`rollback with ${changed} effects preserves history and never rewinds writes`, (t) => {
    const s = setup(t),
      r = s.f.app.platform.restore;
    s.prepare();
    r.activate(s.input);
    if (changed === "internal") s.mutate();
    if (changed === "external") s.effect("observed");
    if (changed === "unknown") s.effect("unknown");
    const result = r.rollback(s.input.id);
    assert.equal(
      result.state,
      changed === "none" ? "rolled-back" : "forward-held",
    );
    assert.equal(s.calls.includes("source"), changed === "none");
    assert.ok(result.history.some((h) => h.state === "released"));
    assert.throws(() => s.f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("rollback lost response inspects source route on restart without replay", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  r.activate(s.input);
  const original = s.adapter.routeSource;
  s.adapter.routeSource = (c) => {
    original(c);
    throw new Error("lost source response");
  };
  assert.throws(() => r.rollback(s.input.id), /lost source response/);
  assert.equal(r.current()!.state, "forward-held");
  const reopened = new Application(s.f.path, "CA", { eventReports: false });
  try {
    s.configure(reopened);
    assert.equal(
      reopened.platform.restore.rollback(s.input.id).state,
      "rolled-back",
    );
    assert.equal(s.calls.filter((c) => c === "source").length, 1);
  } finally {
    reopened.close();
  }
});

test("expiry and lost current authority close an already released gate", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  r.activate(s.input);
  s.effect("unknown");
  assert.throws(() => s.f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
  s.effect("none");
  s.clock(Date.parse(s.input.dossier.expiresAt));
  assert.throws(() => s.f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
  assert.throws(() => r.rollback(s.input.id));
  assert.equal(r.current()!.state, "forward-held");
  assert.ok(s.calls.includes("stop"));
  assert.equal(r.supersede(s.input.id).state, "superseded");
  assert.throws(() => s.f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});

for (const reports of [false, true])
  test(`v16/${reports} exact fresh-file upgrade preserves hold and source bytes`, async (t) => {
    const s = setup(t, "CA", reports),
      source = join(dirname(s.f.path), "v16.db"),
      dest = join(dirname(s.f.path), "v18.db");
    const db = new DatabaseSync(s.f.path);
    try {
      db.prepare("VACUUM INTO ?").run(source);
    } finally {
      db.close();
    }
    const old = new DatabaseSync(source);
    try {
      old.exec(
        "DROP TABLE integration_offline_checkout_paid; DROP TABLE integration_offline_original_leases; DROP TABLE integration_offline_canada_post_members; DROP TABLE integration_offline_original_cancellations; DROP TABLE integration_offline_failed_refunds; DROP TABLE platform_offline_head; DROP TABLE platform_offline_receipts; DROP TABLE platform_offline_journal; DROP TABLE platform_offline_generations",
      );
      old.exec("DROP TABLE platform_restore_releases");
      old.exec("DROP TABLE inventory_quantity_corrections");
      old
        .prepare("UPDATE platform_schema_version SET version=16,schema_hash=?")
        .run(reports ? v16.hashes.enabled : v16.hashes.disabled);
    } finally {
      old.close();
    }
    const bytes = readFileSync(source);
    const inspected = inspectSchema(source);
    assert.equal(inspected.version, 16);
    assert.equal(inspected.kind, "previous");
    assert.throws(
      () => new Application(source, "CA", { eventReports: reports }),
      { code: "SCHEMA_UPGRADE_REQUIRED" },
    );
    const upgraded = await upgradeSchema(
      source,
      dest,
      inspected.schemaHash,
      "CA",
    );
    assert.equal(upgraded.version, SCHEMA_VERSION);
    assert.deepEqual(readFileSync(source), bytes);
    const app = new Application(dest, "CA", { eventReports: reports });
    try {
      assert.equal(app.platform.restore.current(), null);
      assert.throws(() => app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
    } finally {
      app.close();
    }
  });

test("encrypted restore of released store retains history but cannot inherit release", async (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  r.activate(s.input);
  const archive = join(dirname(s.f.path), "released.backup"),
    dest = join(dirname(s.f.path), "restored.db"),
    key = randomBytes(32);
  await createBackup(s.f.path, archive, "CA", key);
  await restoreBackup(archive, dest, "CA", key);
  const app = new Application(dest, "CA", { eventReports: false });
  try {
    s.configure(app);
    assert.equal(app.platform.restore.get(s.input.id).state, "superseded");
    assert.throws(() => app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  } finally {
    app.close();
  }
});

test("read-only review signatures cannot authorize activation, and release signatures cannot move to another binding", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore,
    prepared = r.prepare(s.input);
  assert.throws(() => r.approveRelease(s.input.id, s.input.approvals), {
    code: "RESTORE_APPROVAL",
  });
  assert.throws(
    () => r.approveRelease(s.input.id, s.releaseApprovals("a".repeat(64))),
    { code: "RESTORE_APPROVAL" },
  );
  assert.throws(() => r.activate(s.input), { code: "RESTORE_APPROVAL" });
  assert.deepEqual(s.calls, []);
  assert.ok(prepared.binding);
  assert.equal(r.get(s.input.id).state, "held");
});

for (const change of [
  "cursor",
  "hash",
  "binding",
  "token",
  "stale",
  "unknown",
  "trust",
] as const)
  test(`current ${change} authority drift closes released gate`, (t) => {
    const s = setup(t),
      r = s.f.app.platform.restore;
    s.prepare();
    r.activate(s.input);
    const observe = s.adapter.observe;
    s.adapter.observe = (c) => {
      const o = observe(c);
      if (change === "cursor") o.sourceCursor = "different";
      if (change === "hash") o.sourceHash = "b".repeat(64);
      if (change === "binding") o.binding = "c".repeat(64);
      if (change === "token") o.token = "new-fence";
      if (change === "stale") o.observedAt -= 100;
      if (change === "unknown") o.externalEffects = "unknown";
      if (change === "trust") s.revoke();
      return o;
    };
    assert.throws(() => s.f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("actual process exit after routing intent restarts held and observes exactly one control", (t) => {
  const s = setup(t);
  s.prepare();
  const inputPath = join(dirname(s.f.path), "private-release-input.json"),
    marker = join(dirname(s.f.path), "control-marker");
  writeFileSync(
    inputPath,
    JSON.stringify({ input: s.input, trust: s.trust(), at: s.now() }),
    { mode: 0o600 },
  );
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
 import {Application} from './src/server/application.ts';
 import {readFileSync,writeFileSync} from 'node:fs';
 const {input,trust,at}=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const app=new Application(process.argv[1],'CA',{eventReports:false});
 const marker=process.argv[3];
 app.platform.restore.configure({enabled:true,identity:'synthetic-only-v1',
 fence(){writeFileSync(marker,'fenced',{mode:0o600});},
 routeCandidate(){writeFileSync(marker,'routed-once',{mode:0o600});process.exit(86);},
 stopCandidate(){throw Error('unexpected stop');},routeSource(){throw Error('unexpected source route');},
 observe(c){return {releaseId:c.releaseId,binding:c.binding,token:'synthetic-fence-1',observedAt:at,validUntil:at+1000,settled:true,sourceFenced:true,candidateFenced:true,route:'isolated',sourceHash:c.source.logicalHash,sourceCursor:c.source.durableCursor,evidenceSetHash:c.evidenceSetHash,reconciliation:'complete',externalEffects:'none'};}
 },()=>trust,()=>at);
 app.platform.restore.activate(input);
 `,
      s.f.path,
      inputPath,
      marker,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(child.status, 86, child.stderr);
  assert.equal(readFileSync(marker, "utf8"), "routed-once");
  assert.equal(s.f.app.platform.restore.get(s.input.id).state, "routing");
  assert.throws(() => s.f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
  const original = s.adapter.observe;
  s.adapter.observe = (c) => ({
    ...original(c),
    sourceFenced: true,
    candidateFenced: false,
    route: "candidate",
  });
  const reopened = new Application(s.f.path, "CA", { eventReports: false });
  try {
    s.configure(reopened);
    assert.equal(reopened.platform.restore.activate(s.input).state, "released");
    assert.deepEqual(s.calls, []);
    reopened.platform.assertProviderAccess();
  } finally {
    reopened.close();
  }
});

test("fresh reviewed forward release supersedes an expired held generation without erasing history", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  r.activate(s.input);
  s.mutate();
  assert.equal(r.rollback(s.input.id).state, "forward-held");
  s.clock(Date.parse(s.input.dossier.expiresAt));
  assert.equal(r.supersede(s.input.id).state, "superseded");
  const oldId = s.input.id;
  s.input.id = "forward-reconciled-release";
  s.input.dossier.candidate = captureRestoreCandidate(s.f.path);
  s.input.dossier.preparedAt = new Date(s.now()).toISOString();
  s.input.dossier.expiresAt = new Date(s.now() + 60000).toISOString();
  s.input.approvals = s.approve();
  s.prepare();
  assert.equal(r.activate(s.input).state, "released");
  assert.equal(r.get(oldId).state, "superseded");
  assert.ok(r.get(oldId).history.some((h) => h.state === "forward-held"));
});

for (const state of ["pending", "running", "unknown", "blocked"])
  test(`copied ${state} provider intent refuses release despite signed report declarations`, (t) => {
    const s = setup(t),
      db = new DatabaseSync(s.f.path);
    try {
      db.prepare(
        "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,created_at,residency_version) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "copied-intent",
        s.f.actor.orgId,
        "synthetic-account",
        "stripe",
        "checkout",
        "synthetic-ref",
        "{}",
        state,
        new Date(s.now()).toISOString(),
        1,
      );
    } finally {
      db.close();
    }
    s.input.dossier.candidate = captureRestoreCandidate(s.f.path);
    s.input.approvals = s.approve();
    assert.throws(() => s.prepare(), { code: "RESTORE_UNRESOLVED" });
    assert.deepEqual(s.calls, []);
    assert.equal(s.f.app.platform.restore.current(), null);
    assert.throws(() => s.f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });
