import { isAbsolute } from "node:path";
import { types } from "node:util";
import { canonical, check, digest, DomainError } from "./core.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
} from "./restore-offline-envelope.ts";
import {
  readRestorePrivateEvidence,
  type RestoreEvidenceCapture,
  type RestoreEvidenceManifest,
} from "./restore-private-evidence.ts";

const MiB = 1024 ** 2;
function requireValue(value: unknown): asserts value {
  check(
    value,
    "RESTORE_OFFLINE_PRIVATE_EVIDENCE",
    "Offline private evidence binding did not complete.",
    400,
  );
}
function fail(): never {
  throw new DomainError(
    "RESTORE_OFFLINE_PRIVATE_EVIDENCE",
    "Offline private evidence binding did not complete.",
    400,
  );
}

// Bound lists BEFORE ownKeys/descriptors/copying; reject proxies BEFORE any
// reflective operation. This is a resource preflight, not the envelope schema.
function preflight(input: unknown, maximumList = 1000) {
  let nodes = 0,
    characters = 0;
  function visit(value: unknown, depth: number): void {
    requireValue(++nodes <= 20000 && depth <= 12);
    if (typeof value === "string") {
      requireValue(value.length <= 4096);
      characters += value.length;
      requireValue(characters <= 4 * MiB);
      return;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return;
    requireValue(typeof value === "object" && !types.isProxy(value));
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    requireValue(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      requireValue(
        Number.isSafeInteger(length) && length >= 0 && length <= maximumList,
      );
      requireValue(Reflect.ownKeys(value).length === length + 1);
      for (let i = 0; i < length; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        requireValue(d && "value" in d && d.enumerable);
        visit(d.value, depth + 1);
      }
    } else {
      let count = 0;
      for (const key in value) {
        requireValue(++count <= 20 && Object.hasOwn(value, key));
      }
      const keys = Reflect.ownKeys(value);
      requireValue(keys.length === count);
      for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(value, key);
        requireValue(
          typeof key === "string" &&
            key.length <= 80 &&
            d &&
            "value" in d &&
            d.enumerable,
        );
        visit(d.value, depth + 1);
      }
    }
  }
  visit(input, 0);
}
function record(input: unknown, keys: string[]): Record<string, unknown> {
  requireValue(
    input !== null && typeof input === "object" && !Array.isArray(input),
  );
  const own = Object.keys(input);
  requireValue(
    own.length === keys.length && own.every((key) => keys.includes(key)),
  );
  return input as Record<string, unknown>;
}

export type OfflinePrivateEvidenceSummary = Readonly<{
  status: "historical-byte-binding";
  envelopeBinding: string;
  files: number;
  bytes: number;
  setHash: string;
  qualification: "unverified";
}>;

/** Opaque, process-local lifetime. No byte/map getter, serialization or callback
 * port. Fixed owner parsers must be implemented at this private boundary before
 * any captured content can be consumed; this prerequisite exposes none yet.
 * Always dispose in finally (or use `using`), including on authority failure. */
export type OfflinePrivateEvidenceHandle = Readonly<{
  complete(): OfflinePrivateEvidenceSummary;
  dispose(): void;
  [Symbol.dispose](): void;
}>;

/** Byte binding only. Does not check current authority, time, qualification,
 * candidate state, source fencing, native task eligibility or transport rights. */
export function readOfflinePrivateEvidence(
  envelopeInput: unknown,
  manifestInput: unknown,
  captureInput?: unknown,
): OfflinePrivateEvidenceHandle {
  let pending: ReturnType<typeof readRestorePrivateEvidence> | undefined;
  let captured: ReadonlyMap<string, Buffer> | undefined;
  let state: "pending" | "completed" | "disposed" = "pending";
  const dispose = () => {
    state = "disposed";
    pending?.discard();
    pending = undefined;
    if (captured) for (const bytes of captured.values()) bytes.fill(0);
    captured = undefined;
  };
  try {
    preflight(envelopeInput);
    preflight(manifestInput);
    if (captureInput !== undefined) preflight(captureInput, 16);
    const envelope = parseOfflineTaskEnvelope(envelopeInput);
    const items = envelope.evidence.items;
    requireValue(items.length > 0);
    const expected = new Map(
      items.map((item) => [item.reference, item.sha256]),
    );
    const expectedBytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const m = record(manifestInput, ["version", "root", "files"]);
    requireValue(
      m.version === 1 &&
        typeof m.root === "string" &&
        isAbsolute(m.root) &&
        !m.root.includes("\0"),
    );
    requireValue(Array.isArray(m.files) && m.files.length === items.length);
    const references = new Set<string>(),
      paths = new Set<string>();
    const files = m.files.map((input) => {
      const f = record(input, ["reference", "path"]);
      requireValue(
        typeof f.reference === "string" &&
          expected.has(f.reference) &&
          !references.has(f.reference),
      );
      requireValue(
        typeof f.path === "string" &&
          f.path.length > 0 &&
          f.path.length <= 2000 &&
          !isAbsolute(f.path) &&
          !/[\\\u0000]/.test(f.path) &&
          f.path
            .split("/")
            .every((part) => part && part !== "." && part !== "..") &&
          !paths.has(f.path),
      );
      references.add(f.reference);
      paths.add(f.path);
      return { reference: f.reference, path: f.path };
    });
    const manifest: RestoreEvidenceManifest = {
      version: 1,
      root: m.root,
      files,
    };
    // EXACT legacy reader convention, including localeCompare. The envelope's
    // code-unit item ordering is intentionally not substituted here. Preserve
    // manifest order for locale-equivalent references, as the shared reader does.
    const expectedSetHash = digest(
      canonical(
        files
          .map((file) =>
            items.find((item) => item.reference === file.reference)!,
          )
          .sort((a, b) => a.reference.localeCompare(b.reference)),
      ),
    );
    requireValue(expectedSetHash === envelope.evidence.setHash);
    let capture: RestoreEvidenceCapture | undefined;
    if (captureInput !== undefined) {
      const c = record(captureInput, ["references", "maxBytes"]);
      requireValue(
        Array.isArray(c.references) &&
          c.references.length > 0 &&
          c.references.length <= 16,
      );
      requireValue(
        typeof c.maxBytes === "number" &&
          Number.isSafeInteger(c.maxBytes) &&
          c.maxBytes > 0 &&
          c.maxBytes <= 4 * MiB,
      );
      const selected = new Set<string>();
      let bytes = 0;
      for (const ref of c.references) {
        requireValue(typeof ref === "string" && !selected.has(ref));
        const item = items.find((item) => item.reference === ref);
        requireValue(item && item.bytes <= MiB);
        selected.add(ref);
        bytes += item.bytes;
      }
      requireValue(bytes <= c.maxBytes);
      capture = { references: [...selected], maxBytes: c.maxBytes };
    }
    const envelopeBinding = offlineTaskBinding(envelope);
    pending = readRestorePrivateEvidence(expected, manifest, capture);
    return Object.freeze({
      dispose,
      [Symbol.dispose]: dispose,
      complete() {
        try {
          requireValue(state === "pending" && pending);
          state = "completed";
          const result = pending.complete();
          captured = result.captured;
          // The shared reader hashes the SAME measured per-file byte counts,
          // references and digests. Equality to the envelope-derived commitment
          // binds every individual count, including uncaptured files; a total
          // byte check alone would not. No second open/read/stat-size substitute.
          requireValue(
            result.files === items.length &&
              result.bytes === expectedBytes &&
              result.setHash === expectedSetHash,
          );
          for (const [ref, bytes] of captured) {
            const item = items.find((item) => item.reference === ref);
            requireValue(
              item &&
                bytes.length === item.bytes &&
                digest(bytes) === item.sha256,
            );
          }
          return Object.freeze({
            status: "historical-byte-binding" as const,
            envelopeBinding,
            files: result.files,
            bytes: result.bytes,
            setHash: result.setHash,
            qualification: "unverified" as const,
          });
        } catch {
          dispose();
          fail();
        }
      },
    });
  } catch {
    dispose();
    fail();
  }
}
