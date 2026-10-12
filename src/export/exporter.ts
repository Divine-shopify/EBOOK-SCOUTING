import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "../db/db.js";
import * as Q from "./queries.js";

export function toCsv(rows: Q.Row[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    let s = String(v);
    // Neutralise spreadsheet formula injection from scraped text.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

export interface ExportSet {
  name: string;
  rows: Q.Row[];
}

export function exportSets(db: DB): ExportSet[] {
  const contacts = Q.contacts(db);
  const verifiedRungs = new Set(["provider_verified", "delivery_confirmed"]);
  return [
    { name: "all_researched_authors", rows: Q.allLeads(db) },
    { name: "qualified_leads", rows: Q.qualifiedLeads(db) },
    { name: "high_priority_prospects", rows: Q.highPriorityLeads(db) },
    { name: "book_analysis", rows: Q.bookAnalysis(db) },
    { name: "service_opportunities", rows: Q.opportunities(db) },
    { name: "public_professional_emails", rows: contacts.filter((c) => c.email) },
    { name: "contacts_verified", rows: contacts.filter((c) => c.email && verifiedRungs.has(String(c.verification_status))) },
    { name: "contacts_unverified", rows: contacts.filter((c) => c.email && !verifiedRungs.has(String(c.verification_status)) && c.verification_status !== "invalid") },
    { name: "contacts_invalid", rows: contacts.filter((c) => c.verification_status === "invalid") },
    { name: "contact_pages_no_email", rows: contacts.filter((c) => !c.email) },
    { name: "research_evidence", rows: Q.evidence(db) },
    { name: "research_errors", rows: Q.researchErrors(db) },
    { name: "research_runs", rows: Q.runs(db) },
    { name: "run_candidates", rows: Q.runCandidates(db) },
  ];
}

const SHEET_TITLES: Record<string, string> = {
  all_researched_authors: "All Authors",
  qualified_leads: "Qualified (60+)",
  high_priority_prospects: "High Priority (80+)",
  book_analysis: "Book Analysis",
  service_opportunities: "Service Opportunities",
  public_professional_emails: "Public Emails",
  contacts_verified: "Emails - Verified",
  contacts_unverified: "Emails - Not Verified",
  contacts_invalid: "Emails - Invalid",
  contact_pages_no_email: "Contact Pages (no email)",
  research_evidence: "Evidence & Sources",
  research_errors: "Research Errors",
  research_runs: "Research Runs",
  run_candidates: "Run Candidates",
};

export async function buildWorkbook(db: DB): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AuthorScout AI";
  wb.created = new Date();
  const readme = wb.addWorksheet("README");
  const lines = [
    ["AuthorScout AI export", new Date().toISOString()],
    [],
    ["Email verification statuses (never conflated):"],
    ["publicly_listed", "Address appears on an attributable public page"],
    ["syntax_valid", "Format check passed — NOT proof of deliverability"],
    ["domain_mx_checked", "Domain publishes MX records — NOT proof the mailbox exists"],
    ["provider_verified", "Third-party verifier reported valid (only if a provider is configured)"],
    ["delivery_confirmed", "Set manually only after legitimate, authorised correspondence"],
    ["invalid", "Syntax failure, non-existent domain, or provider rejection"],
    ["unknown", "Checks incomplete"],
    [],
    ["'Emails - Verified' contains provider_verified/delivery_confirmed only. Everything else is in 'Emails - Not Verified'."],
    ["Lead score (0–100) is independent of email validity. 80+ High priority, 60–79 Qualified, 40–59 Further research, <40 Low."],
    ["Book filter: only books with ≤ 1,000 observed ratings/reviews were kept (max of ratings and reviews on the inspected listing)."],
    ["Books marked inspection_scope=listing_only: only the public listing was read, not the book itself."],
  ];
  lines.forEach((l) => readme.addRow(l));
  readme.getColumn(1).width = 28;
  readme.getColumn(2).width = 90;
  for (const set of exportSets(db)) {
    const ws = wb.addWorksheet(SHEET_TITLES[set.name] ?? set.name.slice(0, 31));
    if (!set.rows.length) {
      ws.addRow(["No records"]);
      continue;
    }
    const cols = Object.keys(set.rows[0]);
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(60, Math.max(12, c.length + 2)) }));
    for (const r of set.rows) {
      const safe: Record<string, unknown> = {};
      for (const c of cols) {
        const v = r[c];
        safe[c] = typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v;
      }
      ws.addRow(safe);
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    for (const c of cols.filter((c) => /url$/i.test(c))) {
      ws.getColumn(c).eachCell((cell, row) => {
        if (row > 1 && typeof cell.value === "string" && /^https?:\/\//.test(cell.value)) cell.value = { text: cell.value, hyperlink: cell.value };
      });
    }
  }
  return wb;
}

export async function exportAll(db: DB, dir = "exports"): Promise<{ xlsx: string; csvs: string[] }> {
  mkdirSync(join(dir, "csv"), { recursive: true });
  const csvs: string[] = [];
  for (const set of exportSets(db)) {
    const p = join(dir, "csv", `${set.name}.csv`);
    writeFileSync(p, toCsv(set.rows));
    csvs.push(p);
  }
  const xlsx = join(dir, "authorscout_research.xlsx");
  await (await buildWorkbook(db)).xlsx.writeFile(xlsx);
  return { xlsx, csvs };
}
