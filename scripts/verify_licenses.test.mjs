import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { inventoryLicenses } from "./verify_licenses.mjs";

async function fixture(t, packages) {
  const root = await mkdtemp(join(tmpdir(), "distributor-license-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: { "": { name: "fixture" }, ...packages },
    }),
  );
  return root;
}
async function install(root, location, manifest, files = {}) {
  const path = join(root, location);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "package.json"), JSON.stringify(manifest));
  for (const [file, bytes] of Object.entries(files)) {
    await mkdir(join(path, file, ".."), { recursive: true });
    await writeFile(join(path, file), bytes);
  }
}

test("notice inventory preserves exact byte hashes and reports bundled notices separately from declaration", async (t) => {
  const root = await fixture(t, {
    "node_modules/example": { version: "1.0.0", license: "MIT" },
  });
  const bytes = Buffer.from("Copyright example\r\npermission\r\n");
  await install(
    root,
    "node_modules/example",
    { name: "example", version: "1.0.0", license: "MIT" },
    {
      "LICENSE.txt": bytes,
      "assets/NOTICE": "second notice",
      "bundle.js": "/* another license */",
    },
  );
  const first = await inventoryLicenses(root);
  assert.equal(first.summary.namedNoticeFiles, 2);
  assert.equal(
    first.packages[0].noticeFiles.find((file) => file.path === "LICENSE.txt")
      .sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.deepEqual(first, await inventoryLicenses(root));
  assert.match(
    first.limitations.join(" "),
    /embedded source\/bundle comments are not scanned/,
  );
});

test("missing required packages and actual version mismatch are discrepancies; absent optional packages are disclosed", async (t) => {
  const root = await fixture(t, {
    "node_modules/missing": { version: "1", license: "MIT" },
    "node_modules/optional": {
      version: "1",
      license: "MIT",
      optional: true,
      os: ["win32"],
    },
    "node_modules/changed": { version: "1", license: "MIT" },
  });
  await install(root, "node_modules/changed", {
    name: "changed",
    version: "2",
    license: "MIT",
  });
  const result = await inventoryLicenses(root);
  assert.equal(result.summary.discrepancies.length, 2);
  assert.equal(result.summary.uninstalledOptionalPackages, 1);
  assert.deepEqual(result.summary.installedWithoutNamedNotice, [
    "node_modules/changed",
  ]);
});

test("nested scoped packages keep independent manifests and do not double count child notices", async (t) => {
  const parent = "node_modules/@scope/parent";
  const child = `${parent}/node_modules/@other/child`;
  const root = await fixture(t, {
    [parent]: { version: "1", license: "MIT" },
    [child]: { version: "2", license: "ISC" },
  });
  await install(
    root,
    parent,
    { name: "@scope/parent", version: "1" },
    { LICENSE: "parent" },
  );
  await install(
    root,
    child,
    { name: "@other/child", version: "2" },
    { LICENSE: "child" },
  );
  const result = await inventoryLicenses(root);
  assert.equal(result.summary.discrepancies.length, 0);
  assert.equal(result.summary.namedNoticeFiles, 2);
  assert.equal(
    result.packages.find((pkg) => pkg.location === parent).noticeFiles.length,
    1,
  );
});

test("a symlinked notice cannot import a file outside the installed package", async (t) => {
  const root = await fixture(t, {
    "node_modules/example": { version: "1", license: "MIT" },
  });
  await install(root, "node_modules/example", {
    name: "example",
    version: "1",
  });
  await writeFile(join(root, "private-text"), "unrelated private contents");
  await symlink(
    join(root, "private-text"),
    join(root, "node_modules/example/LICENSE"),
  );
  const result = await inventoryLicenses(root);
  assert.equal(result.summary.namedNoticeFiles, 0);
  assert.equal(
    JSON.stringify(result).includes("unrelated private contents"),
    false,
  );
});

test("path traversal and linked package directories are rejected instead of reading outside the inventory", async (t) => {
  const root = await fixture(t, {
    "node_modules/../outside": { version: "1", license: "MIT" },
  });
  await assert.rejects(inventoryLicenses(root), /Unexpected package location/);
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/linked": { version: "1", license: "MIT" },
      },
    }),
  );
  await mkdir(join(root, "node_modules"));
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), join(root, "node_modules/linked"));
  await assert.rejects(inventoryLicenses(root), /not an ordinary directory/);
});

test("a present but incomplete optional package is not mistaken for a deliberately absent platform dependency", async (t) => {
  const root = await fixture(t, {
    "node_modules/optional": { version: "1", license: "MIT", optional: true },
  });
  await mkdir(join(root, "node_modules/optional"), { recursive: true });
  const result = await inventoryLicenses(root);
  assert.deepEqual(result.summary.discrepancies, [
    {
      location: "node_modules/optional",
      reason: "Installed package is incomplete",
    },
  ]);
});
