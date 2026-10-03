// Synthetic operations only. This fixture follows the existing native dossier contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  copyFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
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
  };
}

for (const operation of ["fence", "stopCandidate"] as const)
  test(`a differently identified adapter cannot receive ${operation} for an approved release`, (t) => {
    const s = setup(t),
      r = s.f.app.platform.restore;
    s.prepare();
    if (operation === "stopCandidate") r.activate(s.input);
    const before = [...s.calls];
    r.configure(
      { ...s.adapter, identity: "unreviewed-adapter-v2" },
      s.trust,
      s.now,
    );
    assert.throws(
      () =>
        operation === "fence" ? r.activate(s.input) : r.rollback(s.input.id),
      { code: "RESTORE_AUTHORITY" },
    );
    assert.deepEqual(
      s.calls,
      before,
      "unapproved adapter must receive no external control",
    );
    assert.equal(r.permits(), false);
  });

for (const phase of ["stopping", "returning"] as const)
  for (const effect of ["observed", "unknown"] as const)
    test(`${phase} ${effect} effects require forward recovery even if a later observation says none`, (t) => {
      const s = setup(t),
        r = s.f.app.platform.restore;
      s.prepare();
      r.activate(s.input);
      if (phase === "returning") {
        const routeSource = s.adapter.routeSource;
        s.adapter.routeSource = (control) => {
          routeSource(control);
          s.effect(effect);
          throw Error("synthetic source route response lost after effects");
        };
        assert.throws(
          () => r.rollback(s.input.id),
          /synthetic source route response lost/,
        );
      } else s.effect(effect);
      // This call actually observes the contradictory interval and must retain it.
      try {
        r.rollback(s.input.id);
      } catch (error) {
        assert.equal((error as { code: string }).code, "RESTORE_ROLLBACK");
      }
      const retained = r.get(s.input.id);
      assert.equal(retained.state, "forward-held");
      const calls = [...s.calls];
      s.effect("none");
      const reopened = new Application(s.f.path, "CA", { eventReports: false });
      try {
        s.configure(reopened);
        assert.equal(
          reopened.platform.restore.rollback(s.input.id).state,
          "forward-held",
          "a later negative observation cannot erase prior possible effects",
        );
        assert.deepEqual(
          s.calls,
          calls,
          "forward recovery cannot route the old source again",
        );
        assert.deepEqual(
          reopened.platform.restore
            .get(s.input.id)
            .history.slice(0, retained.history.length),
          retained.history,
        );
        assert.throws(() => reopened.platform.assertProviderAccess(), {
          code: "RECOVERY_HOLD",
        });
      } finally {
        reopened.close();
      }
    });

test("a main-file replacement during the adapter observation closes that same runtime gate call", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  r.activate(s.input);
  const observe = s.adapter.observe;
  s.adapter.observe = (control) => {
    const result = observe(control);
    renameSync(s.f.path, s.f.path + ".original");
    copyFileSync(s.f.path + ".original", s.f.path);
    s.adapter.observe = observe;
    return result;
  };
  assert.equal(
    r.permits(),
    false,
    "identity must be checked after obtaining external observations too",
  );
  assert.throws(() => s.f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});

test("a competing connection can roll back while a gate observation is pending without reviving stale released authority", (t) => {
  const s = setup(t),
    r = s.f.app.platform.restore;
  s.prepare();
  r.activate(s.input);
  const other = new Application(s.f.path, "CA", { eventReports: false });
  try {
    s.configure(other);
    const observe = s.adapter.observe;
    s.adapter.observe = (control) => {
      const stale = observe(control);
      s.adapter.observe = observe;
      assert.equal(
        other.platform.restore.rollback(s.input.id).state,
        "rolled-back",
      );
      return stale;
    };
    assert.equal(
      r.permits(),
      false,
      "a valid old observation cannot reopen a terminal release",
    );
    assert.equal(r.get(s.input.id).state, "rolled-back");
    assert.equal(s.calls.filter((c) => c === "source").length, 1);
  } finally {
    other.close();
  }
});
