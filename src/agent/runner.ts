import type { DB } from "../db/db.js";
import { nowIso } from "../db/db.js";
import { env, ResearchConfigSchema, type ResearchConfig } from "../config.js";
import { Fetcher } from "../adapters/fetch/http.js";
import { AnthropicAnalyzer, NullAnalyzer, type Analyzer } from "../adapters/ai/analyzer.js";
import { NeverBounceProvider, ZeroBounceProvider, type VerificationProvider, type MxLookup } from "../email/verify.js";
import { researchCandidate } from "./pipeline.js";
import type { Candidate } from "./candidate.js";
import { normalizeKey } from "../util/text.js";

export type RunStatus = "pending" | "running" | "paused" | "cancelled" | "completed" | "failed";

export function createRun(db: DB, name: string, config: Partial<ResearchConfig>, candidates: Candidate[]): number {
  const cfg = ResearchConfigSchema.parse(config);
  const r = db.prepare("INSERT INTO research_runs(name, status, config_json) VALUES (?, 'pending', ?)").run(name, JSON.stringify(cfg));
  const runId = Number(r.lastInsertRowid);
  const ins = db.prepare("INSERT OR IGNORE INTO run_candidates(run_id, candidate_key, payload_json, updated_at) VALUES (?,?,?,?)");
  for (const c of candidates.slice(0, cfg.batchSize)) {
    ins.run(runId, `${normalizeKey(c.penName || c.authorName)}|${normalizeKey(c.bookTitle)}`, JSON.stringify(c), nowIso());
  }
  const total = (db.prepare("SELECT COUNT(*) n FROM run_candidates WHERE run_id = ?").get(runId) as { n: number }).n;
  db.prepare("UPDATE research_runs SET candidates_total = ? WHERE id = ?").run(total, runId);
  return runId;
}

export function setRunStatus(db: DB, runId: number, status: RunStatus): void {
  const fin = ["cancelled", "completed", "failed"].includes(status) ? nowIso() : null;
  db.prepare("UPDATE research_runs SET status = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?").run(status, fin, runId);
}

function runStatus(db: DB, runId: number): RunStatus {
  return (db.prepare("SELECT status FROM research_runs WHERE id = ?").get(runId) as { status: RunStatus }).status;
}

export interface RunnerDeps {
  analyzer?: Analyzer;
  verifier?: VerificationProvider | null;
  fetcher?: Fetcher;
  mxLookup?: MxLookup;
  log?: (m: string) => void;
}

/**
 * Executes (or resumes) a run. Each candidate is checkpointed in run_candidates, so a crash
 * or pause loses at most the candidate in flight. Pause/cancel are cooperative: the runner
 * checks the run status before each candidate.
 */
export async function executeRun(db: DB, runId: number, deps: RunnerDeps = {}): Promise<RunStatus> {
  const e = env();
  const run = db.prepare("SELECT * FROM research_runs WHERE id = ?").get(runId) as any;
  if (!run) throw new Error(`Run ${runId} not found`);
  if (["completed", "cancelled"].includes(run.status)) return run.status;
  const config = ResearchConfigSchema.parse(JSON.parse(run.config_json));
  const log = deps.log ?? ((m: string) => console.log(`[run ${runId}] ${m}`));
  const fetcher =
    deps.fetcher ??
    new Fetcher(db, {
      userAgent: e.USER_AGENT,
      requestsPerSecondPerHost: config.requestsPerSecondPerHost,
      hostDelayMs: { "www.goodreads.com": 5000 },
      onRequest: () => db.prepare("UPDATE research_runs SET api_calls = api_calls + 1 WHERE id = ?").run(runId),
    });
  const analyzer = deps.analyzer ?? (e.ANTHROPIC_API_KEY ? new AnthropicAnalyzer(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL) : new NullAnalyzer());
  const verifier =
    deps.verifier !== undefined
      ? deps.verifier
      : config.verificationProvider === "zerobounce"
        ? new ZeroBounceProvider(e.ZEROBOUNCE_API_KEY)
        : config.verificationProvider === "neverbounce"
          ? new NeverBounceProvider(e.NEVERBOUNCE_API_KEY)
          : null;

  db.prepare("UPDATE research_runs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?").run(nowIso(), runId);
  // Anything left in_progress from a crash is retried.
  db.prepare("UPDATE run_candidates SET status = 'queued' WHERE run_id = ? AND status = 'in_progress'").run(runId);

  const next = db.prepare("SELECT * FROM run_candidates WHERE run_id = ? AND status = 'queued' ORDER BY id LIMIT 1");
  for (;;) {
    const st = runStatus(db, runId);
    if (st === "paused" || st === "cancelled") {
      log(`stopping: run is ${st}`);
      return st;
    }
    const spent = (db.prepare("SELECT COALESCE(SUM(cost_usd),0) s FROM api_usage WHERE run_id = ?").get(runId) as { s: number }).s;
    if (spent >= Math.min(config.maxApiSpendUsd, e.MAX_SPEND_USD) && analyzer.enabled) {
      log(`spend limit reached ($${spent.toFixed(2)}); pausing run`);
      db.prepare("UPDATE research_runs SET notes = COALESCE(notes,'') || ? WHERE id = ?").run(`Paused at spend limit $${spent.toFixed(2)}. `, runId);
      setRunStatus(db, runId, "paused");
      return "paused";
    }
    const row = next.get(runId) as any;
    if (!row) break;
    db.prepare("UPDATE run_candidates SET status = 'in_progress', updated_at = ? WHERE id = ?").run(nowIso(), row.id);
    const cand = JSON.parse(row.payload_json) as Candidate;
    try {
      const out = await researchCandidate({ db, fetcher, runId, config, analyzer, verifier, mxLookup: deps.mxLookup, log }, cand);
      if (out.kind === "saved") {
        if (out.score.total < config.minLeadScore) log(`${cand.authorName}: score ${out.score.total} below minimum ${config.minLeadScore} (kept, flagged)`);
        db.prepare("UPDATE run_candidates SET status = 'done', author_id = ?, message = ?, updated_at = ? WHERE id = ?").run(
          out.authorId, `${out.status}; score ${out.score.total} (${out.score.priority}); ${out.emails} email(s)${out.deduplicatedInto ? "; merged into existing author" : ""}`, nowIso(), row.id);
        db.prepare("UPDATE research_runs SET candidates_done = candidates_done + 1 WHERE id = ?").run(runId);
        log(`✓ ${cand.authorName} — ${out.status}, score ${out.score.total}, emails ${out.emails}`);
      } else if (out.kind === "skipped") {
        db.prepare("UPDATE run_candidates SET status = 'skipped', message = ?, updated_at = ? WHERE id = ?").run(out.reason, nowIso(), row.id);
        db.prepare("UPDATE research_runs SET candidates_skipped = candidates_skipped + 1 WHERE id = ?").run(runId);
        log(`- ${cand.authorName}: skipped (${out.reason})`);
      } else {
        db.prepare("UPDATE run_candidates SET status = 'failed', message = ?, updated_at = ? WHERE id = ?").run(out.reason, nowIso(), row.id);
        db.prepare("UPDATE research_runs SET candidates_failed = candidates_failed + 1 WHERE id = ?").run(runId);
        log(`✗ ${cand.authorName}: ${out.reason}`);
      }
    } catch (err: any) {
      db.prepare("UPDATE run_candidates SET status = 'failed', message = ?, updated_at = ? WHERE id = ?").run(String(err?.stack ?? err).slice(0, 1000), nowIso(), row.id);
      db.prepare("UPDATE research_runs SET candidates_failed = candidates_failed + 1 WHERE id = ?").run(runId);
      db.prepare("INSERT INTO research_errors(run_id, stage, message, occurred_at) VALUES (?,?,?,?)").run(runId, "pipeline", `${cand.authorName}: ${err?.message ?? err}`, nowIso());
      log(`✗ ${cand.authorName}: ${err?.message ?? err}`);
    }
  }
  setRunStatus(db, runId, "completed");
  const cost = (db.prepare("SELECT COALESCE(SUM(cost_usd),0) s FROM api_usage WHERE run_id = ?").get(runId) as { s: number }).s;
  db.prepare("UPDATE research_runs SET api_cost_usd = ? WHERE id = ?").run(cost, runId);
  return "completed";
}
