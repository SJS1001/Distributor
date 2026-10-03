import { DatabaseSync, constants, type SQLInputValue } from "node:sqlite";
import { lstatSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError, check, type Row } from "./core.ts";

import {
  checkIntegrity,
  checkRegion,
  inspectConnection,
  SCHEMA_DDL,
  SCHEMA_VERSION,
  supportedSchemaHash,
} from "./schema.ts";
import type { Region } from "./iam.ts";
import {
  pinRestoreCandidateFiles,
  readRestoreCandidateSnapshot,
} from "./restore-candidate-snapshot.ts";

export type Owner =
  | "iam"
  | "catalog"
  | "inventory"
  | "procurement"
  | "orders"
  | "fulfillment"
  | "billing"
  | "warranty"
  | "integration"
  | "migration"
  | "report"
  | "platform";
export class Database {
  #db: DatabaseSync;
  #owner: Owner | null = null;
  #initializing = false;
  #initialized = false;
  #constructorTransaction = false;
  #initializationFailed = false;
  #inspecting = false;
  #openedFileIdentity?: { dev: bigint; ino: bigint };
  #openedPath: string;
  constructor(public path: string) {
    this.#openedPath = path;
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path, { timeout: 5000 });
    try {
      if (path !== ":memory:") {
        const stat = lstatSync(path, { bigint: true });
        this.#openedFileIdentity = { dev: stat.dev, ino: stat.ino };
      }
      this.#db.exec(
        "PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;",
      );
    } catch (error) {
      this.#db.close();
      throw error;
    }
    this.#db.setAuthorizer((action, first, second) => {
      // Only fixed synchronous inspection and approved journal setup enter this
      // scope. It grants reads/PRAGMAs, never DDL or transaction authority.
      if (
        this.#inspecting &&
        (action === constants.SQLITE_READ || action === constants.SQLITE_PRAGMA)
      )
        return constants.SQLITE_OK;
      if (
        [
          constants.SQLITE_ATTACH,
          constants.SQLITE_DETACH,
          constants.SQLITE_PRAGMA,
        ].includes(action)
      )
        return constants.SQLITE_DENY;
      if (
        this.#owner &&
        [constants.SQLITE_TRANSACTION, constants.SQLITE_SAVEPOINT].includes(
          action,
        )
      )
        return constants.SQLITE_DENY;
      const schemaActions = [
        constants.SQLITE_CREATE_TABLE,
        constants.SQLITE_DROP_TABLE,
        constants.SQLITE_CREATE_INDEX,
        constants.SQLITE_DROP_INDEX,
        constants.SQLITE_CREATE_TRIGGER,
        constants.SQLITE_DROP_TRIGGER,
        constants.SQLITE_CREATE_VIEW,
        constants.SQLITE_DROP_VIEW,
      ];
      const table = [
        constants.SQLITE_ALTER_TABLE,
        constants.SQLITE_CREATE_INDEX,
        constants.SQLITE_DROP_INDEX,
      ].includes(action)
        ? second
        : first;
      if (
        (schemaActions.includes(action) ||
          action === constants.SQLITE_ALTER_TABLE) &&
        table &&
        (!this.#owner || !table.startsWith(`${this.#owner}_`))
      )
        return constants.SQLITE_DENY;
      if (
        [
          constants.SQLITE_INSERT,
          constants.SQLITE_UPDATE,
          constants.SQLITE_DELETE,
          constants.SQLITE_READ,
        ].includes(action) &&
        first &&
        !first.startsWith("sqlite_") &&
        (!this.#owner || !first.startsWith(`${this.#owner}_`))
      ) {
        return constants.SQLITE_DENY;
      }
      return constants.SQLITE_OK;
    });
  }
  owned(owner: Owner): Store {
    return new Store(this, owner);
  }
  execute<T>(owner: Owner, fn: (database: DatabaseSync) => T): T {
    const previous = this.#owner;
    this.#owner = owner;
    try {
      return fn(this.#db);
    } finally {
      this.#owner = previous;
    }
  }
  #inspect<T>(fn: (db: DatabaseSync) => T): T {
    this.#inspecting = true;
    try {
      return fn(this.#db);
    } finally {
      this.#inspecting = false;
    }
  }
  #synchronous<T>(fn: () => T): T {
    const result = fn();
    if (result && typeof (result as { then?: unknown }).then === "function")
      throw new DomainError(
        "TRANSACTION",
        "Async work is forbidden inside a business transaction.",
      );
    return result;
  }
  // The application is the sole orchestrator. Module constructors retain their
  // ordinary owner scopes while their existing transactions join this boot.
  initializeSchema<T>(
    region: Region,
    eventReports: boolean,
    construct: () => T,
  ): T {
    check(
      !this.#initialized && !this.#initializing && this.#owner === null,
      "SCHEMA_INITIALIZATION",
      "Schema initialization is only allowed once per connection.",
    );
    // Journal mode changes persistent header bytes, even when a later business
    // transaction rolls back. Reject incompatible stores before changing it.
    const preflight = this.#inspect(inspectConnection);
    check(
      preflight.kind === "empty" || preflight.kind === "current",
      "SCHEMA_UPGRADE_REQUIRED",
      "Previous or unversioned stores require an operator-reviewed upgrade to a fresh file.",
    );
    check(
      preflight.region === null || preflight.region === region,
      "SCHEMA_REGION",
      "Store and runtime regions must match.",
    );
    if (preflight.kind === "current") this.#inspect(checkIntegrity);
    this.#inspect((db) => db.exec("PRAGMA journal_mode=WAL"));
    this.#db.exec("BEGIN IMMEDIATE");
    this.#initializing = true;
    try {
      const before = this.#inspect(inspectConnection);
      check(
        before.kind === "empty" || before.kind === "current",
        "SCHEMA_UPGRADE_REQUIRED",
        "Previous or unversioned stores require an operator-reviewed upgrade to a fresh file.",
      );
      check(
        before.region === null || before.region === region,
        "SCHEMA_REGION",
        "Store and runtime regions must match.",
      );
      if (before.kind === "current") this.#inspect(checkIntegrity);
      const result = this.#synchronous(construct);
      check(
        !this.#initializationFailed,
        "SCHEMA_INITIALIZATION",
        "A constructor transaction failed; initialization must roll back.",
      );
      const persistedReports = before.eventReports || eventReports;
      const store = this.owned("platform");
      if (before.kind === "empty") {
        store.migrate(SCHEMA_DDL);
        store.run(
          "INSERT INTO platform_schema_version VALUES(1,?,?,?,?,?)",
          SCHEMA_VERSION,
          supportedSchemaHash(persistedReports),
          Number(persistedReports),
          region,
          new Date().toISOString(),
        );
      } else if (persistedReports !== before.eventReports) {
        store.run(
          "UPDATE platform_schema_version SET schema_hash=?,event_reports=? WHERE singleton=1",
          supportedSchemaHash(persistedReports),
          Number(persistedReports),
        );
      }
      this.#inspect(inspectConnection);
      this.#inspect((db) => checkRegion(db, region, false));
      this.#inspect(checkIntegrity);
      this.#db.exec("COMMIT");
      this.#initialized = true;
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
      throw error;
    } finally {
      this.#initializing = false;
    }
  }
  // Native operations may assert a read fence inside their caller's atomic write.
  // This does not start/join transactions or escape an owning SQL callback.
  requireTransaction() {
    check(
      this.#owner === null && this.#db.isTransaction,
      "TRANSACTION",
      "This native fence requires an existing business transaction.",
    );
  }
  /** Fixed native maintenance read of this exact writer snapshot. No new
   * connection, SQL callback, transaction or permission is provided. */
  captureRestoreCandidateInTransaction() {
    this.requireTransaction();
    check(
      this.path === this.#openedPath,
      "RESTORE_REVIEW_CHANGED",
      "Candidate pathname differs from the opened application store.",
    );
    check(
      this.#initialized && !this.#initializing && this.#openedFileIdentity,
      "RESTORE_REVIEW",
      "Candidate hashing requires an initialized file-backed application store.",
    );
    const unchanged = pinRestoreCandidateFiles(
      this.path,
      this.#openedFileIdentity,
    );
    try {
      const candidate = this.#inspect(readRestoreCandidateSnapshot);
      unchanged();
      return candidate;
    } catch (error) {
      unchanged();
      throw error;
    }
  }
  transaction<T>(fn: () => T): T {
    // Calling this from a Store callback must not escape the SQL authorizer.
    check(
      this.#owner === null,
      "TRANSACTION",
      "Transactions cannot start inside an owner SQL scope.",
    );
    if (this.#initializing) {
      check(
        !this.#constructorTransaction,
        "TRANSACTION",
        "Nested business transactions are forbidden.",
      );
      this.#constructorTransaction = true;
      this.#db.exec("SAVEPOINT constructor_transaction");
      try {
        const result = this.#synchronous(fn);
        this.#db.exec("RELEASE constructor_transaction");
        return result;
      } catch (error) {
        this.#initializationFailed = true;
        this.#db.exec(
          "ROLLBACK TO constructor_transaction; RELEASE constructor_transaction",
        );
        throw error;
      } finally {
        this.#constructorTransaction = false;
      }
    }
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.#synchronous(fn);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.#db.close();
  }
}
export class Store {
  constructor(
    private database: Database,
    private owner: Owner,
  ) {}
  migrate(sql: string) {
    this.database.execute(this.owner, (db) => db.exec(sql));
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.database.execute(this.owner, (db) =>
      db.prepare(sql).run(...params),
    );
  }
  get<T extends Row = Row>(
    sql: string,
    ...params: SQLInputValue[]
  ): T | undefined {
    return this.database.execute(
      this.owner,
      (db) => db.prepare(sql).get(...params) as T | undefined,
    );
  }
  all<T extends Row = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.database.execute(
      this.owner,
      (db) => db.prepare(sql).all(...params) as T[],
    );
  }
  visit<T extends Row = Row>(
    sql: string,
    params: SQLInputValue[],
    visitor: (row: T) => unknown,
  ): void {
    this.database.execute(this.owner, (db) => {
      for (const row of db.prepare(sql).iterate(...params)) {
        const result = visitor(row as T);
        if (result && typeof (result as { then?: unknown }).then === "function")
          throw new DomainError(
            "ITERATION",
            "Async work is forbidden inside a database visitor.",
          );
      }
    });
  }
}
