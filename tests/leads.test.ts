import { describe, it, expect } from "vitest";
import { normalizeLead, mergeLeads, validateLead, validateTable, dedupKeys, parseCsv, toCsv, LEAD_COLUMNS } from "../src/leads/canonical.js";

const base = {
  "Author Name": "Jane Doe",
  "Verified Public Email": ["Jane@JaneDoeBooks.com"],
  "Official Author Website": "https://www.janedoebooks.com/",
  "Other Relevant Author Profile URLs": ["https://www.goodreads.com/author/show/123.Jane_Doe", "https://www.amazon.com/stores/author/B00ABCDEFG"],
  "Selected Book Titles for Outreach": ["The Salt Road", "Ember Tide: A Novel"],
  "Verified Book Descriptions or Synopses": "x",
  "Book Evidence Source URLs": ["https://www.goodreads.com/book/show/1"],
  "Amazon Book URL": "https://www.amazon.com/dp/B0CXYZ1234",
  "Personalized Subject Line": "An idea for The Salt Road and Ember Tide",
  "Personalized Email Body": "Hi Jane,\n\nMy name is Roland Jacobs. I came across The Salt Road and Ember Tide...\n\nWarm regards,\nRoland Jacobs",
  "Primary Recommended Service": "Book trailers",
  "Evidence-Based Service-Fit Explanation": "x",
  Country: "Canada",
  "Email Source URL": "https://janedoebooks.com/contact",
  "Author Identity Evidence URL": "https://janedoebooks.com/about",
  "Email Attribution": "Author direct",
  "Publishing Status": "Likely independent/KDP — x",
  "Research Date": "2026-10-19",
  "Platforms Actually Reviewed": ["Official website"],
};

describe("canonical leads", () => {
  it("accepts a complete lead and normalises lists and email case", () => {
    const l = normalizeLead(base);
    expect(validateLead(l)).toEqual([]);
    expect(l["Verified Public Email"]).toBe("jane@janedoebooks.com");
    expect(l["Selected Book Titles for Outreach"]).toBe("The Salt Road | Ember Tide: A Novel");
  });

  it("rejects placeholders, unknown services, untitled bodies and single books without a reason", () => {
    const l = normalizeLead({ ...base, "Primary Recommended Service": "Magic", "Personalized Email Body": "Hi [AUTHOR NAME], Roland Jacobs", "Selected Book Titles for Outreach": ["The Salt Road"] });
    const p = validateLead(l).join("\n");
    expect(p).toMatch(/unknown service/);
    expect(p).toMatch(/placeholders/);
    expect(p).toMatch(/does not mention selected title: The Salt Road/);
    expect(p).toMatch(/only one selected book/);
  });

  it("derives keys from the author-owned domain and Amazon IDs but not shared hosts", () => {
    const k = dedupKeys(normalizeLead(base));
    expect(k).toContain("domain:janedoebooks.com");
    expect(k).toContain("amazon_author:B00ABCDEFG");
    expect(k).toContain("asin:B0CXYZ1234");
    expect(k).toContain("profile:goodreads.com/author/show/123.jane_doe");
    expect(k.some((x) => x === "domain:goodreads.com")).toBe(false);
  });

  it("blocks duplicates by email, domain, alias or Amazon ID and never edits existing rows", () => {
    const first = mergeLeads([], [normalizeLead(base)]);
    expect(first.added).toHaveLength(1);
    const sameEmail = normalizeLead({ ...base, "Author Name": "J. Doe", "Official Author Website": "https://other.example.org" });
    const alias = normalizeLead({ ...base, "Author Name": "Janet Smith (aka Jane Doe)", "Verified Public Email": ["j@x.org"], "Official Author Website": "", "Other Relevant Author Profile URLs": [], "Amazon Book URL": "" });
    const unrelated = normalizeLead({ ...base, "Author Name": "Jane Doe-Smith", "Verified Public Email": ["hi@jds.net"], "Official Author Website": "https://jds.net", "Other Relevant Author Profile URLs": [], "Amazon Book URL": "", "Email Source URL": "https://jds.net/c" });
    const second = mergeLeads(first.merged, [sameEmail, alias, unrelated]);
    expect(second.duplicates.map((d) => d.incoming)).toEqual(["J. Doe", "Janet Smith (aka Jane Doe)"]);
    expect(second.added.map((a) => a["Lead ID"])).toEqual(["L0002"]);
    expect(second.merged[0]).toEqual(first.merged[0]);
    expect(validateTable(second.merged)).toEqual([]);
  });

  it("round-trips CSV with commas, quotes and newlines", () => {
    const row = Object.fromEntries(LEAD_COLUMNS.map((c) => [c, ""])) as Record<string, string>;
    row["Personalized Email Body"] = 'Hi "Jane",\nline two, with comma';
    const [, back] = parseCsv(toCsv(LEAD_COLUMNS, [row]));
    expect(back[LEAD_COLUMNS.indexOf("Personalized Email Body")]).toBe(row["Personalized Email Body"]);
  });
});

describe("shared platforms", () => {
  it("does not merge different authors who share a collective's domain in their profile links", () => {
    const a = normalizeLead({ ...base, "Other Relevant Author Profile URLs": ["https://romanceclassbooks.com/authors/a"] });
    const b = normalizeLead({ ...base, "Author Name": "Ann Roe", "Verified Public Email": ["ann@annroe.com"], "Official Author Website": "https://annroe.com", "Other Relevant Author Profile URLs": ["https://romanceclassbooks.com/authors/b"], "Amazon Book URL": "", "Selected Book Titles for Outreach": ["The Salt Road", "Ember Tide"] });
    expect(mergeLeads([], [a, b]).added).toHaveLength(2);
  });
});

describe("shared listing pages", () => {
  it("ignores directory URLs that many authors share", () => {
    const a = normalizeLead({ ...base, "Other Relevant Author Profile URLs": ["https://christianauthorsnetwork.com/member-directory-2/"] });
    const b = normalizeLead({ ...base, "Author Name": "Ann Roe", "Verified Public Email": ["ann@annroe.com"], "Official Author Website": "https://annroe.com", "Other Relevant Author Profile URLs": ["https://christianauthorsnetwork.com/member-directory-2/"], "Amazon Book URL": "" });
    expect(mergeLeads([], [a, b]).added).toHaveLength(2);
  });
});

describe("award listing pages", () => {
  it("does not treat an awards page shared by finalists as one author", () => {
    const u = ["https://blueridgeconference.com/2025-selah-award-finalists/"];
    const a = normalizeLead({ ...base, "Other Relevant Author Profile URLs": u });
    const b = normalizeLead({ ...base, "Author Name": "Ann Roe", "Verified Public Email": ["ann@annroe.com"], "Official Author Website": "https://annroe.com", "Other Relevant Author Profile URLs": u, "Amazon Book URL": "" });
    expect(mergeLeads([], [a, b]).added).toHaveLength(2);
  });
});
