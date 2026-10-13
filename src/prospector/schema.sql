-- eBook Author Prospecting Agent storage (separate DB file from AuthorScout).
CREATE TABLE IF NOT EXISTS http_cache (
  url TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  final_url TEXT,
  content_type TEXT,
  body TEXT,
  fetched_at TEXT NOT NULL
);

-- Every candidate the agent has seen, from any discovery channel. Processing is resumable per row.
CREATE TABLE IF NOT EXISTS px_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intake_key TEXT NOT NULL UNIQUE,          -- normalised source URL; re-ingesting the same URL is a no-op
  channel TEXT NOT NULL,                    -- bluesky | mastodon | web_search | seed_file
  payload TEXT NOT NULL,                    -- candidate JSON (schema in candidate.ts)
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | processed | error
  outcome TEXT,                             -- Ready | Needs Review | Excluded | Duplicate
  outcome_reason TEXT,
  prospect_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  discovered_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS px_candidates_status ON px_candidates(status);

-- One row per unique author/business. Columns mirror the 28 workbook columns.
CREATE TABLE IF NOT EXISTS px_prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key TEXT NOT NULL UNIQUE,
  record TEXT NOT NULL,                     -- JSON of the 28 workbook fields
  lead_status TEXT NOT NULL,
  dedup_keys TEXT NOT NULL,                 -- JSON array: name:, domain:, email:, profile:
  evidence TEXT NOT NULL,                   -- JSON: page checks + matched signals (audit trail)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS px_search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  market TEXT,
  language TEXT,
  provider TEXT NOT NULL,
  source_type TEXT,
  searched_at TEXT NOT NULL,
  results_reviewed INTEGER NOT NULL DEFAULT 0,
  candidates_added INTEGER NOT NULL DEFAULT 0,
  qualified INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  rejection_reasons TEXT,
  next_direction TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS px_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Author websites from public directories, waiting for (or done with) a bulk site scan. Resumable per site.
CREATE TABLE IF NOT EXISTS px_site_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_key TEXT NOT NULL UNIQUE,             -- host; one scan per author site
  list TEXT NOT NULL,                       -- directory/list name
  payload TEXT NOT NULL,                    -- SiteEntry JSON
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | candidate | rejected
  outcome TEXT,
  queued_at TEXT NOT NULL,
  scanned_at TEXT
);
