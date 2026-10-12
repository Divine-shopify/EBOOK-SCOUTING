import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_CATALOG } from "../analysis/catalog.js";
import { DISCOVERY_SOURCES } from "../adapters/sources.js";

const here = dirname(fileURLToPath(import.meta.url));
// Loaded via require so bundlers/test runners that strip the "node:" prefix still resolve the builtin.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncT };
export const SCHEMA_VERSION = 1;

export type DB = DatabaseSyncT;

let singleton: DB | null = null;

export function nowIso(): string {
  return new Date().toISOString();
}

/** Opens (and migrates) the SQLite database. Pass ":memory:" for tests. */
export function openDb(file = process.env.DATABASE_PATH ?? "data/authorscout.db"): DB {
  if (file !== ":memory:") mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function getDb(): DB {
  if (!singleton) singleton = openDb();
  return singleton;
}

export function migrate(db: DB): void {
  db.exec(readFileSync(resolve(here, "schema.sql"), "utf8"));
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  if ((row?.v ?? 0) < SCHEMA_VERSION) {
    db.prepare("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(SCHEMA_VERSION, nowIso());
  }
  seedReferenceData(db);
}

function seedReferenceData(db: DB): void {
  const svc = db.prepare(
    `INSERT INTO service_catalog(code, category_code, category, name) VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET category_code=excluded.category_code, category=excluded.category, name=excluded.name`,
  );
  for (const s of SERVICE_CATALOG) svc.run(s.code, s.categoryCode, s.category, s.name);
  const src = db.prepare(
    `INSERT INTO discovery_sources(key, name, category, base_url, access_mode, limitation) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET name=excluded.name, category=excluded.category, base_url=excluded.base_url,
       access_mode=excluded.access_mode, limitation=excluded.limitation`,
  );
  for (const s of DISCOVERY_SOURCES) src.run(s.key, s.name, s.category, s.baseUrl ?? null, s.accessMode, s.limitation ?? null);
}

/** Runs fn inside a transaction (commit on success, rollback on throw). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
  ).run(key, JSON.stringify(value), nowIso());
}
