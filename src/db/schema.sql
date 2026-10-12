-- AuthorScout AI schema (SQLite). Applied idempotently by src/db/db.ts.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','paused','cancelled','completed','failed')),
  config_json TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  candidates_total INTEGER NOT NULL DEFAULT 0,
  candidates_done INTEGER NOT NULL DEFAULT 0,
  candidates_failed INTEGER NOT NULL DEFAULT 0,
  candidates_skipped INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,
  api_cost_usd REAL NOT NULL DEFAULT 0,
  notes TEXT
);

-- Queue of candidates per run; doubles as checkpoint for resume.
CREATE TABLE IF NOT EXISTS run_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  candidate_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','in_progress','done','failed','skipped')),
  author_id INTEGER REFERENCES authors(id),
  message TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, candidate_key)
);

CREATE TABLE IF NOT EXISTS discovery_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  base_url TEXT,
  access_mode TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  limitation TEXT
);

CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pen_name TEXT,
  country TEXT,
  country_evidence_url TEXT,
  language TEXT,
  genres TEXT,
  website_url TEXT,
  website_domain TEXT,
  book_count INTEGER,
  upcoming_releases TEXT,
  identity_status TEXT NOT NULL DEFAULT 'unverified' CHECK (identity_status IN ('verified','partially_verified','unverified')),
  research_status TEXT NOT NULL DEFAULT 'discovered' CHECK (research_status IN ('discovered','researched','failed')),
  first_seen_run_id INTEGER REFERENCES research_runs(id),
  last_run_id INTEGER REFERENCES research_runs(id),
  opted_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_authors_domain ON authors(website_domain);

CREATE TABLE IF NOT EXISTS author_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (author_id, url)
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  url TEXT,
  platform TEXT,
  genre TEXT,
  publication_date TEXT,
  publication_status TEXT NOT NULL CHECK (publication_status IN ('unpublished','forthcoming','published_ebook','other_formats_only','serial','unclear')),
  status_evidence_url TEXT,
  formats TEXT,
  description TEXT,
  description_length INTEGER,
  cover_url TEXT,
  review_count INTEGER,
  review_count_source TEXT,
  rating REAL,
  series TEXT,
  isbn TEXT,
  promotional_activity TEXT,
  purchase_links TEXT,
  metadata_issues TEXT,
  distribution_opportunities TEXT,
  inspection_scope TEXT NOT NULL DEFAULT 'listing_only',
  analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES research_runs(id),
  kind TEXT NOT NULL,
  claim TEXT NOT NULL,
  source_url TEXT,
  source_title TEXT,
  excerpt TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE (author_id, book_id, kind, claim, source_url)
);

CREATE TABLE IF NOT EXISTS service_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  category_code TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL REFERENCES service_catalog(code),
  rationale TEXT NOT NULL,
  strength INTEGER NOT NULL CHECK (strength BETWEEN 1 AND 3),
  evidence_url TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (author_id, book_id, service_code)
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  email TEXT,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('author_direct','author_business','agent','publisher','publicist','general_inquiry','contact_form_only','unknown')),
  source_url TEXT NOT NULL,
  source_title TEXT,
  discovered_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('publicly_listed','syntax_valid','domain_mx_checked','provider_verified','delivery_confirmed','invalid','unknown')),
  verification_method TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  notes TEXT,
  UNIQUE (author_id, email, source_url)
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  publicly_listed INTEGER NOT NULL,
  syntax_valid INTEGER NOT NULL,
  domain_has_mx INTEGER,
  mx_hosts TEXT,
  provider TEXT,
  provider_result TEXT,
  resulting_status TEXT NOT NULL,
  details TEXT
);

CREATE TABLE IF NOT EXISTS lead_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES research_runs(id),
  opportunity_evidence INTEGER NOT NULL,
  buying_signal INTEGER NOT NULL,
  commercial_fit INTEGER NOT NULL,
  author_activity INTEGER NOT NULL,
  identity_verification INTEGER NOT NULL,
  contact_availability INTEGER NOT NULL,
  total INTEGER NOT NULL,
  priority TEXT NOT NULL,
  explanation TEXT NOT NULL,
  scored_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_author ON lead_scores(author_id, scored_at);

CREATE TABLE IF NOT EXISTS research_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES research_runs(id),
  author_id INTEGER REFERENCES authors(id),
  stage TEXT NOT NULL,
  source TEXT,
  url TEXT,
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES research_runs(id),
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  cost_usd REAL NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS http_cache (
  url TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  final_url TEXT,
  content_type TEXT,
  body TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opt_outs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  domain TEXT,
  author_name TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

-- Latest score per author, convenient for dashboards/exports.
CREATE VIEW IF NOT EXISTS v_latest_scores AS
SELECT s.* FROM lead_scores s
JOIN (SELECT author_id, MAX(id) AS max_id FROM lead_scores GROUP BY author_id) m
  ON m.max_id = s.id;
