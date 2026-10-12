import type { DB } from "../db/db.js";

export type Row = Record<string, string | number | null>;

const LEAD_SELECT = `
SELECT a.id AS author_id, a.name AS author, a.pen_name, a.country, a.country_evidence_url, a.language, a.genres, a.website_url,
  a.identity_status, a.book_count,
  b.title AS book_title, b.url AS book_url, b.platform, b.publication_status, b.publication_date, b.review_count, b.rating,
  s.total AS lead_score, s.priority,
  s.opportunity_evidence, s.buying_signal, s.commercial_fit, s.author_activity, s.identity_verification, s.contact_availability,
  (SELECT group_concat(sc.name, '; ') FROM service_opportunities so JOIN service_catalog sc ON sc.code = so.service_code WHERE so.author_id = a.id AND so.strength >= 2) AS top_opportunities,
  (SELECT c.email FROM contacts c WHERE c.author_id = a.id AND c.email IS NOT NULL AND c.verification_status != 'invalid'
     ORDER BY CASE c.contact_type WHEN 'author_business' THEN 0 WHEN 'author_direct' THEN 1 WHEN 'general_inquiry' THEN 2 WHEN 'agent' THEN 3 ELSE 4 END LIMIT 1) AS best_email,
  (SELECT c.contact_type FROM contacts c WHERE c.author_id = a.id AND c.email IS NOT NULL AND c.verification_status != 'invalid'
     ORDER BY CASE c.contact_type WHEN 'author_business' THEN 0 WHEN 'author_direct' THEN 1 WHEN 'general_inquiry' THEN 2 WHEN 'agent' THEN 3 ELSE 4 END LIMIT 1) AS best_email_type,
  (SELECT c.verification_status FROM contacts c WHERE c.author_id = a.id AND c.email IS NOT NULL AND c.verification_status != 'invalid'
     ORDER BY CASE c.contact_type WHEN 'author_business' THEN 0 WHEN 'author_direct' THEN 1 WHEN 'general_inquiry' THEN 2 WHEN 'agent' THEN 3 ELSE 4 END LIMIT 1) AS email_verification_status,
  (SELECT c.source_url FROM contacts c WHERE c.author_id = a.id ORDER BY (c.email IS NULL), c.id LIMIT 1) AS contact_source_url,
  a.updated_at AS last_researched
FROM authors a
LEFT JOIN v_latest_scores s ON s.author_id = a.id
LEFT JOIN books b ON b.id = (SELECT id FROM books WHERE author_id = a.id ORDER BY updated_at DESC LIMIT 1)
WHERE a.opted_out = 0`;

export function allLeads(db: DB): Row[] {
  return db.prepare(`${LEAD_SELECT} ORDER BY s.total DESC`).all() as Row[];
}
export function qualifiedLeads(db: DB): Row[] {
  return db.prepare(`${LEAD_SELECT} AND s.total >= 60 ORDER BY s.total DESC`).all() as Row[];
}
export function highPriorityLeads(db: DB): Row[] {
  return db.prepare(`${LEAD_SELECT} AND s.total >= 80 ORDER BY s.total DESC`).all() as Row[];
}
export function bookAnalysis(db: DB): Row[] {
  return db
    .prepare(
      `SELECT b.id AS book_id, a.name AS author, b.title, b.url, b.platform, b.genre, b.publication_status, b.status_evidence_url, b.publication_date, b.formats,
        b.review_count, b.review_count_source, b.rating, b.series, b.description_length, b.cover_url, b.promotional_activity, b.metadata_issues,
        b.distribution_opportunities, b.purchase_links, b.inspection_scope, b.analyzed_at
       FROM books b JOIN authors a ON a.id = b.author_id ORDER BY a.name`,
    )
    .all() as Row[];
}
export function opportunities(db: DB): Row[] {
  return db
    .prepare(
      `SELECT a.name AS author, b.title AS book, sc.category_code, sc.category, so.service_code, sc.name AS service, so.strength, so.rationale, so.evidence_url
       FROM service_opportunities so JOIN authors a ON a.id = so.author_id LEFT JOIN books b ON b.id = so.book_id JOIN service_catalog sc ON sc.code = so.service_code
       ORDER BY a.name, so.strength DESC`,
    )
    .all() as Row[];
}
export function contacts(db: DB, opts: { withEmailOnly?: boolean } = {}): Row[] {
  return db
    .prepare(
      `SELECT c.id AS contact_id, c.author_id, a.name AS author, c.email, c.contact_type, c.source_url, c.source_title, c.discovered_at, c.last_checked_at,
        c.verification_status, c.verification_method, c.confidence, c.notes
       FROM contacts c JOIN authors a ON a.id = c.author_id ${opts.withEmailOnly ? "WHERE c.email IS NOT NULL" : ""}
       ORDER BY CASE c.verification_status WHEN 'delivery_confirmed' THEN 0 WHEN 'provider_verified' THEN 1 WHEN 'domain_mx_checked' THEN 2 WHEN 'syntax_valid' THEN 3 WHEN 'publicly_listed' THEN 4 WHEN 'unknown' THEN 5 ELSE 6 END, a.name`,
    )
    .all() as Row[];
}
export function evidence(db: DB): Row[] {
  return db
    .prepare(
      `SELECT e.id, a.name AS author, b.title AS book, e.kind, e.claim, e.source_url, e.source_title, e.excerpt, e.observed_at, e.run_id
       FROM evidence e LEFT JOIN authors a ON a.id = e.author_id LEFT JOIN books b ON b.id = e.book_id ORDER BY a.name, e.kind`,
    )
    .all() as Row[];
}
export function researchErrors(db: DB): Row[] {
  return db
    .prepare(`SELECT e.id, e.run_id, a.name AS author, e.stage, e.source, e.url, e.message, e.occurred_at FROM research_errors e LEFT JOIN authors a ON a.id = e.author_id ORDER BY e.id`)
    .all() as Row[];
}
export function runs(db: DB): Row[] {
  return db.prepare("SELECT * FROM research_runs ORDER BY id DESC").all() as Row[];
}
export function runCandidates(db: DB, runId?: number): Row[] {
  return db
    .prepare(`SELECT run_id, candidate_key, status, message, author_id, updated_at FROM run_candidates ${runId ? "WHERE run_id = ?" : ""} ORDER BY run_id, id`)
    .all(...(runId ? [runId] : [])) as Row[];
}

export function overview(db: DB) {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    authorsDiscovered: one("SELECT COUNT(*) n FROM authors"),
    authorsResearched: one("SELECT COUNT(*) n FROM authors WHERE research_status = 'researched'"),
    booksAnalyzed: one("SELECT COUNT(*) n FROM books WHERE inspection_scope != 'not_inspected'"),
    booksTotal: one("SELECT COUNT(*) n FROM books"),
    qualifiedLeads: one("SELECT COUNT(*) n FROM v_latest_scores WHERE total >= 60"),
    highPriorityLeads: one("SELECT COUNT(*) n FROM v_latest_scores WHERE total >= 80"),
    publicEmails: one("SELECT COUNT(DISTINCT email) n FROM contacts WHERE email IS NOT NULL"),
    runs: one("SELECT COUNT(*) n FROM research_runs"),
    errors: one("SELECT COUNT(*) n FROM research_errors"),
    emailsByStatus: db.prepare("SELECT verification_status k, COUNT(*) n FROM contacts WHERE email IS NOT NULL GROUP BY 1 ORDER BY 2 DESC").all() as { k: string; n: number }[],
    contactsByType: db.prepare("SELECT contact_type k, COUNT(*) n FROM contacts GROUP BY 1 ORDER BY 2 DESC").all() as { k: string; n: number }[],
    opportunitiesByCategory: db
      .prepare("SELECT sc.category k, COUNT(*) n FROM service_opportunities so JOIN service_catalog sc ON sc.code = so.service_code GROUP BY 1 ORDER BY 2 DESC")
      .all() as { k: string; n: number }[],
    leadsByCountry: db.prepare("SELECT COALESCE(country, 'Unverified / unknown') k, COUNT(*) n FROM authors GROUP BY 1 ORDER BY 2 DESC").all() as { k: string; n: number }[],
    leadsByPlatform: db
      .prepare("SELECT COALESCE(b.platform,'none') k, COUNT(DISTINCT b.author_id) n FROM books b GROUP BY 1 ORDER BY 2 DESC")
      .all() as { k: string; n: number }[],
    leadsByPriority: db.prepare("SELECT priority k, COUNT(*) n FROM v_latest_scores GROUP BY 1 ORDER BY 2 DESC").all() as { k: string; n: number }[],
    statusBreakdown: db.prepare("SELECT publication_status k, COUNT(*) n FROM books GROUP BY 1 ORDER BY 2 DESC").all() as { k: string; n: number }[],
    runFailures: db.prepare("SELECT status k, COUNT(*) n FROM run_candidates GROUP BY 1").all() as { k: string; n: number }[],
  };
}
