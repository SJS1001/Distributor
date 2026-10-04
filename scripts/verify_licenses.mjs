#!/usr/bin/env node
/** Inventory exact local notice files without executing dependency code. No license approval is inferred. */
import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const slash = (path) => path.split(sep).join("/");
const noticeName =
  /^(?:licen[sc]e|copying|notice|copyright|authors)(?:$|[._-])/i;

async function noticeFiles(directory, base = directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name, "en"),
  )) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git")
        files.push(...(await noticeFiles(path, base)));
    } else if (entry.isFile() && noticeName.test(entry.name)) {
      const bytes = await readFile(path);
      files.push({
        path: slash(relative(base, path)),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
  }
  return files;
}

export async function inventoryLicenses(root) {
  const lockBytes = await readFile(resolve(root, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""])
    throw new Error(
      "Expected npm lockfile version 3 with root package metadata",
    );
  const packages = [];
  const discrepancies = [];
  for (const [location, pinned] of Object.entries(lock.packages)
    .filter(([key]) => key)
    .sort(([a], [b]) => a.localeCompare(b, "en"))) {
    if (
      location.includes("\\") ||
      !/^(?:node_modules\/(?:@[^/]+\/)?[^/]+\/)*(?:node_modules\/)(?:@[^/]+\/)?[^/]+$/.test(
        location,
      ) ||
      location.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error("Unexpected package location in lockfile");
    const directory = resolve(root, location);
    const record = {
      location,
      name: location.slice(
        location.lastIndexOf("node_modules/") + "node_modules/".length,
      ),
      version: pinned.version ?? null,
      declaredLicense: pinned.license ?? null,
      resolved: pinned.resolved ?? null,
      integrity: pinned.integrity ?? null,
      developmentOnly: pinned.dev === true,
      optional: pinned.optional === true,
      os: pinned.os ?? [],
      cpu: pinned.cpu ?? [],
      installed: false,
      noticeFiles: [],
    };
    let packageDirectoryPresent = false;
    try {
      let component = root;
      for (const part of location.split("/")) {
        component = resolve(component, part);
        const stat = await lstat(component);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error(
            `Package directory is not an ordinary directory: ${location}`,
          );
      }
      packageDirectoryPresent = true;
      const manifestPath = resolve(directory, "package.json");
      const manifestStat = await lstat(manifestPath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink())
        throw new Error(
          `Package manifest is not an ordinary file: ${location}`,
        );
      const manifestBytes = await readFile(manifestPath);
      const manifest = JSON.parse(manifestBytes);
      record.installed = true;
      record.installedVersion = manifest.version ?? null;
      record.installedDeclaredLicense = manifest.license ?? null;
      record.manifestSha256 = sha256(manifestBytes);
      record.noticeFiles = await noticeFiles(directory);
      if (manifest.name !== record.name || manifest.version !== pinned.version)
        discrepancies.push({
          location,
          reason: "Installed package name/version differs from lockfile",
          installedName: manifest.name ?? null,
          installedVersion: manifest.version ?? null,
        });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Optional packages for other platforms are expected to be absent. No downloaded notice is implied.
      if (packageDirectoryPresent || !record.optional)
        discrepancies.push({
          location,
          reason: packageDirectoryPresent
            ? "Installed package is incomplete"
            : "Required locked package is absent",
        });
    }
    if (!record.declaredLicense)
      discrepancies.push({
        location,
        reason: "No declared license in lockfile",
      });
    packages.push(record);
  }
  return {
    schemaVersion: 1,
    purpose:
      "Locked package and actual local notice inventory; not a legal review or redistribution approval",
    lockfileSha256: sha256(lockBytes),
    platform: { os: process.platform, architecture: process.arch },
    limitations: [
      "Declared licenses do not establish all license obligations or source provenance.",
      "Only separately named license, copying, notice, copyright and authors files are hashed; embedded source/bundle comments are not scanned.",
      "Uninstalled optional platform packages, bundled native libraries and runtime downloads require independent qualification.",
      "No dependency code is executed and no network requests are made.",
      "Notice bytes remain in the installed packages; hashes do not replace retaining their texts in a distribution.",
    ],
    summary: {
      lockedPackages: packages.length,
      installedPackages: packages.filter((pkg) => pkg.installed).length,
      uninstalledOptionalPackages: packages.filter(
        (pkg) => !pkg.installed && pkg.optional,
      ).length,
      installedWithoutNamedNotice: packages
        .filter((pkg) => pkg.installed && pkg.noticeFiles.length === 0)
        .map((pkg) => pkg.location),
      declaredLicenses: [
        ...new Set(packages.map((pkg) => pkg.declaredLicense)),
      ].sort(),
      namedNoticeFiles: packages.reduce(
        (total, pkg) => total + pkg.noticeFiles.length,
        0,
      ),
      discrepancies,
    },
    packages,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
    const inventory = await inventoryLicenses(root);
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    if (inventory.summary.discrepancies.length) process.exitCode = 1;
  } catch (error) {
    console.error(`License inventory failed: ${error.message}`);
    process.exitCode = 1;
  }
}
