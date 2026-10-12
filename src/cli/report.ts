/** Writes a Markdown report of the research database. Usage: npm run report -- [--out reports/initial_run_report.md] */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDb } from "../db/db.js";
import * as Q from "../export/queries.js";

const db = getDb();
const o = Q.overview(db);
const outIdx = process.argv.indexOf("--out");
const out = outIdx > 0 ? process.argv[outIdx + 1] : "reports/research_report.md";
const md: string[] = [];
const t = (rows: Record<string, unknown>[], cols: string[]) =>
  rows.length ? [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "").replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`)].join("\n") : "_none_";

md.push(`# AuthorScout AI — research report`, ``, `Generated ${new Date().toISOString()} from \`${process.env.DATABASE_PATH ?? "data/authorscout.db"}\`.`, ``);
md.push(`## Totals`, ``, t([
  { m: "Authors discovered", v: o.authorsDiscovered },
  { m: "Authors researched", v: o.authorsResearched },
  { m: "Books analyzed (listing inspected)", v: o.booksAnalyzed },
  { m: "Qualified leads (60+)", v: o.qualifiedLeads },
  { m: "High-priority leads (80+)", v: o.highPriorityLeads },
  { m: "Distinct public professional emails", v: o.publicEmails },
  { m: "Recorded research errors/limitations", v: o.errors },
], ["m", "v"]), ``);
md.push(`## Runs`, ``, t(Q.runs(db), ["id", "name", "status", "candidates_total", "candidates_done", "candidates_skipped", "candidates_failed", "api_calls", "api_cost_usd", "notes"]), ``);
md.push(`## Leads by priority`, ``, t(o.leadsByPriority, ["k", "n"]), ``);
md.push(`## Emails by verification status`, ``, t(o.emailsByStatus, ["k", "n"]), ``, `## Contacts by type`, ``, t(o.contactsByType, ["k", "n"]), ``);
md.push(`## Leads by country (evidence-backed only)`, ``, t(o.leadsByCountry, ["k", "n"]), ``);
md.push(`## Publication status`, ``, t(o.statusBreakdown, ["k", "n"]), ``, `## Opportunities by category`, ``, t(o.opportunitiesByCategory, ["k", "n"]), ``);
md.push(`## All researched leads`, ``, t(Q.allLeads(db), ["author", "country", "book_title", "publication_status", "review_count", "lead_score", "priority", "best_email", "best_email_type", "email_verification_status", "top_opportunities"]), ``);
md.push(`## Skipped / failed candidates`, ``, t(Q.runCandidates(db).filter((r) => r.status !== "done"), ["run_id", "candidate_key", "status", "message"]), ``);
const errs = db.prepare("SELECT stage, COALESCE(source,'-') source, COUNT(*) n FROM research_errors GROUP BY 1,2 ORDER BY 3 DESC").all() as any[];
md.push(`## Research errors by stage/source`, ``, t(errs, ["stage", "source", "n"]), ``);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md.join("\n"));
console.log(`Wrote ${out}`);
