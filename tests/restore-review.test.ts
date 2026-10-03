import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { providerNames } from "../src/shared/provider-choices.ts";
import {
  captureRestoreCandidate,
  reviewRestoreDossier,
  restoreApprovalMessage,
  type RestoreDossier,
  type RestoreApprover,
} from "../src/server/restore-review.ts";

function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  eventReports = true,
) {
  const f = fixture(t, { eventReports }, region);
  assert.throws(() => captureRestoreCandidate(f.path), {
    code: "RESTORE_REVIEW",
  });
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  const candidate = captureRestoreCandidate(f.path),
    at = Date.now();
  const evidence = {
    reference: "synthetic:independent-operator-rehearsal",
    sha256: digest("synthetic source reconciliation only"),
  };
  const dossier: RestoreDossier = {
    version: 1,
    preparedBy: "synthetic-preparer",
    preparedAt: new Date(at - 1000).toISOString(),
    expiresAt: new Date(at + 60000).toISOString(),
    candidate,
    source: {
      identity: "synthetic-authoritative-source",
      logicalHash: digest("synthetic source"),
      durableCursor: "synthetic-durable-cursor-43",
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
        "synthetic-source-app",
        "synthetic-source-worker",
        "synthetic-source-cli",
        "synthetic-source-callback",
      ],
      candidateWriters: ["synthetic-isolated-candidate"],
      rollbackMode: "source-before-effects-forward-recovery-after-effects",
      rpoMinutes: 15,
      rtoMinutes: 240,
    },
  };
  const finance = generateKeyPairSync("ed25519"),
    security = generateKeyPairSync("ed25519");
  const trust: RestoreApprover[] = [
    {
      id: "synthetic-finance",
      role: "finance",
      publicKey: finance.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
    {
      id: "synthetic-security",
      role: "security",
      publicKey: security.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
  ];
  const approve = (value = dossier) =>
    trust.map((a, index) => ({
      signerId: a.id,
      role: a.role,
      dossierHash: digest(canonical(value)),
      signature: sign(
        null,
        Buffer.from(
          restoreApprovalMessage(digest(canonical(value)), a.id, a.role),
        ),
        index === 0 ? finance.privateKey : security.privateKey,
      ).toString("base64"),
    }));
  return { f, at, dossier, trust, approve };
}
for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    test(`${region}/${reports} signed restore review binds all persisted rows and leaves provider hold intact`, (t) => {
      const { f, at, dossier, trust, approve } = setup(t, region, reports);
      const first = captureRestoreCandidate(f.path),
        bytes = readFileSync(f.path);
      const reviewed = reviewRestoreDossier(
        f.path,
        dossier,
        approve(),
        trust,
        at,
      );
      assert.equal(reviewed.status, "reviewed-isolated");
      assert.equal(reviewed.activationAuthorized, false);
      assert.equal(reviewed.providerHold, true);
      assert.deepEqual(captureRestoreCandidate(f.path), first);
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.throws(() => f.app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
      const output = JSON.stringify({ first, reviewed });
      for (const secret of [
        "long-test-only-password",
        "admin@example.test",
        "Synthetic Distributor",
        "Synthetic processor",
      ])
        assert.equal(output.includes(secret), false);
      // Any new native audit/access/policy fact changes the signed candidate; review performs no native writes.
      f.app.platform.audit(f.actor, "SyntheticAfterReview", "synthetic", {});
      assert.throws(
        () => reviewRestoreDossier(f.path, dossier, approve(), trust, at),
        { code: "RESTORE_REVIEW_CHANGED" },
      );
      assert.throws(() => f.app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
    });

test("restore review refuses expired, partial organization, missing provider and unknown outcome evidence", (t) => {
  const { f, at, dossier, trust, approve } = setup(t);
  const changes: ((d: RestoreDossier) => void)[] = [
    (d) => {
      d.expiresAt = new Date(at).toISOString();
    },
    (d) => {
      d.preparedAt = new Date(at + 1).toISOString();
    },
    (d) => {
      d.expiresAt = new Date(at + 3600000).toISOString();
    },
    (d) => {
      d.organizations = [];
    },
    (d) => {
      d.organizations.push(structuredClone(d.organizations[0]!));
    },
    (d) => {
      d.organizations[0]!.providers.pop();
    },
    (d) => {
      d.organizations[0]!.providers[0]!.outcome = "unknown";
    },
    (d) => {
      d.organizations[0]!.inventory.sha256 = "not-evidence";
    },
    (d) => {
      d.operations.candidateWriters = [d.operations.sourceWriters[0]!];
    },
    (d) => {
      d.operations.sourceWriters = [];
    },
    (d) => {
      d.operations.rollbackMode = "always-return-to-old-source" as any;
    },
    (d) => {
      d.operations.rpoMinutes = 0;
    },
    (d) => {
      d.source.durableCursor = "";
    },
  ];
  for (const change of changes) {
    const next = structuredClone(dossier);
    change(next);
    assert.throws(() =>
      reviewRestoreDossier(f.path, next, approve(next), trust, at),
    );
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  }
});

test("restore signatures require separate trusted people/keys and bind the entire dossier", (t) => {
  const { f, at, dossier, trust, approve } = setup(t);
  const approvals = approve();
  for (const altered of [
    [],
    [approvals[0]!],
    [approvals[0]!, approvals[0]!],
    approvals.map((a) => ({ ...a, signature: "A".repeat(86) + "==" })),
    approvals.map((a) => ({ ...a, dossierHash: "0".repeat(64) })),
  ])
    assert.throws(
      () => reviewRestoreDossier(f.path, dossier, altered, trust, at),
      { code: "RESTORE_APPROVAL" },
    );
  assert.throws(
    () => reviewRestoreDossier(f.path, dossier, approvals, [], at),
    { code: "RESTORE_APPROVAL" },
  );
  assert.throws(
    () =>
      reviewRestoreDossier(
        f.path,
        dossier,
        approvals,
        [trust[0]!, trust[0]!],
        at,
      ),
    { code: "RESTORE_APPROVAL" },
  );
  assert.throws(
    () =>
      reviewRestoreDossier(
        f.path,
        dossier,
        approvals,
        [trust[0]!, { ...trust[1]!, publicKey: trust[0]!.publicKey }],
        at,
      ),
    { code: "RESTORE_APPROVAL" },
  );
  const next = structuredClone(dossier);
  next.preparedBy = trust[0]!.id;
  assert.throws(
    () => reviewRestoreDossier(f.path, next, approve(next), trust, at),
    { code: "RESTORE_APPROVAL" },
  );
  const tampered = structuredClone(dossier);
  tampered.source.auditSequence++;
  assert.throws(
    () => reviewRestoreDossier(f.path, tampered, approvals, trust, at),
    { code: "RESTORE_APPROVAL" },
  );
});

test("all organization membership and candidate path/schema/isolation changes refuse the frozen dossier", (t) => {
  const { f, at, dossier, trust, approve } = setup(t);
  const db = new DatabaseSync(f.path);
  try {
    db.prepare(
      "INSERT INTO iam_organizations SELECT ?,name,region,currency,policy FROM iam_organizations LIMIT 1",
    ).run("synthetic-second-organization");
    assert.throws(
      () => reviewRestoreDossier(f.path, dossier, approve(), trust, at),
      { code: "RESTORE_REVIEW_CHANGED" },
    );
    assert.equal(captureRestoreCandidate(f.path).organizations.length, 2);
    db.prepare("DELETE FROM iam_organizations WHERE id=?").run(
      "synthetic-second-organization",
    );
    db.exec("DELETE FROM platform_recovery");
    assert.throws(() => captureRestoreCandidate(f.path), {
      code: "RESTORE_REVIEW",
    });
    db.exec("CREATE TABLE unexpected_extension(x TEXT)");
    assert.throws(() => captureRestoreCandidate(f.path), {
      code: "SCHEMA_DRIFT",
    });
  } finally {
    db.close();
  }
  const linked = join(dirname(f.path), "candidate-link.db");
  symlinkSync(f.path, linked);
  assert.throws(() => captureRestoreCandidate(linked), {
    code: "RESTORE_REVIEW",
  });
});

test("CLI review requires private evidence files and never exposes business values or activates", (t) => {
  const { f, dossier, trust, approve } = setup(t);
  const paths = ["dossier", "approvals", "trust"].map((name) =>
    join(dirname(f.path), name + ".json"),
  );
  [dossier, approve(), trust].forEach((value, i) =>
    writeFileSync(paths[i]!, JSON.stringify(value), { mode: 0o600 }),
  );
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "src/server/restore-review-cli.ts", ...args],
      { encoding: "utf8", timeout: 15000 },
    );
  const capture = run(["capture", f.path]);
  assert.equal(capture.status, 0, capture.stderr);
  assert.equal(
    JSON.parse(capture.stdout).logicalHash,
    dossier.candidate.logicalHash,
  );
  const review = run(["review", f.path, ...paths]);
  assert.equal(review.status, 0, review.stderr);
  assert.equal(JSON.parse(review.stdout).activationAuthorized, false);
  chmodSync(paths[0]!, 0o644);
  const refused = run(["review", f.path, ...paths]);
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, "");
  assert.equal(refused.stderr.includes("admin@example.test"), false);
  assert.throws(() => f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});
