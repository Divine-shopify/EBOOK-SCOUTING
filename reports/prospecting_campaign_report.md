# eBook Author Prospecting Campaign: final report

Generated 2026-10-13 from `data/prospector.db` (snapshot: `exports/prospector_snapshot.db`).
Workbook: `Global_eBook_Author_Prospects_200.xlsx` (repo root).

## Headline

| Metric | Main sheet (200 strongest) | All qualified |
|---|---|---|
| Qualified prospects (Lead Status = Ready) | 200 | 284 |
| Explicit service requests | 58 | 58 |
| Inferred opportunities (production stage) | 142 | 226 |
| Buying intent High / Medium | 41 / 159 | 41 / 243 |
| Research confidence High / Medium / Low | 148 / 52 / 0 | 232 / 52 / 0 |
| Publicly displayed professional email | 70 | 92 |
| Contact page but no listed email | 52 | 83 |
| Country verified on a fetched page | 128 | 128 |
| Unique authors/businesses | 200 | 284 |

## Pipeline totals

| Metric | Value |
|---|---|
| Candidates discovered (queued for verification) | 608 |
| Qualified (Ready) | 284 |
| Needs Review | 230 |
| Excluded | 87 |
| Duplicate candidates consolidated | 10 |
| Search/crawl log entries | 933 |
| Emails with a DNS MX record on their domain | 91 |
| Emails mailbox-verified | 0 (no SMTP or provider verification was run) |

Posts and pages rejected *before* becoming candidates are counted in the Research Log, not in "candidates discovered". For example, about 6,300 Bluesky and Mastodon posts were reviewed and most were dropped as provider adverts, recommendations or old posts.

## Coverage (main sheet)

**Countries (verified):** United States 33, Australia 26, Germany 24, United Kingdom 20, Canada 8, New Zealand 4, France 3, Spain 3, Netherlands 2, Denmark 1, Austria 1, Belgium 1, Italy 1, Sweden 1. Unverified: 72.

**Opportunity categories:** Marketing 124, Cover Design 34, Editing 19, Multiple Services 11, Audiobook 6, Publishing Setup 2, Translation 2, Formatting 1, Listing Optimization 1.

**Publishing platforms:** Amazon 85, Amazon KDP 40, Books2Read (D2D) 19, Kobo 18, Direct sales 16, Barnes & Noble 13, Apple Books 10, Google Play Books 9, Wattpad 6, BookFunnel 6, Shopify 6, Payhip 5, Draft2Digital 5, IngramSpark 4, Kickstarter 4.

**Languages:** English 163, German 26, French 6, Spanish 3, Dutch 1, Swedish 1.

## Search sources used

- **Bluesky public AppView API** (`api.bsky.app`, keyless): about 100 service-request phrases in 8 languages, run from code.
- **Mastodon public hashtag timelines** (keyless): mastodon.social, mastodon.online and wandering.shop. writing.exchange and mstdn.social return HTTP 422 without login.
- **Claude Code WebSearch and WebFetch**, used by ten wave-1 researcher sub-agents and four wave-2 researcher sub-agents. WebSearch is capped at 200 calls per turn across all agents, so most discovery switched to direct crawls of public directories:
  - Selfpublisher-Verband, ARRA, Livraddict, ACFW Fiction Finder and Spicy & Steamy author lists
  - risingshadow and other release calendars
  - Substack and WordPress.com public search APIs
  - event author lists
- **Page verification:** the agent's own fetcher, with robots.txt checks, throttling, caching and retries.
- **Configured but untested:** keyed Brave, Tavily and SerpAPI adapters. No API keys are present in this environment.

## Limitations

- **Mostly inferred opportunities.** 142 of the 200 main-sheet prospects are inferred from production-stage evidence: a pre-order is live, a cover reveal has happened, or a dated upcoming release is announced. The rationale says so on every row. No paid-service request has been confirmed for these.
- **Explicit requests are older and thinner on detail.** They mostly come from Bluesky, Substack and WordPress. About a third are 12–24 months old (Medium intent), and most posters do not state their country.
- **Unverified locations.** 72 main-sheet prospects have no location wording on any fetched page, so they are marked "Unverified" rather than guessed.
- **Thin markets.** Very few or no qualified prospects for Japan, South Korea, UAE, Singapore, Luxembourg, Norway, Finland, Iceland and Italy. The usual blockers were:
  - traditional-publishing dominance
  - requests posted in Facebook groups that cannot be fetched
  - JavaScript-only sites
  - the WebSearch budget
- **Pages the agent will not fetch.** Amazon, Reddit, Kickstarter and social networks are never fetched, and kboards' robots.txt blocks AI agents. Evidence that exists only on those sites can reach Needs Review at most.
- **Analyst QC overrides.** 21 records were downgraded after a manual read of the verbatim evidence (`seeds/prospects/qc_overrides.json`). Overrides can only downgrade a record.
- **Mislabelled search-log entries.** A few researcher log entries labelled as WebSearch were actually directory crawls. API-based entries were relabelled, and the remaining labels are as the researchers recorded them.

## Reproduce

See README, section "eBook Author Prospecting Agent". In short:

```bash
npm install
npm run prospect -- doctor
npm run prospect -- discover-social --pages 5
npm run prospect -- ingest seeds/prospects/*.json   # skip RESEARCHER_BRIEF/qc files
npm run prospect -- verify --all
npm run prospect -- export
```
