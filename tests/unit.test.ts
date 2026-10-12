import { describe, it, expect } from "vitest";
import { robotsAllows } from "../src/adapters/fetch/http.js";
import { extractEmails, extractPage, decodeCfEmail } from "../src/analysis/extract.js";
import { classifyEmail } from "../src/email/classify.js";
import { verifyEmail, isSyntaxValid } from "../src/email/verify.js";
import { classifyStatus } from "../src/analysis/status.js";
import { scoreLead, priorityFor } from "../src/analysis/scoring.js";
import { detectOpportunities } from "../src/analysis/opportunities.js";
import { toCsv } from "../src/export/exporter.js";
import { pageSupportsCountry } from "../src/agent/country.js";
import { parseCandidates } from "../src/agent/candidate.js";

describe("robots.txt", () => {
  const txt = `User-agent: *\nAllow: /work/editions\nDisallow: /search\nDisallow: /work\n\nUser-agent: GPTBot\nDisallow: /`;
  it("applies longest-match rules for the wildcard group", () => {
    expect(robotsAllows(txt, "AuthorScoutBot/0.1", "/book/show/123").allowed).toBe(true);
    expect(robotsAllows(txt, "AuthorScoutBot/0.1", "/search?q=x").allowed).toBe(false);
    expect(robotsAllows(txt, "AuthorScoutBot/0.1", "/work/editions/1").allowed).toBe(true);
    expect(robotsAllows(txt, "AuthorScoutBot/0.1", "/work/quotes").allowed).toBe(false);
  });
  it("uses a specific group when the UA matches", () => {
    expect(robotsAllows(txt, "GPTBot/1.0", "/book/show/1").allowed).toBe(false);
  });
});

describe("email extraction", () => {
  it("finds mailto, plain, Cloudflare-encoded and obfuscated addresses and drops junk", () => {
    const enc = (s: string, key = 0x42) => key.toString(16).padStart(2, "0") + [...s].map((ch) => (ch.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
    const html = `<body><p>Business enquiries: <a href="mailto:jane@janedoebooks.com?subject=hi">email</a></p>
      <p>Agent: Sam Lee, Lee Literary Agency — sam@leeagency.co.uk</p>
      <span class="__cf_email__" data-cfemail="${enc("press@janedoebooks.com")}">[email protected]</span>
      <p>write to hello [at] janedoebooks [dot] com</p><img src="logo@2x.png"> user@example.com</body>`;
    const emails = extractEmails(html).map((e) => e.email).sort();
    expect(emails).toEqual(["hello@janedoebooks.com", "jane@janedoebooks.com", "press@janedoebooks.com", "sam@leeagency.co.uk"]);
    expect(decodeCfEmail(enc("a@b.co"))).toBe("a@b.co");
  });
  it("does not glue adjacent element text into addresses", () => {
    const html = `<body><div>Scott Palmer</div><div>scottpalmerauthor@gmail.com</div><div>Privacy</div><a href="mailto:scottpalmerauthor@gmail.com">mail</a></body>`;
    expect(extractEmails(html).map((e) => e.email)).toEqual(["scottpalmerauthor@gmail.com"]);
  });
  it("labels agent addresses as agent, not the author", () => {
    const [agent] = extractEmails(`<p>Literary agent: Sam Lee, Lee Agency — sam@leeagency.co.uk</p>`);
    expect(classifyEmail(agent, "janedoebooks.com", "https://janedoebooks.com/contact").type).toBe("agent");
    const [own] = extractEmails(`<p>Contact me: jane@janedoebooks.com</p>`);
    expect(classifyEmail(own, "janedoebooks.com", "https://janedoebooks.com/contact").type).toBe("author_direct");
  });
});

describe("email verification ladder", () => {
  it("never reports provider_verified without a provider", async () => {
    const r = await verifyEmail("jane@janedoebooks.com", { mxLookup: async () => [{ exchange: "mx.example.net", priority: 10 }] });
    expect(r.status).toBe("domain_mx_checked");
  });
  it("marks NXDOMAIN invalid but treats missing MX as inconclusive", async () => {
    const nx = await verifyEmail("a@nope.invalid", { mxLookup: async () => { throw Object.assign(new Error("x"), { code: "ENOTFOUND" }); } });
    expect(nx.status).toBe("invalid");
    const nodata = await verifyEmail("a@weird.com", { mxLookup: async () => { throw Object.assign(new Error("x"), { code: "ENODATA" }); } });
    expect(nodata.status).toBe("syntax_valid");
  });
  it("uses provider results when configured", async () => {
    const provider = { name: "fake", isConfigured: () => true, verify: async () => ({ result: "valid" as const, raw: "valid" }) };
    const r = await verifyEmail("a@b.com", { provider, mxLookup: async () => [{ exchange: "mx", priority: 1 }] });
    expect(r.status).toBe("provider_verified");
    expect(isSyntaxValid("bad@@x.com")).toBe(false);
  });
});

describe("publication status", () => {
  it("does not treat a missing listing as unpublished", () => {
    expect(classifyStatus({ hint: "unpublished", evidenceText: "My new novel is great", formats: [], platforms: [] }).status).toBe("unclear");
    expect(classifyStatus({ hint: "unpublished", evidenceText: "I am querying agents with my manuscript", formats: [], platforms: [] }).status).toBe("unpublished");
  });
  it("detects forthcoming from future dates and Goodreads expected publication", () => {
    const today = new Date("2026-10-12");
    expect(classifyStatus({ datePublished: "2027-02-01", formats: [], platforms: [], today }).status).toBe("forthcoming");
    expect(classifyStatus({ goodreadsExpected: true, formats: [], platforms: [] }).status).toBe("forthcoming");
    expect(classifyStatus({ formats: ["Kindle Edition"], platforms: ["goodreads"] }).status).toBe("published_ebook");
    expect(classifyStatus({ formats: [], platforms: ["royalroad"] }).status).toBe("serial");
  });
});

describe("scoring", () => {
  it("bounds components and maps priorities", () => {
    const opps = detectOpportunities({
      status: "forthcoming", reviewCount: 12, rating: 4.3, descriptionLength: 150, hasWebsite: true, websiteFetched: true, websiteUrl: "https://a.com",
      websiteHttps: true, websiteCopyrightYear: 2020, newsletterSignals: [], storeSignals: [], retailerPlatforms: ["amazon"], socialLinkCount: 0,
      bookLanguage: "de", series: "Saga", formats: [], bookCount: 4, explicitSeeking: "I'm looking for a cover designer for book 3.", crowdfunding: false,
      bookUrl: "https://goodreads.com/book/show/1", statusEvidenceUrl: "https://a.com/news", publisherIsLarge: false, currentYear: 2026,
    });
    expect(opps.map((o) => o.code)).toContain("B01");
    const s = scoreLead({ opportunities: opps, status: "forthcoming", explicitSeeking: "x", crowdfunding: false, selfPublished: true, publisherIsLarge: false,
      bookCount: 4, hasSeries: true, monthsSinceRelease: null, identity: "verified", bestContactType: "author_direct", hasContactPage: true });
    expect(s.opportunityEvidence).toBeLessThanOrEqual(30);
    expect(s.commercialFit).toBeLessThanOrEqual(15);
    expect(s.total).toBe(100);
    expect(priorityFor(80)).toBe("High priority");
    expect(priorityFor(79)).toBe("Qualified");
    expect(priorityFor(40)).toBe("Further research required");
    expect(priorityFor(39)).toBe("Low priority");
  });
  it("gives no contact points when nothing public exists", () => {
    const s = scoreLead({ opportunities: [], status: "unclear", explicitSeeking: null, crowdfunding: false, selfPublished: null, publisherIsLarge: false,
      bookCount: null, hasSeries: false, monthsSinceRelease: null, identity: "unverified", bestContactType: null, hasContactPage: false });
    expect(s.contactAvailability).toBe(0);
    expect(s.total).toBeLessThan(40);
  });
});

describe("misc", () => {
  it("neutralises CSV formula injection", () => {
    expect(toCsv([{ a: "=HYPERLINK(1)", b: 'x,"y"' }])).toBe(`a,b\n'=HYPERLINK(1),"x,""y"""\n`);
  });
  it("confirms countries only on whole-word mentions", () => {
    expect(pageSupportsCountry("I live in Wellington, New Zealand", "New Zealand")).toBe(true);
    expect(pageSupportsCountry("Ukulele lessons", "United Kingdom")).toBe(false);
    expect(pageSupportsCountry("Wohnhaft in Graz", "Austria")).toBe(true);
  });
  it("rejects malformed seeds without failing the batch", () => {
    const { ok, rejected } = parseCandidates([{ authorName: "A B", bookTitle: "T", websiteUrl: "" }, { bookTitle: "no author" }]);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
  it("parses Book JSON-LD rating counts", () => {
    const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"Night Tide","author":[{"@type":"Person","name":"Jane Doe"}],"aggregateRating":{"ratingValue":4.21,"ratingCount":312,"reviewCount":58},"bookFormat":"Kindle Edition","inLanguage":"English"}</script></head><body>x</body></html>`;
    const p = extractPage(html, "https://www.goodreads.com/book/show/1");
    expect(p.book?.ratingCount).toBe(312);
    expect(p.book?.authors).toEqual(["Jane Doe"]);
  });
});
