import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DB } from "../db/db.js";
import { COLUMNS, type ProspectRecord } from "./qualify.js";
import { allProspects } from "./store.js";
import { MARKETS, MARKET_MEASURE } from "./markets.js";

const URL_COLS = new Set(["Public Contact Page", "Official Website", "Source URL"]);
const WIDTHS: Partial<Record<string, number>> = {
  "Prospect Name": 24, "First Name": 12, "Author or Business Name": 24, Country: 16, "State or Region": 14, City: 14, "Preferred Language": 12,
  "Author Type": 20, "Book Title": 26, "Book Topic or Genre": 18, "Book Status": 13, "Publishing Platform": 22, "Publishing Stage": 20,
  "Service Opportunity": 34, "Opportunity Category": 18, "Buying Intent": 11, "Evidence of Need": 60, "Opportunity Rationale": 50,
  "Public Professional Email": 28, "Public Contact Page": 30, "Official Website": 30, "Source URL": 40, "Additional Source URL": 40,
  "Evidence Type": 22, "Research Confidence": 12, "Lead Status": 12, "Date Researched": 12, Notes: 70,
};

/** Neutralises spreadsheet formula injection from scraped text. */
function safe(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function styleHeader(ws: ExcelJS.Worksheet, cols: number): void {
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  h.alignment = { vertical: "middle", wrapText: true };
  h.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
}

function prospectSheet(wb: ExcelJS.Workbook, title: string, rows: ProspectRecord[]): void {
  const ws = wb.addWorksheet(title);
  ws.columns = COLUMNS.map((c) => ({ header: c, key: c, width: WIDTHS[c] ?? 16 }));
  for (const r of rows) {
    const row = ws.addRow(COLUMNS.map((c) => safe(r[c] ?? "")));
    COLUMNS.forEach((c, i) => {
      const v = r[c];
      const cell = row.getCell(i + 1);
      if (v && URL_COLS.has(c) && /^https?:\/\//.test(v)) cell.value = { text: v, hyperlink: v };
      if (v && c === "Additional Source URL" && /^https?:\/\//.test(v) && !v.includes(" | ")) cell.value = { text: v, hyperlink: v };
      if (v && c === "Public Professional Email") cell.value = { text: v, hyperlink: `mailto:${v}` };
      if (cell.value && typeof cell.value === "object") cell.font = { color: { argb: "FF0563C1" }, underline: true };
    });
    row.alignment = { vertical: "top", wrapText: true };
  }
  styleHeader(ws, COLUMNS.length);
}

export interface CampaignStats {
  candidates: number;
  ready: number;
  review: number;
  excluded: number;
  duplicates: number;
  errors: number;
  pending: number;
  readyWithEmail: number;
  readyContactPageNoEmail: number;
  conf: Record<string, number>;
  intent: Record<string, number>;
  countries: Record<string, number>;
  platforms: Record<string, number>;
  categories: Record<string, number>;
  explicit: number;
  inferred: number;
  channels: Record<string, number>;
  searches: number;
}

const count = (arr: string[]) => arr.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

export function campaignStats(db: DB): CampaignStats {
  const ps = allProspects(db);
  const ready = ps.filter((p) => p["Lead Status"] === "Ready");
  const q = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const svc = ready.flatMap((p) => (p["Opportunity Category"] === "Multiple Services" ? p["Service Opportunity"].split("; ").map(serviceToCat) : [p["Opportunity Category"]]));
  return {
    candidates: q("SELECT COUNT(*) n FROM px_candidates"),
    ready: ready.length,
    review: ps.filter((p) => p["Lead Status"] === "Needs Review").length,
    excluded: q("SELECT COUNT(*) n FROM px_candidates WHERE outcome = 'Excluded'"),
    duplicates: q("SELECT COUNT(*) n FROM px_candidates WHERE outcome = 'Duplicate'"),
    errors: q("SELECT COUNT(*) n FROM px_candidates WHERE status = 'error'"),
    pending: q("SELECT COUNT(*) n FROM px_candidates WHERE status = 'pending'"),
    readyWithEmail: ready.filter((p) => p["Public Professional Email"]).length,
    readyContactPageNoEmail: ready.filter((p) => !p["Public Professional Email"] && p["Public Contact Page"]).length,
    conf: count(ready.map((p) => p["Research Confidence"])),
    intent: count(ready.map((p) => p["Buying Intent"])),
    countries: count(ready.map((p) => p.Country)),
    platforms: count(ready.flatMap((p) => (p["Publishing Platform"] ? p["Publishing Platform"].split(", ") : []))),
    categories: count(svc),
    explicit: ready.filter((p) => p["Evidence of Need"].startsWith("Explicit request")).length,
    inferred: ready.filter((p) => !p["Evidence of Need"].startsWith("Explicit request")).length,
    channels: count((db.prepare("SELECT c.channel FROM px_candidates c JOIN px_prospects p ON p.id = c.prospect_id WHERE c.outcome = 'Ready'").all() as { channel: string }[]).map((r) => r.channel)),
    searches: q("SELECT COUNT(*) n FROM px_search_log"),
  };
}

function serviceToCat(s: string): string {
  const m: [RegExp, string][] = [[/proofread/i, "Proofreading"], [/edit|assessment/i, "Editing"], [/format|epub|layout/i, "Formatting"], [/cover|illustrat/i, "Cover Design"], [/kdp|publishing setup/i, "Publishing Setup"], [/distribut/i, "Distribution"], [/description|metadata/i, "Listing Optimization"], [/ads|advertis/i, "Advertising"], [/market|launch|arc|pre-order/i, "Marketing"], [/website/i, "Author Website"], [/direct/i, "Direct Sales"], [/audio/i, "Audiobook"], [/translat/i, "Translation"], [/newsletter|automation/i, "Automation"]];
  return m.find(([re]) => re.test(s))?.[1] ?? "Other";
}

const sorted = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]);

/** Ranking score for choosing the strongest qualified prospects when more than the campaign target qualify. */
export function prospectStrength(p: ProspectRecord): number {
  const lv: Record<string, number> = { High: 2, Medium: 1, Low: 0 };
  return (
    lv[p["Buying Intent"]] * 100 +
    lv[p["Research Confidence"]] * 40 +
    (p["Evidence of Need"].startsWith("Explicit request") ? 30 : 0) +
    (p.Country !== "Unverified" ? 20 : 0) +
    (p["Public Professional Email"] ? 10 : p["Public Contact Page"] ? 5 : 0) +
    (p["Official Website"] ? 5 : 0)
  );
}

export async function exportWorkbook(db: DB, file: string, target = 200): Promise<CampaignStats> {
  const ps = allProspects(db);
  const order = { High: 0, Medium: 1, Low: 2 } as Record<string, number>;
  const byStrength = (a: ProspectRecord, b: ProspectRecord) =>
    order[a["Buying Intent"]] - order[b["Buying Intent"]] || order[a["Research Confidence"]] - order[b["Research Confidence"]] || a.Country.localeCompare(b.Country) || a["Prospect Name"].localeCompare(b["Prospect Name"]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "eBook Author Prospecting Agent";
  wb.created = new Date();
  const ready = ps.filter((p) => p["Lead Status"] === "Ready").sort((a, b) => prospectStrength(b) - prospectStrength(a) || a["Prospect Name"].localeCompare(b["Prospect Name"]));
  prospectSheet(wb, "Qualified Prospects", ready.slice(0, target).sort(byStrength));
  if (ready.length > target) prospectSheet(wb, "Qualified Reserve", ready.slice(target).sort(byStrength));
  prospectSheet(wb, "Needs Review", ps.filter((p) => p["Lead Status"] === "Needs Review").sort(byStrength));

  // Research log: every query, with outcomes attributed back from candidates.
  const log = db.prepare("SELECT * FROM px_search_log ORDER BY id").all() as any[];
  const outcomes = db.prepare("SELECT payload, outcome FROM px_candidates WHERE status='processed'").all() as { payload: string; outcome: string }[];
  const perQuery = new Map<string, { ready: number; rejected: number }>();
  for (const o of outcomes) {
    const q = JSON.parse(o.payload).discovery?.query as string | undefined;
    if (!q) continue;
    const e = perQuery.get(q) ?? { ready: 0, rejected: 0 };
    if (o.outcome === "Ready") e.ready++;
    else if (o.outcome === "Excluded") e.rejected++;
    perQuery.set(q, e);
  }
  const lw = wb.addWorksheet("Research Log");
  const logCols = ["Search Query", "Country or Market", "Language", "Platform or Source Type", "Provider", "Date Searched", "Results Reviewed", "Candidates Added", "Qualified Prospects Discovered", "Rejected Results", "Reason for Rejection", "Next Search Direction", "Error"];
  lw.columns = logCols.map((h) => ({ header: h, key: h, width: h.startsWith("Reason") || h.startsWith("Next") ? 50 : h === "Search Query" ? 40 : 16 }));
  for (const r of log) {
    const pq = perQuery.get(r.query);
    lw.addRow([safe(r.query), r.market ?? "", r.language ?? "", r.source_type ?? "", r.provider, String(r.searched_at).slice(0, 10), r.results_reviewed, r.candidates_added, pq?.ready ?? 0, r.rejected + (pq?.rejected ?? 0), r.rejection_reasons ?? "", r.next_direction ?? "", r.error ?? ""]).alignment = { vertical: "top", wrapText: true };
  }
  styleHeader(lw, logCols.length);

  // Excluded and duplicate candidates (audit trail; not counted as qualified).
  const ex = wb.addWorksheet("Excluded & Duplicates");
  const exCols = ["Candidate", "Source URL", "Discovery Channel", "Outcome", "Reason"];
  ex.columns = exCols.map((h) => ({ header: h, key: h, width: h === "Reason" ? 90 : h === "Source URL" ? 50 : 22 }));
  const exRows = db.prepare("SELECT channel, payload, outcome, outcome_reason, last_error, status FROM px_candidates WHERE outcome IN ('Excluded','Duplicate') OR status = 'error' ORDER BY id").all() as any[];
  for (const r of exRows) {
    const p = JSON.parse(r.payload);
    const row = ex.addRow([safe(p.name), p.sourceUrl, r.channel, r.status === "error" ? "Error" : r.outcome, safe(r.outcome_reason ?? r.last_error ?? "")]);
    row.getCell(2).value = { text: p.sourceUrl, hyperlink: p.sourceUrl };
    row.alignment = { vertical: "top", wrapText: true };
  }
  styleHeader(ex, exCols.length);

  // Campaign summary.
  const s = campaignStats(db);
  const sw = wb.addWorksheet("Campaign Summary");
  sw.columns = [{ header: "Metric", key: "m", width: 52 }, { header: "Value", key: "v", width: 90 }];
  const rows: [string, string | number][] = [
    ["Workbook generated", new Date().toISOString()],
    ["Qualified prospects (Lead Status = Ready), all", s.ready],
    ["Target", target],
    ["Qualified prospects on 'Qualified Prospects' sheet (strongest, capped at target)", Math.min(s.ready, target)],
    ["Additional qualified prospects on 'Qualified Reserve' sheet", Math.max(0, s.ready - target)],
    ["Records needing review", s.review],
    ["Total candidates discovered", s.candidates],
    ["Candidates excluded", s.excluded],
    ["Duplicate candidates consolidated", s.duplicates],
    ["Candidates with processing errors", s.errors],
    ["Candidates still pending", s.pending],
    ["Qualified with publicly displayed professional email", s.readyWithEmail],
    ["Qualified with public contact page but no listed email", s.readyContactPageNoEmail],
    ["Emails technically deliverability-checked", 0],
    ["High confidence (qualified)", s.conf.High ?? 0],
    ["Medium confidence (qualified)", s.conf.Medium ?? 0],
    ["Low confidence (qualified)", s.conf.Low ?? 0],
    ["High buying intent (qualified)", s.intent.High ?? 0],
    ["Medium buying intent (qualified)", s.intent.Medium ?? 0],
    ["Explicit service requests (qualified)", s.explicit],
    ["Inferred opportunities (qualified)", s.inferred],
    ["Countries (qualified, verified location)", sorted(s.countries).map(([k, n]) => `${k}: ${n}`).join("; ")],
    ["Publishing platforms represented", sorted(s.platforms).map(([k, n]) => `${k}: ${n}`).join("; ")],
    ["Opportunity categories", sorted(s.categories).map(([k, n]) => `${k}: ${n}`).join("; ")],
    ["Qualified prospects by discovery channel", sorted(s.channels).map(([k, n]) => `${k}: ${n}`).join("; ")],
    ["Searches logged", s.searches],
    ["Market measure", MARKET_MEASURE],
    ["Target markets", MARKETS.map((m) => `${m.country}${m.gdpPerCapitaUsd2026 ? ` ($${m.gdpPerCapitaUsd2026.toLocaleString("en-US")})` : ""}`).join("; ")],
    ["Qualification rule", "Ready = identity confirmed on an agent-fetched page + eBook/book-production connection + service need found verbatim in agent-fetched text (explicit request ≤30 months old, or production-stage wording dated within 12 months) + buying intent High/Medium + confidence High/Medium. Service providers are excluded."],
    ["Email rule", "Only addresses displayed on the author's own fetched website/contact page are recorded. None are guessed. Displayed ≠ deliverability-verified; no deliverability check was run."],
    ["Location rule", "Country is recorded only when location wording appears on a fetched page; otherwise 'Unverified'."],
  ];
  for (const [m, v] of rows) sw.addRow([m, v]).alignment = { vertical: "top", wrapText: true };
  styleHeader(sw, 2);

  mkdirSync(dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
  return s;
}
