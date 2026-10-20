/**
 * Canonical author-lead database (leads/canonical_leads.csv): one row per author, permanently deduplicated.
 * Incoming research batches are validated, deduplicated against every existing row and merged atomically.
 */
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { normalizeKey, domainOf } from "../util/text.js";
import { isSyntaxValid } from "../email/verify.js";

export const LIST_SEP = " | ";

export const LEAD_COLUMNS = [
  "Lead ID",
  "Author Name",
  "Verified Public Email",
  "Official Author Website",
  "Other Relevant Author Profile URLs",
  "Selected Book Titles for Outreach",
  "Additional Discoverable Books and Series",
  "Book Genres",
  "Verified Book Descriptions or Synopses",
  "Book URLs Across Relevant Platforms",
  "Amazon Book URL",
  "Amazon Author URL",
  "Personalized Subject Line",
  "Personalized Email Body",
  "Primary Recommended Service",
  "Secondary Service Opportunity",
  "Evidence-Based Service-Fit Explanation",
  "Reader and Review Signals",
  "Discoverability and Promotional Observations",
  "Country",
  "Region, State, or Province",
  "City",
  "Geographic Evidence and Relationship",
  "Email Source URL",
  "Author Identity Evidence URL",
  "Book Evidence Source URLs",
  "Other Relevant Platform Evidence URLs",
  "Evidence Type",
  "Email Attribution",
  "Publishing Status",
  "Research Date",
  "Platforms Actually Reviewed",
  "Confidence and Manual Verification Notes",
  "Other Notes",
] as const;
export type LeadColumn = (typeof LEAD_COLUMNS)[number];
export type Lead = Record<LeadColumn, string>;

export const LOG_COLUMNS = [
  "Research Date",
  "Country or Target Market",
  "Geographic Division",
  "City",
  "Language",
  "Search Query",
  "Candidate Name",
  "Email",
  "Source URL",
  "Evidence Type",
  "Platform",
  "Decision",
  "Rejection Reason",
  "Batch",
] as const;
export type LogRow = Record<(typeof LOG_COLUMNS)[number], string>;

export const SERVICES = [
  "Book trailers",
  "Book promotion and marketing",
  "Book formatting",
  "Ebook formatting",
  "Editing",
  "Proofreading",
  "Cover design",
  "Interior layout",
  "Publishing-related assistance",
  "Facebook Ads",
  "Ads management",
  "SEO optimization",
  "YouTube automation",
  "Book-focused website design",
  "AEO (Answer Engine Optimization)",
  "GEO (Generative Engine Optimization)",
  "Email marketing",
  "Christmas preorder campaigns",
  "Email templates",
  "Book sales marketing",
  "Sales bots",
  "Customer retention",
  "Reader-engagement automation",
  "Marketing and sales workflow automation",
  "12-month book marketing roadmap",
  "TikTok Shop",
] as const;

export const PUBLISHING_STATUSES = [
  "Confirmed KDP",
  "Likely independent/KDP",
  "Amazon-listed, KDP unverified",
  "Traditional publisher",
  "Independent publisher, evidence available",
  "Mixed publishing model",
  "Publishing status unclear",
] as const;

export const UNKNOWN_LOCATION = "Unknown / not publicly verified";

/** Hosts whose domain is shared by many authors, so it can never identify one author on its own. */
const SHARED_HOSTS = /(^|\.)(amazon\.[a-z.]+|goodreads\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|linkedin\.com|wordpress\.com|blogspot\.com|wixsite\.com|substack\.com|linktr\.ee|bookbub\.com|wattpad\.com|medium\.com|squarespace\.com|weebly\.com|carrd\.co|beacons\.ai|kobo\.com|books\.apple\.com|apple\.com|google\.com|barnesandnoble\.com|smashwords\.com|books2read\.com|lulu\.com|draft2digital\.com|thestorygraph\.com|librarything\.com|reedsy\.com|threads\.net|pinterest\.com)$/;
/** Directory and listing pages shared by many authors (e.g. ".../member-directory-2", ".../our-authors"). */
const LISTING_PATH = /\/(?:[a-z0-9-]*(?:directory|directories|members?|mitglieder|authors|writers|winners|finalists|list|lists)[a-z0-9-]*)$/;
const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|gmx|web|proton|protonmail|mail|yandex|zoho|qq|163|126|naver|hanmail|libero|orange|free|t-online|seznam|wp|o2|interia|rediffmail)\./i;

export function splitList(v: string | undefined): string[] {
  return (v ?? "").split(/\s\|\s|\n/).map((s) => s.trim()).filter(Boolean);
}

/** Canonical form of a URL for comparison: lowercase host without www, no query/fragment/trailing slash. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
  } catch {
    return null;
  }
}

/** Amazon author pages are identified by their Author Central ID (e.g. /e/B00XXXXXXX or /stores/author/B00XXXXXXX). */
function amazonAuthorId(url: string): string | null {
  return url.match(/\/(?:e|stores\/author|author)\/(B0[0-9A-Z]{8})/i)?.[1]?.toUpperCase() ?? null;
}
function asinOf(url: string): string | null {
  return url.match(/\/(?:dp|gp\/product)\/([0-9A-Z]{10})/i)?.[1]?.toUpperCase() ?? null;
}

/** Every key that identifies this author; two rows sharing any key are the same author. */
export function dedupKeys(l: Partial<Lead>): string[] {
  const keys = new Set<string>();
  const nameParts = splitList(l["Author Name"]).flatMap((n) => n.split(/\s*\((?:aka|pen name|writing as)\s*|\)\s*/i)).map(normalizeKey).filter((n) => n.length > 2);
  for (const n of nameParts) keys.add(`name:${n}`);
  for (const e of splitList(l["Verified Public Email"])) keys.add(`email:${e.toLowerCase()}`);
  // Only the official website's domain identifies one author; other profile URLs (often on shared
  // collective or platform sites) are compared as full URLs.
  const site = splitList(l["Official Author Website"]);
  for (const u of site) {
    const d = domainOf(u);
    if (d && !SHARED_HOSTS.test(d)) keys.add(`domain:${d}`);
  }
  const urls = [...site, l["Amazon Author URL"], ...splitList(l["Other Relevant Author Profile URLs"])].flatMap((u) => splitList(u));
  for (const u of urls) {
    const n = normalizeUrl(u);
    // A profile URL identifies an author only if it names them; otherwise it is a shared listing page.
    const named = nameParts.some((np) => np.split(" ").some((t) => t.length > 2 && n?.replace(/[^a-z0-9]/g, "").includes(t)));
    if (n && n.includes("/") && named && !LISTING_PATH.test(n)) keys.add(`profile:${n}`);
    const aid = amazonAuthorId(u);
    if (aid) keys.add(`amazon_author:${aid}`);
  }
  for (const u of [l["Amazon Book URL"], ...splitList(l["Book URLs Across Relevant Platforms"])].flatMap((u) => splitList(u))) {
    const asin = asinOf(u);
    if (asin) keys.add(`asin:${asin}`);
  }
  for (const m of `${l["Additional Discoverable Books and Series"] ?? ""} ${l["Other Notes"] ?? ""}`.matchAll(/\bISBN(?:-1[03])?:?\s*([0-9Xx-]{10,17})/g)) keys.add(`isbn:${m[1].replace(/-/g, "").toUpperCase()}`);
  // Book titles alone collide across authors, so pair each with the author's surname.
  const surname = nameParts[0]?.split(" ").pop();
  if (surname) for (const t of splitList(l["Selected Book Titles for Outreach"])) keys.add(`book:${normalizeKey(t)}|${surname}`);
  return [...keys];
}

/** Returns acceptance problems; an empty list means the lead meets the mandatory requirements. */
export function validateLead(l: Partial<Lead>): string[] {
  const p: string[] = [];
  const need = (c: LeadColumn) => {
    if (!(l[c] ?? "").trim()) p.push(`missing ${c}`);
  };
  (["Author Name", "Verified Public Email", "Email Source URL", "Author Identity Evidence URL", "Book Evidence Source URLs", "Selected Book Titles for Outreach", "Verified Book Descriptions or Synopses", "Personalized Subject Line", "Personalized Email Body", "Primary Recommended Service", "Evidence-Based Service-Fit Explanation", "Country", "Email Attribution", "Publishing Status", "Research Date", "Platforms Actually Reviewed"] as LeadColumn[]).forEach(need);
  for (const e of splitList(l["Verified Public Email"])) if (!isSyntaxValid(e)) p.push(`invalid email syntax: ${e}`);
  for (const c of ["Email Source URL", "Author Identity Evidence URL"] as LeadColumn[]) for (const u of splitList(l[c])) if (!/^https?:\/\//.test(u)) p.push(`${c} is not a URL: ${u}`);
  if (l["Primary Recommended Service"] && !SERVICES.includes(l["Primary Recommended Service"] as (typeof SERVICES)[number])) p.push(`unknown service: ${l["Primary Recommended Service"]}`);
  if (l["Publishing Status"] && !PUBLISHING_STATUSES.some((s) => l["Publishing Status"]!.startsWith(s))) p.push(`unknown publishing status: ${l["Publishing Status"]}`);
  const titles = splitList(l["Selected Book Titles for Outreach"]);
  const body = l["Personalized Email Body"] ?? "";
  const subject = l["Personalized Subject Line"] ?? "";
  if (titles.length === 1 && !/only one|single (verifiable|suitable)|one verifiable/i.test(`${l["Other Notes"]} ${l["Confidence and Manual Verification Notes"]}`)) p.push("only one selected book and no recorded reason why a second could not be used");
  const loose = (s: string) => normalizeKey(s.replace(/\s*[:(].*$/, ""));
  for (const t of titles) if (!normalizeKey(body).includes(loose(t))) p.push(`email body does not mention selected title: ${t}`);
  if (/\[[A-Z][A-Z \-']+\]/.test(body + subject)) p.push("email still contains template placeholders");
  if (!/Roland Jacobs/.test(body)) p.push("email body is not signed by Roland Jacobs");
  if (/^(book marketing services|promote your book|author services|book promotion opportunity|grow your book sales)$/i.test(subject.trim())) p.push("generic subject line");
  if (/guarantee/i.test(body)) p.push("email promises guaranteed results");
  return p;
}

// ---------- CSV (RFC 4180) ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  if (f || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv<T extends Record<string, string>>(cols: readonly string[], rows: T[]): string {
  return [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c] ?? "")).join(","))].join("\r\n") + "\r\n";
}

export function readTable<T extends Record<string, string>>(file: string, cols: readonly string[]): T[] {
  if (!existsSync(file)) return [];
  const [header, ...rows] = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
  const missing = cols.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`${file} is missing columns: ${missing.join(", ")}`);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])) as T);
}

/** Backs the file up with a timestamp, then replaces it via write-to-temp + rename. */
export function writeTableAtomic(file: string, cols: readonly string[], rows: Record<string, string>[], backupDir: string): string | null {
  mkdirSync(dirname(file), { recursive: true });
  let backup: string | null = null;
  if (existsSync(file)) {
    mkdirSync(backupDir, { recursive: true });
    backup = join(backupDir, `${basename(file, ".csv")}.${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
    copyFileSync(file, backup);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, "﻿" + toCsv(cols, rows));
  renameSync(tmp, file);
  return backup;
}

// ---------- merge ----------

export interface MergeResult {
  merged: Lead[];
  added: Lead[];
  duplicates: { incoming: string; existing: string; keys: string[] }[];
  rejected: { author: string; problems: string[] }[];
}

/** Trims every field and joins multi-value fields with the canonical separator. */
export function normalizeLead(raw: Record<string, unknown>): Lead {
  const out = {} as Lead;
  for (const c of LEAD_COLUMNS) {
    const v = raw[c];
    out[c] = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(LIST_SEP) : String(v ?? "").trim();
  }
  // The sender changed from Femi Emmanuel to Roland Jacobs; batches written before the change are rewritten on merge.
  for (const c of ["Personalized Email Body", "Personalized Subject Line"] as LeadColumn[]) out[c] = out[c].replace(/Femi Emmanuel/g, "Roland Jacobs").replace(/^Femi$/m, "Roland Jacobs");
  out["Verified Public Email"] = splitList(out["Verified Public Email"]).map((e) => e.toLowerCase()).join(LIST_SEP);
  return out;
}

/** Merges incoming leads into the canonical rows. Existing rows are never modified or dropped. */
export function mergeLeads(existing: Lead[], incoming: Lead[]): MergeResult {
  const merged = [...existing];
  const owner = new Map<string, string>();
  const claim = (l: Lead) => dedupKeys(l).forEach((k) => owner.has(k) || owner.set(k, l["Author Name"]));
  existing.forEach(claim);
  let next = existing.reduce((m, l) => Math.max(m, Number(l["Lead ID"].replace(/\D/g, "")) || 0), 0) + 1;
  const res: MergeResult = { merged, added: [], duplicates: [], rejected: [] };
  for (const l of incoming) {
    const problems = validateLead(l);
    if (problems.length) {
      res.rejected.push({ author: l["Author Name"] || "(unnamed)", problems });
      continue;
    }
    const hits = dedupKeys(l).filter((k) => owner.has(k));
    if (hits.length) {
      res.duplicates.push({ incoming: l["Author Name"], existing: owner.get(hits[0])!, keys: hits });
      continue;
    }
    const row = { ...l, "Lead ID": `L${String(next++).padStart(4, "0")}` };
    merged.push(row);
    res.added.push(row);
    claim(row);
  }
  return res;
}

/** Checks the whole canonical table: every row valid, no key shared by two rows, unique IDs. */
export function validateTable(rows: Lead[]): string[] {
  const issues: string[] = [];
  const seen = new Map<string, string>();
  const ids = new Set<string>();
  for (const r of rows) {
    if (ids.has(r["Lead ID"])) issues.push(`duplicate Lead ID ${r["Lead ID"]}`);
    ids.add(r["Lead ID"]);
    for (const p of validateLead(r)) issues.push(`${r["Lead ID"]} ${r["Author Name"]}: ${p}`);
    for (const k of dedupKeys(r)) {
      if (seen.has(k) && seen.get(k) !== r["Lead ID"]) issues.push(`${r["Lead ID"]} shares dedup key ${k} with ${seen.get(k)}`);
      seen.set(k, r["Lead ID"]);
    }
  }
  return issues;
}

export function isFreemail(email: string): boolean {
  return FREEMAIL.test(email.split("@")[1] ?? "");
}
