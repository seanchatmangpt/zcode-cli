import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { ComplianceRefusalError } from "./config.ts";
import {
  validateOcel2,
  type Ocel2AttributeSchema,
  type Ocel2Document,
  type Ocel2Event,
  type Ocel2EventAttribute,
  type Ocel2Object,
  type Ocel2ObjectAttribute,
  type Ocel2Relationship,
  type Ocel2TypeSchema
} from "./ocel2.ts";

const DEFAULT_MIN_RETENTION_DAYS = 180;
const MS_PER_DAY = 86_400_000;
const RESERVED_EVENT_COLS_LOWER = new Set(["ocel_id", "ocel_time", "ocel_type"]);
const RESERVED_OBJECT_COLS_LOWER = new Set([
  "ocel_id",
  "ocel_time",
  "ocel_changed_field",
  "ocel_type"
]);
const CANONICAL_PI_ORDER = [
  "pi_parent",
  "pi_hash",
  "pi_hash_alg",
  "pi_attr_sha256",
  "pi_obj_sha256",
  "pi_phase",
  "pi_pending_ref"
] as const;
const CANONICAL_PI_INDEX = new Map<string, number>(
  CANONICAL_PI_ORDER.map((name, idx) => [name, idx])
);
const PI_ATTR_SET = new Set<string>(CANONICAL_PI_ORDER);

function orderEventAttributeColumns(attrs: Iterable<string>): string[] {
  const list = [...attrs];
  return list.sort((a, b) => {
    const ia = CANONICAL_PI_INDEX.get(a);
    const ib = CANONICAL_PI_INDEX.get(b);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return 0;
  });
}

function quoteIdent(ident: string): string {
  if (ident.includes("\u0000")) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      "SQLite identifier cannot contain NUL byte.",
      "mu_on_O"
    );
  }
  return `"${ident.replaceAll('"', '""')}"`;
}

function sanitizeTypeMap(typeName: string, usedMaps: Set<string>): string {
  const base = typeName.replace(/[^A-Za-z0-9_]/g, "_") || "type";
  let candidate = base;
  let suffix = 2;
  while (usedMaps.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix++;
  }
  usedMaps.add(candidate);
  return candidate;
}

function asLoggingUnavailable(prefix: string, err: unknown): ComplianceRefusalError {
  if (err instanceof ComplianceRefusalError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new ComplianceRefusalError(
    "LOGGING_UNAVAILABLE",
    `${prefix}: ${msg}`,
    "R_missing_consequence"
  );
}

export function assertWritableDirectory(dirPath: string): void {
  if (!dirPath || dirPath.trim().length === 0) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      "Compliance log directory path must be non-empty.",
      "R_missing_consequence"
    );
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    accessSync(dirPath, constants.R_OK | constants.W_OK);
    const probePath = join(dirPath, `.zcode-ocel-probe-${process.pid}-${randomUUID()}.tmp`);
    writeFileSync(probePath, "ok", "utf8");
    unlinkSync(probePath);
  } catch (err) {
    throw asLoggingUnavailable(`Compliance log directory '${dirPath}' is not writable`, err);
  }
}

function createCoreTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_map_type (
      ocel_type TEXT PRIMARY KEY,
      ocel_type_map TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS object_map_type (
      ocel_type TEXT PRIMARY KEY,
      ocel_type_map TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS event (
      ocel_id TEXT PRIMARY KEY,
      ocel_type TEXT NOT NULL REFERENCES event_map_type(ocel_type)
    );
    CREATE TABLE IF NOT EXISTS object (
      ocel_id TEXT PRIMARY KEY,
      ocel_type TEXT NOT NULL REFERENCES object_map_type(ocel_type)
    );
    CREATE TABLE IF NOT EXISTS event_object (
      ocel_event_id TEXT NOT NULL REFERENCES event(ocel_id),
      ocel_object_id TEXT NOT NULL REFERENCES object(ocel_id),
      ocel_qualifier TEXT NOT NULL,
      PRIMARY KEY (ocel_event_id, ocel_object_id, ocel_qualifier)
    );
    CREATE TABLE IF NOT EXISTS object_object (
      ocel_source_id TEXT NOT NULL REFERENCES object(ocel_id),
      ocel_target_id TEXT NOT NULL REFERENCES object(ocel_id),
      ocel_qualifier TEXT NOT NULL,
      PRIMARY KEY (ocel_source_id, ocel_target_id, ocel_qualifier)
    );
    CREATE TABLE IF NOT EXISTS zcode_ocel_attr_meta (
      kind TEXT NOT NULL,
      ocel_type TEXT NOT NULL,
      attr_name TEXT NOT NULL,
      attr_type TEXT NOT NULL,
      sql_col TEXT,
      in_schema INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (kind, ocel_type, attr_name)
    );
    CREATE TABLE IF NOT EXISTS zcode_ocel_event_attr_multi (
      ocel_event_id TEXT NOT NULL REFERENCES event(ocel_id),
      attr_seq INTEGER NOT NULL,
      attr_name TEXT NOT NULL,
      attr_value TEXT NOT NULL,
      PRIMARY KEY (ocel_event_id, attr_seq)
    );
  `);
  const metaCols = getTableColumns(db, "zcode_ocel_attr_meta");
  const metaColsLower = new Set([...metaCols].map((c) => c.toLowerCase()));
  if (!metaColsLower.has("sql_col")) {
    db.exec("ALTER TABLE zcode_ocel_attr_meta ADD COLUMN sql_col TEXT;");
  }
  if (!metaColsLower.has("in_schema")) {
    db.exec("ALTER TABLE zcode_ocel_attr_meta ADD COLUMN in_schema INTEGER NOT NULL DEFAULT 1;");
  }
}

function getTableColumns(db: DatabaseSync, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all() as Array<
    Record<string, unknown>
  >;
  const cols = new Set<string>();
  for (const row of rows) {
    const name = row["name"];
    if (typeof name === "string") cols.add(name);
  }
  return cols;
}

function allocateSqlColumnName(
  attrName: string,
  reservedLower: ReadonlySet<string>,
  usedLower: Set<string>
): string {
  if (!reservedLower.has(attrName.toLowerCase()) && !usedLower.has(attrName.toLowerCase())) {
    usedLower.add(attrName.toLowerCase());
    return attrName;
  }
  const safeBase = attrName.replace(/[^A-Za-z0-9_]/g, "_") || "attr";
  let candidate = `${safeBase}_attr`;
  let suffix = 2;
  while (reservedLower.has(candidate.toLowerCase()) || usedLower.has(candidate.toLowerCase())) {
    candidate = `${safeBase}_attr_${suffix}`;
    suffix++;
  }
  usedLower.add(candidate.toLowerCase());
  return candidate;
}

function ensureTypeTableColumns(
  db: DatabaseSync,
  kind: "event" | "object",
  ocelType: string,
  tableName: string,
  reservedLower: ReadonlySet<string>,
  attrNames: Iterable<string>,
  options: { hasDeclaredSchema: boolean }
): Map<string, string> {
  const existing = getTableColumns(db, tableName);
  const usedLower = new Set<string>();
  for (const c of existing) usedLower.add(c.toLowerCase());

  const attrToSql = new Map<string, string>();
  const existingMetaRows = db
    .prepare("SELECT attr_name, sql_col FROM zcode_ocel_attr_meta WHERE kind = ? AND ocel_type = ?")
    .all(kind, ocelType) as Array<Record<string, unknown>>;
  for (const row of existingMetaRows) {
    const attrName = String(row["attr_name"] ?? "");
    const sqlColRaw = row["sql_col"];
    if (attrName && typeof sqlColRaw === "string" && sqlColRaw.length > 0) {
      attrToSql.set(attrName, sqlColRaw);
      usedLower.add(sqlColRaw.toLowerCase());
    }
  }

  const upsertMappingOnly = db.prepare(
    `INSERT INTO zcode_ocel_attr_meta (kind, ocel_type, attr_name, attr_type, sql_col, in_schema)
     VALUES (?, ?, ?, 'string', ?, 0)
     ON CONFLICT(kind, ocel_type, attr_name) DO UPDATE SET
       sql_col = COALESCE(zcode_ocel_attr_meta.sql_col, excluded.sql_col)`
  );
  const upsertDynamicSchema = db.prepare(
    `INSERT INTO zcode_ocel_attr_meta (kind, ocel_type, attr_name, attr_type, sql_col, in_schema)
     VALUES (?, ?, ?, 'string', ?, 1)
     ON CONFLICT(kind, ocel_type, attr_name) DO UPDATE SET
       sql_col = COALESCE(zcode_ocel_attr_meta.sql_col, excluded.sql_col)`
  );

  for (const attr of orderEventAttributeColumns(attrNames)) {
    let sqlCol = attrToSql.get(attr);
    if (!sqlCol) {
      sqlCol = allocateSqlColumnName(attr, reservedLower, usedLower);
      attrToSql.set(attr, sqlCol);
    }
    if (!existing.has(sqlCol) && !usedLower.has(`__added__${sqlCol.toLowerCase()}`)) {
      const colAlreadyExists = [...existing].some(
        (c) => c.toLowerCase() === sqlCol!.toLowerCase()
      );
      if (!colAlreadyExists) {
        db.exec(`ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${quoteIdent(sqlCol)} TEXT;`);
        existing.add(sqlCol);
      }
      usedLower.add(`__added__${sqlCol.toLowerCase()}`);
    }

    if (!options.hasDeclaredSchema && !PI_ATTR_SET.has(attr)) {
      upsertDynamicSchema.run(kind, ocelType, attr, sqlCol);
    } else if (sqlCol !== attr) {
      upsertMappingOnly.run(kind, ocelType, attr, sqlCol);
    }
  }

  return attrToSql;
}

function ensureEventTypeTable(
  db: DatabaseSync,
  ocelType: string,
  typeMap: string,
  attrNames: Iterable<string>,
  hasDeclaredSchema: boolean
): { tableName: string; attrToSql: Map<string, string> } {
  const tableName = `event_${typeMap}`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (
      ocel_id TEXT PRIMARY KEY REFERENCES event(ocel_id),
      ocel_time TEXT NOT NULL
    );
  `);
  const attrToSql = ensureTypeTableColumns(
    db,
    "event",
    ocelType,
    tableName,
    RESERVED_EVENT_COLS_LOWER,
    attrNames,
    { hasDeclaredSchema }
  );
  return { tableName, attrToSql };
}

function ensureObjectTypeTable(
  db: DatabaseSync,
  ocelType: string,
  typeMap: string,
  attrNames: Iterable<string>,
  hasDeclaredSchema: boolean
): { tableName: string; attrToSql: Map<string, string> } {
  const tableName = `object_${typeMap}`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (
      ocel_id TEXT NOT NULL REFERENCES object(ocel_id),
      ocel_time TEXT NOT NULL,
      ocel_changed_field TEXT
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${tableName}_id_time`)} ON ${quoteIdent(tableName)} (ocel_id, ocel_time);`
  );
  const attrToSql = ensureTypeTableColumns(
    db,
    "object",
    ocelType,
    tableName,
    RESERVED_OBJECT_COLS_LOWER,
    attrNames,
    { hasDeclaredSchema }
  );
  return { tableName, attrToSql };
}

function readDocumentFromDb(db: DatabaseSync): Ocel2Document {
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<Record<string, unknown>>;
  const existingTables = new Set<string>();
  for (const row of tableRows) {
    const name = row["name"];
    if (typeof name === "string") existingTables.add(name);
  }

  const hasMetaTable = existingTables.has("zcode_ocel_attr_meta");
  const metaEventAttrs = new Map<string, Ocel2AttributeSchema[]>();
  const metaObjectAttrs = new Map<string, Ocel2AttributeSchema[]>();
  const evtSqlToAttr = new Map<string, Map<string, string>>();
  const objSqlToAttr = new Map<string, Map<string, string>>();
  const objAttrToSql = new Map<string, Map<string, string>>();

  if (hasMetaTable) {
    const metaColsLower = new Set(
      [...getTableColumns(db, "zcode_ocel_attr_meta")].map((c) => c.toLowerCase())
    );
    const hasSqlCol = metaColsLower.has("sql_col");
    const hasInSchema = metaColsLower.has("in_schema");
    const selectSql = `SELECT kind, ocel_type, attr_name, attr_type${
      hasSqlCol ? ", sql_col" : ""
    }${hasInSchema ? ", in_schema" : ""} FROM zcode_ocel_attr_meta ORDER BY rowid ASC`;
    const metaRows = db.prepare(selectSql).all() as Array<Record<string, unknown>>;
    for (const r of metaRows) {
      const kind = String(r["kind"] ?? "");
      const ocelType = String(r["ocel_type"] ?? "");
      const attrName = String(r["attr_name"] ?? "");
      const attrType = String(r["attr_type"] ?? "string");
      const sqlColRaw = hasSqlCol ? r["sql_col"] : undefined;
      const sqlCol = typeof sqlColRaw === "string" && sqlColRaw.length > 0 ? sqlColRaw : attrName;
      const inSchema = hasInSchema ? Number(r["in_schema"] ?? 1) !== 0 : true;

      if (kind === "object") {
        if (inSchema) {
          const list = metaObjectAttrs.get(ocelType) ?? [];
          list.push({ name: attrName, type: attrType });
          metaObjectAttrs.set(ocelType, list);
        }
        const s2a = objSqlToAttr.get(ocelType) ?? new Map<string, string>();
        s2a.set(sqlCol, attrName);
        objSqlToAttr.set(ocelType, s2a);
        const a2s = objAttrToSql.get(ocelType) ?? new Map<string, string>();
        a2s.set(attrName, sqlCol);
        objAttrToSql.set(ocelType, a2s);
      } else if (kind === "event") {
        if (inSchema) {
          const list = metaEventAttrs.get(ocelType) ?? [];
          list.push({ name: attrName, type: attrType });
          metaEventAttrs.set(ocelType, list);
        }
        const s2a = evtSqlToAttr.get(ocelType) ?? new Map<string, string>();
        s2a.set(sqlCol, attrName);
        evtSqlToAttr.set(ocelType, s2a);
      }
    }
  }

  const objMapRows = db
    .prepare("SELECT ocel_type, ocel_type_map FROM object_map_type ORDER BY rowid ASC")
    .all() as Array<Record<string, unknown>>;
  const objectTypes: Ocel2TypeSchema[] = [];
  const objTypeToMap = new Map<string, string>();
  const objAttrById = new Map<string, Ocel2ObjectAttribute[]>();

  for (const row of objMapRows) {
    const ocelType = String(row["ocel_type"]);
    const typeMap = String(row["ocel_type_map"]);
    objTypeToMap.set(ocelType, typeMap);
    const tableName = `object_${typeMap}`;
    const colSet = existingTables.has(tableName) ? getTableColumns(db, tableName) : new Set<string>();
    const s2a = objSqlToAttr.get(ocelType);
    const a2s = objAttrToSql.get(ocelType);
    const declared = metaObjectAttrs.get(ocelType);
    const attrs: Ocel2AttributeSchema[] = declared
      ? declared
      : [...colSet]
          .filter((c) => !RESERVED_OBJECT_COLS_LOWER.has(c.toLowerCase()))
          .map((c) => ({ name: s2a?.get(c) ?? c, type: "string" }));
    objectTypes.push({ name: ocelType, attributes: attrs });

    if (existingTables.has(tableName)) {
      const attrRows = db
        .prepare(`SELECT * FROM ${quoteIdent(tableName)} ORDER BY rowid ASC`)
        .all() as Array<Record<string, unknown>>;
      for (const ar of attrRows) {
        const id = String(ar["ocel_id"]);
        const time = String(ar["ocel_time"]);
        const changedField = ar["ocel_changed_field"];
        const list = objAttrById.get(id) ?? [];
        if (typeof changedField === "string" && changedField.length > 0) {
          const sqlCol = a2s?.get(changedField) ?? changedField;
          const val = Object.prototype.hasOwnProperty.call(ar, sqlCol)
            ? ar[sqlCol]
            : Object.prototype.hasOwnProperty.call(ar, changedField)
              ? ar[changedField]
              : "";
          list.push({
            name: changedField,
            time,
            value: val === null || val === undefined ? "" : String(val)
          });
        } else {
          for (const [k, v] of Object.entries(ar)) {
            if (RESERVED_OBJECT_COLS_LOWER.has(k.toLowerCase()) || v === null || v === undefined) {
              continue;
            }
            const origName = s2a?.get(k) ?? k;
            list.push({ name: origName, time, value: String(v) });
          }
        }
        objAttrById.set(id, list);
      }
    }
  }

  const o2oRows = db
    .prepare("SELECT ocel_source_id, ocel_target_id, ocel_qualifier FROM object_object ORDER BY rowid ASC")
    .all() as Array<Record<string, unknown>>;
  const o2oBySource = new Map<string, Ocel2Relationship[]>();
  for (const r of o2oRows) {
    const src = String(r["ocel_source_id"]);
    const dst = String(r["ocel_target_id"]);
    const qual = String(r["ocel_qualifier"]);
    const list = o2oBySource.get(src) ?? [];
    list.push({ objectId: dst, qualifier: qual });
    o2oBySource.set(src, list);
  }

  const objectRows = db
    .prepare("SELECT ocel_id, ocel_type FROM object ORDER BY rowid ASC")
    .all() as Array<Record<string, unknown>>;
  const objects: Ocel2Object[] = objectRows.map((r) => {
    const id = String(r["ocel_id"]);
    const type = String(r["ocel_type"]);
    return {
      id,
      type,
      attributes: objAttrById.get(id) ?? [],
      relationships: o2oBySource.get(id) ?? []
    };
  });

  const evtMapRows = db
    .prepare("SELECT ocel_type, ocel_type_map FROM event_map_type ORDER BY rowid ASC")
    .all() as Array<Record<string, unknown>>;
  const eventTypes: Ocel2TypeSchema[] = [];
  const evtRowById = new Map<string, { time: string; attributes: Ocel2EventAttribute[] }>();

  for (const row of evtMapRows) {
    const ocelType = String(row["ocel_type"]);
    const typeMap = String(row["ocel_type_map"]);
    const tableName = `event_${typeMap}`;
    const colSet = existingTables.has(tableName) ? getTableColumns(db, tableName) : new Set<string>();
    const s2a = evtSqlToAttr.get(ocelType);
    const declared = metaEventAttrs.get(ocelType);
    const attrs: Ocel2AttributeSchema[] = declared
      ? declared
      : [...colSet]
          .filter((c) => !RESERVED_EVENT_COLS_LOWER.has(c.toLowerCase()))
          .map((c) => ({ name: s2a?.get(c) ?? c, type: "string" }));
    eventTypes.push({ name: ocelType, attributes: attrs });

    if (existingTables.has(tableName)) {
      const evRows = db
        .prepare(`SELECT * FROM ${quoteIdent(tableName)} ORDER BY rowid ASC`)
        .all() as Array<Record<string, unknown>>;
      for (const er of evRows) {
        const id = String(er["ocel_id"]);
        const time = String(er["ocel_time"]);
        const evAttrs: Ocel2EventAttribute[] = [];
        for (const [k, v] of Object.entries(er)) {
          if (RESERVED_EVENT_COLS_LOWER.has(k.toLowerCase()) || v === null || v === undefined) {
            continue;
          }
          const origName = s2a?.get(k) ?? k;
          evAttrs.push({ name: origName, value: String(v) });
        }
        evAttrs.sort((a, b) => {
          const ia = CANONICAL_PI_INDEX.get(a.name);
          const ib = CANONICAL_PI_INDEX.get(b.name);
          if (ia !== undefined && ib !== undefined) return ia - ib;
          if (ia !== undefined) return -1;
          if (ib !== undefined) return 1;
          return 0;
        });
        evtRowById.set(id, { time, attributes: evAttrs });
      }
    }
  }

  const e2oRows = db
    .prepare("SELECT ocel_event_id, ocel_object_id, ocel_qualifier FROM event_object ORDER BY rowid ASC")
    .all() as Array<Record<string, unknown>>;
  const e2oByEvent = new Map<string, Ocel2Relationship[]>();
  for (const r of e2oRows) {
    const eid = String(r["ocel_event_id"]);
    const oid = String(r["ocel_object_id"]);
    const qual = String(r["ocel_qualifier"]);
    const list = e2oByEvent.get(eid) ?? [];
    list.push({ objectId: oid, qualifier: qual });
    e2oByEvent.set(eid, list);
  }

  const multiAttrsByEvent = new Map<string, Ocel2EventAttribute[]>();
  if (existingTables.has("zcode_ocel_event_attr_multi")) {
    const multiRows = db
      .prepare(
        "SELECT ocel_event_id, attr_name, attr_value FROM zcode_ocel_event_attr_multi ORDER BY ocel_event_id ASC, attr_seq ASC"
      )
      .all() as Array<Record<string, unknown>>;
    for (const mr of multiRows) {
      const eid = String(mr["ocel_event_id"]);
      const list = multiAttrsByEvent.get(eid) ?? [];
      list.push({
        name: String(mr["attr_name"]),
        value: String(mr["attr_value"])
      });
      multiAttrsByEvent.set(eid, list);
    }
  }

  const eventRows = db
    .prepare("SELECT ocel_id, ocel_type FROM event ORDER BY rowid ASC")
    .all() as Array<Record<string, unknown>>;
  const events: Ocel2Event[] = eventRows.map((r) => {
    const id = String(r["ocel_id"]);
    const type = String(r["ocel_type"]);
    const detail = evtRowById.get(id);
    const multiAttrs = multiAttrsByEvent.get(id);
    return {
      id,
      type,
      time: detail?.time ?? "",
      attributes: multiAttrs ?? detail?.attributes ?? [],
      relationships: e2oByEvent.get(id) ?? []
    };
  });

  return {
    objectTypes,
    eventTypes,
    objects,
    events
  };
}

export interface AppendableOcel2SqliteSinkOptions {
  busyTimeoutMs?: number;
  minRetentionDays?: number;
  journalMode?: "WAL" | "DELETE";
}

export class AppendableOcel2SqliteSink {
  readonly dbPath: string;
  private readonly db: DatabaseSync;
  private closed = false;
  private readonly objTypeToMap = new Map<string, string>();
  private readonly evtTypeToMap = new Map<string, string>();
  private readonly usedObjMaps = new Set<string>();
  private readonly usedEvtMaps = new Set<string>();

  constructor(dbPath: string, options: AppendableOcel2SqliteSinkOptions = {}) {
    if (
      options.minRetentionDays !== undefined &&
      (!Number.isFinite(options.minRetentionDays) || options.minRetentionDays < DEFAULT_MIN_RETENTION_DAYS)
    ) {
      throw new ComplianceRefusalError(
        "LOGGING_UNAVAILABLE",
        `EU AI Act Art. 12/26 requires minRetentionDays >= ${DEFAULT_MIN_RETENTION_DAYS} (got ${options.minRetentionDays}).`,
        "admission_vacuous"
      );
    }

    const parentDir = dirname(dbPath);
    assertWritableDirectory(parentDir);
    this.dbPath = dbPath;

    const busyTimeout = Math.max(0, Math.floor(options.busyTimeoutMs ?? 10_000));
    const journalMode = options.journalMode ?? "WAL";
    let openedDb: DatabaseSync | undefined;
    try {
      openedDb = new DatabaseSync(dbPath);
      this.db = openedDb;
      this.db.exec(`PRAGMA journal_mode = ${journalMode};`);
      this.db.exec("PRAGMA synchronous = NORMAL;");
      this.db.exec(`PRAGMA busy_timeout = ${busyTimeout};`);
      this.db.exec("PRAGMA foreign_keys = ON;");

      this.db.exec("BEGIN IMMEDIATE;");
      try {
        createCoreTables(this.db);
        const existingObjMaps = this.db
          .prepare("SELECT ocel_type, ocel_type_map FROM object_map_type")
          .all() as Array<Record<string, unknown>>;
        for (const r of existingObjMaps) {
          const t = String(r["ocel_type"]);
          const m = String(r["ocel_type_map"]);
          this.objTypeToMap.set(t, m);
          this.usedObjMaps.add(m);
        }
        const existingEvtMaps = this.db
          .prepare("SELECT ocel_type, ocel_type_map FROM event_map_type")
          .all() as Array<Record<string, unknown>>;
        for (const r of existingEvtMaps) {
          const t = String(r["ocel_type"]);
          const m = String(r["ocel_type_map"]);
          this.evtTypeToMap.set(t, m);
          this.usedEvtMaps.add(m);
        }
        this.db.exec("COMMIT;");
      } catch (err) {
        this.db.exec("ROLLBACK;");
        throw err;
      }
    } catch (err) {
      if (openedDb) {
        try {
          openedDb.close();
        } catch {
          // ignore close error on failed construction
        }
      }
      throw asLoggingUnavailable(`Failed to open OCEL 2.0 SQLite sink '${dbPath}'`, err);
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new ComplianceRefusalError(
        "LOGGING_UNAVAILABLE",
        `OCEL 2.0 SQLite sink '${this.dbPath}' is already closed.`,
        "R_missing_consequence"
      );
    }
  }

  private runInTransaction(fn: () => void): void {
    this.ensureOpen();
    try {
      this.db.exec("BEGIN IMMEDIATE;");
      try {
        fn();
        this.db.exec("COMMIT;");
      } catch (inner) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // ignore rollback error
        }
        throw inner;
      }
    } catch (err) {
      if (err instanceof ComplianceRefusalError) throw err;
      throw asLoggingUnavailable(`SQLite write failed on '${this.dbPath}'`, err);
    }
  }

  private ensureObjectTypeRegistered(
    type: string,
    attrNames: Iterable<string>,
    declaredSchema?: Ocel2AttributeSchema[]
  ): { tableName: string; attrToSql: Map<string, string> } {
    let typeMap = this.objTypeToMap.get(type);
    if (!typeMap) {
      typeMap = sanitizeTypeMap(type, this.usedObjMaps);
      this.db
        .prepare("INSERT OR IGNORE INTO object_map_type (ocel_type, ocel_type_map) VALUES (?, ?)")
        .run(type, typeMap);
      const row = this.db
        .prepare("SELECT ocel_type_map FROM object_map_type WHERE ocel_type = ?")
        .get(type) as Record<string, unknown> | undefined;
      typeMap = row ? String(row["ocel_type_map"]) : typeMap;
      this.objTypeToMap.set(type, typeMap);
      this.usedObjMaps.add(typeMap);
    }
    if (declaredSchema) {
      const insertMeta = this.db.prepare(
        `INSERT INTO zcode_ocel_attr_meta (kind, ocel_type, attr_name, attr_type, sql_col, in_schema)
         VALUES ('object', ?, ?, ?, NULL, 1)
         ON CONFLICT(kind, ocel_type, attr_name) DO UPDATE SET
           attr_type = excluded.attr_type,
           in_schema = 1`
      );
      for (const a of declaredSchema) {
        insertMeta.run(type, a.name, String(a.type));
      }
    }
    const result = ensureObjectTypeTable(
      this.db,
      type,
      typeMap,
      attrNames,
      declaredSchema !== undefined
    );
    if (declaredSchema) {
      const updateSqlCol = this.db.prepare(
        "UPDATE zcode_ocel_attr_meta SET sql_col = ? WHERE kind = 'object' AND ocel_type = ? AND attr_name = ?"
      );
      for (const a of declaredSchema) {
        const sqlCol = result.attrToSql.get(a.name);
        if (sqlCol) updateSqlCol.run(sqlCol, type, a.name);
      }
    }
    return result;
  }

  private ensureEventTypeRegistered(
    type: string,
    attrNames: Iterable<string>,
    declaredSchema?: Ocel2AttributeSchema[]
  ): { tableName: string; attrToSql: Map<string, string> } {
    let typeMap = this.evtTypeToMap.get(type);
    if (!typeMap) {
      typeMap = sanitizeTypeMap(type, this.usedEvtMaps);
      this.db
        .prepare("INSERT OR IGNORE INTO event_map_type (ocel_type, ocel_type_map) VALUES (?, ?)")
        .run(type, typeMap);
      const row = this.db
        .prepare("SELECT ocel_type_map FROM event_map_type WHERE ocel_type = ?")
        .get(type) as Record<string, unknown> | undefined;
      typeMap = row ? String(row["ocel_type_map"]) : typeMap;
      this.evtTypeToMap.set(type, typeMap);
      this.usedEvtMaps.add(typeMap);
    }
    if (declaredSchema) {
      const insertMeta = this.db.prepare(
        `INSERT INTO zcode_ocel_attr_meta (kind, ocel_type, attr_name, attr_type, sql_col, in_schema)
         VALUES ('event', ?, ?, ?, NULL, 1)
         ON CONFLICT(kind, ocel_type, attr_name) DO UPDATE SET
           attr_type = excluded.attr_type,
           in_schema = 1`
      );
      for (const a of declaredSchema) {
        insertMeta.run(type, a.name, String(a.type));
      }
    }
    const result = ensureEventTypeTable(
      this.db,
      type,
      typeMap,
      attrNames,
      declaredSchema !== undefined
    );
    if (declaredSchema) {
      const updateSqlCol = this.db.prepare(
        "UPDATE zcode_ocel_attr_meta SET sql_col = ? WHERE kind = 'event' AND ocel_type = ? AND attr_name = ?"
      );
      for (const a of declaredSchema) {
        const sqlCol = result.attrToSql.get(a.name);
        if (sqlCol) updateSqlCol.run(sqlCol, type, a.name);
      }
    }
    return result;
  }

  private insertObjectsInternal(objects: readonly Ocel2Object[]): void {
    const attrsByType = new Map<string, Set<string>>();
    for (const obj of objects) {
      const set = attrsByType.get(obj.type) ?? new Set<string>();
      for (const a of obj.attributes) set.add(a.name);
      attrsByType.set(obj.type, set);
    }
    const tableByType = new Map<string, { tableName: string; attrToSql: Map<string, string> }>();
    for (const [type, cols] of attrsByType.entries()) {
      tableByType.set(type, this.ensureObjectTypeRegistered(type, cols));
    }

    const insertObjStmt = this.db.prepare(
      "INSERT OR IGNORE INTO object (ocel_id, ocel_type) VALUES (?, ?)"
    );
    for (const obj of objects) {
      insertObjStmt.run(obj.id, obj.type);
      const { tableName, attrToSql } = tableByType.get(obj.type)!;
      for (const attr of obj.attributes) {
        const sqlCol = attrToSql.get(attr.name) ?? attr.name;
        this.db
          .prepare(
            `INSERT INTO ${quoteIdent(tableName)} (ocel_id, ocel_time, ocel_changed_field, ${quoteIdent(sqlCol)}) VALUES (?, ?, ?, ?)`
          )
          .run(obj.id, attr.time, attr.name, attr.value);
      }
    }

    const insertO2OStmt = this.db.prepare(
      "INSERT OR IGNORE INTO object_object (ocel_source_id, ocel_target_id, ocel_qualifier) VALUES (?, ?, ?)"
    );
    for (const obj of objects) {
      for (const rel of obj.relationships) {
        insertO2OStmt.run(obj.id, rel.objectId, rel.qualifier);
      }
    }
  }

  private insertEventsInternal(events: readonly Ocel2Event[]): void {
    const attrsByType = new Map<string, Set<string>>();
    for (const ev of events) {
      const set = attrsByType.get(ev.type) ?? new Set<string>();
      for (const a of ev.attributes) set.add(a.name);
      attrsByType.set(ev.type, set);
    }
    const tableByType = new Map<string, { tableName: string; attrToSql: Map<string, string> }>();
    for (const [type, cols] of attrsByType.entries()) {
      tableByType.set(type, this.ensureEventTypeRegistered(type, cols));
    }

    const insertEvtStmt = this.db.prepare(
      "INSERT INTO event (ocel_id, ocel_type) VALUES (?, ?)"
    );
    const insertE2OStmt = this.db.prepare(
      "INSERT OR IGNORE INTO event_object (ocel_event_id, ocel_object_id, ocel_qualifier) VALUES (?, ?, ?)"
    );

    for (const ev of events) {
      insertEvtStmt.run(ev.id, ev.type);
      const { tableName, attrToSql } = tableByType.get(ev.type)!;
      const dedupBySqlCol = new Map<string, string>();
      for (const a of ev.attributes) {
        const sqlCol = attrToSql.get(a.name) ?? a.name;
        dedupBySqlCol.set(sqlCol, a.value);
      }
      const colNames = ["ocel_id", "ocel_time", ...dedupBySqlCol.keys()];
      const placeholders = colNames.map(() => "?").join(", ");
      const values = [ev.id, ev.time, ...dedupBySqlCol.values()];
      this.db
        .prepare(
          `INSERT INTO ${quoteIdent(tableName)} (${colNames.map(quoteIdent).join(", ")}) VALUES (${placeholders})`
        )
        .run(...values);

      let hasDuplicateAttr = false;
      const seenNames = new Set<string>();
      for (const a of ev.attributes) {
        if (seenNames.has(a.name)) {
          hasDuplicateAttr = true;
          break;
        }
        seenNames.add(a.name);
      }
      if (hasDuplicateAttr) {
        const insertMultiStmt = this.db.prepare(
          "INSERT INTO zcode_ocel_event_attr_multi (ocel_event_id, attr_seq, attr_name, attr_value) VALUES (?, ?, ?, ?)"
        );
        for (let idx = 0; idx < ev.attributes.length; idx++) {
          const a = ev.attributes[idx]!;
          insertMultiStmt.run(ev.id, idx, a.name, a.value);
        }
      }

      for (const rel of ev.relationships) {
        insertE2OStmt.run(ev.id, rel.objectId, rel.qualifier);
      }
    }
  }

  upsertObjects(objects: readonly Ocel2Object[]): void {
    this.runInTransaction(() => {
      this.insertObjectsInternal(objects);
    });
  }

  appendEvent(event: Ocel2Event, objectHints: readonly Ocel2Object[] = []): void {
    this.runInTransaction(() => {
      if (objectHints.length > 0) {
        this.insertObjectsInternal(objectHints);
      }
      this.insertEventsInternal([event]);
    });
  }

  appendDocument(doc: Ocel2Document): void {
    const check = validateOcel2(doc);
    if (!check.ok) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Refusing to write invalid OCEL 2.0 document to SQLite: ${check.errors.join("; ")}`,
        "mu_on_O"
      );
    }

    this.runInTransaction(() => {
      for (const ot of doc.objectTypes) {
        const attrSet = new Set(ot.attributes.map((a) => a.name));
        for (const obj of doc.objects) {
          if (obj.type === ot.name) {
            for (const a of obj.attributes) attrSet.add(a.name);
          }
        }
        this.ensureObjectTypeRegistered(ot.name, attrSet, ot.attributes);
      }

      for (const et of doc.eventTypes) {
        const attrSet = new Set(et.attributes.map((a) => a.name));
        for (const ev of doc.events) {
          if (ev.type === et.name) {
            for (const a of ev.attributes) attrSet.add(a.name);
          }
        }
        this.ensureEventTypeRegistered(et.name, attrSet, et.attributes);
      }

      this.insertObjectsInternal(doc.objects);
      this.insertEventsInternal(doc.events);
    });
  }

  checkpoint(): void {
    this.ensureOpen();
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch (err) {
      throw asLoggingUnavailable(`Failed to checkpoint SQLite WAL for '${this.dbPath}'`, err);
    }
  }

  readDocument(): Ocel2Document {
    this.ensureOpen();
    return readDocumentFromDb(this.db);
  }

  close(): void {
    if (this.closed) return;
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // Best-effort checkpoint on close
    } finally {
      this.db.close();
      this.closed = true;
    }
  }
}

export interface WriteOcel2SqliteOptions {
  journalMode?: "WAL" | "DELETE";
}

export function writeOcel2Sqlite(
  doc: Ocel2Document,
  dbPath: string,
  options: WriteOcel2SqliteOptions = {}
): void {
  const check = validateOcel2(doc);
  if (!check.ok) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Cannot write invalid OCEL 2.0 document to SQLite: ${check.errors.join("; ")}`,
      "mu_on_O"
    );
  }

  const dir = dirname(dbPath);
  assertWritableDirectory(dir);

  const journalMode = options.journalMode ?? "WAL";
  const tmpPath = join(dir, `.zcode-ocel2-${process.pid}-${randomUUID()}.sqlite.tmp`);
  const walKeep = `${dbPath}-wal.keep`;
  const shmKeep = `${dbPath}-shm.keep`;

  try {
    const sink = new AppendableOcel2SqliteSink(tmpPath, { journalMode: "DELETE" });
    try {
      sink.appendDocument(doc);
    } finally {
      sink.close();
    }

    for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`, walKeep, shmKeep]) {
      if (existsSync(sidecar)) {
        rmSync(sidecar, { force: true });
      }
    }
    renameSync(tmpPath, dbPath);

    if (journalMode === "WAL") {
      const walDb = new DatabaseSync(dbPath);
      let hasWalKeep = false;
      let hasShmKeep = false;
      try {
        walDb.exec("PRAGMA journal_mode = WAL; PRAGMA wal_checkpoint(TRUNCATE);");
        if (existsSync(`${dbPath}-wal`)) {
          copyFileSync(`${dbPath}-wal`, walKeep);
          hasWalKeep = true;
        }
        if (existsSync(`${dbPath}-shm`)) {
          copyFileSync(`${dbPath}-shm`, shmKeep);
          hasShmKeep = true;
        }
      } finally {
        walDb.close();
      }
      if (hasWalKeep && existsSync(walKeep)) {
        renameSync(walKeep, `${dbPath}-wal`);
      }
      if (hasShmKeep && existsSync(shmKeep)) {
        renameSync(shmKeep, `${dbPath}-shm`);
      }
    }

    for (const tmpSidecar of [`${tmpPath}-wal`, `${tmpPath}-shm`, walKeep, shmKeep]) {
      if (existsSync(tmpSidecar)) {
        rmSync(tmpSidecar, { force: true });
      }
    }
  } catch (err) {
    for (const tmpFile of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`, walKeep, shmKeep]) {
      if (existsSync(tmpFile)) {
        rmSync(tmpFile, { force: true });
      }
    }
    throw asLoggingUnavailable(`Failed writing OCEL 2.0 SQLite database '${dbPath}'`, err);
  }
}

function isWalOpenFallbackError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as Record<string, unknown>;
  const errcode = typeof rec["errcode"] === "number" ? rec["errcode"] : undefined;
  if (errcode !== undefined) {
    const base = errcode & 0xff;
    // 14 = SQLITE_CANTOPEN (incl. WAL without -shm), 8 = SQLITE_READONLY (incl. 1544 SQLITE_READONLY_DIRECTORY)
    if (base === 14 || base === 8) return true;
  }
  const msg = rec["message"];
  return (
    typeof msg === "string" &&
    /unable to open database file|SQLITE_CANTOPEN|readonly/i.test(msg)
  );
}

function hasNonEmptyWalSidecar(dbPath: string): boolean {
  const walPath = `${dbPath}-wal`;
  if (!existsSync(walPath)) return false;
  try {
    return statSync(walPath).size > 0;
  } catch {
    // Fail closed: if -wal exists but cannot be stat'd, do not bypass it with immutable=1.
    return true;
  }
}

function openAndReadDocument(
  location: string,
  options?: { readOnly?: boolean }
): Ocel2Document {
  const db = options ? new DatabaseSync(location, options) : new DatabaseSync(location);
  try {
    return readDocumentFromDb(db);
  } finally {
    try {
      db.close();
    } catch {
      // ignore close error on failed handle
    }
  }
}

export function readOcel2Sqlite(dbPath: string): Ocel2Document {
  if (!existsSync(dbPath)) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `OCEL 2.0 SQLite file does not exist: ${dbPath}`,
      "R_missing_consequence"
    );
  }

  try {
    return openAndReadDocument(dbPath, { readOnly: true });
  } catch (roErr) {
    if (!isWalOpenFallbackError(roErr)) {
      throw asLoggingUnavailable(`Failed reading OCEL 2.0 SQLite file '${dbPath}'`, roErr);
    }

    // Opening a WAL-mode DB read-only without -shm fails lazily in Bun (SQLITE_CANTOPEN)
    // and on 0444/0555 in Node (SQLITE_READONLY_DIRECTORY). Retry RW first when writable so
    // any uncheckpointed -wal is recovered rather than bypassed.
    try {
      return openAndReadDocument(dbPath);
    } catch (rwErr) {
      if (!isWalOpenFallbackError(rwErr) || hasNonEmptyWalSidecar(dbPath)) {
        throw asLoggingUnavailable(`Failed reading OCEL 2.0 SQLite file '${dbPath}'`, rwErr);
      }

      // Safe to open immutable=1 only when unwritable AND no non-empty -wal sidecar exists.
      const immutableUri = `${pathToFileURL(resolve(dbPath)).href}?immutable=1`;
      try {
        return openAndReadDocument(immutableUri, { readOnly: true });
      } catch (immErr) {
        throw asLoggingUnavailable(`Failed reading OCEL 2.0 SQLite file '${dbPath}'`, immErr);
      }
    }
  }
}

export const RETENTION_PURGE_LEDGER_FILENAME = "retention-purge-ledger.ndjson";

export interface RetentionPurgeReceipt {
  schemaVersion: "1.0";
  kind: "ocel_retention_purge_tombstone";
  purgedAt: string;
  artifactPath: string;
  artifactName: string;
  artifactSha256: string;
  artifactSizeBytes: number;
  mtimeIso: string;
  latestEventTimeIso: string | null;
  effectiveAgeDays: number;
  minDays: number;
  effectiveRetentionDays: number;
  eventCount: number | null;
  headHash: string | null;
  reason: "EU_AI_ACT_ART12_RETENTION_EXPIRED";
  prevHash: string;
  entryHash: string;
}

export interface RetentionPolicyOptions {
  nowMs?: number;
  maxRetentionDays?: number;
  dryRun?: boolean;
}

export interface RetentionPolicyResult {
  dir: string;
  minDays: number;
  effectiveRetentionDays: number;
  writable: true;
  checked: string[];
  retained: string[];
  purged: string[];
  purgeLedgerPath?: string;
  purgeReceipts: RetentionPurgeReceipt[];
}

function isManagedComplianceArtifact(name: string): boolean {
  return (
    name.endsWith(".sqlite") ||
    name.endsWith(".jsonocel") ||
    name.endsWith(".ocel.json") ||
    name.endsWith(".ocel.xml") ||
    name.endsWith(".receipt.json")
  );
}

interface ArtifactRetentionInspection {
  latestEventTimeMs: number | null;
  eventCount: number | null;
  headHash: string | null;
  unreadableProtected: boolean;
}

function extractLatestTimeFromOcelDoc(doc: Ocel2Document): {
  latestEventTimeMs: number | null;
  eventCount: number;
  headHash: string | null;
} {
  let latest: number | null = null;
  for (const ev of doc.events) {
    const ms = Date.parse(ev.time);
    if (Number.isFinite(ms) && (latest === null || ms > latest)) {
      latest = ms;
    }
  }
  for (const obj of doc.objects) {
    for (const attr of obj.attributes) {
      const ms = Date.parse(attr.time);
      if (Number.isFinite(ms) && (latest === null || ms > latest)) {
        latest = ms;
      }
    }
  }
  let headHash: string | null = null;
  if (doc.events.length > 0) {
    const lastEv = doc.events[doc.events.length - 1]!;
    const piHash = lastEv.attributes.find((a) => a.name === "pi_hash")?.value;
    if (typeof piHash === "string" && piHash.length > 0) {
      headHash = piHash;
    }
  }
  return { latestEventTimeMs: latest, eventCount: doc.events.length, headHash };
}

function inspectArtifactForRetention(
  fullPath: string,
  name: string
): ArtifactRetentionInspection {
  if (name.endsWith(".sqlite")) {
    let header: Buffer;
    try {
      header = readFileSync(fullPath).subarray(0, 16);
    } catch {
      return {
        latestEventTimeMs: null,
        eventCount: null,
        headHash: null,
        unreadableProtected: true
      };
    }
    const isSqliteMagic = header.length === 16 && header.toString("utf8") === "SQLite format 3\0";
    if (!isSqliteMagic) {
      return {
        latestEventTimeMs: null,
        eventCount: null,
        headHash: null,
        unreadableProtected: false
      };
    }
    try {
      const doc = readOcel2Sqlite(fullPath);
      const info = extractLatestTimeFromOcelDoc(doc);
      return { ...info, unreadableProtected: false };
    } catch {
      // Fail closed: never purge a real SQLite compliance DB whose event times cannot be read.
      return {
        latestEventTimeMs: null,
        eventCount: null,
        headHash: null,
        unreadableProtected: true
      };
    }
  }

  if (name.endsWith(".jsonocel") || name.endsWith(".ocel.json")) {
    try {
      const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as Partial<Ocel2Document>;
      if (Array.isArray(parsed.events)) {
        const safeDoc: Ocel2Document = {
          objectTypes: Array.isArray(parsed.objectTypes) ? parsed.objectTypes : [],
          eventTypes: Array.isArray(parsed.eventTypes) ? parsed.eventTypes : [],
          objects: Array.isArray(parsed.objects) ? parsed.objects : [],
          events: parsed.events
        };
        const info = extractLatestTimeFromOcelDoc(safeDoc);
        return { ...info, unreadableProtected: false };
      }
    } catch {
      // Fall through to mtime for non-OCEL/placeholder JSON files
    }
    return {
      latestEventTimeMs: null,
      eventCount: null,
      headHash: null,
      unreadableProtected: false
    };
  }

  if (name.endsWith(".ocel.xml")) {
    try {
      const xml = readFileSync(fullPath, "utf8");
      let latest: number | null = null;
      const re = /\btime="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(xml)) !== null) {
        const ms = Date.parse(match[1]!);
        if (Number.isFinite(ms) && (latest === null || ms > latest)) {
          latest = ms;
        }
      }
      return {
        latestEventTimeMs: latest,
        eventCount: null,
        headHash: null,
        unreadableProtected: false
      };
    } catch {
      return {
        latestEventTimeMs: null,
        eventCount: null,
        headHash: null,
        unreadableProtected: true
      };
    }
  }

  if (name.endsWith(".receipt.json")) {
    try {
      const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
      let latest: number | null = null;
      for (const key of ["purgedAt", "generatedAt", "timestamp", "createdAt", "recordedAt"]) {
        const val = parsed[key];
        if (typeof val === "string") {
          const ms = Date.parse(val);
          if (Number.isFinite(ms) && (latest === null || ms > latest)) {
            latest = ms;
          }
        }
      }
      return {
        latestEventTimeMs: latest,
        eventCount: null,
        headHash: null,
        unreadableProtected: false
      };
    } catch {
      // Fall through to mtime
    }
  }

  return {
    latestEventTimeMs: null,
    eventCount: null,
    headHash: null,
    unreadableProtected: false
  };
}

function readLastPurgeLedgerHash(ledgerPath: string): string {
  if (!existsSync(ledgerPath)) return "GENESIS";
  const content = readFileSync(ledgerPath, "utf8").trim();
  if (!content) return "GENESIS";
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const parsed = JSON.parse(line) as { entryHash?: unknown };
    if (typeof parsed.entryHash === "string" && /^[a-f0-9]{64}$/.test(parsed.entryHash)) {
      return parsed.entryHash;
    }
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `Retention purge ledger '${ledgerPath}' has malformed entryHash.`,
      "R_missing_consequence"
    );
  }
  return "GENESIS";
}

export function enforceRetentionPolicy(
  dir: string,
  minDays = DEFAULT_MIN_RETENTION_DAYS,
  options: RetentionPolicyOptions = {}
): RetentionPolicyResult {
  if (!Number.isFinite(minDays) || minDays < DEFAULT_MIN_RETENTION_DAYS) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `Retention policy must be >= ${DEFAULT_MIN_RETENTION_DAYS} days (EU AI Act Art. 12/26, got ${minDays}).`,
      "admission_vacuous"
    );
  }
  if (
    options.maxRetentionDays !== undefined &&
    (!Number.isFinite(options.maxRetentionDays) || options.maxRetentionDays < minDays)
  ) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `Retention policy maxRetentionDays must be a finite number >= ${minDays} (got ${options.maxRetentionDays}).`,
      "admission_vacuous"
    );
  }
  if (options.nowMs !== undefined && !Number.isFinite(options.nowMs)) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `Retention policy nowMs must be finite (got ${options.nowMs}).`,
      "mu_on_O"
    );
  }

  assertWritableDirectory(dir);

  const nowMs = options.nowMs ?? Date.now();
  const effectiveRetentionDays = Math.max(minDays, options.maxRetentionDays ?? minDays);
  const cutoffMs = nowMs - effectiveRetentionDays * MS_PER_DAY;
  const minCutoffMs = nowMs - minDays * MS_PER_DAY;

  const entries = readdirSync(dir, { withFileTypes: true });
  const checked: string[] = [];
  const retained: string[] = [];
  const purged: string[] = [];
  const purgeReceipts: RetentionPurgeReceipt[] = [];
  const ledgerPath = join(dir, RETENTION_PURGE_LEDGER_FILENAME);

  for (const entry of entries) {
    if (!entry.isFile() || !isManagedComplianceArtifact(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    checked.push(fullPath);

    let mtimeMs: number;
    let artifactSizeBytes: number;
    try {
      const st = statSync(fullPath);
      mtimeMs = st.mtimeMs;
      artifactSizeBytes = st.size;
      if (entry.name.endsWith(".sqlite")) {
        for (const walExt of ["-wal", "-shm"]) {
          const sidecar = `${fullPath}${walExt}`;
          if (existsSync(sidecar)) {
            mtimeMs = Math.max(mtimeMs, statSync(sidecar).mtimeMs);
          }
        }
      }
    } catch (err) {
      throw asLoggingUnavailable(`Failed to stat compliance artifact '${fullPath}'`, err);
    }

    const inspection = inspectArtifactForRetention(fullPath, entry.name);
    if (inspection.unreadableProtected) {
      retained.push(fullPath);
      continue;
    }

    // Use the newest of filesystem mtime and internal OCEL event/object timestamps so
    // backdating mtime can never cause premature deletion of events younger than minDays.
    const effectiveTimeMs =
      inspection.latestEventTimeMs !== null
        ? Math.max(mtimeMs, inspection.latestEventTimeMs)
        : mtimeMs;

    // Never purge anything younger than minDays (180d floor) or effectiveRetentionDays
    if (effectiveTimeMs < cutoffMs && effectiveTimeMs < minCutoffMs) {
      if (!options.dryRun) {
        try {
          const artifactSha256 = createHash("sha256")
            .update(readFileSync(fullPath))
            .digest("hex");
          const prevHash = readLastPurgeLedgerHash(ledgerPath);
          const payload: Omit<RetentionPurgeReceipt, "entryHash"> = {
            schemaVersion: "1.0",
            kind: "ocel_retention_purge_tombstone",
            purgedAt: new Date(nowMs).toISOString(),
            artifactPath: fullPath,
            artifactName: basename(fullPath),
            artifactSha256,
            artifactSizeBytes,
            mtimeIso: new Date(mtimeMs).toISOString(),
            latestEventTimeIso:
              inspection.latestEventTimeMs !== null
                ? new Date(inspection.latestEventTimeMs).toISOString()
                : null,
            effectiveAgeDays: (nowMs - effectiveTimeMs) / MS_PER_DAY,
            minDays,
            effectiveRetentionDays,
            eventCount: inspection.eventCount,
            headHash: inspection.headHash,
            reason: "EU_AI_ACT_ART12_RETENTION_EXPIRED",
            prevHash
          };
          const entryHash = createHash("sha256")
            .update(JSON.stringify(payload))
            .digest("hex");
          const receipt: RetentionPurgeReceipt = { ...payload, entryHash };

          // Persist tamper-evident purge receipt BEFORE unlinking the expired artifact.
          appendFileSync(ledgerPath, `${JSON.stringify(receipt)}\n`, "utf8");
          purgeReceipts.push(receipt);

          unlinkSync(fullPath);
          if (entry.name.endsWith(".sqlite")) {
            for (const walExt of ["-wal", "-shm"]) {
              const sidecar = `${fullPath}${walExt}`;
              if (existsSync(sidecar)) unlinkSync(sidecar);
            }
          }
        } catch (err) {
          throw asLoggingUnavailable(`Failed to purge expired artifact '${fullPath}'`, err);
        }
      }
      purged.push(fullPath);
    } else {
      retained.push(fullPath);
    }
  }

  return {
    dir,
    minDays,
    effectiveRetentionDays,
    writable: true,
    checked,
    retained,
    purged,
    ...(purgeReceipts.length > 0 ? { purgeLedgerPath: ledgerPath } : {}),
    purgeReceipts
  };
}
