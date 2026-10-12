/**
 * Usage:
 *   npm run research -- --seeds seeds/*.json [--name "Batch 1"] [--batch 50] [--max-reviews 1000] [--depth standard]
 *   npm run research -- --discover [--name "..."]          (uses configured search providers)
 *   npm run research -- --resume <runId>
 */
import { readFileSync } from "node:fs";
import { getDb, getSetting } from "../db/db.js";
import { env, ResearchConfigSchema } from "../config.js";
import { parseCandidates, type Candidate } from "../agent/candidate.js";
import { createRun, executeRun } from "../agent/runner.js";
import { discoverCandidates } from "../agent/discovery.js";
import { buildSearchProviders } from "../adapters/search/providers.js";
import { Fetcher, installProxyFromEnv } from "../adapters/fetch/http.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith("--"); j++) out.push(process.argv[j]);
  return out;
}

installProxyFromEnv();
const db = getDb();
const e = env();
const resume = arg("resume");
if (resume) {
  const st = await executeRun(db, Number(resume));
  console.log(`Run ${resume}: ${st}`);
  process.exit(0);
}
const base = getSetting(db, "research_config", {});
const config = ResearchConfigSchema.parse({
  ...base,
  ...(arg("batch") ? { batchSize: Number(arg("batch")) } : {}),
  ...(arg("max-reviews") ? { maxReviewCount: Number(arg("max-reviews")) } : {}),
  ...(arg("depth") ? { researchDepth: arg("depth") } : {}),
  ...(arg("max-queries") ? { maxSearchQueries: Number(arg("max-queries")) } : {}),
});
let candidates: Candidate[] = [];
let notes = "";
if (process.argv.includes("--discover")) {
  const fetcher = new Fetcher(db, { userAgent: e.USER_AGENT, requestsPerSecondPerHost: config.requestsPerSecondPerHost });
  const providers = buildSearchProviders(fetcher, { brave: e.BRAVE_SEARCH_API_KEY, tavily: e.TAVILY_API_KEY, serpapi: e.SERPAPI_API_KEY, googleBooks: e.GOOGLE_BOOKS_API_KEY });
  console.log("Search providers:", providers.map((p) => `${p.name}=${p.isConfigured() ? "configured" : "missing credentials"}`).join(", "));
  const d = await discoverCandidates(db, null, config, providers, fetcher, console.log);
  candidates = d.candidates;
  notes = `Discovery: ${d.queries} queries, ${d.resultUrls} result URLs, ${d.candidates.length} candidates. `;
}
for (const f of args("seeds")) {
  const { ok, rejected } = parseCandidates(JSON.parse(readFileSync(f, "utf8")));
  candidates.push(...ok);
  notes += `${f}: ${ok.length} candidates, ${rejected.length} rejected. `;
  for (const r of rejected) console.warn(`  rejected ${f}[${r.index}]: ${r.error}`);
}
if (!candidates.length) {
  console.error("No candidates. Pass --seeds <files> and/or --discover.");
  process.exit(1);
}
const runId = createRun(db, arg("name") ?? `Run ${new Date().toISOString()}`, config, candidates);
db.prepare("UPDATE research_runs SET notes = ? WHERE id = ?").run(notes, runId);
console.log(`Run ${runId}: ${Math.min(candidates.length, config.batchSize)} candidates queued (max reviews ${config.maxReviewCount}).`);
const st = await executeRun(db, runId);
console.log(`Run ${runId} finished: ${st}`);
