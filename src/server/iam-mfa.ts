import { randomBytes } from "node:crypto";
import { check, digest, now, text, integer, type Actor } from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import { encodeSecret, FactorCipher, matchingStep } from "./totp.ts";

type Access = {
  required?: (actor: Actor) => boolean;
  authenticate: (actor: Actor, password: string, throttle: boolean) => Actor;
  revision: (actor: Actor) => number;
  changed: (actor: Actor) => { revision: number; sessionsEnded: number };
  failed: (actor: Actor) => void;
};
type Bundle = { secret: string; recoveryCodes: string[] };
type RecoveryBundle = { recoveryCodes: string[] };
export class MultiFactor {
  private store: Store;
  private cipher: FactorCipher;
  constructor(
    private database: Database,
    private platform: Platform,
    private access: Access,
    key?: string,
  ) {
    this.cipher = new FactorCipher(key);
    this.store = database.owned("iam");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS iam_mfa (user_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,secret TEXT NOT NULL,last_step INTEGER NOT NULL,enabled_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS iam_mfa_recovery (user_id TEXT NOT NULL,hash TEXT NOT NULL,used_at TEXT,PRIMARY KEY(user_id,hash)) STRICT;
      CREATE TABLE IF NOT EXISTS iam_mfa_pending (user_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,key TEXT NOT NULL,enrollment_id TEXT NOT NULL,revision INTEGER NOT NULL,material TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS iam_mfa_pending_expiry ON iam_mfa_pending(expires_at,user_id) WHERE material<>'';
    `);
    this.purgeExpiredEnrollments();
  }
  // Filesystem-authorized maintenance, never an HTTP operation. One atomic statement
  // bounds each batch; no key/decryption or principal data is needed.
  purgeExpiredEnrollments() {
    return {
      purged: Number(
        this.store.run(
          "UPDATE iam_mfa_pending SET material='' WHERE user_id IN (SELECT user_id FROM iam_mfa_pending WHERE expires_at<=? AND material<>'' ORDER BY expires_at,user_id LIMIT 100)",
          Date.now(),
        ).changes,
      ),
    };
  }
  // Called inside the identity security-change transaction; retain the retry
  // identity so an old request cannot silently receive a fresh setup bundle.
  invalidatePending(actor: Pick<Actor, "id" | "orgId">) {
    this.store.run(
      "UPDATE iam_mfa_pending SET material='' WHERE user_id=? AND org_id=? AND material<>''",
      actor.id,
      actor.orgId,
    );
  }
  private discardOwnExpired(actor: Actor) {
    // Commit before the setup transaction: its MFA_EXPIRED error must not bring
    // erased secrets back. Confirmation still rechecks expiry under its lock.
    this.store.run(
      "UPDATE iam_mfa_pending SET material='' WHERE user_id=? AND org_id=? AND expires_at<=? AND material<>''",
      actor.id,
      actor.orgId,
      Date.now(),
    );
  }
  summary(actor: Actor) {
    const row = this.store.get(
      "SELECT enabled_at FROM iam_mfa WHERE user_id=? AND org_id=?",
      actor.id,
      actor.orgId,
    );
    return {
      available: this.cipher.available,
      enabled: !!row,
      enabledAt: row?.enabled_at ?? null,
      recoveryCodesRemaining: Number(
        this.store.get(
          "SELECT COUNT(*) AS n FROM iam_mfa_recovery WHERE user_id=? AND used_at IS NULL",
          actor.id,
        )!.n,
      ),
    };
  }
  private context(actor: Actor, purpose: string) {
    return `${actor.orgId}:${actor.id}:${purpose}`;
  }
  private recoveryHash(actor: Actor, code: string) {
    return digest(`${actor.id}:${code.toLowerCase()}`);
  }
  // Called inside session creation's transaction: only a fully verified login receives a session.
  verifyLogin(actor: Actor, code: string | undefined, timestamp: number) {
    const factor = this.store.get(
      "SELECT * FROM iam_mfa WHERE user_id=? AND org_id=?",
      actor.id,
      actor.orgId,
    );
    if (!factor) return;
    this.cipher.require();
    check(
      code !== undefined,
      "MFA_REQUIRED",
      "Enter an authenticator code or an unused recovery code.",
      401,
    );
    this.consume(actor, factor, code, timestamp);
  }
  private consume(
    actor: Actor,
    factor: Record<string, unknown>,
    code: string,
    timestamp: number,
  ) {
    if (/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{8}){3}$/.test(code)) {
      const changed = this.store.run(
        "UPDATE iam_mfa_recovery SET used_at=? WHERE user_id=? AND hash=? AND used_at IS NULL",
        now(),
        actor.id,
        this.recoveryHash(actor, code),
      );
      check(
        Number(changed.changes) === 1,
        "MFA_INVALID",
        "Code is invalid or already used.",
        401,
      );
      this.platform.audit(actor, "user.mfa.recovery.used", actor.id, {});
      return;
    }
    const secret = this.cipher.decrypt<{ secret: string }>(
      String(factor.secret),
      this.context(actor, "factor"),
    ).secret;
    const step = matchingStep(
      secret,
      code,
      timestamp,
      Number(factor.last_step),
    );
    check(
      step !== null,
      "MFA_INVALID",
      "Code is invalid or already used. Wait for the next authenticator code.",
      401,
    );
    this.store.run(
      "UPDATE iam_mfa SET last_step=? WHERE user_id=? AND org_id=?",
      step,
      actor.id,
      actor.orgId,
    );
  }
  begin(
    actor: Actor,
    key: string,
    input: { currentPassword: string; revision: number },
  ) {
    text(key, "Idempotency key", 128);
    this.access.authenticate(actor, input.currentPassword, true);
    this.discardOwnExpired(actor);
    this.cipher.require();
    return this.database.transaction(() => {
      this.access.authenticate(actor, input.currentPassword, false);
      const revision = this.access.revision(actor);
      check(
        integer(input.revision, "security revision", 1) === revision,
        "STALE_USER",
        "Security changed. Refresh before setting up an authenticator.",
        409,
      );
      check(
        !this.summary(actor).enabled,
        "MFA_ENABLED",
        "An authenticator is already enabled.",
        409,
      );
      let pending = this.store.get(
        "SELECT * FROM iam_mfa_pending WHERE user_id=? AND org_id=?",
        actor.id,
        actor.orgId,
      );
      let bundle: Bundle;
      if (pending?.key === key) {
        check(
          Number(pending.revision) === revision &&
            pending.material !== "" &&
            Number(pending.expires_at) > Date.now(),
          "MFA_EXPIRED",
          "Setup expired or security changed. Start a new setup.",
          409,
        );
        bundle = this.cipher.decrypt<Bundle>(
          String(pending.material),
          this.context(actor, "pending"),
        );
      } else {
        bundle = {
          secret: encodeSecret(randomBytes(20)),
          recoveryCodes: Array.from({ length: 10 }, () =>
            randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
          ),
        };
        const enrollmentId = randomBytes(24).toString("base64url"),
          expiresAt = Date.now() + 10 * 60000;
        this.store.run(
          "INSERT INTO iam_mfa_pending VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET org_id=excluded.org_id,key=excluded.key,enrollment_id=excluded.enrollment_id,revision=excluded.revision,material=excluded.material,expires_at=excluded.expires_at",
          actor.id,
          actor.orgId,
          key,
          enrollmentId,
          revision,
          this.cipher.encrypt(bundle, this.context(actor, "pending")),
          expiresAt,
        );
        pending = { enrollment_id: enrollmentId, expires_at: expiresAt };
        this.platform.audit(actor, "user.mfa.setup.started", actor.id, {});
      }
      return {
        enrollmentId: String(pending.enrollment_id),
        expiresAt: Number(pending.expires_at),
        secret: bundle.secret,
        recoveryCodes: bundle.recoveryCodes,
      };
    });
  }
  confirm(
    actor: Actor,
    input: {
      currentPassword: string;
      enrollmentId: string;
      code: string;
      recoverySaved: boolean;
    },
  ) {
    this.access.authenticate(actor, input.currentPassword, true);
    this.discardOwnExpired(actor);
    return this.attempt(actor, () =>
      this.database.transaction(() => {
        this.access.authenticate(actor, input.currentPassword, false);
        this.cipher.require();
        const pending = this.store.get(
          "SELECT * FROM iam_mfa_pending WHERE user_id=? AND org_id=? AND enrollment_id=?",
          actor.id,
          actor.orgId,
          text(input.enrollmentId, "enrollment ID", 128),
        );
        check(
          pending &&
            pending.material !== "" &&
            Number(pending.expires_at) > Date.now() &&
            Number(pending.revision) === this.access.revision(actor),
          "MFA_EXPIRED",
          "Setup expired or security changed. Start a new setup.",
          409,
        );
        check(
          input.recoverySaved === true,
          "VALIDATION",
          "Save your recovery codes before enabling the authenticator.",
          400,
        );
        check(
          !this.summary(actor).enabled,
          "MFA_ENABLED",
          "An authenticator is already enabled.",
          409,
        );
        const bundle = this.cipher.decrypt<Bundle>(
          String(pending.material),
          this.context(actor, "pending"),
        );
        const step = matchingStep(bundle.secret, input.code, Date.now());
        check(
          step !== null,
          "MFA_INVALID",
          "Authenticator code is invalid.",
          401,
        );
        this.store.run(
          "INSERT INTO iam_mfa VALUES(?,?,?,?,?)",
          actor.id,
          actor.orgId,
          this.cipher.encrypt(
            { secret: bundle.secret },
            this.context(actor, "factor"),
          ),
          step,
          now(),
        );
        for (const code of bundle.recoveryCodes)
          this.store.run(
            "INSERT INTO iam_mfa_recovery VALUES(?,?,NULL)",
            actor.id,
            this.recoveryHash(actor, code),
          );
        this.store.run("DELETE FROM iam_mfa_pending WHERE user_id=?", actor.id);
        const changed = this.access.changed(actor);
        this.platform.audit(actor, "user.mfa.enabled", actor.id, changed);
        return { ...changed, sessionEnded: true };
      }),
    );
  }
  disable(
    actor: Actor,
    input: { currentPassword: string; code: string; revision: number },
  ) {
    this.access.authenticate(actor, input.currentPassword, true);
    return this.attempt(actor, () =>
      this.database.transaction(() => {
        this.access.authenticate(actor, input.currentPassword, false);
        this.cipher.require();
        check(
          !this.access.required?.(actor),
          "MFA_POLICY",
          "Your role requires an authenticator; removal is unavailable.",
          403,
        );
        check(
          integer(input.revision, "security revision", 1) ===
            this.access.revision(actor),
          "STALE_USER",
          "Security changed. Refresh before removing the authenticator.",
          409,
        );
        const factor = this.store.get(
          "SELECT * FROM iam_mfa WHERE user_id=? AND org_id=?",
          actor.id,
          actor.orgId,
        );
        check(factor, "MFA_DISABLED", "No authenticator is enabled.", 409);
        this.consume(actor, factor, input.code, Date.now());
        this.store.run("DELETE FROM iam_mfa WHERE user_id=?", actor.id);
        this.store.run(
          "DELETE FROM iam_mfa_recovery WHERE user_id=?",
          actor.id,
        );
        this.store.run("DELETE FROM iam_mfa_pending WHERE user_id=?", actor.id);
        const changed = this.access.changed(actor);
        this.platform.audit(actor, "user.mfa.disabled", actor.id, changed);
        return { ...changed, sessionEnded: true };
      }),
    );
  }
  prepareRecovery(
    actor: Actor,
    key: string,
    input: { currentPassword: string; revision: number },
  ) {
    text(key, "Idempotency key", 128);
    this.access.authenticate(actor, input.currentPassword, true);
    this.discardOwnExpired(actor);
    this.cipher.require();
    return this.database.transaction(() => {
      this.access.authenticate(actor, input.currentPassword, false);
      const revision = this.access.revision(actor);
      check(
        integer(input.revision, "security revision", 1) === revision,
        "STALE_USER",
        "Security changed. Refresh before replacing recovery codes.",
        409,
      );
      check(
        this.summary(actor).enabled,
        "MFA_DISABLED",
        "No authenticator is enabled.",
        409,
      );
      let pending = this.store.get(
        "SELECT * FROM iam_mfa_pending WHERE user_id=? AND org_id=?",
        actor.id,
        actor.orgId,
      );
      let bundle: RecoveryBundle;
      if (pending?.key === key) {
        check(
          Number(pending.revision) === revision &&
            pending.material !== "" &&
            Number(pending.expires_at) > Date.now(),
          "MFA_EXPIRED",
          "Replacement expired or security changed. Prepare new recovery codes.",
          409,
        );
        bundle = this.cipher.decrypt<RecoveryBundle>(
          String(pending.material),
          this.context(actor, "pending-recovery"),
        );
      } else {
        bundle = {
          recoveryCodes: Array.from({ length: 10 }, () =>
            randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
          ),
        };
        const renewalId = randomBytes(24).toString("base64url"),
          expiresAt = Date.now() + 10 * 60000;
        this.store.run(
          "INSERT INTO iam_mfa_pending VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET org_id=excluded.org_id,key=excluded.key,enrollment_id=excluded.enrollment_id,revision=excluded.revision,material=excluded.material,expires_at=excluded.expires_at",
          actor.id,
          actor.orgId,
          key,
          renewalId,
          revision,
          this.cipher.encrypt(bundle, this.context(actor, "pending-recovery")),
          expiresAt,
        );
        pending = { enrollment_id: renewalId, expires_at: expiresAt };
        this.platform.audit(actor, "user.mfa.recovery.prepared", actor.id, {});
      }
      return {
        renewalId: String(pending.enrollment_id),
        expiresAt: Number(pending.expires_at),
        recoveryCodes: bundle.recoveryCodes,
      };
    });
  }
  confirmRecovery(
    actor: Actor,
    input: {
      currentPassword: string;
      renewalId: string;
      code: string;
      recoverySaved: boolean;
    },
  ) {
    this.access.authenticate(actor, input.currentPassword, true);
    this.discardOwnExpired(actor);
    return this.attempt(actor, () =>
      this.database.transaction(() => {
        this.access.authenticate(actor, input.currentPassword, false);
        this.cipher.require();
        const pending = this.store.get(
          "SELECT * FROM iam_mfa_pending WHERE user_id=? AND org_id=? AND enrollment_id=?",
          actor.id,
          actor.orgId,
          text(input.renewalId, "renewal ID", 128),
        );
        check(
          pending &&
            pending.material !== "" &&
            Number(pending.expires_at) > Date.now() &&
            Number(pending.revision) === this.access.revision(actor),
          "MFA_EXPIRED",
          "Replacement expired or security changed. Prepare new recovery codes.",
          409,
        );
        check(
          input.recoverySaved === true,
          "VALIDATION",
          "Save your new recovery codes before replacing the current codes.",
          400,
        );
        const factor = this.store.get(
          "SELECT * FROM iam_mfa WHERE user_id=? AND org_id=?",
          actor.id,
          actor.orgId,
        );
        check(factor, "MFA_DISABLED", "No authenticator is enabled.", 409);
        const bundle = this.cipher.decrypt<RecoveryBundle>(
          String(pending.material),
          this.context(actor, "pending-recovery"),
        );
        // Only an existing factor can authorize activation; inactive new codes cannot.
        this.consume(actor, factor, input.code, Date.now());
        this.store.run(
          "DELETE FROM iam_mfa_recovery WHERE user_id=?",
          actor.id,
        );
        for (const code of bundle.recoveryCodes)
          this.store.run(
            "INSERT INTO iam_mfa_recovery VALUES(?,?,NULL)",
            actor.id,
            this.recoveryHash(actor, code),
          );
        this.store.run("DELETE FROM iam_mfa_pending WHERE user_id=?", actor.id);
        const changed = this.access.changed(actor);
        this.platform.audit(
          actor,
          "user.mfa.recovery.replaced",
          actor.id,
          changed,
        );
        return { ...changed, sessionEnded: true };
      }),
    );
  }
  prepareReplacement(
    actor: Actor,
    key: string,
    input: { currentPassword: string; revision: number },
  ) {
    text(key, "Idempotency key", 128);
    this.access.authenticate(actor, input.currentPassword, true);
    this.discardOwnExpired(actor);
    this.cipher.require();
    return this.database.transaction(() => {
      this.access.authenticate(actor, input.currentPassword, false);
      const revision = this.access.revision(actor);
      check(
        integer(input.revision, "security revision", 1) === revision,
        "STALE_USER",
        "Security changed. Refresh before replacing the authenticator.",
        409,
      );
      check(
        this.summary(actor).enabled,
        "MFA_DISABLED",
        "No authenticator is enabled.",
        409,
      );
      let pending = this.store.get(
        "SELECT * FROM iam_mfa_pending WHERE user_id=? AND org_id=?",
        actor.id,
        actor.orgId,
      );
      let bundle: Bundle;
      if (pending?.key === key) {
        check(
          Number(pending.revision) === revision &&
            pending.material !== "" &&
            Number(pending.expires_at) > Date.now(),
          "MFA_EXPIRED",
          "Replacement expired or security changed. Prepare a new authenticator.",
          409,
        );
        bundle = this.cipher.decrypt<Bundle>(
          String(pending.material),
          this.context(actor, "pending-factor"),
        );
      } else {
        bundle = {
          secret: encodeSecret(randomBytes(20)),
          recoveryCodes: Array.from({ length: 10 }, () =>
            randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
          ),
        };
        const replacementId = randomBytes(24).toString("base64url"),
          expiresAt = Date.now() + 10 * 60000;
        this.store.run(
          "INSERT INTO iam_mfa_pending VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET org_id=excluded.org_id,key=excluded.key,enrollment_id=excluded.enrollment_id,revision=excluded.revision,material=excluded.material,expires_at=excluded.expires_at",
          actor.id,
          actor.orgId,
          key,
          replacementId,
          revision,
          this.cipher.encrypt(bundle, this.context(actor, "pending-factor")),
          expiresAt,
        );
        pending = { enrollment_id: replacementId, expires_at: expiresAt };
        this.platform.audit(
          actor,
          "user.mfa.replacement.prepared",
          actor.id,
          {},
        );
      }
      return {
        replacementId: String(pending.enrollment_id),
        expiresAt: Number(pending.expires_at),
        secret: bundle.secret,
        recoveryCodes: bundle.recoveryCodes,
      };
    });
  }
  confirmReplacement(
    actor: Actor,
    input: {
      currentPassword: string;
      replacementId: string;
      currentCode: string;
      newCode: string;
      recoverySaved: boolean;
    },
  ) {
    this.access.authenticate(actor, input.currentPassword, true);
    this.discardOwnExpired(actor);
    return this.attempt(actor, () =>
      this.database.transaction(() => {
        this.access.authenticate(actor, input.currentPassword, false);
        this.cipher.require();
        const pending = this.store.get(
          "SELECT * FROM iam_mfa_pending WHERE user_id=? AND org_id=? AND enrollment_id=?",
          actor.id,
          actor.orgId,
          text(input.replacementId, "replacement ID", 128),
        );
        check(
          pending &&
            pending.material !== "" &&
            Number(pending.expires_at) > Date.now() &&
            Number(pending.revision) === this.access.revision(actor),
          "MFA_EXPIRED",
          "Replacement expired or security changed. Prepare a new authenticator.",
          409,
        );
        check(
          input.recoverySaved === true,
          "VALIDATION",
          "Save your new recovery codes before replacing the authenticator.",
          400,
        );
        const factor = this.store.get(
          "SELECT * FROM iam_mfa WHERE user_id=? AND org_id=?",
          actor.id,
          actor.orgId,
        );
        check(factor, "MFA_DISABLED", "No authenticator is enabled.", 409);
        const bundle = this.cipher.decrypt<Bundle>(
          String(pending.material),
          this.context(actor, "pending-factor"),
        );
        const timestamp = Date.now();
        const step = matchingStep(bundle.secret, input.newCode, timestamp);
        check(
          step !== null,
          "MFA_INVALID",
          "New authenticator code is invalid.",
          401,
        );
        // Both proofs belong to this transaction; a failure cannot consume the old
        // factor or install only part of the replacement. MFA never becomes disabled.
        this.consume(actor, factor, input.currentCode, timestamp);
        this.store.run(
          "UPDATE iam_mfa SET secret=?,last_step=?,enabled_at=? WHERE user_id=? AND org_id=?",
          this.cipher.encrypt(
            { secret: bundle.secret },
            this.context(actor, "factor"),
          ),
          step,
          now(),
          actor.id,
          actor.orgId,
        );
        this.store.run(
          "DELETE FROM iam_mfa_recovery WHERE user_id=?",
          actor.id,
        );
        for (const code of bundle.recoveryCodes)
          this.store.run(
            "INSERT INTO iam_mfa_recovery VALUES(?,?,NULL)",
            actor.id,
            this.recoveryHash(actor, code),
          );
        this.store.run("DELETE FROM iam_mfa_pending WHERE user_id=?", actor.id);
        const changed = this.access.changed(actor);
        this.platform.audit(actor, "user.mfa.replaced", actor.id, changed);
        return { ...changed, sessionEnded: true };
      }),
    );
  }
  // Restore may otherwise resurrect already-used recovery codes from the snapshot.
  invalidateRestoredFactors() {
    this.store.run(
      "UPDATE iam_mfa_recovery SET used_at=? WHERE used_at IS NULL",
      now(),
    );
    this.store.run(
      "UPDATE iam_mfa SET last_step=MAX(last_step,?)",
      Math.floor(Date.now() / 30000) + 1,
    );
    this.store.run("DELETE FROM iam_mfa_pending");
  }
  private attempt<T>(actor: Actor, run: () => T): T {
    try {
      return run();
    } catch (error) {
      if ((error as { code?: string }).code === "MFA_INVALID")
        this.access.failed(actor);
      throw error;
    }
  }
}
