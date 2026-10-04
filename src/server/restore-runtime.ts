import { types } from "node:util";
import { check, type Actor } from "./core.ts";
import type { Application } from "./application.ts";
import type { RestoreRuntimeConfiguration } from "./runtime-host.ts";
import type { RestoreApproval } from "./restore-review.ts";
import type {
  RestoreRelease,
  RestoreReleaseInput,
} from "./restore-activation.ts";
import { RestoreOfflineFailedRefundCoordinator } from "./restore-offline-failed-refund-coordinator.ts";
import { RestoreOfflineOriginalCancellationCoordinator } from "./restore-offline-original-cancellation-coordinator.ts";
import { RestoreOfflineOriginalLeaseRetirementCoordinator } from "./restore-offline-original-lease-retirement-coordinator.ts";
import { RestoreOfflineCanadaPostMemberCoordinator } from "./restore-offline-canada-post-member-coordinator.ts";
import { RestoreOfflineCheckoutPaidCoordinator } from "./restore-offline-checkout-paid-coordinator.ts";

const fields: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "release-status": ["id"],
  "release-prepare": ["input"],
  "release-approve": ["id", "approvals"],
  "release-activate": ["input"],
  "release-rollback": ["id"],
  "release-supersede": ["id"],
  "offline-failed-refund": [
    "executor",
    "envelope",
    "approvals",
    "manifest",
    "reference",
  ],
  "offline-failed-refund-recover": ["executor", "envelope"],
  "offline-original-cancellation": [
    "preparer",
    "executor",
    "envelope",
    "approvals",
    "manifest",
    "reference",
  ],
  "offline-original-cancellation-recover": ["preparer", "executor", "envelope"],
  "offline-original-lease-retirement": [
    "preparer",
    "executor",
    "envelope",
    "approvals",
    "payload",
  ],
  "offline-original-lease-retirement-recover": [
    "preparer",
    "executor",
    "envelope",
  ],
  "offline-canada-post-member": [
    "preparer",
    "executor",
    "envelope",
    "approvals",
    "manifest",
  ],
  "offline-canada-post-member-recover": ["executor", "envelope"],
  "offline-checkout-paid": [
    "preparer",
    "executor",
    "envelope",
    "approvals",
    "manifest",
  ],
  "offline-checkout-paid-recover": ["preparer", "executor", "envelope"],
});

function insist(condition: unknown): asserts condition {
  check(condition, "RESTORE_INPUT", "Invalid restore operator input.");
}

/** Detach untrusted input before opening a CLI store or invoking native/host
 * code. Native operations still validate signatures, authority and domain data. */
export function parseRestoreOperatorRequest(action: string, input: unknown) {
  insist(Object.hasOwn(fields, action));
  let nodes = 0;
  let bytes = 0;
  const copy = (value: unknown, depth: number): unknown => {
    insist(++nodes <= 20000 && depth <= 32);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      insist(Number.isSafeInteger(value));
      return value;
    }
    if (typeof value === "string") {
      insist(
        value.length <= 65536 &&
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            value,
          ),
      );
      bytes += Buffer.byteLength(value, "utf8");
      insist(bytes <= 1024 * 1024);
      return value;
    }
    insist(
      typeof value === "object" && value !== null && !types.isProxy(value),
    );
    const array = Array.isArray(value);
    insist(
      array ||
        Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null,
    );
    const descriptors: Record<string, PropertyDescriptor> =
      Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    insist(keys.length <= 10001);
    if (array) {
      const length = descriptors.length?.value;
      insist(
        Number.isSafeInteger(length) &&
          length >= 0 &&
          length <= 10000 &&
          keys.length === length + 1,
      );
      const result: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        insist(descriptor && "value" in descriptor && descriptor.enumerable);
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      insist(
        typeof key === "string" &&
          key.length <= 128 &&
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            key,
          ) &&
          !["__proto__", "constructor", "prototype"].includes(key),
      );
      bytes += Buffer.byteLength(key, "utf8");
      insist(bytes <= 1024 * 1024);
      const descriptor = descriptors[key]!;
      insist("value" in descriptor && descriptor.enumerable);
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  };
  const value = copy(input, 0);
  insist(value !== null && typeof value === "object" && !Array.isArray(value));
  const request = value as Record<string, unknown>;
  const allowed = fields[action]!;
  insist(Object.keys(request).every((key) => allowed.includes(key)));
  if (action !== "release-status")
    insist(allowed.every((key) => Object.hasOwn(request, key)));
  if (Object.hasOwn(request, "id"))
    insist(
      typeof request.id === "string" &&
        request.id.length > 0 &&
        request.id.length <= 200,
    );
  return request;
}

function hostRecord(value: unknown, allowed: readonly string[]) {
  check(
    value &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null),
    "RESTORE_CONFIG",
    "Invalid static restore configuration.",
  );
  const descriptors: Record<string, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(value);
  check(
    Reflect.ownKeys(descriptors).every(
      (key) =>
        typeof key === "string" &&
        allowed.includes(key) &&
        "value" in descriptors[key]!,
    ),
    "RESTORE_CONFIG",
    "Invalid static restore configuration.",
  );
}

function releaseSummary(release: RestoreRelease) {
  return {
    version: release.version,
    id: release.id,
    revision: release.revision,
    state: release.state,
    phase: release.phase,
    adapter: release.adapter,
    binding: release.binding,
    evidenceSetHash: release.evidenceSetHash,
  };
}

/** Private operator composition; never exposed as a generic HTTP operation. */
export class RestoreRuntime {
  readonly #app: Application;
  readonly #installed: boolean;
  readonly #activation: boolean;
  readonly #offlineActions = new Set<string>();
  #refund?: RestoreOfflineFailedRefundCoordinator;
  #cancellation?: RestoreOfflineOriginalCancellationCoordinator;
  #retirement?: RestoreOfflineOriginalLeaseRetirementCoordinator;
  #canadaPost?: RestoreOfflineCanadaPostMemberCoordinator;
  #checkout?: RestoreOfflineCheckoutPaidCoordinator;

  constructor(app: Application, host?: RestoreRuntimeConfiguration) {
    this.#app = app;
    this.#installed = host !== undefined;
    this.#activation = false;
    if (host === undefined) return;
    hostRecord(host, [
      "version",
      "activation",
      "nativeDispositions",
      "offline",
    ]);
    check(
      host.version === 1,
      "RESTORE_CONFIG",
      "Unsupported static restore configuration.",
    );
    if (host.activation !== undefined) {
      hostRecord(host.activation, ["adapter", "loadTrust"]);
      check(
        typeof host.activation.loadTrust === "function" &&
          host.activation.adapter &&
          !types.isProxy(host.activation.adapter),
        "RESTORE_CONFIG",
        "Invalid static restore configuration.",
      );
    }
    if (host.offline !== undefined) {
      hostRecord(host.offline, [
        "failedRefund",
        "originalCancellation",
        "originalLeaseRetirement",
        "canadaPostMember",
        "checkoutPaid",
      ]);
      const h = host.offline;
      if (h.failedRefund) {
        this.#offlineActions.add("offline-failed-refund");
        this.#refund = new RestoreOfflineFailedRefundCoordinator(
          app.database,
          app.identity,
          app.billing,
          app.platform,
          h.failedRefund,
        );
      }
      if (h.originalCancellation) {
        this.#offlineActions.add("offline-original-cancellation");
        this.#cancellation = new RestoreOfflineOriginalCancellationCoordinator(
          app.database,
          app.identity,
          app.integration.costs.journals,
          app.platform,
          h.originalCancellation,
        );
      }
      if (h.originalLeaseRetirement) {
        this.#offlineActions.add("offline-original-lease-retirement");
        this.#retirement = new RestoreOfflineOriginalLeaseRetirementCoordinator(
          app.database,
          app.identity,
          app.platform,
          app.integration.costs.journals,
          h.originalLeaseRetirement,
        );
      }
      if (h.canadaPostMember) {
        this.#offlineActions.add("offline-canada-post-member");
        this.#canadaPost = new RestoreOfflineCanadaPostMemberCoordinator(
          app.database,
          app.identity,
          app.platform,
          app.fulfillment,
          app.carriers,
          h.canadaPostMember,
        );
      }
      if (h.checkoutPaid) {
        this.#offlineActions.add("offline-checkout-paid");
        this.#checkout = new RestoreOfflineCheckoutPaidCoordinator(
          app.database,
          app.identity,
          app.platform,
          app.billing,
          app.integration.checkouts,
          h.checkoutPaid,
        );
      }
    }
    if (host.nativeDispositions !== undefined)
      app.configureRestoreNativeDispositions(host.nativeDispositions);
    if (host.activation !== undefined) {
      const activation = host.activation;
      const loadTrust = activation.loadTrust;
      // Preserve current trust lookup on every native request, never cache its result.
      app.platform.restore.configure(activation.adapter, () =>
        loadTrust.call(activation),
      );
      this.#activation = true;
    }
  }

  installed() {
    return this.#installed;
  }

  run(action: string, input: unknown): unknown {
    const request = parseRestoreOperatorRequest(action, input);
    const restore = this.#app.platform.restore;
    if (action === "release-status") {
      const release =
        request.id === undefined
          ? restore.current()
          : restore.get(request.id as string);
      return {
        hostInstalled: this.#installed,
        release: release ? releaseSummary(release) : null,
      };
    }
    if (action.startsWith("release-")) {
      check(
        this.#activation,
        "RESTORE_DISABLED",
        "Static restore host configuration is required.",
        503,
      );
      switch (action) {
        case "release-prepare":
          return releaseSummary(
            restore.prepare(request.input as RestoreReleaseInput),
          );
        case "release-approve":
          return releaseSummary(
            restore.approveRelease(
              request.id as string,
              request.approvals as RestoreApproval[],
            ),
          );
        case "release-activate":
          return releaseSummary(
            restore.activate(request.input as RestoreReleaseInput),
          );
        case "release-rollback":
          return releaseSummary(restore.rollback(request.id as string));
        case "release-supersede":
          return releaseSummary(restore.supersede(request.id as string));
      }
    }
    const required = <T>(coordinator: T | undefined): T => {
      check(
        this.#offlineActions.has(action) && coordinator !== undefined,
        "RESTORE_OFFLINE_DISABLED",
        "Static offline host configuration is required.",
        503,
      );
      return coordinator;
    };
    let result: { status: string; resultHash: string };
    switch (action) {
      case "offline-failed-refund":
        result = required(this.#refund).execute(
          request.executor as Actor,
          request.envelope,
          request.approvals,
          request.manifest,
          request.reference,
        );
        break;
      case "offline-failed-refund-recover":
        result = this.#app.database.transaction(() =>
          (this.#refund ??= new RestoreOfflineFailedRefundCoordinator(
            this.#app.database,
            this.#app.identity,
            this.#app.billing,
            this.#app.platform,
          )).recoverInTransaction(request.executor as Actor, request.envelope),
        );
        break;
      case "offline-original-cancellation":
        result = required(this.#cancellation).execute(
          request.preparer as Actor,
          request.executor as Actor,
          request.envelope,
          request.approvals,
          request.manifest,
          request.reference,
        );
        break;
      case "offline-original-cancellation-recover":
        result = this.#app.database.transaction(() =>
          (this.#cancellation ??=
            new RestoreOfflineOriginalCancellationCoordinator(
              this.#app.database,
              this.#app.identity,
              this.#app.integration.costs.journals,
              this.#app.platform,
            )).recoverRetainedInTransaction(
            request.preparer as Actor,
            request.executor as Actor,
            request.envelope,
          ),
        );
        break;
      case "offline-original-lease-retirement":
        result = required(this.#retirement).execute(
          request.preparer as Actor,
          request.executor as Actor,
          request.envelope,
          request.approvals,
          request.payload,
        );
        break;
      case "offline-original-lease-retirement-recover":
        result = this.#app.database.transaction(() =>
          (this.#retirement ??=
            new RestoreOfflineOriginalLeaseRetirementCoordinator(
              this.#app.database,
              this.#app.identity,
              this.#app.platform,
              this.#app.integration.costs.journals,
            )).recoverRetainedInTransaction(
            request.preparer as Actor,
            request.executor as Actor,
            request.envelope,
          ),
        );
        break;
      case "offline-canada-post-member":
        result = required(this.#canadaPost).execute(
          request.preparer as Actor,
          request.executor as Actor,
          request.envelope,
          request.approvals,
          request.manifest,
        );
        break;
      case "offline-canada-post-member-recover":
        result = this.#app.database.transaction(() =>
          (this.#canadaPost ??= new RestoreOfflineCanadaPostMemberCoordinator(
            this.#app.database,
            this.#app.identity,
            this.#app.platform,
            this.#app.fulfillment,
            this.#app.carriers,
          )).recoverRetainedInTransaction(request.executor, request.envelope),
        );
        break;
      case "offline-checkout-paid":
        result = required(this.#checkout).execute(
          request.preparer,
          request.executor,
          request.envelope,
          request.approvals,
          request.manifest,
        );
        break;
      case "offline-checkout-paid-recover":
        result = this.#app.database.transaction(() =>
          (this.#checkout ??= new RestoreOfflineCheckoutPaidCoordinator(
            this.#app.database,
            this.#app.identity,
            this.#app.platform,
            this.#app.billing,
            this.#app.integration.checkouts,
          )).recoverRetainedInTransaction(
            request.executor,
            request.preparer,
            request.envelope,
          ),
        );
        break;
      default:
        insist(false);
    }
    return {
      version: 1,
      action,
      status: result.status,
      resultHash: result.resultHash,
    };
  }
}
