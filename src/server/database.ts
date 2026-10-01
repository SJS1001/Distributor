import { DatabaseSync, constants, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError, type Row } from "./core.ts";

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
  | "platform";
export class Database {
  #db: DatabaseSync;
  #owner: Owner | null = null;
  constructor(public path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path, { timeout: 5000 });
    this.#db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
    );
    this.#db.setAuthorizer((action, first, second) => {
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
  transaction<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new DomainError(
          "TRANSACTION",
          "Async work is forbidden inside a business transaction.",
        );
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
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
}
