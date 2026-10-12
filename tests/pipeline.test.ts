import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { openDb, type DB } from "../src/db/db.js";
import { Fetcher, type FetchResult } from "../src/adapters/fetch/http.js";
import { createRun, executeRun, setRunStatus } from "../src/agent/runner.js";
import { NullAnalyzer } from "../src/adapters/ai/analyzer.js";
import { exportAll } from "../src/export/exporter.js";
import type { Candidate } from "../src/agent/candidate.js";

/** Offline fixture fetcher: deterministic pages, no network. */
class FixtureFetcher extends Fetcher {
  constructor(private pages: Record<string, string>) {
    super(null, { userAgent: "test", requestsPerSecondPerHost: 1000 });
  }
  override async get(url: string): Promise<FetchResult> {
    const body = this.pages[url];
    if (body == null) return { url, finalUrl: url, status: 404, contentType: "text/html", body: "", fromCache: false };
    return { url, finalUrl: url, status: 200, contentType: "text/html", body, fromCache: false };
  }
}

const book = (name: string, author: string, ratings: number, reviews: number, extra = "") => `<html><head><title>${name}</title>
<script type="application/ld+json">{"@type":"Book","name":"${name}","author":[{"@type":"Person","name":"${author}"}],"aggregateRating":{"ratingValue":4.1,"ratingCount":${ratings},"reviewCount":${reviews}},"bookFormat":"Kindle Edition","inLanguage":"English","description":"Short blurb."}</script></head>
<body><h1>${name}</h1><a href="https://www.goodreads.com/author/show/1.${author.replace(/ /g, "_")}">${author}</a><div data-testid="publicationInfo">First published March 3, 2026</div>${extra}</body></html>`;

const PAGES: Record<string, string> = {
  "https://www.goodreads.com/book/show/1": book("Night Tide", "Jane Doe", 312, 58, "<p>Review: I think this book is looking for a professional editor, honestly.</p>"),
  "https://www.goodreads.com/book/show/2": book("Big Seller", "Rich Author", 25000, 3000),
  "https://www.goodreads.com/book/show/3": book("Quiet Book", "Sam Nomail", 40, 10),
  "https://www.goodreads.com/author/show/1.Jane_Doe": `<body>Jane Doe · 4 distinct works</body>`,
  "https://janedoebooks.com/": `<html><head><title>Jane Doe Books</title></head><body><nav><a href="/contact">Contact</a><a href="https://www.amazon.com/dp/B0X">Buy on Amazon</a></nav>
     <p>Jane Doe is a fantasy author living in Wellington, New Zealand. Her novel Night Tide is out now.</p><footer>© 2021 Jane Doe</footer></body></html>`,
  "https://janedoebooks.com/contact": `<body><h1>Contact</h1><p>For business enquiries email <a href="mailto:jane@janedoebooks.com">jane@janedoebooks.com</a>.</p>
     <p>Literary agent: Sam Lee, Lee Literary Agency, sam@leeagency.co.uk</p></body>`,
  "https://samnomail.net/": `<body><p>Sam Nomail writes Quiet Book. <a href="/contact">Contact</a></p></body>`,
  "https://samnomail.net/contact": `<body><form><input name="msg"></form><p>Use the form to reach Sam Nomail.</p></body>`,
};

const cands: Candidate[] = [
  { authorName: "Jane Doe", bookTitle: "Night Tide", goodreadsUrl: "https://www.goodreads.com/book/show/1", bookUrls: ["https://www.amazon.com/dp/B0X"], websiteUrl: "https://janedoebooks.com/", countryClaim: "New Zealand", countryEvidenceUrl: "https://janedoebooks.com/", statusHint: "published_ebook" },
  { authorName: "Rich Author", bookTitle: "Big Seller", goodreadsUrl: "https://www.goodreads.com/book/show/2" },
  { authorName: "Sam Nomail", bookTitle: "Quiet Book", goodreadsUrl: "https://www.goodreads.com/book/show/3", websiteUrl: "https://samnomail.net/", countryClaim: "Germany", countryEvidenceUrl: "https://samnomail.net/" },
  { authorName: "Ghost Writer", bookTitle: "Missing", goodreadsUrl: "https://www.goodreads.com/book/show/404" },
];

const dir = mkdtempSync(join(tmpdir(), "authorscout-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function run(db: DB, list: Candidate[], name = "test") {
  const id = createRun(db, name, { batchSize: 50, maxReviewCount: 1000 }, list);
  const st = await executeRun(db, id, { fetcher: new FixtureFetcher(PAGES), analyzer: new NullAnalyzer(), verifier: null, mxLookup: async () => [{ exchange: "mx.test", priority: 10 }], log: () => {} });
  return { id, st };
}

describe("research pipeline (offline fixtures)", () => {
  let dbFile: string;
  let db: DB;
  beforeEach(() => {
    dbFile = join(dir, `t${Math.random().toString(36).slice(2)}.db`);
    db = openDb(dbFile);
  });

  it("saves evidence, opportunities, contacts; filters >1000 reviews; never fabricates emails", async () => {
    const { id, st } = await run(db, cands);
    expect(st).toBe("completed");
    const rc = db.prepare("SELECT candidate_key, status, message FROM run_candidates WHERE run_id = ?").all(id) as any[];
    expect(rc.find((r) => r.candidate_key.startsWith("rich author")).status).toBe("skipped");
    expect(rc.find((r) => r.candidate_key.startsWith("ghost writer")).status).toBe("failed");

    const jane = db.prepare("SELECT * FROM authors WHERE name = 'Jane Doe'").get() as any;
    expect(jane.country).toBe("New Zealand");
    expect(jane.identity_status).toBe("verified");
    expect(jane.book_count).toBe(4);
    const b = db.prepare("SELECT * FROM books WHERE author_id = ?").get(jane.id) as any;
    expect(b.review_count).toBe(312);
    expect(b.publication_status).toBe("published_ebook");
    expect(b.inspection_scope).toBe("listing_only");

    const contacts = db.prepare("SELECT email, contact_type, verification_status FROM contacts WHERE author_id = ? ORDER BY email").all(jane.id) as any[];
    expect(contacts).toEqual([
      { email: "jane@janedoebooks.com", contact_type: "author_business", verification_status: "domain_mx_checked" },
      { email: "sam@leeagency.co.uk", contact_type: "agent", verification_status: "domain_mx_checked" },
    ]);
    const codes = (db.prepare("SELECT service_code FROM service_opportunities WHERE author_id = ?").all(jane.id) as any[]).map((r) => r.service_code);
    expect(codes).toEqual(expect.arrayContaining(["H01", "D01", "C09", "G02"]));
    expect((db.prepare("SELECT COUNT(*) n FROM evidence WHERE author_id = ? AND source_url IS NOT NULL").get(jane.id) as any).n).toBeGreaterThan(3);

    // Reader-review text on a retailer/Goodreads page must not count as the author's buying signal.
    expect((db.prepare("SELECT COUNT(*) n FROM evidence WHERE author_id = ? AND kind = 'buying_signal'").get(jane.id) as any).n).toBe(0);
    const sam = db.prepare("SELECT * FROM authors WHERE name = 'Sam Nomail'").get() as any;
    expect(sam.country).toBeNull(); // claim not supported by any fetched page
    const samContacts = db.prepare("SELECT email, contact_type FROM contacts WHERE author_id = ?").all(sam.id) as any[];
    expect(samContacts).toEqual([{ email: null, contact_type: "contact_form_only" }]);
    expect((db.prepare("SELECT COUNT(*) n FROM research_errors WHERE run_id = ?").get(id) as any).n).toBeGreaterThan(0);
  });

  it("deduplicates authors across runs and survives restarts", async () => {
    await run(db, cands, "first");
    await run(db, [cands[0]], "second");
    db.close();
    const reopened = openDb(dbFile);
    expect((reopened.prepare("SELECT COUNT(*) n FROM authors WHERE name = 'Jane Doe'").get() as any).n).toBe(1);
    expect((reopened.prepare("SELECT COUNT(*) n FROM books").get() as any).n).toBe(2);
    expect((reopened.prepare("SELECT COUNT(*) n FROM research_runs").get() as any).n).toBe(2);
    reopened.close();
  });

  it("honours pause/cancel and resumes from checkpoint", async () => {
    const runId = createRun(db, "pausable", {}, cands);
    setRunStatus(db, runId, "paused");
    const deps = { fetcher: new FixtureFetcher(PAGES), analyzer: new NullAnalyzer(), verifier: null, mxLookup: async () => [{ exchange: "mx", priority: 1 }], log: () => {} };
    db.prepare("UPDATE research_runs SET status = 'paused' WHERE id = ?").run(runId);
    // executeRun sets running then checks status each loop; simulate pause by cancelling first.
    setRunStatus(db, runId, "cancelled");
    expect(await executeRun(db, runId, deps)).toBe("cancelled");
    const r2 = createRun(db, "resumable", {}, cands);
    db.prepare("UPDATE run_candidates SET status = 'in_progress' WHERE run_id = ? AND id = (SELECT MIN(id) FROM run_candidates WHERE run_id = ?)").run(r2, r2);
    expect(await executeRun(db, r2, deps)).toBe("completed");
    expect((db.prepare("SELECT COUNT(*) n FROM run_candidates WHERE run_id = ? AND status IN ('queued','in_progress')").get(r2) as any).n).toBe(0);
  });

  it("exports Excel and CSV files containing database findings", async () => {
    await run(db, cands);
    const out = join(dir, `exp${Math.random().toString(36).slice(2)}`);
    const { xlsx, csvs } = await exportAll(db, out);
    const emailsCsv = readFileSync(csvs.find((c) => c.endsWith("public_professional_emails.csv"))!, "utf8");
    expect(emailsCsv).toContain("jane@janedoebooks.com");
    const unverified = readFileSync(csvs.find((c) => c.endsWith("contacts_unverified.csv"))!, "utf8");
    const verified = readFileSync(csvs.find((c) => c.endsWith("contacts_verified.csv"))!, "utf8");
    expect(unverified).toContain("jane@janedoebooks.com");
    expect(verified).not.toContain("jane@janedoebooks.com");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsx);
    const sheet = wb.getWorksheet("All Authors")!;
    const names = sheet.getColumn(2).values.map(String);
    expect(names).toContain("Jane Doe");
  });
});

describe("scope guard", () => {
  it("ships no outreach/messaging features", async () => {
    const src = readFileSync(new URL("../src/server/app.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/app\.(get|post)\(["'`]\/(outreach|send|draft|templates|follow-?up)/i);
    expect(src).not.toMatch(/nodemailer|sendgrid|smtp/i);
  });
});
