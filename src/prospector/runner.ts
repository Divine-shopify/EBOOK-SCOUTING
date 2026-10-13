import type { Fetcher } from "../adapters/fetch/http.js";
import type { DB } from "../db/db.js";
import { verifyCandidate } from "./verify.js";
import { resolveMxRobust, type MxLookup } from "../email/verify.js";
import { qualify } from "./qualify.js";
import { intakeKey, markError, pendingCandidates, saveDecision } from "./store.js";
import { existsSync, readFileSync } from "node:fs";
import type { Decision } from "./qualify.js";

/**
 * Analyst QC overrides (seeds/prospects/qc_overrides.json): a reviewer can only *downgrade* a record
 * (Ready → Needs Review/Excluded) with a written reason, e.g. when a verified quote is a joke or an anecdote.
 * Overrides never upgrade a record, so they cannot create a qualified prospect the rules rejected.
 */
export interface QcOverride {
  sourceUrl: string;
  status: "Needs Review" | "Excluded";
  reason: string;
}

export function loadOverrides(file = process.env.QC_OVERRIDES ?? "seeds/prospects/qc_overrides.json"): Map<string, QcOverride> {
  if (!existsSync(file)) return new Map();
  const arr = JSON.parse(readFileSync(file, "utf8")) as QcOverride[];
  return new Map(arr.map((o) => [intakeKey(o.sourceUrl), o]));
}

const RANK = { Ready: 3, "Needs Review": 2, Excluded: 1 } as const;

export function applyOverride(d: Decision, o: QcOverride | undefined): Decision {
  if (!o || RANK[o.status] >= RANK[d.status]) return d;
  const record = { ...d.record, "Lead Status": o.status, Notes: `${d.record.Notes} Analyst QC: ${o.reason}` };
  if (record["Buying Intent"] === "High") record["Buying Intent"] = "Medium";
  return { ...d, status: o.status, record, reasons: [...d.reasons, `analyst QC: ${o.reason}`] };
}

export interface BatchResult {
  processed: number;
  ready: number;
  review: number;
  excluded: number;
  duplicates: number;
  errors: number;
}

/**
 * Verifies and qualifies pending candidates in batches. Each candidate is committed on its own, so an interrupted run
 * resumes from the next pending row; failed rows are retried up to three times with --retry-errors.
 */
export async function processPending(
  db: DB,
  fetcher: Fetcher,
  opts: { batch?: number; concurrency?: number; retryErrors?: boolean; onLog?: (s: string) => void; mxLookup?: MxLookup | null } = {},
): Promise<BatchResult> {
  const log = opts.onLog ?? (() => {});
  const rows = pendingCandidates(db, opts.batch ?? 50, opts.retryErrors);
  const res: BatchResult = { processed: 0, ready: 0, review: 0, excluded: 0, duplicates: 0, errors: 0 };
  const overrides = loadOverrides();
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      try {
        const v = await verifyCandidate(row.payload, fetcher, opts.mxLookup === undefined ? resolveMxRobust : opts.mxLookup);
        const d = applyOverride(qualify(row.payload, v), overrides.get(intakeKey(row.payload.sourceUrl)));
        const saved = saveDecision(db, row.id, d, { candidateId: row.id, pages: v.pages, signals: v.signals, identity: v.identityBasis, ebook: v.ebookBasis, audit: v.audit });
        res.processed++;
        if (saved.duplicateOf) res.duplicates++;
        else if (d.status === "Ready") res.ready++;
        else if (d.status === "Needs Review") res.review++;
        else res.excluded++;
        log(`#${row.id} ${row.payload.name}: ${saved.duplicateOf ? `duplicate of #${saved.duplicateOf}` : d.status} (intent ${d.intent}, confidence ${d.confidence})`);
      } catch (e) {
        res.errors++;
        markError(db, row.id, (e as Error).message);
        log(`#${row.id} ${row.payload.name}: ERROR ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return res;
}
