import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso, type DB } from "../db/db.js";
import type { ProspectCandidate } from "./candidate.js";
import type { Decision, ProspectRecord, LeadStatus } from "./qualify.js";

/** Write transaction that takes the lock up front, so concurrent writers wait (busy_timeout) instead of failing. */
function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncT };

export function openProspectDb(file = process.env.PROSPECT_DB_PATH ?? "data/prospector.db"): DB {
  if (file !== ":memory:") mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000;");
  db.exec(readFileSync(resolve(here, "schema.sql"), "utf8"));
  // Additive migrations for databases created before batch tracking existed.
  const cols = (db.prepare("PRAGMA table_info(px_search_log)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("batch")) db.exec("ALTER TABLE px_search_log ADD COLUMN batch INTEGER");
  const qcols = (db.prepare("PRAGMA table_info(px_site_queue)").all() as { name: string }[]).map((c) => c.name);
  if (!qcols.includes("batch")) db.exec("ALTER TABLE px_site_queue ADD COLUMN batch INTEGER");
  return db;
}

export function intakeKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$/i.test(p)) u.searchParams.delete(p);
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/** Adds candidates to the work queue; already-seen source URLs are skipped. Returns how many were new. */
export function ingest(db: DB, cands: ProspectCandidate[], channel: string): { added: number; skipped: number } {
  let added = 0;
  const ins = db.prepare("INSERT OR IGNORE INTO px_candidates(intake_key, channel, payload, discovered_at) VALUES (?,?,?,?)");
  tx(db, () => {
    for (const c of cands) {
      const r = ins.run(intakeKey(c.sourceUrl), channel, JSON.stringify(c), nowIso());
      if (Number(r.changes) > 0) added++;
    }
  });
  return { added, skipped: cands.length - added };
}

export function pendingCandidates(db: DB, limit: number, retryErrors = false): { id: number; payload: ProspectCandidate }[] {
  const rows = db
    .prepare(`SELECT id, payload FROM px_candidates WHERE status = 'pending' ${retryErrors ? "OR (status = 'error' AND attempts < 3)" : ""} ORDER BY id LIMIT ?`)
    .all(limit) as { id: number; payload: string }[];
  return rows.map((r) => ({ id: r.id, payload: JSON.parse(r.payload) }));
}

const STATUS_RANK: Record<LeadStatus, number> = { Ready: 3, "Needs Review": 2, Excluded: 1 };
const LEVEL_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

function strength(r: ProspectRecord): number {
  return STATUS_RANK[r["Lead Status"] as LeadStatus] * 100 + LEVEL_RANK[r["Buying Intent"]] * 10 + LEVEL_RANK[r["Research Confidence"]];
}

function findExisting(db: DB, keys: string[]): { id: number; record: ProspectRecord; dedup_keys: string; evidence: string } | undefined {
  const rows = db.prepare("SELECT id, record, dedup_keys, evidence FROM px_prospects").all() as any[];
  const set = new Set(keys);
  const hit = rows.find((r) => (JSON.parse(r.dedup_keys) as string[]).some((k) => set.has(k)));
  return hit ? { ...hit, record: JSON.parse(hit.record) } : undefined;
}

/**
 * Saves a decision, consolidating with an existing prospect when any dedup key (name, site domain, email, profile URL)
 * matches. The stronger record wins; source URLs and services of the weaker one are preserved.
 */
export function saveDecision(db: DB, candidateId: number, d: Decision, evidence: unknown): { prospectId: number; duplicateOf?: number } {
  return tx(db, () => {
    const existing = findExisting(db, d.dedupKeys);
    const now = nowIso();
    if (!existing) {
      const r = db
        .prepare("INSERT INTO px_prospects(identity_key, record, lead_status, dedup_keys, evidence, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
        .run(`${d.identityKey}#${candidateId}`, JSON.stringify(d.record), d.status, JSON.stringify(d.dedupKeys), JSON.stringify([evidence]), now, now);
      const id = Number(r.lastInsertRowid);
      db.prepare("UPDATE px_candidates SET status='processed', outcome=?, outcome_reason=?, prospect_id=?, processed_at=?, attempts=attempts+1 WHERE id=?").run(d.status, d.reasons.join("; ") || null, id, now, candidateId);
      return { prospectId: id };
    }
    const keep = strength(d.record) > strength(existing.record) ? d.record : existing.record;
    const other = keep === d.record ? existing.record : d.record;
    const merged: ProspectRecord = { ...keep };
    const urls = new Set([merged["Additional Source URL"], other["Source URL"], other["Additional Source URL"]].flatMap((s) => (s ? s.split(" | ") : [])).filter((u) => u && u !== merged["Source URL"]));
    merged["Additional Source URL"] = [...urls].join(" | ");
    for (const col of ["Public Professional Email", "Public Contact Page", "Official Website", "Book Title", "Publishing Platform", "Preferred Language"] as const) {
      if (!merged[col] && other[col]) merged[col] = other[col];
    }
    if (merged.Country === "Unverified" && other.Country !== "Unverified") {
      merged.Country = other.Country;
      merged["State or Region"] = other["State or Region"];
      merged.City = other.City;
    }
    if (other["Lead Status"] !== "Excluded" && other["Service Opportunity"] && !merged["Service Opportunity"].includes(other["Service Opportunity"])) {
      merged.Notes += ` Consolidated duplicate evidence: ${other["Evidence of Need"].slice(0, 300)} [${other["Source URL"]}]`;
    }
    const keys = [...new Set([...(JSON.parse(existing.dedup_keys) as string[]), ...d.dedupKeys])];
    const ev = [...(JSON.parse(existing.evidence) as unknown[]), evidence];
    db.prepare("UPDATE px_prospects SET record=?, lead_status=?, dedup_keys=?, evidence=?, updated_at=? WHERE id=?").run(
      JSON.stringify(merged), merged["Lead Status"], JSON.stringify(keys), JSON.stringify(ev), now, existing.id,
    );
    db.prepare("UPDATE px_candidates SET status='processed', outcome='Duplicate', outcome_reason=?, prospect_id=?, processed_at=?, attempts=attempts+1 WHERE id=?").run(
      `consolidated into prospect #${existing.id} (${d.status} candidate)`, existing.id, now, candidateId,
    );
    return { prospectId: existing.id, duplicateOf: existing.id };
  });
}

export function markError(db: DB, candidateId: number, err: string): void {
  db.prepare("UPDATE px_candidates SET status='error', last_error=?, attempts=attempts+1, processed_at=? WHERE id=?").run(err.slice(0, 500), nowIso(), candidateId);
}

export function logSearch(
  db: DB,
  e: { query: string; market?: string; language?: string; provider: string; sourceType?: string; resultsReviewed: number; candidatesAdded: number; rejected?: number; rejectionReasons?: string; nextDirection?: string; error?: string; searchedAt?: string; batch?: number },
): void {
  db.prepare(
    `INSERT INTO px_search_log(query, market, language, provider, source_type, searched_at, results_reviewed, candidates_added, rejected, rejection_reasons, next_direction, error, batch)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(e.query, e.market ?? null, e.language ?? null, e.provider, e.sourceType ?? null, e.searchedAt ?? nowIso(), e.resultsReviewed, e.candidatesAdded, e.rejected ?? 0, e.rejectionReasons ?? null, e.nextDirection ?? null, e.error ?? null, e.batch ?? currentBatch(db));
}

export function allProspects(db: DB): (ProspectRecord & { _id: number })[] {
  return (db.prepare("SELECT id, record FROM px_prospects ORDER BY id").all() as any[]).map((r) => ({ ...JSON.parse(r.record), _id: r.id }));
}

export function updateProspectRecord(db: DB, id: number, record: ProspectRecord): void {
  db.prepare("UPDATE px_prospects SET record=?, lead_status=?, updated_at=? WHERE id=?").run(JSON.stringify(record), record["Lead Status"], nowIso(), id);
}

/** Clears prospects and re-queues every candidate (used after qualification rules change; page fetches stay cached). */
export function requeueAll(db: DB): number {
  return tx(db, () => {
    db.exec("DELETE FROM px_prospects");
    return Number(db.prepare("UPDATE px_candidates SET status='pending', outcome=NULL, outcome_reason=NULL, prospect_id=NULL, attempts=0, last_error=NULL").run().changes);
  });
}

/** The research batch new work is attributed to (set with `prospect set-batch N`). */
export function currentBatch(db: DB): number {
  const r = db.prepare("SELECT value FROM px_meta WHERE key = 'batch'").get() as { value: string } | undefined;
  return r ? Number(r.value) : 1;
}

export function setBatch(db: DB, n: number): void {
  db.prepare("INSERT INTO px_meta(key, value) VALUES ('batch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(n));
}
