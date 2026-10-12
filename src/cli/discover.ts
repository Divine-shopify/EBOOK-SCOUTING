/** Runs only the discovery stage and prints candidates (no research). Usage: npm run discover -- [--max-queries 5] [--out file.json] */
import { writeFileSync } from "node:fs";
import { getDb, getSetting } from "../db/db.js";
import { env, ResearchConfigSchema } from "../config.js";
import { discoverCandidates } from "../agent/discovery.js";
import { buildSearchProviders } from "../adapters/search/providers.js";
import { Fetcher, installProxyFromEnv } from "../adapters/fetch/http.js";

installProxyFromEnv();
const db = getDb();
const e = env();
const i = process.argv.indexOf("--max-queries");
const o = process.argv.indexOf("--out");
const config = ResearchConfigSchema.parse({ ...getSetting(db, "research_config", {}), ...(i > 0 ? { maxSearchQueries: Number(process.argv[i + 1]) } : {}) });
const fetcher = new Fetcher(db, { userAgent: e.USER_AGENT, requestsPerSecondPerHost: config.requestsPerSecondPerHost });
const providers = buildSearchProviders(fetcher, { brave: e.BRAVE_SEARCH_API_KEY, tavily: e.TAVILY_API_KEY, serpapi: e.SERPAPI_API_KEY, googleBooks: e.GOOGLE_BOOKS_API_KEY });
console.log("Providers:", providers.map((p) => `${p.name}=${p.isConfigured() ? "configured" : "missing credentials"}`).join(", "));
const d = await discoverCandidates(db, null, config, providers, fetcher, console.log);
console.log(`${d.queries} queries → ${d.resultUrls} result URLs → ${d.candidates.length} candidates`);
if (o > 0) writeFileSync(process.argv[o + 1], JSON.stringify(d.candidates, null, 2));
else console.log(JSON.stringify(d.candidates.slice(0, 10), null, 2));
