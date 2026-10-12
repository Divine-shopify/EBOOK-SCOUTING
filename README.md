# AuthorScout AI

AuthorScout AI researches ebook authors, works out each book's publishing status, matches authors to ebook services using observable evidence, finds **publicly listed** professional email addresses, scores each lead, and stores everything in a local SQLite database. Results can be exported to Excel and CSV.

It does **not** write outreach messages, store email templates, or send email. That is deliberately out of scope, and a test (`tests/pipeline.test.ts › scope guard`) checks that it stays that way.

## Stack

| Concern | Implementation |
|---|---|
| Runtime | Node.js ≥ 22.13, TypeScript (run with `tsx`) |
| Database | SQLite via Node's built-in `node:sqlite` (no native build); schema in `src/db/schema.sql` |
| Dashboard | Hono, server-rendered HTML (no client JS build step) |
| Validation | Zod (env vars, research controls, seed candidates, AI output) |
| Parsing | Cheerio (JSON-LD, Open Graph, links, emails) |
| Search | Adapters for Open Library (keyless), Google Books (keyless/keyed), Brave, Tavily and SerpAPI (keyed) |
| Browser | Optional Playwright (`playwright-core`) rendering for JS-only author sites |
| AI | Optional Anthropic Messages API pass; rule-based analysis is always on |
| Email verification | Syntax check → MX lookup (system DNS, with DNS-over-HTTPS as fallback) → optional ZeroBounce or NeverBounce |
| Export | ExcelJS workbook with 15 sheets, plus 14 CSVs |
| Tests | Vitest, using offline fixtures (no network) |

This deviates from the suggested Next.js + Prisma stack on purpose. `node:sqlite` and a server-rendered Hono app install with no native or engine downloads, which made them work behind the restricted proxy here. All database access goes through `src/db/db.ts`, so moving to Postgres later means rewriting SQL in one layer only.

## Setup

```bash
npm install
cp .env.example .env          # fill in any credentials you have (all optional)
npm run db:migrate            # creates data/authorscout.db and applies the schema (idempotent)
npm test                      # 21 offline tests
npm run typecheck
```

The schema is applied automatically every time the database is opened. `schema_migrations` records the version.

If you are behind an HTTP proxy, the fetcher uses `HTTPS_PROXY` through undici's `EnvHttpProxyAgent`. Set `NODE_EXTRA_CA_CERTS` if the proxy re-signs TLS.

## Running research

```bash
# 1. Curated or seed candidates (JSON array, schema in src/agent/candidate.ts)
npm run research -- --seeds seeds/*.json --batch 50 --max-reviews 1000 --depth standard

# 2. Automatic discovery through the configured search providers
npm run research -- --discover --max-queries 40

# 3. Resume a paused or crashed run (each candidate is checkpointed)
npm run research -- --resume 1

# Discovery only (writes candidates to a file without researching them)
npm run discover -- --max-queries 5 --out data/candidates.json

# Exports and report
npm run export                 # exports/authorscout_research.xlsx + exports/csv/*.csv
npm run report -- --out reports/research_report.md

# Dashboard
npm start                      # http://127.0.0.1:3000
```

The dashboard has these pages:
- **Overview:** live counts and breakdowns.
- **Lead explorer:** search, filter and sort.
- **Author detail:** score explanation, evidence, opportunities and contacts.
- **Book analysis.**
- **Contacts:** verified, not verified, invalid, and contact-page-only, each kept separate.
- **Research runs:** create a run, then start, pause, resume or cancel it.
- **Research controls:** countries, languages, platforms, genres, author types, service categories, batch size, minimum score, review ceiling, depth, email discovery, verification provider, search and rate limits, spend cap, browser.
- **Export center:** Excel and per-dataset CSV.
- **Errors.**

## How a candidate is researched (`src/agent/pipeline.ts`)

1. **Opt-out check:** the candidate's name and domain are checked against the opt-out list first.
2. **Book listings:** fetched only where automated access is permitted. Goodreads `/book/show` pages are used (robots.txt allows them; `/search` is disallowed and never used). JSON-LD supplies the rating and review counts, format, date, description and series.
3. **Review ceiling:** if the larger of *ratings* and *reviews* on the inspected listing is above `maxReviewCount` (default **1000**, inclusive), the candidate is skipped.
4. **Goodreads author page:** gives the number of distinct works and the official website.
5. **Official website:** the homepage plus up to 5 contact, about, press or Impressum pages (10 at `deep` depth).
6. **Status evidence:** the cited announcement page is fetched and has to contain release or manuscript wording before a status is accepted. A missing listing is **never** taken to mean "unpublished". "Unknown Binding" is ignored. "Published in other formats only" requires either the full editions list (checked) to show no ebook, or an explicit seed claim.
7. **Country:** recorded only when a fetched page names it (or a city or region in it). Otherwise it is left blank.
8. **Opportunities:** rule-based and tied to evidence (`src/analysis/opportunities.ts`). Each one stores its rationale and source URL.
9. **Emails:** taken only from fetched pages that can be attributed to the author: mailto links, visible text, Cloudflare-encoded addresses and "name [at] domain" forms. Addresses from agents, publicists and publishers are labelled as such. Third-party addresses that can't be attributed are dropped.
10. **Verification:** see below.
11. **Score** (`src/analysis/scoring.ts`): out of 100, and every point is explained.
12. **Save:** everything is written in one transaction per candidate. Authors are deduplicated by normalised name, then by website domain; books by author and title.

Every fetch is SSRF-guarded (http/https only, no private IPs or credentials), checks robots.txt, is rate-limited per host (5 s for Goodreads), retried with backoff, size-capped and cached. Page text is treated as untrusted: the optional LLM sees it inside `<untrusted_page>` tags, its output is schema-validated, and it can only *classify*. Any quote it returns has to occur literally in the fetched text.

## Email verification statuses (never conflated)

| Status | Meaning |
|---|---|
| `publicly_listed` | Appears on an attributable public page |
| `syntax_valid` | Format is valid. This is **not** deliverability |
| `domain_mx_checked` | The domain publishes MX records. This is **not** proof the mailbox exists |
| `provider_verified` | A configured ZeroBounce or NeverBounce check returned valid |
| `delivery_confirmed` | Set manually, only after legitimate, authorised correspondence |
| `invalid` | Bad syntax, a non-existent domain, or rejected by the provider |
| `unknown` | Checks could not be completed |

AuthorScout never guesses addresses, never probes SMTP, and never sends mail. If no public email is found, the contact page is kept as a `contact_form_only` reference with an empty email field.

## Lead score

| Component | Max | Basis |
|---|---|---|
| Opportunity evidence | 30 | Sum of evidenced opportunity strengths × 3 |
| Explicit buying signal | 25 | Public request for help (25); crowdfunding or announced self-published release (15); manuscript stage (12); serial or recent release (8) |
| Commercial fit | 15 | Self-published (8) or small press (4); multiple books (+4); series (+3); large publisher (0) |
| Author activity | 10 | Forthcoming (10); release within 12 months (8); serial or manuscript (7); within 3 years (4) |
| Identity verification | 10 | Verified (10), partially verified (6), unverified (2) |
| Contact availability | 10 | Author or business email (10); agent, publicist or publisher (6); contact page only (4) |

80–100 is High priority, 60–79 Qualified, 40–59 Further research required, and below 40 Low priority. The score measures whether a contact is *available*, not whether the email is valid.

## Sources and access (`src/adapters/sources.ts`, also listed on the Research controls page)

- **Fetched (robots-checked):**
  - Goodreads (`/book/show`, `/author/show`, `/work/editions` only)
  - Open Library API
  - Author websites
  - Smashwords, Books2Read, Lulu, BookBaby, Blurb, Gumroad, Payhip, Wattpad, Inkitt, Scribble Hub, Reedsy, Substack, Medium
- **Reference-only:** these are not fetched because they block bots or their terms prohibit it. Their URLs are stored as evidence links.
  - Amazon, Kobo, B&N, Royal Road, Kickstarter
  - Instagram, TikTok, Facebook, LinkedIn, X, YouTube
- **Keyed search:** Brave, Tavily and SerpAPI. Adding any one of these enables open-web discovery.

## Compliance notes

- Only data that is publicly published for professional contact is collected. Private personal details are out of scope.
- Use the opt-out button on the author page or the `opt_outs` table. Opted-out names and domains are skipped in every later run.
- Marketing law (GDPR, CAN-SPAM, CASL and others) governs what you do with these contacts. AuthorScout is a research tool only.

## Project layout

```
src/
  adapters/  fetch (http, robots, browser), search providers, AI analyzer, source registry
  agent/     candidate schema, pipeline, runner (pause/resume/checkpoint), discovery, country evidence
  analysis/  extraction, status, opportunities, scoring, service catalog (A–K, 155 services)
  email/     classification, verification
  export/    queries, Excel/CSV
  server/    dashboard
  cli/       research, discover, export, report, migrate
seeds/       discovery seed files used for the initial run
exports/     generated workbook + CSVs
reports/     run reports
```

---

# eBook Author Prospecting Agent (`src/prospector/`)

A second agent in this repo, built for one job: find real eBook authors and author-owned businesses with **evidence of a specific service need**, and write them to `Global_eBook_Author_Prospects_200.xlsx`. It reuses AuthorScout's fetcher (SSRF guard, robots.txt, per-host throttling, retries, cache), page extraction and ExcelJS. It has its own database (`data/prospector.db`) and its own qualification rules.

It does not write outreach messages, send email, submit forms or contact anyone.

## Commands

```bash
npm run prospect -- doctor                    # tests each integration and prints OK/FAIL
npm run prospect -- discover-social --pages 3 # keyless: Bluesky post search + Mastodon hashtag timelines
npm run prospect -- discover-web --queries q.json   # needs BRAVE_SEARCH_API_KEY / TAVILY_API_KEY / SERPAPI_API_KEY
npm run prospect -- ingest seeds/prospects/*.json   # researcher/seed candidates (schema: src/prospector/candidate.ts)
npm run prospect -- import-log seeds/prospects/x.searchlog.json
npm run prospect -- check-file seeds/prospects/x.json   # dry-run verdicts; nothing saved
npm run prospect -- verify --all              # verify + qualify every pending candidate (resumable)
npm run prospect -- requalify                 # re-queue everything after a rule change (fetches stay cached)
npm run prospect -- export                    # writes Global_eBook_Author_Prospects_200.xlsx
npm run prospect -- status
```

Behind the agent proxy in the cloud container, set `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` if TLS fails. API keys belong in `.env`, never in code.

## Discovery channels

| Channel | Key needed | What it does |
|---|---|---|
| Bluesky public AppView (`api.bsky.app`) | none | Searches posts with ~47 service-request phrases in 8 languages, then loads each author's profile |
| Mastodon public hashtag timelines | none | Scans #amwriting, #indieauthor, #selfpublishing and similar tags on 5 instances |
| Brave / Tavily / SerpAPI | yes | Fetches each result page; a page becomes a candidate only if it shows request or stage wording and names its owner |
| Seed files (`seeds/prospects/*.json`) | none | Candidates found by a researcher, for example a Claude session using its web-search tool. They are re-verified like everything else |

Every query is written to `px_search_log` with the number of results reviewed, candidates added, rejections and the reasons for them.

## Verification (`verify.ts`)

Nothing in a candidate is trusted. The agent re-fetches the source page, the official website and its contact page, and up to 3 additional URLs, then checks:

- **Evidence quote:** must occur in the page the agent fetched itself. Matching is exact after normalisation, or at least 80% of 5-word shingles.
- **Signals (`lexicon.ts`):**
  - A first-person explicit request in 8 languages.
  - Production-stage wording: pre-order, cover reveal, release date, in edits, relaunch.
  - These are discarded when the sentence or post reads as a provider advert, a recommendation, a past or negated request, a third party's job ad, or a pitch-party/querying post.
  - On third-party pages, only the verified quote is scanned.
- **Identity:** the name appears on the official website. Or a public profile describes the person as an author **and** the name is a real two-part personal or pen name.
- **eBook connection:** retailer links on the author's site, eBook or self-publishing wording in author-owned text, or a verified request for a book-production service.
- **Location:** recorded only when location wording ("lives in Cork, Ireland") appears on a fetched page. Otherwise the country is `Unverified`.
- **Emails:** only addresses displayed on the author's own fetched site or contact page. They are labelled *publicly displayed, not deliverability-checked*. Addresses are never guessed.
- **Never fetched:** Amazon, Reddit, Kickstarter, Facebook, Instagram, X, LinkedIn, kboards (its robots.txt blocks AI agents), Upwork, Fiverr, YouTube, TikTok. Evidence hosted only there can reach *Needs Review*, never *Ready*.

## Qualification (`qualify.ts`)

| Field | Rule |
|---|---|
| Buying Intent: High | Verified explicit request, 12 months old or less (or undated with a current year on author-owned pages) |
| Buying Intent: Medium | Explicit request 12–24 months old or undated; or production-stage wording that is current |
| Research Confidence: High | Identity, eBook connection and evidence all agent-verified, and the evidence is current |
| Research Confidence: Medium | Identity and evidence verified, but some uncertainty remains: age, or eBook format only implied |
| Lead Status: Ready | Intent High/Medium, confidence High/Medium, identity verified, eBook connection, and not a service provider |
| Lead Status: Needs Review | Some evidence exists, but identity, the eBook link or the page itself could not be verified |
| Lead Status: Excluded | Everything else, including service providers and requests more than 24 months old |

**Dedup:** records are matched on normalised name, website domain, email and profile URL. Duplicates are merged into the stronger record, keeping the sources and evidence of both.

## Workbook

The workbook has five sheets:

1. **Qualified Prospects:** the 28 required columns, in order.
2. **Needs Review:** the same 28 columns.
3. **Research Log:** every query.
4. **Excluded & Duplicates:** with a reason for each.
5. **Campaign Summary:** totals, the market measure, and the rules.

All sheets have filters and a frozen header, URL columns are clickable, and formula injection is neutralised.

Tests: `npx vitest run tests/prospector.test.ts` (offline fixtures).
