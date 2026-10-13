# Harvest brief: author-website lists for the bulk site scan

Your job is **list building, not judging**. Collect real author websites (indie / self-published authors, author-owned
imprints, small presses publishing indie authors) from public directories, and write them as a JSON array. The agent
(`npm run prospect -- scan-sites`) later scans every site for current publishing evidence and verifies hits itself.

## Output
`seeds/sites/<segment>.json` — array of:
```json
{"url": "https://janedoebooks.com/", "name": "Jane Doe", "country": "Ireland", "language": "en",
 "genre": "cozy mystery", "source": "<directory name + year>", "directoryUrl": "<page you took it from>"}
```
- `url` = the author's OWN website homepage (not Amazon/Goodreads/Facebook/Instagram/Linktree/beacons/carrd root).
- `name` = the author/pen name exactly as the directory shows it (omit if unknown). `country` only if the directory states it.
- Skip hosts already listed in `seeds/sites/_known_hosts.txt` (one per line, no "www.").
- Prefer lists dominated by **indie/self-published** authors; skip obviously traditional-only lists (big publisher catalogues).
- Target: as many unique author sites as you can, **at least 1,500**. Also write `seeds/sites/<segment>.sources.json`:
  an array of `{"source","directoryUrl","method","sitesFound","notes"}` describing every directory you crawled.

## Good source types (use WebSearch sparingly — it is capped at 200 calls per turn across ALL agents)
- Reader/signing event author lists (romance, fantasy, cozy, LitRPG conventions), book fairs' indie author halls
- Writer association member directories that are public (indie author associations, genre associations)
- Award entrant lists for self-published books (e.g. SPFBO/SPSFC entrant lists, indie book awards)
- Release calendars and "new releases" roundup blogs that link author sites
- Library "local author" directories, indie author project lists
- Blog-tour organisers' author/tour pages, newsletter swap directories, author-collective member pages
You may fetch pages with WebFetch, curl, or scripts (keep scratch files in your own folder under the session
scratchpad, never in the repo). Respect robots.txt; do not fetch kboards.com, Facebook, Instagram, X, Amazon.
Do NOT scan author sites for evidence and do NOT run ingest/verify/scan-sites/export. Do not contact anyone.

Return: number of sites written, sources used, dead ends.
