import { isAbsolute } from "node:path";
import { types } from "node:util";
import { canonical, check, digest, DomainError } from "./core.ts";
import {
  compareOfflineFailedRefundEvidence,
  type OfflineFailedRefundComparison,
} from "./integration-offline-refund-evidence.ts";
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

// Only JSON.parse output from the bounded private buffer reaches this walk.
// Iterative preflight must finish BEFORE recursive canonicalization/comparison.
function refundJsonShape(input: unknown) {
  const stack = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    requireValue(++nodes <= 4096 && depth <= 16);
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number") {
      requireValue(Number.isSafeInteger(value) && !Object.is(value, -0));
      continue;
    }
    if (typeof value === "string") {
      requireValue(value.length <= 8192 && !/[\ud800-\udfff]/u.test(value));
      continue;
    }
    requireValue(typeof value === "object");
    if (Array.isArray(value)) {
      requireValue(value.length <= 128);
      for (const child of value) stack.push({ value: child, depth: depth + 1 });
    } else {
      const keys = Object.keys(value);
      requireValue(keys.length <= 64);
      for (const key of keys) {
        requireValue(
          key.length <= 128 &&
            !/[\ud800-\udfff]/u.test(key) &&
            !["__proto__", "constructor", "prototype"].includes(key),
        );
        stack.push({
          value: (value as Record<string, unknown>)[key],
          depth: depth + 1,
        });
      }
    }
  }
}

// Fixed comparator JSON domain: code-unit key order, preserving array order.
// This does NOT replace the legacy evidence-set canonical/hash convention.
function refundCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(refundCanonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${refundCanonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export type OfflinePrivateEvidenceSummary = Readonly<{
  status: "historical-byte-binding";
  envelopeBinding: string;
  files: number;
  bytes: number;
  setHash: string;
  qualification: "unverified";
}>;

/** Opaque, process-local lifetime. No byte/map getter or parser callback port.
 * The one fixed refund comparator consumes a completed capture once and erases
 * every capture on success or refusal. Its result is historical consistency only.
 * Always dispose in finally (or use `using`), including on authority failure. */
export type OfflinePrivateEvidenceHandle = Readonly<{
  complete(): OfflinePrivateEvidenceSummary;
  compareFailedRefund(reference: unknown): OfflineFailedRefundComparison;
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
    const handle = {
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
    };
    // Non-enumerable addition preserves the original public method enumeration
    // and serialization. This property is fixed and non-replaceable, not a port.
    return Object.freeze(
      Object.defineProperty(handle, "compareFailedRefund", {
        value(reference: unknown): OfflineFailedRefundComparison {
          try {
            requireValue(state === "completed" && captured);
            requireValue(
              envelope.task.owner === "integration" &&
                envelope.task.name ===
                  "integration.stripe-refund-failed.import" &&
                envelope.task.version === 1,
            );
            requireValue(
              typeof reference === "string" &&
                reference.length > 0 &&
                reference.length <= 2000 &&
                items.some((item) => item.reference === reference),
            );
            const bytes = captured.get(reference);
            requireValue(
              bytes && bytes.length > 0 && bytes.length <= 64 * 1024,
            );
            // Pass the OWNED captured allocation directly; no copy, getter or
            // second read. Retain BOM so JSON parsing refuses it rather than
            // silently stripping it. Fatal UTF-8 rejects replacement decoding.
            const text = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(bytes);
            const input: unknown = JSON.parse(text);
            refundJsonShape(input);
            // Duplicate keys and every alternative serialization differ from
            // this exact canonical form even if JSON.parse normalized them.
            requireValue(refundCanonical(input) === text);
            return compareOfflineFailedRefundEvidence(input);
          } catch {
            fail();
          } finally {
            dispose();
          }
        },
        enumerable: false,
        writable: false,
        configurable: false,
      }),
    ) as OfflinePrivateEvidenceHandle;
  } catch {
    dispose();
    fail();
  }
}
