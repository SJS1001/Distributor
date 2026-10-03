import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
  linkSync,
  truncateSync,
} from "node:fs";
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
import {
  reviewRestoreEvidence,
  type RestoreEvidenceManifest,
} from "../src/server/restore-evidence.ts";

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

function evidenceSetup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  reports = true,
) {
  const result = setup(t, region, reports),
    { f, dossier } = result,
    root = join(dirname(f.path), "private-evidence");
  mkdirSync(root, { mode: 0o700 });
  const manifest: RestoreEvidenceManifest = { version: 1, root, files: [] };
  let bytes = 0;
  const item = () => {
    const index = manifest.files.length,
      reference = `synthetic:private-evidence-${index}`,
      path = `evidence-${index}.txt`,
      value = `Private synthetic evidence bytes ${index}; never publish these values.\n`;
    writeFileSync(join(root, path), value, { mode: 0o600 });
    manifest.files.push({ reference, path });
    bytes += Buffer.byteLength(value);
    return { reference, sha256: digest(value) };
  };
  dossier.source.cutoff = item();
  dossier.operations.fencing = item();
  dossier.operations.routing = item();
  dossier.operations.rollback = item();
  for (const org of dossier.organizations) {
    org.inventory = item();
    org.billing = item();
    org.access = item();
    org.residency = item();
    for (const provider of org.providers) provider.evidence = item();
  }
  const review = (
    value = manifest,
    loadTrust = () => result.trust,
    clock = () => result.at,
  ) =>
    reviewRestoreEvidence(
      f.path,
      dossier,
      result.approve(),
      loadTrust,
      value,
      clock,
    );
  return { ...result, root, manifest, bytes, review };
}

for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    test(`${region}/${reports} private restore evidence checks every signed file without mutating candidate or disclosing bytes`, (t) => {
      const { f, manifest, bytes, review } = evidenceSetup(t, region, reports),
        before = captureRestoreCandidate(f.path),
        result = review();
      assert.equal(result.status, "reviewed-evidence-isolated");
      assert.equal(result.activationAuthorized, false);
      assert.equal(result.providerHold, true);
      assert.equal(result.evidence.files, manifest.files.length);
      assert.equal(result.evidence.bytes, bytes);
      assert.deepEqual(
        review({ ...manifest, files: [...manifest.files].reverse() }),
        result,
      );
      assert.deepEqual(captureRestoreCandidate(f.path), before);
      assert.throws(() => f.app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
      const output = JSON.stringify(result);
      for (const privateValue of [
        manifest.root,
        "Private synthetic evidence bytes",
        "synthetic:private-evidence",
        "long-test-only-password",
      ])
        assert.equal(output.includes(privateValue), false);
    });

test("restore evidence requires exact signed reference coverage and strict manifest names", (t) => {
  const { manifest, review } = evidenceSetup(t);
  const alterations: ((m: RestoreEvidenceManifest) => void)[] = [
    (m) => {
      m.files.pop();
    },
    (m) => {
      m.files.push({ reference: "unsigned-extra", path: "extra.txt" });
    },
    (m) => {
      m.files.push({ ...m.files[0]! });
    },
    (m) => {
      m.files[1]!.path = m.files[0]!.path;
    },
    (m) => {
      m.files[0]!.path = "../private.txt";
    },
    (m) => {
      m.files[0]!.path = "/tmp/private.txt";
    },
    (m) => {
      m.files[0]!.path = "nested/../private.txt";
    },
    (m) => {
      m.files[0]!.path = "nested//private.txt";
    },
    (m) => {
      m.files[0]!.path = "nested\\private.txt";
    },
    (m) => {
      m.files[0]!.path = "private\u0000.txt";
    },
    (m) => {
      m.files[0]!.path = "./private.txt";
    },
    (m) => {
      m.root = "relative-root";
    },
    (m) => {
      Object.assign(m, { extra: true });
    },
    (m) => {
      Object.assign(m.files[0]!, { sha256: "a".repeat(64) });
    },
    (m) => {
      m.files = Array.from({ length: 1001 }, () => m.files[0]!);
    },
  ];
  for (const alter of alterations) {
    const next = structuredClone(manifest);
    alter(next);
    assert.throws(() => review(next), { code: "RESTORE_EVIDENCE" });
  }
});

test("restore evidence rejects altered, empty, oversized and nonprivate files", (t) => {
  const { root, manifest, review } = evidenceSetup(t),
    path = join(root, manifest.files[0]!.path),
    original = readFileSync(path);
  writeFileSync(path, "Changed private data, same signed dossier");
  assert.throws(() => review(), { code: "RESTORE_EVIDENCE" });
  writeFileSync(path, "");
  assert.throws(() => review(), { code: "RESTORE_EVIDENCE" });
  truncateSync(path, 64 * 1024 ** 2 + 1);
  assert.throws(() => review(), { code: "RESTORE_EVIDENCE" });
  writeFileSync(path, original);
  chmodSync(path, 0o644);
  assert.throws(() => review(), { code: "RESTORE_EVIDENCE" });
  chmodSync(path, 0o600);
  chmodSync(root, 0o755);
  assert.throws(() => review(), { code: "RESTORE_EVIDENCE" });
});

test("restore evidence enforces the aggregate byte limit before reading the next file", (t) => {
  const { root, dossier, manifest, review } = evidenceSetup(t),
    size = 64 * 1024 ** 2,
    sha256 = digest(Buffer.alloc(size)),
    items = [
      dossier.source.cutoff,
      dossier.operations.fencing,
      dossier.operations.routing,
      dossier.operations.rollback,
      dossier.organizations[0]!.inventory,
    ];
  for (let index = 0; index < 5; index++) {
    const path = join(root, manifest.files[index]!.path);
    writeFileSync(path, "");
    truncateSync(path, size);
    items[index]!.sha256 = sha256;
  }
  assert.throws(() => review(), {
    code: "RESTORE_EVIDENCE",
    message: "Evidence exceeds the 256 MiB review limit.",
  });
});

test("restore evidence rejects root, nested directory, file symlinks and hard links", (t) => {
  const { root, manifest, review } = evidenceSetup(t),
    base = dirname(root),
    original = join(root, manifest.files[0]!.path);
  symlinkSync(root, join(base, "root-link"));
  assert.throws(() => review({ ...manifest, root: join(base, "root-link") }), {
    code: "RESTORE_EVIDENCE",
  });
  symlinkSync(root, join(root, "nested-link"));
  const nested = structuredClone(manifest);
  nested.files[0]!.path = `nested-link/${manifest.files[0]!.path}`;
  assert.throws(() => review(nested), { code: "RESTORE_EVIDENCE" });
  symlinkSync(original, join(root, "file-link"));
  const linked = structuredClone(manifest);
  linked.files[0]!.path = "file-link";
  assert.throws(() => review(linked), { code: "RESTORE_EVIDENCE" });
  linkSync(original, join(root, "file-hard-link"));
  assert.throws(() => review(), { code: "RESTORE_EVIDENCE" });
});

test("restore evidence supports private nested directories and a shared signed reference", (t) => {
  const { root, dossier, manifest, review } = evidenceSetup(t);
  mkdirSync(join(root, "nested"), { mode: 0o700 });
  const first = manifest.files[0]!;
  writeFileSync(
    join(root, "nested", "evidence.txt"),
    readFileSync(join(root, first.path)),
    { mode: 0o600 },
  );
  first.path = "nested/evidence.txt";
  const removed = manifest.files.pop()!;
  const provider = dossier.organizations[0]!.providers.at(-1)!;
  assert.equal(provider.evidence.reference, removed.reference);
  provider.evidence = { ...dossier.source.cutoff };
  assert.equal(review().evidence.files, manifest.files.length);
  provider.evidence.sha256 = "0".repeat(64);
  assert.throws(() => review(), { code: "RESTORE_EVIDENCE" });
});

test("restore evidence rechecks candidate, current approver authority, expiry and retained files after hashing", (t) => {
  for (const change of [
    "authority",
    "candidate",
    "file",
    "directory",
    "expiry",
    "clock",
  ] as const) {
    const child = evidenceSetup(t);
    // Each fixture has an independently allocated directory/store.
    let loads = 0,
      clocks = 0;
    const loadTrust = () => {
      if (++loads === 2) {
        if (change === "authority") return [];
        if (change === "candidate")
          child.f.app.platform.audit(
            child.f.actor,
            "SyntheticDuringEvidence",
            "synthetic",
            {},
          );
        if (change === "file")
          writeFileSync(
            join(child.root, child.manifest.files[0]!.path),
            "Changed during verification",
          );
        if (change === "directory") chmodSync(child.root, 0o755);
      }
      return child.trust;
    };
    const clock = () => {
      ++clocks;
      if (change === "expiry" && clocks > 1)
        return Date.parse(child.dossier.expiresAt);
      if (change === "clock" && clocks > 2) return child.at - 1;
      return child.at;
    };
    assert.throws(() => child.review(child.manifest, loadTrust, clock));
    assert.throws(() => child.f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  }
});

test("CLI verifies private evidence and sanitizes missing file and mismatch failures", (t) => {
  const { f, dossier, trust, approve, manifest } = evidenceSetup(t);
  const inputs = [dossier, approve(), trust, manifest].map((value, index) => {
    const path = join(dirname(f.path), `evidence-input-${index}.json`);
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
    return path;
  });
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/server/restore-review-cli.ts",
        "verify-evidence",
        f.path,
        ...inputs,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
  const success = run();
  assert.equal(success.status, 0, success.stderr);
  assert.equal(
    JSON.parse(success.stdout).evidence.files,
    manifest.files.length,
  );
  assert.equal(JSON.parse(success.stdout).activationAuthorized, false);
  assert.equal(success.stdout.includes(manifest.root), false);
  writeFileSync(
    join(manifest.root, manifest.files[0]!.path),
    "private-provider-token-never-print",
  );
  const mismatch = run();
  assert.equal(mismatch.status, 1);
  assert.equal(mismatch.stdout, "");
  assert.match(
    mismatch.stderr,
    /RESTORE_EVIDENCE: Restore review did not complete/,
  );
  assert.equal(mismatch.stderr.includes("private-provider-token"), false);
  manifest.files[0]!.path = "private-missing-file-never-print";
  writeFileSync(inputs[3]!, JSON.stringify(manifest));
  const missing = run();
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr.includes("private-missing-file"), false);
  assert.throws(() => f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});
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
