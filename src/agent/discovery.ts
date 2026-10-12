import type { DB } from "../db/db.js";
import { nowIso } from "../db/db.js";
import type { ResearchConfig } from "../config.js";
import type { Fetcher } from "../adapters/fetch/http.js";
import type { SearchProvider, SearchResult } from "../adapters/search/types.js";
import { platformOf } from "../adapters/sources.js";
import type { Candidate } from "./candidate.js";
import { normalizeKey } from "../util/text.js";

const LANG3: Record<string, string> = { en: "eng", de: "ger", fr: "fre", es: "spa", nl: "dut", it: "ita", sv: "swe", no: "nor", da: "dan", fi: "fin", ja: "jpn", ko: "kor" };

/** Builds provider-appropriate discovery queries from the research configuration. */
export function buildQueries(config: ResearchConfig, provider: string, year: number): string[] {
  const genres = config.genres.length ? config.genres : ["fantasy", "romance", "thriller", "science fiction", "mystery", "self-help", "memoir", "young adult"];
  if (provider === "openlibrary" || provider === "googlebooks") {
    const q: string[] = [];
    for (const g of genres) {
      if (provider === "openlibrary") {
        for (const l of config.languages) q.push(`subject:"${g}" first_publish_year:[${year - 1} TO ${year + 1}] language:${LANG3[l] ?? l} publisher:"independently published"`);
      } else q.push(`subject:${g} "independently published"`);
    }
    return q;
  }
  // general web search providers
  const q: string[] = [];
  for (const g of genres) {
    q.push(`"indie author" "${g}" "new release" ${year} ebook`);
    q.push(`"debut" "${g}" novel "coming ${year + 1}" author newsletter`);
    q.push(`site:goodreads.com/book/show "${g}" "Expected publication" ${year + 1}`);
  }
  q.push(`"looking for a cover designer" ebook author ${year}`, `"self-published" author "contact" "${year}" ebook launch`);
  q.push(`"Selfpublisherin" "neues E-Book" ${year}`, `"auteure autoéditée" "nouveau roman" ${year}`, `"zelfuitgegeven" e-book auteur ${year}`);
  return q;
}

/** Turns book-API results into candidates (author + book + listing URL). Websites are resolved later via Goodreads author pages. */
export function resultsToCandidates(results: SearchResult[]): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const r of results) {
    const authors = (r.meta?.authors as string[] | undefined) ?? [];
    if (!authors.length || !r.title) continue;
    const gr = ((r.meta?.goodreadsIds as string[] | undefined) ?? [])[0];
    const key = `${normalizeKey(authors[0])}|${normalizeKey(r.title)}`;
    if (out.has(key)) continue;
    const ratings = r.meta?.ratingsCount as number | null | undefined;
    out.set(key, {
      authorName: authors[0],
      bookTitle: r.title,
      bookUrls: [r.url],
      goodreadsUrl: gr ? `https://www.goodreads.com/book/show/${gr}` : null,
      statusHint: "unclear",
      discoveryQuery: r.query,
      discoveryPlatform: r.provider,
      reviewCountObserved: null,
      notes: ratings != null ? `${r.provider} ratingsCount=${ratings} (provider's own ratings, not used for filtering)` : null,
    });
  }
  return [...out.values()];
}

/** Web-search results pointing at book pages/author sites become lightweight candidates (only Goodreads book pages carry enough structure). */
export async function webResultsToCandidates(results: SearchResult[], fetcher: Fetcher): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const { extractPage } = await import("../analysis/extract.js");
  for (const r of results) {
    if (platformOf(r.url) !== "goodreads" || !/\/book\/show\//.test(r.url)) continue;
    try {
      const p = await fetcher.get(r.url);
      const info = extractPage(p.body, p.finalUrl);
      if (!info.book?.authors.length) continue;
      out.push({ authorName: info.book.authors[0], bookTitle: info.book.name ?? r.title, goodreadsUrl: p.finalUrl, bookUrls: [], statusHint: "unclear", discoveryQuery: r.query, discoveryPlatform: r.provider });
    } catch {
      /* recorded by caller if needed */
    }
  }
  return out;
}

export async function discoverCandidates(db: DB, runId: number | null, config: ResearchConfig, providers: SearchProvider[], fetcher: Fetcher, log: (m: string) => void): Promise<{ candidates: Candidate[]; queries: number; resultUrls: number }> {
  const year = new Date().getFullYear();
  const usable = providers.filter((p) => p.isConfigured() && (!config.platforms.length || config.platforms.includes(p.name) || ["brave", "tavily", "serpapi"].includes(p.name)));
  let queries = 0;
  let resultUrls = 0;
  const all: Candidate[] = [];
  for (const p of usable) {
    for (const q of buildQueries(config, p.name, year)) {
      if (queries >= config.maxSearchQueries) break;
      queries++;
      try {
        const res = await p.search(q, { limit: config.searchLimitPerQuery });
        resultUrls += res.length;
        db.prepare("INSERT INTO api_usage(run_id, provider, operation, units, cost_usd, at) VALUES (?,?,?,?,?,?)").run(runId, p.name, "search", 1, p.costPerQueryUsd, nowIso());
        log(`${p.name}: "${q}" → ${res.length} results`);
        const cands = ["openlibrary", "googlebooks"].includes(p.name) ? resultsToCandidates(res) : await webResultsToCandidates(res, fetcher);
        all.push(...cands);
      } catch (e: any) {
        db.prepare("INSERT INTO research_errors(run_id, stage, source, message, occurred_at) VALUES (?,?,?,?,?)").run(runId, "search", p.name, `${q}: ${e?.message ?? e}`, nowIso());
        log(`${p.name} error: ${e?.message ?? e}`);
      }
    }
  }
  const dedup = new Map(all.map((c) => [`${normalizeKey(c.authorName)}|${normalizeKey(c.bookTitle)}`, c]));
  return { candidates: [...dedup.values()], queries, resultUrls };
}
