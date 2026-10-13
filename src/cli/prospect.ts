import { readFileSync } from "node:fs";
import { env } from "../config.js";
import { Fetcher } from "../adapters/fetch/http.js";
import { buildSearchProviders } from "../adapters/search/providers.js";
import { openProspectDb, ingest, logSearch, requeueAll, setBatch, currentBatch } from "../prospector/store.js";
import { parseCandidates, type ProspectCandidate } from "../prospector/candidate.js";
import { runSocialDiscovery, runBlogDiscovery, webSearchDiscover, BlueskyDiscovery, fmtReasons } from "../prospector/discovery.js";
import { processPending } from "../prospector/runner.js";
import { exportWorkbook, campaignStats } from "../prospector/export.js";
import { verifyCandidate } from "../prospector/verify.js";
import { enqueueSites, runSiteScan, type SiteEntry } from "../prospector/sitescan.js";
import { qualify } from "../prospector/qualify.js";

const USAGE = `Usage: npm run prospect -- <command> [options]

  doctor                         Test every discovery/fetch integration and report which work
  discover-social [--pages N] [--max-queries N] [--no-mastodon] [--no-bluesky]
                                 Keyless discovery via Bluesky post search + Mastodon hashtag timelines
  discover-blogs [--pages N] [--max-queries N]
                                 Keyless discovery via Substack post search + WordPress.com Reader search
  discover-web --queries FILE [--limit N]
                                 Keyed web search (Brave/Tavily/SerpAPI from .env); FILE = JSON array of queries
  ingest FILE...                 Queue researcher/seed candidates (schema: src/prospector/candidate.ts)
  import-log FILE                Append external search-log entries (JSON array) to the research log
  check --url URL [--name N] [--quote Q] [--website W]
                                 Dry-run verification of one candidate (nothing saved)
  check-file FILE                Dry-run verification of every candidate in a seed file (nothing saved)
  verify [--batch N] [--all] [--concurrency N] [--retry-errors]
                                 Verify + qualify pending candidates (resumable)
  set-batch N                    Attribute new research to batch N (research log + candidates)
  enqueue-sites FILE... --list NAME [--country C] [--language L]
                                 Queue author websites from a directory (JSON SiteEntry[] or name|url lines)
  scan-sites [--concurrency N] [--limit N]
                                 Scan queued sites for current publishing evidence; hits become candidates
  requalify                      Re-queue all candidates after a rule change (cached pages are reused)
  export [--out FILE] [--target N]  Write the Excel workbook; the N strongest qualified prospects go on the main sheet (default Global_eBook_Author_Prospects_1000.xlsx)
  status                         Campaign counts`;

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const cmd = process.argv[2];
  const e = env();
  const db = openProspectDb();
  const fetcher = new Fetcher(db, { userAgent: e.USER_AGENT, requestsPerSecondPerHost: 1, cacheTtlHours: 72, timeoutMs: 20_000, retries: 2, hostDelayMs: { "absolutewrite.com": 20_000, "www.goodreads.com": 5_000 } });
  const log = (s: string) => console.log(s);

  switch (cmd) {
    case "doctor": {
      const checks: [string, () => Promise<string>][] = [
        ["Bluesky public API (search)", async () => `${(await new BlueskyDiscovery(fetcher).searchPosts('"looking for an editor"', 1)).length} posts`],
        ["Mastodon public API (tag timeline)", async () => {
          const r = await fetcher.getJson<any[]>("https://mastodon.social/api/v1/timelines/tag/amwriting?limit=5");
          if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
          return `${r.data?.length ?? 0} statuses`;
        }],
        ["Page fetch (robots-checked)", async () => `HTTP ${(await fetcher.get("https://www.draft2digital.com/", { useCache: false })).status}`],
      ];
      for (const p of buildSearchProviders(fetcher, { brave: e.BRAVE_SEARCH_API_KEY, tavily: e.TAVILY_API_KEY, serpapi: e.SERPAPI_API_KEY })) {
        if (["openlibrary", "googlebooks"].includes(p.name)) continue;
        checks.push([`Web search: ${p.name}`, async () => {
          if (!p.isConfigured()) throw new Error("not configured (no API key in environment)");
          return `${(await p.search("looking for an ebook formatter", { limit: 3 })).length} results`;
        }]);
      }
      for (const [n, f] of checks) {
        try {
          console.log(`OK    ${n}: ${await f()}`);
        } catch (err) {
          console.log(`FAIL  ${n}: ${(err as Error).message}`);
        }
      }
      break;
    }
    case "discover-social": {
      const r = await runSocialDiscovery(db, fetcher, { pages: Number(arg("pages", "2")), maxQueries: arg("max-queries") ? Number(arg("max-queries")) : undefined, mastodon: !flag("no-mastodon"), bluesky: !flag("no-bluesky"), onLog: log });
      console.log(`Queries run: ${r.queries}; new candidates queued: ${r.added}`);
      break;
    }
    case "discover-blogs": {
      const r = await runBlogDiscovery(db, fetcher, { pages: Number(arg("pages", "3")), maxQueries: arg("max-queries") ? Number(arg("max-queries")) : undefined, onLog: log });
      console.log(`Queries run: ${r.queries}; new candidates queued: ${r.added}`);
      break;
    }
    case "discover-web": {
      const providers = buildSearchProviders(fetcher, { brave: e.BRAVE_SEARCH_API_KEY, tavily: e.TAVILY_API_KEY, serpapi: e.SERPAPI_API_KEY }).filter((p) => p.isConfigured() && !["openlibrary", "googlebooks"].includes(p.name));
      if (!providers.length) throw new Error("No keyed web-search provider configured. Set BRAVE_SEARCH_API_KEY, TAVILY_API_KEY or SERPAPI_API_KEY.");
      const queries = JSON.parse(readFileSync(arg("queries")!, "utf8")) as string[];
      for (const q of queries) {
        try {
          const r = await webSearchDiscover(providers[0], fetcher, q, Number(arg("limit", "10")));
          const ing = ingest(db, r.candidates, "web_search");
          logSearch(db, { query: q, provider: providers[0].name, sourceType: "Web search", resultsReviewed: r.reviewed, candidatesAdded: ing.added, rejected: r.reviewed - r.candidates.length, rejectionReasons: fmtReasons(r.rejected) });
          log(`${q}: reviewed ${r.reviewed}, new ${ing.added}`);
        } catch (err) {
          logSearch(db, { query: q, provider: providers[0].name, resultsReviewed: 0, candidatesAdded: 0, error: (err as Error).message });
        }
      }
      break;
    }
    case "ingest": {
      for (const f of process.argv.slice(3).filter((a) => !a.startsWith("--"))) {
        const { ok, rejected } = parseCandidates(JSON.parse(readFileSync(f, "utf8")));
        const r = ingest(db, ok, "seed_file");
        console.log(`${f}: ${ok.length} valid, ${rejected.length} invalid, ${r.added} new, ${r.skipped} already queued`);
        for (const x of rejected) console.log(`  invalid #${x.index}: ${x.error}`);
      }
      break;
    }
    case "import-log": {
      const entries = JSON.parse(readFileSync(process.argv[3], "utf8")) as any[];
      for (const x of entries) logSearch(db, { query: x.query, market: x.market, language: x.language, provider: x.provider ?? "research-tool web search", sourceType: x.sourceType, resultsReviewed: x.resultsReviewed ?? 0, candidatesAdded: x.candidatesAdded ?? 0, rejected: x.rejected ?? 0, rejectionReasons: x.rejectionReasons, nextDirection: x.nextDirection, searchedAt: x.date });
      console.log(`Imported ${entries.length} search-log entries`);
      break;
    }
    case "check": {
      const c: ProspectCandidate = { name: arg("name", "Unknown")!, sourceUrl: arg("url")!, evidenceQuote: arg("quote"), officialWebsite: arg("website"), locationQuote: arg("location"), country: arg("country"), evidenceDate: arg("date"), platforms: [], additionalUrls: [], discovery: { channel: "check" } };
      const v = await verifyCandidate(c, fetcher);
      const d = qualify(c, v);
      console.log(JSON.stringify({ status: d.status, intent: d.intent, confidence: d.confidence, reasons: d.reasons, pages: v.pages, quoteVerified: v.quoteVerified, signals: v.signals.map((s) => s.label), identity: v.identityBasis, ebook: v.ebookBasis, country: v.country, emails: v.emails, contactPage: v.contactPage }, null, 2));
      break;
    }
    case "check-file": {
      // Dry run for researchers: verifies each candidate in a seed file and prints the verdict; nothing is saved.
      const { ok, rejected } = parseCandidates(JSON.parse(readFileSync(process.argv[3], "utf8")));
      for (const x of rejected) console.log(`INVALID #${x.index}: ${x.error}`);
      for (const c of ok) {
        const v = await verifyCandidate(c, fetcher);
        const d = qualify(c, v);
        console.log(JSON.stringify({ name: c.name, status: d.status, intent: d.intent, confidence: d.confidence, quoteVerified: v.quoteVerified, signals: v.signals.map((s) => s.label), identity: v.identityBasis, ebook: v.ebookBasis, country: v.country?.country ?? "Unverified", email: d.record["Public Professional Email"], reasons: d.reasons, pages: v.pages.map((p) => `${p.role}:${p.ok ? "ok" : p.note ?? p.status}`) }));
      }
      break;
    }
    case "verify": {
      const batch = Number(arg("batch", "50"));
      let total = { processed: 0, ready: 0, review: 0, excluded: 0, duplicates: 0, errors: 0 };
      do {
        const r = await processPending(db, fetcher, { batch, concurrency: Number(arg("concurrency", "4")), retryErrors: flag("retry-errors"), onLog: log });
        total = Object.fromEntries(Object.entries(total).map(([k, n]) => [k, n + (r as any)[k]])) as typeof total;
        if (!r.processed && !r.errors) break;
      } while (flag("all"));
      console.log(`Processed ${total.processed}: Ready ${total.ready}, Needs Review ${total.review}, Excluded ${total.excluded}, Duplicates ${total.duplicates}, Errors ${total.errors}`);
      break;
    }
    case "export": {
      const out = arg("out", "Global_eBook_Author_Prospects_1000.xlsx")!;
      const s = await exportWorkbook(db, out, Number(arg("target", "1000")));
      console.log(`Wrote ${out}: ${s.ready} qualified, ${s.review} needs review`);
      break;
    }
    case "requalify": {
      console.log(`Re-queued ${requeueAll(db)} candidates; run verify --all next`);
      break;
    }
    case "set-batch": {
      setBatch(db, Number(process.argv[3]));
      console.log(`Current research batch: ${currentBatch(db)}`);
      break;
    }
    case "enqueue-sites": {
      // JSON array of SiteEntry, or text lines "url", "name<TAB>url", "name|url[|country]".
      const list = arg("list") ?? "unnamed list";
      for (const f of process.argv.slice(3).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"))) {
        const raw = readFileSync(f, "utf8");
        let entries: SiteEntry[];
        if (f.endsWith(".json")) entries = (JSON.parse(raw) as SiteEntry[]).map((e) => ({ ...e, source: e.source ?? list }));
        else
          entries = raw.split(/\r?\n/).flatMap((line) => {
            const parts = line.split(/\t|\|/).map((x) => x.trim()).filter(Boolean);
            const url = parts.find((x) => /^https?:\/\//i.test(x) && !/beventi\.co|selfpublisher-verband\.de\/autor/i.test(x));
            if (!url) return [];
            const name = parts.find((x) => !/^https?:/i.test(x) && /\p{L}{2,}\s+\p{L}/u.test(x));
            const country = arg("country");
            return [{ url, name, source: list, country, language: arg("language") } as SiteEntry];
          });
        const r = enqueueSites(db, entries, list);
        console.log(`${f}: ${entries.length} entries, ${r.added} queued, ${r.skipped} already queued`);
      }
      break;
    }
    case "scan-sites": {
      // Bulk scans favour throughput: short timeout, no retries (a failed site is just logged as rejected).
      const scanFetcher = new Fetcher(db, { userAgent: e.USER_AGENT, requestsPerSecondPerHost: 1, cacheTtlHours: 72, timeoutMs: 12_000, retries: 0, maxBytes: 1_500_000 });
      const r = await runSiteScan(db, scanFetcher, { concurrency: Number(arg("concurrency", "24")), limit: arg("limit") ? Number(arg("limit")) : undefined, batch: currentBatch(db), onLog: log });
      console.log(`Scanned ${r.scanned} sites; ${r.candidates} new candidates queued for verification`);
      break;
    }
    case "status": {
      console.log(JSON.stringify(campaignStats(db), null, 2));
      break;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
