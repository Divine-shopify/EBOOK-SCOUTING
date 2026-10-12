import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";

/** Minimal .env loader (no dependency); real environment variables win. */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const EnvSchema = z.object({
  DATABASE_PATH: z.string().default("data/authorscout.db"),
  PORT: z.coerce.number().default(3000),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  GOOGLE_BOOKS_API_KEY: z.string().optional(),
  EMAIL_VERIFIER: z.enum(["none", "zerobounce", "neverbounce"]).default("none"),
  ZEROBOUNCE_API_KEY: z.string().optional(),
  NEVERBOUNCE_API_KEY: z.string().optional(),
  USER_AGENT: z.string().default("AuthorScoutBot/0.1 (+research; respects robots.txt)"),
  BROWSER_EXECUTABLE: z.string().optional(),
  MAX_SPEND_USD: z.coerce.number().default(5),
});
export type Env = z.infer<typeof EnvSchema>;

export function env(): Env {
  loadDotEnv();
  return EnvSchema.parse(process.env);
}

/** User-configurable research settings (dashboard "Research controls"). */
export const ResearchConfigSchema = z.object({
  countries: z.array(z.string()).default([
    "United States", "United Kingdom", "Canada", "Australia", "Germany", "France", "Netherlands", "Spain", "Italy",
    "Switzerland", "Austria", "Belgium", "Sweden", "Norway", "Denmark", "Finland", "Iceland", "Ireland", "Luxembourg",
    "New Zealand", "Japan", "South Korea", "Singapore", "United Arab Emirates", "Israel",
  ]),
  languages: z.array(z.string()).default(["en", "de", "fr", "es", "nl", "it"]),
  platforms: z.array(z.string()).default([]),
  genres: z.array(z.string()).default([]),
  authorTypes: z.array(z.string()).default(["self_published", "forthcoming", "serial", "small_press"]),
  serviceCategories: z.array(z.string()).default(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]),
  batchSize: z.number().int().min(1).max(500).default(50),
  minLeadScore: z.number().int().min(0).max(100).default(0),
  /** Books with more reviews than this are excluded (inclusive bound). */
  maxReviewCount: z.number().int().min(0).default(1000),
  researchDepth: z.enum(["shallow", "standard", "deep"]).default("standard"),
  emailDiscovery: z.boolean().default(true),
  verificationProvider: z.enum(["none", "zerobounce", "neverbounce"]).default("none"),
  searchLimitPerQuery: z.number().int().min(1).max(100).default(20),
  maxSearchQueries: z.number().int().min(0).max(1000).default(40),
  requestsPerSecondPerHost: z.number().min(0.05).max(5).default(0.5),
  maxApiSpendUsd: z.number().min(0).default(5),
  useBrowser: z.boolean().default(false),
});
export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;
