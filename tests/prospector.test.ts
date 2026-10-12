import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { Fetcher, type FetchResult } from "../src/adapters/fetch/http.js";
import { detectSignals } from "../src/prospector/lexicon.js";
import { containsQuote, verifyCandidate, looksLikeNamedIdentity, websitesInText } from "../src/prospector/verify.js";
import { countryFromText } from "../src/prospector/markets.js";
import { qualify, COLUMNS } from "../src/prospector/qualify.js";
import { openProspectDb, ingest, intakeKey } from "../src/prospector/store.js";
import { processPending } from "../src/prospector/runner.js";
import { exportWorkbook } from "../src/prospector/export.js";
import { cleanDisplayName, isPromising } from "../src/prospector/discovery.js";
import type { ProspectCandidate } from "../src/prospector/candidate.js";

class FixtureFetcher extends Fetcher {
  constructor(private pages: Record<string, string>) {
    super(null, { userAgent: "test", requestsPerSecondPerHost: 1000 });
  }
  override async get(url: string): Promise<FetchResult> {
    const body = this.pages[url];
    return { url, finalUrl: url, status: body == null ? 404 : 200, contentType: "text/html", body: body ?? "", fromCache: false };
  }
}

const explicit = (t: string) => detectSignals(t, { wholeTextIsOnePost: true }).filter((s) => s.kind === "explicit");

describe("request detection", () => {
  it("accepts first-person and sentence-initial requests", () => {
    expect(explicit("Still looking for a cover designer tho if you have any recommendations.")[0]?.category).toBe("Cover Design");
    expect(explicit("I'm looking for a proofreader for my cozy mystery.")[0]?.category).toBe("Proofreading");
    expect(explicit("Looking for a cover designer for a Shifter Romance.").length).toBe(1);
    expect(explicit("Ich suche eine Lektorin für meinen Roman.")[0]?.category).toBe("Editing");
  });
  it("rejects provider adverts, recommendations, past or negated requests and pitch posts", () => {
    expect(explicit("Looking for an editor? I have openings in September! Free sample edit.")).toEqual([]);
    expect(explicit("If you’re looking for an editor he’s your guy & affordable.")).toEqual([]);
    expect(explicit("When I was looking for an editor, I had so many recs.")).toEqual([]);
    expect(explicit("I'm not looking for an editor, that's a different role.")).toEqual([]);
    expect(explicit("The European Journal of Political Research is looking for an Editor of Open Science.")).toEqual([]);
    expect(explicit("Space witches! #BluePit (Manuscript is looking for an editor)")).toEqual([]);
  });
  it("detects production-stage wording", () => {
    expect(detectSignals("Book 3 cover reveal next week, pre-orders are open now!").map((s) => s.label)).toContain("Pre-order live");
  });
  it("pre-filters discovery posts", () => {
    expect(isPromising("Any authors here looking for a cover designer? Commissions open!")).toBe(false);
    expect(isPromising("I need a cover designer for my debut fantasy novel.")).toBe(true);
  });
});

describe("helpers", () => {
  it("matches quotes despite punctuation and whitespace differences", () => {
    expect(containsQuote("<p>I’m looking for an  editor —  soon.</p>", "I'm looking for an editor - soon")).toBe(true);
    expect(containsQuote("totally different text here", "I'm looking for an editor")).toBe(false);
  });
  it("only records countries stated with location phrasing", () => {
    expect(countryFromText("Jane lives in Cork, Ireland with two cats.")?.country).toBe("Ireland");
    expect(countryFromText("A thriller set in Paris during the war.")).toBeNull();
  });
  it("cleans display names and judges identifiability", () => {
    expect(cleanDisplayName("Jane Doe 📚 | Fantasy Author")).toBe("Jane Doe");
    expect(cleanDisplayName("Matthew Zorich, Author")).toBe("Matthew Zorich");
    expect(looksLikeNamedIdentity("Jane Doe")).toBe(true);
    expect(looksLikeNamedIdentity("Puck")).toBe(false);
    expect(looksLikeNamedIdentity("lauren romance reader")).toBe(false);
  });
  it("never treats an email domain as a website", () => {
    expect(websitesInText("Email jane@gmail.com or visit janedoebooks.com")).toEqual(["https://janedoebooks.com"]);
  });
  it("normalises intake keys", () => {
    expect(intakeKey("https://www.example.com/post/?utm_source=x#top")).toBe("example.com/post");
  });
});

const SITE = {
  "https://janedoebooks.com/": `<html lang="en"><body><h1>Jane Doe</h1><p>Jane Doe is a fantasy author who lives in Wellington, New Zealand.</p>
    <a href="https://www.amazon.com/dp/B0X">Kindle</a><a href="/contact">Contact</a><footer>© 2026 Jane Doe</footer></body></html>`,
  "https://janedoebooks.com/contact": `<body><p>Business enquiries: <a href="mailto:jane@janedoebooks.com">jane@janedoebooks.com</a></p></body>`,
  "https://janedoebooks.com/news": `<body><h2>News</h2><p>Book three is finished and I'm looking for a cover designer for the ebook release in 2027.</p></body>`,
};

const cand = (over: Partial<ProspectCandidate> = {}): ProspectCandidate => ({
  name: "Jane Doe",
  platforms: [],
  sourceUrl: "https://janedoebooks.com/news",
  evidenceQuote: "I'm looking for a cover designer for the ebook release in 2027",
  officialWebsite: "https://janedoebooks.com/",
  additionalUrls: [],
  discovery: { channel: "seed_file" },
  ...over,
});

describe("verification and qualification", () => {
  it("qualifies an author whose own site carries an explicit, verified request", async () => {
    const v = await verifyCandidate(cand(), new FixtureFetcher(SITE));
    expect(v.quoteVerified).toBe(true);
    expect(v.identityVerified).toBe(true);
    expect(v.country?.country).toBe("New Zealand");
    expect(v.emails.map((e) => e.email)).toEqual(["jane@janedoebooks.com"]);
    const d = qualify(cand(), v);
    expect(d.status).toBe("Ready");
    expect(d.intent).not.toBe("Low");
    expect(d.record["Opportunity Category"]).toBe("Cover Design");
    expect(d.record.Country).toBe("New Zealand");
    expect(Object.keys(d.record)).toEqual([...COLUMNS]);
  });
  it("does not trust a quote that is not on the page", async () => {
    const c = cand({ evidenceQuote: "I urgently need an EPUB formatter and a translator" });
    const d = qualify(c, await verifyCandidate(c, new FixtureFetcher({ ...SITE, "https://janedoebooks.com/news": "<body>Nothing here.</body>" })));
    expect(d.status).not.toBe("Ready");
  });
  it("keeps blocked sources out of Ready", async () => {
    const c = cand({ sourceUrl: "https://www.reddit.com/r/selfpublish/comments/x" });
    const v = await verifyCandidate(c, new FixtureFetcher(SITE));
    expect(v.sourceAccessible).toBe(false);
    expect(qualify(c, v).status).toBe("Needs Review");
  });
});

describe("pipeline: dedup, resume and export", () => {
  it("consolidates duplicates and exports the exact column order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "px-"));
    const db = openProspectDb(join(dir, "p.db"));
    ingest(db, [cand(), cand({ sourceUrl: "https://janedoebooks.com/" , evidenceQuote: undefined })], "seed_file");
    const r = await processPending(db, new FixtureFetcher(SITE), { batch: 10, concurrency: 1 });
    expect(r.processed).toBe(2);
    expect(r.duplicates).toBe(1);
    // Resume: nothing left to do.
    expect((await processPending(db, new FixtureFetcher(SITE), { batch: 10 })).processed).toBe(0);
    const file = join(dir, "out.xlsx");
    const stats = await exportWorkbook(db, file);
    expect(stats.ready).toBe(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet("Qualified Prospects")!;
    expect((ws.getRow(1).values as string[]).slice(1)).toEqual([...COLUMNS]);
    expect(ws.rowCount).toBe(2);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Qualified Prospects", "Needs Review", "Research Log", "Excluded & Duplicates", "Campaign Summary"]);
  });
});

describe("CJK lexicon", () => {
  it("detects Japanese and Korean requests", () => {
    expect(detectSignals("新作の表紙イラストレーターを募集しています")[0]?.category).toBe("Cover Design");
    expect(detectSignals("전자책 표지 디자이너 구합니다").some((s) => s.category === "Cover Design")).toBe(true);
  });
});

describe("author self-promotion is not provider advertising", () => {
  it("keeps author launch wording", () => {
    expect(detectSignals("Pre-order the E-BOOK NOW before release day!", { wholeTextIsOnePost: true }).some((s) => s.kind === "stage")).toBe(true);
    expect(detectSignals("Check out my new release dates for 2027.", { wholeTextIsOnePost: true }).some((s) => s.kind === "stage")).toBe(true);
  });
});
