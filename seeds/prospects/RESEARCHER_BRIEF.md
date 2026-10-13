# Researcher brief: seed candidates for the eBook Author Prospecting Agent

You find **real** eBook authors / author-owned publishing businesses with **evidence of a service need**, and write them
as seed candidates. The agent (`npm run prospect`) re-fetches every page itself and decides; you only supply candidates
whose evidence the agent can confirm. Never invent anything: every quote must be copied verbatim from a page you fetched.

## What counts as evidence (on a page the agent can fetch)
- **Explicit request** (best): the author, on their own site/blog/newsletter archive or a public forum, asks for an editor,
  proofreader, formatter, cover designer, illustrator, narrator, translator, marketer/publicist, ads help, website help,
  KDP/distribution help, etc. First person, current (posted ≤ 24 months ago, ideally ≤ 12), not a provider advertising.
- **Production stage** (inferred, medium): the author's **own website** says an eBook/book is forthcoming (pre-order live,
  cover reveal, "coming soon", release date, "currently editing", "final edits", relaunch / new covers / second edition),
  AND the author-owned pages mention 2026 or 2027 (so it is current). Self-published/indie authors or small author-owned imprints only.
- Not evidence: an ordinary retail listing, reviews, a big traditional bestseller, a service provider's advert,
  pitch-party/querying-agent posts, readers.

## Hosts the agent will NOT fetch (never use as sourceUrl; may go in additionalUrls only)
amazon.*, reddit.com, kickstarter.com, indiegogo.com, facebook.com, instagram.com, tiktok.com, x.com, twitter.com,
linkedin.com, kboards.com, upwork.com, fiverr.com, threads.net, youtube.com, discord.com. Also skip bsky.app and Mastodon
(the agent covers those through APIs). Do not fetch kboards.com at all (its robots.txt blocks AI agents).

## Candidate JSON (array) — schema in src/prospector/candidate.ts
```json
{
  "name": "Jane Doe",                       // person or pen name as shown on the site; business name if a business
  "businessName": "Doe Books Ltd",          // optional, author-owned imprint/business
  "authorType": "Self-Published Author",    // Independent Author | Self-Published Author | Traditionally Published Author | Author-Owned Business | Independent Publisher | Other Verified Type
  "country": "Ireland", "region": "Munster", "city": "Cork",   // claims; only kept if locationQuote is found on a fetched page
  "locationQuote": "Jane lives in Cork, Ireland",             // VERBATIM text from source/website/contact/additional page
  "language": "en",
  "bookTitle": "The Salt Road",             // verbatim title as on the page
  "genre": "Historical fantasy",
  "platforms": ["Amazon KDP", "Kobo"],
  "sourceUrl": "https://janedoe.com/blog/looking-for-a-cover-artist",   // page carrying the evidence (fetchable)
  "evidenceQuote": "I'm looking for a cover artist for book three",     // VERBATIM from sourceUrl, 8-40 words, containing the need/stage wording
  "evidenceDate": "2026-08-14",             // ISO date of the post if shown on the page; omit if unknown
  "officialWebsite": "https://janedoe.com/",// author's own site (homepage). REQUIRED for identity verification
  "contactPage": "https://janedoe.com/contact",  // optional
  "additionalUrls": ["https://janedoe.com/about"], // up to 3: about page (for location), book page, etc.
  "notes": "short factual note",
  "discovery": { "channel": "web_search", "query": "<the exact search query>", "provider": "claude-websearch", "market": "Ireland", "date": "2026-10-12" }
}
```
Rules: sourceUrl on the author's own domain ⇒ set officialWebsite to that domain's homepage (that makes it "author-owned"
and lets the agent scan the whole page). For forum posts, officialWebsite must be the poster's own site (with their name on it).
Do not include emails yourself — the agent extracts publicly displayed ones.

## Workflow (repo: /home/user/EBOOK-SCOUTING)
1. Search with WebSearch (vary phrasing, country, city, language, genre, platform; use local-language phrases).
2. Open promising pages with WebFetch to find verbatim quotes, the author's site, about/location text, and a date.
3. Write candidates to your file, then dry-run: `cd /home/user/EBOOK-SCOUTING && NODE_NO_WARNINGS=1 npm run -s prospect -- check-file <your file>`
   (prints the agent's verdict per candidate; nothing is saved). If `quoteVerified` is false, your quote is not verbatim
   on the fetched HTML — fix it (copy a shorter exact phrase) or drop the candidate. If identity is not confirmed, add the
   correct officialWebsite. Keep candidates whose status is `Ready` or `Needs Review`; drop `Excluded` ones (count them as rejected).
4. Final files (overwrite as you go):
   - `seeds/prospects/<segment>.json` — candidates array
   - `seeds/prospects/<segment>.searchlog.json` — array of
     `{"query","market","language","sourceType","provider":"claude-websearch","date":"2026-10-12","resultsReviewed":N,"candidatesAdded":N,"rejected":N,"rejectionReasons":"...","nextDirection":"..."}` — one per search you ran.
5. Do NOT run `ingest`, `verify`, `requalify` or `export`. Do not contact anyone, submit forms, or sign up for anything. No outreach text.

Return a short summary: candidates written, how many check as Ready / Needs Review, searches run, main dead ends.

## Wave-2 additions (learned from wave 1)
- **Freshness:** production-stage evidence counts only if the release it cites is still upcoming (or released within the
  last ~45 days) and, when the post is dated, the post is ≤ 6 months old. Pages whose only dates are past are rejected.
  Prefer quotes that contain the future date ("erscheint am 06.11.2026", "Releasing Nov 2026", "Coming 2027").
- **Skip authors already in the database:** `seeds/prospects/_already_known_names.txt`.
- **Directories beat search:** event author lists (signings, book fairs, festivals), writer-association member lists,
  award eligibility lists and release calendars give hundreds of author sites without spending WebSearch calls. You may
  fetch those with WebFetch or the repo fetcher (`npx tsx -e` scripts are fine; keep scratch files in your own folder under the
  session scratchpad, never in the repo).
- WebSearch is capped per turn across all agents: use it sparingly for finding directories, not individual authors.
- Wording the agent recognises now includes: pre-order/preorder (any form), cover reveal, coming soon, release date(s),
  releasing <season/month> 2026/27, will be published 2027, forthcoming novel, heavy/final edits, re-release/new covers,
  German (erscheint am/im, Veröffentlichung, vorbestellen, Neuerscheinung), French (sortie le/prévue, précommandes ouvertes,
  à paraître, bientôt disponible, à venir en 2027), Spanish (preventa, próximamente), Italian (in uscita), Dutch (verschijnt),
  Nordic (kommer ut, udkommer, ilmestyy), Japanese/Korean release and request phrases.
