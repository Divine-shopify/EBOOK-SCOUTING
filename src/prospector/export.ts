import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DB } from "../db/db.js";
import { COLUMNS, type ProspectRecord } from "./qualify.js";
import { allProspects } from "./store.js";
import { siteScanLog } from "./sitescan.js";
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
  readyEmailMx: number;
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
    readyEmailMx: ready.filter((p) => p["Public Professional Email"] && /domain has MX records/.test(p.Notes)).length,
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
    (p["Evidence of Need"].startsWith("Explicit request") ? 80 : 0) +
    (p.Country !== "Unverified" ? 20 : 0) +
    (p["Public Professional Email"] ? 10 : p["Public Contact Page"] ? 5 : 0) +
    (p["Official Website"] ? 5 : 0)
  );
}

/** Prospect-mix categories (campaign brief §3) with their target counts. */
export const PROSPECT_MIX: [string, number][] = [
  ["Independent and self-published authors", 200],
  ["Amazon KDP and Kindle authors", 150],
  ["Authors with upcoming books or active publishing projects", 100],
  ["Authors seeking editing or proofreading", 100],
  ["Authors seeking eBook formatting or conversion", 100],
  ["Authors seeking cover design or book graphics", 75],
  ["Authors seeking publishing or distribution assistance", 75],
  ["Authors seeking book marketing or launch support", 75],
  ["Authors needing author websites or direct-sales infrastructure", 50],
  ["Independent publishers and author-owned publishing businesses", 75],
];

/** One primary prospect-mix category per record, derived from its verified evidence. */
export function primaryCategory(p: ProspectRecord): string {
  const explicit = p["Evidence of Need"].startsWith("Explicit request");
  const svc = `${p["Opportunity Category"]} ${p["Service Opportunity"]}`;
  if (explicit) {
    if (/Editing|Proofreading|edit|proofread/i.test(svc)) return PROSPECT_MIX[3][0];
    if (/Formatting|format|epub/i.test(svc)) return PROSPECT_MIX[4][0];
    if (/Cover Design|cover|illustrat/i.test(svc)) return PROSPECT_MIX[5][0];
    if (/Publishing Setup|Distribution|kdp|distribut|isbn/i.test(svc)) return PROSPECT_MIX[6][0];
    if (/Marketing|Advertising|Listing|launch|ads|blurb|description/i.test(svc)) return PROSPECT_MIX[7][0];
    if (/Author Website|Direct Sales|website|storefront/i.test(svc)) return PROSPECT_MIX[8][0];
  }
  if (/Independent Publisher|Author-Owned Business/.test(p["Author Type"])) return PROSPECT_MIX[9][0];
  if (/Amazon KDP|Kindle/i.test(`${p["Publishing Platform"]} ${p["Evidence of Need"]}`)) return PROSPECT_MIX[1][0];
  if (/Forthcoming|In Progress|Relaunch|Unpublished/.test(p["Book Status"])) return PROSPECT_MIX[2][0];
  return PROSPECT_MIX[0][0];
}

/**
 * Research batches (brief §16): qualified prospects in the order they were first discovered, 200 per batch.
 * Returns each prospect's batch and the discovery timestamp that closes each batch (used to date log entries).
 */
function batchPlan(db: DB, main: (ProspectRecord & { _id: number })[], size = 200): { of: Map<number, number>; batchAt: (iso: string) => number } {
  const rows = db.prepare("SELECT prospect_id, MIN(id) AS first_id, MIN(discovered_at) AS first_at FROM px_candidates WHERE prospect_id IS NOT NULL GROUP BY prospect_id").all() as { prospect_id: number; first_id: number; first_at: string }[];
  const first = new Map(rows.map((r) => [r.prospect_id, r]));
  const ordered = [...main].sort((x, y) => (first.get(x._id)?.first_id ?? 0) - (first.get(y._id)?.first_id ?? 0));
  const of = new Map<number, number>();
  const closes: string[] = [];
  ordered.forEach((p, i) => {
    const b = Math.floor(i / size) + 1;
    of.set(p._id, b);
    closes[b - 1] = first.get(p._id)?.first_at ?? closes[b - 1];
  });
  const last = Math.max(1, closes.length);
  const batchAt = (iso: string) => {
    const i = closes.findIndex((c) => c && iso <= c);
    return i < 0 ? last : i + 1;
  };
  return { of, batchAt };
}

/** Status labels used in the workbook ("Needs Review" is stored internally, shown as "Review"). */
function forWorkbook(p: ProspectRecord): ProspectRecord {
  const notes = `${p.Notes}${p["Public Professional Email"] ? "" : " Contact: no public professional email found."} Primary prospect category: ${primaryCategory(p)}.`;
  return { ...p, "Lead Status": p["Lead Status"] === "Needs Review" ? "Review" : p["Lead Status"], Notes: notes };
}

function tableRows(ws: ExcelJS.Worksheet, title: string, m: Record<string, number> | [string, number | string][]): void {
  ws.addRow([]);
  ws.addRow([title]).font = { bold: true };
  for (const [k, v] of Array.isArray(m) ? m : sorted(m)) ws.addRow([k, v]);
}

export async function exportWorkbook(db: DB, file: string, target = 1000): Promise<CampaignStats> {
  const ps = allProspects(db);
  const order = { High: 0, Medium: 1, Low: 2 } as Record<string, number>;
  const byStrength = (a: ProspectRecord, b: ProspectRecord) =>
    order[a["Buying Intent"]] - order[b["Buying Intent"]] || order[a["Research Confidence"]] - order[b["Research Confidence"]] || a.Country.localeCompare(b.Country) || a["Prospect Name"].localeCompare(b["Prospect Name"]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "eBook Author Prospecting Agent";
  wb.created = new Date();
  const ready = ps.filter((p) => p["Lead Status"] === "Ready").sort((a, b) => prospectStrength(b) - prospectStrength(a) || a["Prospect Name"].localeCompare(b["Prospect Name"]));
  const main = ready.slice(0, target);
  const plan = batchPlan(db, main);
  const review = ps.filter((p) => p["Lead Status"] === "Needs Review");
  const s = campaignStats(db);

  // Sheet 1: qualified prospects.
  prospectSheet(wb, "Qualified Prospects", main.sort(byStrength).map(forWorkbook));

  // Sheet 2: research summary.
  const sw = wb.addWorksheet("Research Summary");
  sw.columns = [{ header: "Metric", key: "m", width: 62 }, { header: "Value", key: "v", width: 70 }];
  const emailMx = main.filter((p) => p["Public Professional Email"] && /domain has MX records/.test(p.Notes)).length;
  const head: [string, string | number][] = [
    ["Workbook generated", new Date().toISOString()],
    ["Target (approximate)", target],
    ["Total candidates discovered (queued for verification)", s.candidates],
    ["Total unique qualified prospects (Lead Status = Ready)", main.length],
    ["Additional qualified prospects beyond the target (not in workbook)", Math.max(0, ready.length - target)],
    ["Records requiring review (Review sheet)", review.length],
    ["Candidates rejected (excluded by the qualification rules or analyst QC)", s.excluded],
    ["Duplicate candidates removed (consolidated into an existing record)", s.duplicates],
    ["Invalid candidates removed (failed schema validation or processing errors)", s.errors],
    ["Qualified prospects with a publicly displayed professional email", main.filter((p) => p["Public Professional Email"]).length],
    ["Qualified prospects without a public professional email", main.filter((p) => !p["Public Professional Email"]).length],
    ["  …of which have a public contact page", main.filter((p) => !p["Public Professional Email"] && p["Public Contact Page"]).length],
    ["Emails whose domain passed a DNS MX check (mail routable; mailbox NOT verified)", emailMx],
    ["Emails technically verified at mailbox level (SMTP/provider)", "0 — not performed"],
    ["Prospects with explicit service requests", main.filter((p) => p["Evidence of Need"].startsWith("Explicit request")).length],
    ["Prospects with inferred service opportunities", main.filter((p) => !p["Evidence of Need"].startsWith("Explicit request")).length],
    ["Search / crawl log entries", s.searches],
    ["Market measure", MARKET_MEASURE],
    ["Qualification rule", "Ready = identity confirmed on an agent-fetched page + eBook/book-production connection + service need found verbatim in agent-fetched text (first-person explicit request ≤24 months old — High intent if ≤12 months — or production-stage wording that is current: cited release still upcoming or within 45 days, dated posts ≤6 months) + intent High/Medium + confidence High/Medium. Low intent/confidence never qualifies."],
    ["Email rule", "Only addresses displayed on the author's own fetched pages and attributable to the author are recorded; none guessed; MX check only, no mailbox verification."],
    ["Location rule", "Country only from author-referring location wording on a fetched page (or an Impressum / mentions légales address); otherwise 'Unverified'."],
  ];
  for (const [m, v] of head) sw.addRow([m, v]).alignment = { vertical: "top", wrapText: true };
  const mix = count(main.map(primaryCategory));
  sw.addRow([]);
  sw.addRow(["Prospect mix (primary category)", "Qualified / target (shortfall)"]).font = { bold: true };
  for (const [k, t] of PROSPECT_MIX) sw.addRow([k, `${mix[k] ?? 0} / ${t}${(mix[k] ?? 0) < t ? ` (short ${t - (mix[k] ?? 0)})` : ""}`]);
  tableRows(sw, "Prospects by country", count(main.map((p) => p.Country)));
  tableRows(sw, "Prospects by author type", count(main.map((p) => p["Author Type"])));
  tableRows(sw, "Prospects by opportunity category", count(main.map((p) => p["Opportunity Category"])));
  tableRows(sw, "Prospects by buying intent", count(main.map((p) => p["Buying Intent"])));
  tableRows(sw, "Prospects by research confidence", count(main.map((p) => p["Research Confidence"])));
  tableRows(sw, "Prospects by research batch", count(main.map((p) => `Batch ${plan.of.get(p._id) ?? 1}`)));
  tableRows(sw, "Publishing platforms represented", count(main.flatMap((p) => (p["Publishing Platform"] ? p["Publishing Platform"].split(", ") : []))));
  tableRows(sw, "Preferred language", count(main.map((p) => p["Preferred Language"] || "Unknown")));
  tableRows(sw, "Target markets (IMF 2026 GDP per capita where captured)", MARKETS.map((m) => [m.country, m.gdpPerCapitaUsd2026 ? `$${m.gdpPerCapitaUsd2026.toLocaleString("en-US")}` : "top tier, value not captured"] as [string, string]));
  sw.views = [{ state: "frozen", ySplit: 1 }];
  sw.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sw.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };

  // Sheet 3: research log, with outcomes attributed back from candidates.
  const log = db.prepare("SELECT * FROM px_search_log ORDER BY id").all() as any[];
  const outcomes = db.prepare("SELECT payload, outcome, status FROM px_candidates").all() as { payload: string; outcome: string | null; status: string }[];
  const perQuery = new Map<string, { ready: number; rejected: number; dup: number; err: number }>();
  for (const o of outcomes) {
    const q = JSON.parse(o.payload).discovery?.query as string | undefined;
    if (!q) continue;
    const e = perQuery.get(q) ?? { ready: 0, rejected: 0, dup: 0, err: 0 };
    if (o.outcome === "Ready") e.ready++;
    else if (o.outcome === "Excluded") e.rejected++;
    else if (o.outcome === "Duplicate") e.dup++;
    if (o.status === "error") e.err++;
    perQuery.set(q, e);
  }
  const lw = wb.addWorksheet("Research Log");
  const logCols = ["Batch Number", "Date Researched", "Country or Market", "Search Query or Method", "Source Type", "Provider", "Results Reviewed", "Candidates Discovered", "Qualified Prospects Added", "Candidates Rejected", "Duplicates Removed", "Research Errors or Access Limitations", "Rejection Reasons", "Next Research Direction"];
  lw.columns = logCols.map((h) => ({ header: h, key: h, width: /Reasons|Direction|Errors/.test(h) ? 48 : h.startsWith("Search") ? 42 : 15 }));
  for (const r of log) {
    const pq = perQuery.get(r.query);
    lw.addRow([plan.batchAt(String(r.searched_at)), String(r.searched_at).slice(0, 10), r.market ?? "", safe(r.query), r.source_type ?? "", r.provider, r.results_reviewed, r.candidates_added, pq?.ready ?? 0, r.rejected + (pq?.rejected ?? 0), pq?.dup ?? 0, r.error ?? "", r.rejection_reasons ?? "", r.next_direction ?? ""]).alignment = { vertical: "top", wrapText: true };
  }
  for (const r of siteScanLog(db)) {
    const pq = perQuery.get(r.list);
    lw.addRow([plan.batchAt(r.date + "T23:59:59"), r.date, "", safe(`Bulk site scan: ${r.list}`), "Author websites from public directory", "directory-crawl + site scan", r.reviewed, r.candidates, pq?.ready ?? 0, r.rejected + (pq?.rejected ?? 0), pq?.dup ?? 0, r.errors, r.reasons, r.candidates / Math.max(1, r.reviewed) < 0.03 ? "low-yield list; prefer release calendars and indie event lists" : "verify candidates; harvest similar lists"]).alignment = { vertical: "top", wrapText: true };
  }
  styleHeader(lw, logCols.length);

  // Sheet 4: records needing review (not counted as qualified).
  prospectSheet(wb, "Needs Review", review.sort(byStrength).map(forWorkbook));

  mkdirSync(dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
  return { ...s, ready: main.length };
}
