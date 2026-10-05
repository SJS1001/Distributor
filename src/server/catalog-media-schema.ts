export const CATALOG_MEDIA_DDL = `
CREATE TABLE IF NOT EXISTS catalog_resources(
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,product_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('image','literature','installation','maintenance','other')),
 title TEXT NOT NULL,alt_text TEXT NOT NULL,models TEXT NOT NULL,language TEXT NOT NULL,revision TEXT NOT NULL,source TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 10000),state TEXT NOT NULL CHECK(state IN('draft','published','retired')),
 version INTEGER NOT NULL CHECK(version>0),media_type TEXT NOT NULL CHECK(media_type IN('image/png','application/pdf','text/uri-list')),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 0 AND 16777216),content_hash TEXT NOT NULL,external_url TEXT NOT NULL,
 inspection TEXT NOT NULL CHECK(inspection IN('normalized','quarantined','approved','link')),
 content BLOB NOT NULL CHECK(length(content)=byte_length),created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(product_id) REFERENCES catalog_products(id)
) STRICT;
CREATE INDEX IF NOT EXISTS catalog_resources_product ON catalog_resources(org_id,product_id,position,id);
CREATE TABLE IF NOT EXISTS catalog_resource_history(
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,resource_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(resource_id) REFERENCES catalog_resources(id)
) STRICT;
CREATE TRIGGER IF NOT EXISTS catalog_resource_history_no_update BEFORE UPDATE ON catalog_resource_history BEGIN SELECT RAISE(ABORT,'Resource history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS catalog_resource_history_no_delete BEFORE DELETE ON catalog_resource_history BEGIN SELECT RAISE(ABORT,'Resource history is immutable'); END;
`;

export const CATALOG_MEDIA_SCHEMA = CATALOG_MEDIA_DDL.trim()
  .split(/;\s*(?=CREATE)/)
  .map((sql) => {
    const normalized = sql
      .trim()
      .replace(/;$/, "")
      .replaceAll(" IF NOT EXISTS", "");
    const match = /^CREATE (TABLE|INDEX|TRIGGER) (\w+)/.exec(normalized)!;
    const table =
      match[1] === "TABLE"
        ? match[2]!
        : /(?:ON|UPDATE ON|DELETE ON) (\w+)/.exec(normalized)![1]!;
    return {
      type: match[1]!.toLowerCase(),
      name: match[2]!,
      tbl_name: table,
      sql: normalized,
    };
  });
