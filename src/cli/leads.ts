/**
 * Canonical lead database CLI.
 *   npm run leads -- merge leads/batches/batch_01.json [--no-fetch]   validate, re-check emails, dedupe, merge
 *   npm run leads -- validate                                          validate the canonical file
 *   npm run leads -- report [--out leads/coverage_report.md]           QC + coverage report
 *
 * A batch file is JSON: { "batch": "name", "leads": [ {<LEAD_COLUMNS>} ], "log": [ {<LOG_COLUMNS>} ] }.
 * List-valued fields may be arrays or " | "-joined strings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as L from "../leads/canonical.js";
import { Fetcher } from "../adapters/fetch/http.js";
import { extractEmails } from "../analysis/extract.js";
import { normalizeKey } from "../util/text.js";
import { execFileSync } from "node:child_process";

const DIR = "leads";
const CANON = `${DIR}/canonical_leads.csv`;
const LOG = `${DIR}/research_log.csv`;
const BACKUPS = `${DIR}/backups`;
const PRIOR = "exports/csv/all_researched_authors.csv";
const USER_AGENT = "AuthorScoutAI/0.1 (+research; public professional contacts only)";

const [cmd, ...args] = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);

const readCanon = () => L.readTable<L.Lead>(CANON, L.LEAD_COLUMNS);
const readLog = () => L.readTable<L.LogRow>(LOG, L.LOG_COLUMNS);
const count = <T>(xs: T[], f: (x: T) => string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) for (const k of f(x)) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const stats = (rows: L.Lead[]) => ({
  rows: rows.length,
  authors: new Set(rows.map((r) => normalizeKey(r["Author Name"]))).size,
  keys: new Set(rows.flatMap((r) => L.dedupKeys(r))).size,
  withEmail: rows.filter((r) => L.splitList(r["Verified Public Email"]).length).length,
});

function curlGet(url: string): string | null {
  try {
    return execFileSync("curl", ["-sSL", "--max-time", "20", "--fail", "-A", USER_AGENT, url], { encoding: "utf8", maxBuffer: 5_000_000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** Re-fetches the email source page and confirms every claimed address is published there. */
async function confirmEmails(fetcher: Fetcher, l: L.Lead): Promise<string | null> {
  const emails = L.splitList(l["Verified Public Email"]);
  const pages = L.splitList(l["Email Source URL"]);
  const found = new Set<string>();
  const errors: string[] = [];
  for (const url of pages) {
    try {
      const r = await fetcher.get(url);
      let html = r.body;
      // Some hosts reject Node's HTTP client outright; retry once with curl under the same user agent.
      if (r.status >= 400) html = curlGet(url) ?? "";
      if (!html) {
        errors.push(`${url}: HTTP ${r.status}`);
        continue;
      }
      const body = html.toLowerCase();
      for (const e of extractEmails(html)) found.add(e.email);
      for (const e of emails) if (body.includes(e)) found.add(e);
    } catch (err) {
      errors.push(`${url}: ${(err as Error).message}`);
    }
  }
  const missing = emails.filter((e) => !found.has(e));
  if (!missing.length) return null;
  return `email not found on source page(s): ${missing.join(", ")}${errors.length ? ` (${errors.join("; ")})` : ""}`;
}

async function merge(files: string[]) {
  const existing = readCanon();
  const before = stats(existing);
  const log = readLog();
  const fetcher = new Fetcher(null, { userAgent: USER_AGENT, requestsPerSecondPerHost: 1, timeoutMs: 20_000, retries: 1 });
  const prior = new Set(L.readTable<Record<string, string>>(PRIOR, ["author"]).map((r) => normalizeKey(r.author)));
  // Authors whose pages refuse solicitation stay excluded, whichever batch rediscovers them.
  const optedOut = new Map<string, string>();
  for (const r of log) if (r.Decision === "rejected" && /solicit|advertis|werbung|marketing (offers|emails)|vendor pitch|paid-service offers/i.test(r["Rejection Reason"])) {
    optedOut.set(normalizeKey(r["Candidate Name"]), r["Rejection Reason"]);
    for (const e of L.splitList(r.Email)) optedOut.set(e.toLowerCase(), r["Rejection Reason"]);
  }
  const existingKeys = new Set(existing.flatMap((r) => L.dedupKeys(r)));
  const incoming: L.Lead[] = [];
  const manual: { author: string; reason: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const f of files) {
    const batch = JSON.parse(readFileSync(f, "utf8")) as { batch?: string; leads?: Record<string, unknown>[]; log?: Record<string, unknown>[] };
    const name = batch.batch ?? f;
    for (const raw of batch.log ?? []) {
      const row = Object.fromEntries(L.LOG_COLUMNS.map((c) => [c, String(raw[c] ?? "").trim()])) as L.LogRow;
      row.Batch ||= name;
      row["Research Date"] ||= today;
      log.push(row);
    }
    for (const raw of batch.leads ?? []) {
      const l = L.normalizeLead(raw);
      // Recent-release batches (batch08+) must document a 2025-or-later book.
      if (/^batch(0[89]|[1-9]\d)/.test(name) && !/Recent release:[^|]*20(2[5-9])/.test(l["Other Notes"])) {
        log.push({ ...Object.fromEntries(L.LOG_COLUMNS.map((c) => [c, ""])), "Research Date": today, "Candidate Name": l["Author Name"], Decision: "rejected", "Rejection Reason": "no documented 2025+ release", Batch: name } as L.LogRow);
        continue;
      }
      const known = L.dedupKeys(l).some((k) => existingKeys.has(k));
      if (!known && !flag("--no-fetch") && !L.validateLead(l).length) {
        const problem = await confirmEmails(fetcher, l);
        if (problem) {
          manual.push({ author: l["Author Name"], reason: problem });
          log.push({ ...Object.fromEntries(L.LOG_COLUMNS.map((c) => [c, ""])), "Research Date": today, "Country or Target Market": l.Country, City: l.City, "Candidate Name": l["Author Name"], Email: l["Verified Public Email"], "Source URL": l["Email Source URL"], "Evidence Type": "email re-check", Decision: "manual_verification", "Rejection Reason": problem, Batch: name } as L.LogRow);
          continue;
        }
      }
      const optOut = optedOut.get(normalizeKey(l["Author Name"])) ?? L.splitList(l["Verified Public Email"]).map((e) => optedOut.get(e)).find(Boolean);
      if (optOut) {
        manual.push({ author: l["Author Name"], reason: `previously rejected for a no-solicitation notice: ${optOut}` });
        continue;
      }
      if (prior.has(normalizeKey(l["Author Name"]))) l["Other Notes"] = [l["Other Notes"], "Also appears in the initial AuthorScout run (exports/csv/all_researched_authors.csv)."].filter(Boolean).join(" ");
      incoming.push(l);
    }
  }
  const res = L.mergeLeads(existing, incoming);
  for (const r of res.rejected) log.push({ ...Object.fromEntries(L.LOG_COLUMNS.map((c) => [c, ""])), "Research Date": today, "Candidate Name": r.author, Decision: "rejected", "Rejection Reason": r.problems.join("; "), Batch: "merge-validation" } as L.LogRow);
  const issues = L.validateTable(res.merged);
  if (issues.length) {
    console.error("Validator failed; canonical file NOT written:\n" + issues.join("\n"));
    process.exit(1);
  }
  const backup = L.writeTableAtomic(CANON, L.LEAD_COLUMNS, res.merged, BACKUPS);
  const seen = new Set<string>();
  const dedupedLog = log.filter((r) => {
    const k = L.LOG_COLUMNS.filter((c) => c !== "Batch").map((c) => r[c]).join("\u0001");
    return seen.has(k) ? false : (seen.add(k), true);
  });
  L.writeTableAtomic(LOG, L.LOG_COLUMNS, dedupedLog, BACKUPS);
  const after = stats(res.merged);
  console.log(JSON.stringify({ backup, before, after, newAccepted: res.added.length, newByCountry: Object.fromEntries(count(res.added, (r) => [r.Country])), duplicatesPrevented: res.duplicates, rejected: res.rejected, manualVerification: manual, validator: "pass" }, null, 2));
}

function report(out: string) {
  const rows = readCanon();
  const log = readLog();
  const s = stats(rows);
  const t = (pairs: [string, number][]) => (pairs.length ? ["| value | n |", "| --- | --- |", ...pairs.map(([k, n]) => `| ${k.replace(/\|/g, "/") || "(blank)"} | ${n} |`)].join("\n") : "_none_");
  const status = (r: L.Lead) => [L.PUBLISHING_STATUSES.find((p) => r["Publishing Status"].startsWith(p)) ?? r["Publishing Status"]];
  const md = [
    `# Canonical author leads — QC and coverage report`,
    ``,
    `Generated ${new Date().toISOString()} from \`${CANON}\`.`,
    ``,
    `## Totals`,
    ``,
    `| metric | value |`,
    `| --- | --- |`,
    `| Accepted leads (rows) | ${s.rows} |`,
    `| Unique authors | ${s.authors} |`,
    `| Unique dedup keys | ${s.keys} |`,
    `| Email-bearing rows | ${s.withEmail} |`,
    `| Target | 1000 |`,
    `| Remaining to target | ${Math.max(0, 1000 - s.rows)} |`,
    `| Candidates logged | ${new Set(log.map((r) => normalizeKey(r["Candidate Name"]))).size} |`,
    `| Log decisions | ${count(log, (r) => [r.Decision]).map(([k, n]) => `${k}: ${n}`).join(", ")} |`,
    `| Validator | ${L.validateTable(rows).length ? "FAIL" : "pass"} |`,
    ``,
    `## Accepted leads by country`, ``, t(count(rows, (r) => [r.Country])), ``,
    `## Publishing models`, ``, t(count(rows, status)), ``,
    `## Primary recommended service`, ``, t(count(rows, (r) => [r["Primary Recommended Service"]])), ``,
    `## Secondary services`, ``, t(count(rows, (r) => L.splitList(r["Secondary Service Opportunity"]))), ``,
    `## Genres`, ``, t(count(rows, (r) => L.splitList(r["Book Genres"]).map((g) => g.toLowerCase()))), ``,
    `## Platforms actually reviewed (accepted leads)`, ``, t(count(rows, (r) => L.splitList(r["Platforms Actually Reviewed"]))), ``,
    `## Email attribution`, ``, t(count(rows, (r) => [r["Email Attribution"]])), ``,
    `## Rows with one selected book`, ``, t(count(rows.filter((r) => L.splitList(r["Selected Book Titles for Outreach"]).length < 2), (r) => [r["Author Name"]])), ``,
    `## Research coverage (log)`, ``,
    `### Countries / markets searched`, ``, t(count(log, (r) => [r["Country or Target Market"]])), ``,
    `### Languages used`, ``, t(count(log, (r) => L.splitList(r.Language))), ``,
    `### Platforms searched`, ``, t(count(log, (r) => [r.Platform])), ``,
    `### Rejection reasons`, ``, t(count(log.filter((r) => r.Decision !== "accepted"), (r) => [r["Rejection Reason"].slice(0, 120)])), ``,
  ];
  writeFileSync(out, md.join("\n"));
  console.log(`Wrote ${out}`);
}

if (cmd === "merge") await merge(args.filter((a) => !a.startsWith("--")));
else if (cmd === "validate") {
  const issues = L.validateTable(readCanon());
  console.log(issues.length ? issues.join("\n") : `ok: ${readCanon().length} rows`);
  process.exit(issues.length ? 1 : 0);
} else if (cmd === "report") report(opt("--out") ?? `${DIR}/coverage_report.md`);
else {
  console.error("usage: leads merge <batch.json...> [--no-fetch] | validate | report [--out file]");
  process.exit(2);
}
