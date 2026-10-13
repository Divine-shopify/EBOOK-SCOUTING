# eBook Author Prospecting: 1,000-prospect brief, final report

Generated 2026-10-13.

- **Workbook:** `Global_eBook_Author_Prospects_1000.xlsx`, at the repository root. Its 4 sheets are Qualified Prospects, Research Summary, Research Log and Needs Review.
- **Agent source:** `src/prospector/`, with the CLI in `src/cli/prospect.ts`.
- **Database snapshot:** `exports/prospector_snapshot.db`. This copy omits the HTTP cache.

## Headline: 418 qualified, not 1,000

The workbook holds **418 unique qualified prospects**. The target of about 1,000 was **not** reached.

The automated rules approved about 1,550 records. Blind samples kept showing that roughly a quarter to a third of them were not real prospects:

- bookshops, review blogs and book-promotion newsletters
- service providers and academic presses
- traditionally published bestsellers
- other authors' books
- stale pages

Every automated "Ready" record was then read by an analyst QC pass that could only **downgrade** records. That pass removed 293, and an earlier round removed 47. All 340 downgrades have written reasons, in `seeds/prospects/qc_overrides.json` and in each record's Notes. A further 1,813 records stayed in Review because the author's own pages show no self-publishing activity. That is the rule that keeps traditionally published authors out of the qualified list.

Approving all ~1,550 would have hit the target, but with an estimated 25–35% false positives. The brief says to prioritise accuracy over volume.

## Required metrics

| Metric | Value |
|---|---|
| Candidates discovered (queued and verified) | 3,267 |
| Author websites bulk-scanned from 15 public directory lists | 40,347 (37,618 without current evidence) |
| Unique qualified prospects (Ready) | **418** |
| Records needing review | 2,357 |
| Rejected candidates (excluded) | 368 |
| Duplicate candidates removed (consolidated) | 46 |
| Invalid candidates removed (schema or processing errors) | 0 |
| Excluded for compliance (Livraddict crawl; its robots.txt blocks AI agents) | 29 |
| Qualified prospects with a publicly displayed professional email | 153 |
| Qualified prospects without a public email | 265 (141 of them have a public contact page) |
| Emails whose domain passed a DNS MX check | 150. This means the domain can receive mail; no mailbox was checked |
| Emails technically verified at mailbox level | **0** (none performed) |
| Research confidence High / Medium / Low | 383 / 35 / 0 |
| Buying intent High / Medium / Low | 38 / 380 / 0 |
| Explicit service requests | 39 |
| Inferred opportunities (production-stage evidence) | 379 |
| Countries with a verified location | 11: US 30, DE 20, UK 14, AU 11, CA 5, DK, FR, IT, NZ, ES, SE 1 each |
| Location unverified | 332. Many author sites never state where the author lives, so country was left unset rather than guessed |
| Publishing platforms represented | 16: Amazon/KDP, Books2Read/D2D, B&N, Kobo, BookFunnel, direct sales, Apple Books, Payhip, Shopify, Google Play, Smashwords, Kickstarter, IngramSpark, Wattpad and others |
| Most common opportunity categories | Marketing/launch 273, Multiple Services 31, Editing 26, Cover Design 26, Automation 18, Audiobook 15 |
| Author types | Independent Author 290, Self-Published Author 87, Independent Publisher 31, Author-Owned Business 10 |
| Research batches (200 each, by discovery order) | Batch 1: 200, Batch 2: 200, Batch 3: 18 |

**Prospect-mix shortfalls** (primary category, set out in the Research Summary sheet):

- **Upcoming-book authors:** 194 against a target of 100.
- **KDP and Kindle authors:** 144 against 150.
- **Independent publishers:** 41 against 75.
- **Explicit service-request categories are far short:**
  - editing: 14 against 100
  - cover: 21 against 75
  - formatting: 1 against 100
  - publishing and distribution: 0 against 75
  - marketing: 0 against 75
  - websites: 0 against 50

  Verifiable, identifiable, current public requests are rare on fetchable pages. Most are in Facebook groups, Reddit and Discord, which the agent does not fetch.

## Sources and methods

1. **Keyless APIs, run by the agent:**
   - Bluesky post search: about 150 queries in 8 languages.
   - Mastodon hashtag timelines.
   - Substack post search and the WordPress.com Reader search.
2. **Researcher sub-agents using web search and page fetching.** These produced 413 seed candidates. WebSearch is capped at 200 calls per turn, so most of this work used direct directory crawls.
3. **Directory harvesting:** 15 lists, about 40,000 author websites in total. Sources included:
   - writer associations: Writers' Union of Canada, Selfpublisher-Verband, Syndikat, DELIA, ITW, MWA, SCBWI, Scottish Book Trust, Literature Wales and the CWA
   - events: romance signing events
   - award lists: Readers' Favorite, American Book Fest, Eric Hoffer, IAN
   - blog-tour circuits
   - small-press directories
4. **Bulk site scan by the agent.** It scanned each homepage plus up to 4 news, books or blog pages for an explicit request or dated release wording. Hits went to the verifier.
5. **Verifier.** It re-fetched every page with robots.txt checks and confirmed the quote verbatim, the identity on the site, the eBook connection, location wording and attributable emails. Each email domain got a DNS MX check.
6. **Analyst QC:** a downgrade-only review of every Ready record.

## Integration limitations

- **Keyed web search is untested.** The Brave, Tavily and SerpAPI adapters are built, but no API keys are configured.
- **No mailbox verification.** The agent never probes SMTP, and no ZeroBounce or NeverBounce key is set.
- **Sources the agent never fetches:** Facebook, Instagram, X, Reddit, Amazon, Kickstarter, kboards (blocks AI agents) and Livraddict (blocks AI agents). Evidence that exists only on those sites cannot qualify.
- **Pages the agent cannot read:** JavaScript-only author sites (Wix and similar) and directories behind logins or Cloudflare.
- **Researcher compliance issues:**
  - One researcher used Goodreads `/search`, which its robots.txt disallows, for name lookups. No qualified record traces to it.
  - Livraddict-derived records were excluded, as reported above.
- **Name-guessed author domains.** Some awards-list author sites were located by trying name-based domains, for example `name.com`. Each one was kept only if the site showed the author's name, and the verifier re-confirmed identity on the site.
- **Container restart.** One restart lost two harvest runs, which were resumed. The HTTP cache was dropped to keep the database small.
- **Estimated remaining error.** QC reviewers judged from the verified evidence text and fetched pages only when unsure. Some traditionally published authors may remain where the evidence does not reveal the publisher.

## Reproduce

```bash
npm install
npm run prospect -- doctor
npm run prospect -- discover-social --pages 5 && npm run prospect -- discover-blogs
npm run prospect -- enqueue-sites seeds/sites/<list>.json --list "<name>"   # repeat per list
npm run prospect -- scan-sites --shard 0/4   # run shards 0..3 in parallel
npm run prospect -- ingest seeds/prospects/<file>.json
npm run prospect -- verify --all
npm run prospect -- export                   # writes Global_eBook_Author_Prospects_1000.xlsx
```
