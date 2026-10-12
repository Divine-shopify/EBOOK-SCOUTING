import { Hono } from "hono";
import type { DB } from "../db/db.js";
import { getSetting, setSetting, nowIso } from "../db/db.js";
import { ResearchConfigSchema, env } from "../config.js";
import { layout, table, bars, esc, link, priorityPill } from "./html.js";
import * as Q from "../export/queries.js";
import { buildWorkbook, exportSets, toCsv } from "../export/exporter.js";
import { createRun, executeRun, setRunStatus } from "../agent/runner.js";
import { parseCandidates } from "../agent/candidate.js";
import { discoverCandidates } from "../agent/discovery.js";
import { buildSearchProviders } from "../adapters/search/providers.js";
import { Fetcher } from "../adapters/fetch/http.js";

const active = new Set<number>();

function launch(db: DB, runId: number) {
  if (active.has(runId)) return;
  active.add(runId);
  executeRun(db, runId)
    .catch((e) => {
      db.prepare("INSERT INTO research_errors(run_id, stage, message, occurred_at) VALUES (?,?,?,?)").run(runId, "runner", String(e?.message ?? e), nowIso());
      setRunStatus(db, runId, "failed");
    })
    .finally(() => active.delete(runId));
}

export function buildApp(db: DB) {
  const app = new Hono();

  app.get("/", (c) => {
    const o = Q.overview(db);
    const kpi = (n: number, l: string) => `<div class="card kpi"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
    const body = `<div class="grid">${kpi(o.authorsDiscovered, "Authors discovered")}${kpi(o.authorsResearched, "Authors researched")}${kpi(o.booksAnalyzed, "Books analyzed (listing inspected)")}${kpi(o.qualifiedLeads, "Qualified leads (60+)")}${kpi(o.highPriorityLeads, "High-priority leads (80+)")}${kpi(o.publicEmails, "Public professional emails")}${kpi(o.runs, "Research runs")}${kpi(o.errors, "Recorded research errors")}</div>
    <div class="cols" style="margin-top:12px">
      <div class="card"><h2>Emails by verification status</h2>${bars(o.emailsByStatus)}<p class="muted">Only provider_verified / delivery_confirmed count as verified.</p></div>
      <div class="card"><h2>Contacts by type</h2>${bars(o.contactsByType)}</div>
      <div class="card"><h2>Leads by priority</h2>${bars(o.leadsByPriority)}</div>
      <div class="card"><h2>Opportunities by service category</h2>${bars(o.opportunitiesByCategory)}</div>
      <div class="card"><h2>Leads by country (evidence-backed)</h2>${bars(o.leadsByCountry)}</div>
      <div class="card"><h2>Leads by platform</h2>${bars(o.leadsByPlatform)}</div>
      <div class="card"><h2>Publication status</h2>${bars(o.statusBreakdown)}</div>
      <div class="card"><h2>Run candidates</h2>${bars(o.runFailures)}</div>
    </div>`;
    return c.html(layout("Overview", body, "/"));
  });

  app.get("/leads", (c) => {
    const q = (c.req.query("q") ?? "").toLowerCase();
    const country = c.req.query("country") ?? "";
    const priority = c.req.query("priority") ?? "";
    const vstatus = c.req.query("vstatus") ?? "";
    const sort = c.req.query("sort") ?? "lead_score";
    let rows = Q.allLeads(db);
    if (q) rows = rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
    if (country) rows = rows.filter((r) => (r.country ?? "") === country);
    if (priority) rows = rows.filter((r) => r.priority === priority);
    if (vstatus) rows = rows.filter((r) => (r.email_verification_status ?? "none") === vstatus);
    const numeric = ["lead_score", "review_count", "rating"].includes(sort);
    rows.sort((a, b) => (numeric ? Number(b[sort] ?? -1) - Number(a[sort] ?? -1) : String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""))));
    const countries = (db.prepare("SELECT DISTINCT country FROM authors WHERE country IS NOT NULL ORDER BY 1").all() as { country: string }[]).map((r) => r.country);
    const opt = (vals: string[], cur: string) => `<option value="">All</option>` + vals.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
    const form = `<form class="f" method="get"><label>Search<input name="q" value="${esc(q)}"></label><label>Country<select name="country">${opt(countries, country)}</select></label>
      <label>Priority<select name="priority">${opt(["High priority", "Qualified", "Further research required", "Low priority"], priority)}</select></label>
      <label>Email status<select name="vstatus">${opt(["none", "publicly_listed", "syntax_valid", "domain_mx_checked", "provider_verified", "delivery_confirmed"], vstatus)}</select></label>
      <label>Sort<select name="sort">${["lead_score", "author", "country", "review_count", "rating", "publication_status", "platform"].map((s) => `<option ${s === sort ? "selected" : ""}>${s}</option>`).join("")}</select></label><button>Apply</button></form>`;
    return c.html(
      layout(
        `Lead explorer (${rows.length})`,
        form +
          table(rows, [
            { key: "author", label: "Author", render: (r) => `<a href="/authors/${r.author_id}">${esc(r.author)}</a>${r.pen_name ? ` <span class="muted">(${esc(r.pen_name)})</span>` : ""}` },
            { key: "book_title", label: "Book", render: (r) => (r.book_url ? link(r.book_url, String(r.book_title)) : esc(r.book_title)) },
            { key: "country", label: "Country" },
            { key: "platform", label: "Platform" },
            { key: "publication_status", label: "Status" },
            { key: "review_count", label: "Ratings" },
            { key: "top_opportunities", label: "Main opportunities" },
            { key: "lead_score", label: "Score", render: (r) => `<b>${esc(r.lead_score)}</b> ${priorityPill(r.priority)}` },
            { key: "best_email", label: "Public email", render: (r) => (r.best_email ? `${esc(r.best_email)}<br><span class="muted">${esc(r.best_email_type)}</span>` : `<span class="muted">—</span>`) },
            { key: "email_verification_status", label: "Email status" },
            { key: "contact_source_url", label: "Source", render: (r) => link(r.contact_source_url) },
          ]),
        "/leads",
      ),
    );
  });

  app.get("/authors/:id", (c) => {
    const id = Number(c.req.param("id"));
    const a = db.prepare("SELECT * FROM authors WHERE id = ?").get(id) as any;
    if (!a) return c.html(layout("Not found", "<p>No such author.</p>"), 404);
    const books = db.prepare("SELECT * FROM books WHERE author_id = ?").all(id) as any[];
    const score = db.prepare("SELECT * FROM v_latest_scores WHERE author_id = ?").get(id) as any;
    const opps = db.prepare("SELECT so.*, sc.name, sc.category FROM service_opportunities so JOIN service_catalog sc ON sc.code = so.service_code WHERE so.author_id = ? ORDER BY strength DESC").all(id) as any[];
    const contacts = db.prepare("SELECT * FROM contacts WHERE author_id = ?").all(id) as any[];
    const ev = db.prepare("SELECT * FROM evidence WHERE author_id = ? ORDER BY kind").all(id) as any[];
    const profiles = db.prepare("SELECT * FROM author_profiles WHERE author_id = ?").all(id) as any[];
    const errs = db.prepare("SELECT * FROM research_errors WHERE author_id = ?").all(id) as any[];
    const body = `<div class="cols"><div class="card"><h2>Identity</h2><p><b>${esc(a.name)}</b>${a.pen_name ? ` (pen name ${esc(a.pen_name)})` : ""}<br>Country: ${esc(a.country ?? "not verified")} ${a.country_evidence_url ? link(a.country_evidence_url, "[source]") : ""}<br>
      Language: ${esc(a.language)} · Genres: ${esc(a.genres)}<br>Website: ${link(a.website_url)}<br>Identity: ${esc(a.identity_status)} · Books identified: ${esc(a.book_count ?? "unknown")}</p>
      <h2>Profiles</h2>${profiles.map((p) => `${esc(p.platform)}: ${link(p.url)}`).join("<br>") || '<p class="muted">None</p>'}</div>
      <div class="card"><h2>Lead score ${score ? `${score.total}/100 ${priorityPill(score.priority)}` : ""}</h2><pre>${esc(score?.explanation ?? "Not scored")}</pre></div></div>
      <h2>Books</h2>${table(books, [
        { key: "title", label: "Title", render: (r) => link(r.url, r.title) },
        { key: "publication_status", label: "Status", render: (r) => `${esc(r.publication_status)} ${r.status_evidence_url ? link(r.status_evidence_url, "[evidence]") : ""}` },
        { key: "publication_date", label: "Date" },
        { key: "formats", label: "Formats" },
        { key: "review_count", label: "Ratings", render: (r) => `${esc(r.review_count ?? "—")} <span class="muted">${esc(r.rating ?? "")}</span>` },
        { key: "series", label: "Series" },
        { key: "description_length", label: "Desc. chars" },
        { key: "metadata_issues", label: "Observed issues" },
        { key: "inspection_scope", label: "Scope" },
      ])}
      <h2>Service opportunities</h2>${table(opps, [
        { key: "category", label: "Category" },
        { key: "name", label: "Service" },
        { key: "strength", label: "Strength" },
        { key: "rationale", label: "Why (observed)" },
        { key: "evidence_url", label: "Evidence", render: (r) => link(r.evidence_url) },
      ])}
      <h2>Public professional contacts</h2>${table(contacts, [
        { key: "email", label: "Email", render: (r) => esc(r.email ?? "— (no public email)") },
        { key: "contact_type", label: "Type" },
        { key: "verification_status", label: "Verification" },
        { key: "verification_method", label: "Method" },
        { key: "confidence", label: "Confidence" },
        { key: "source_url", label: "Source", render: (r) => link(r.source_url) },
        { key: "last_checked_at", label: "Checked" },
      ])}
      <h2>Evidence</h2>${table(ev, [
        { key: "kind", label: "Kind" },
        { key: "claim", label: "Claim" },
        { key: "excerpt", label: "Excerpt" },
        { key: "source_url", label: "Source", render: (r) => link(r.source_url) },
        { key: "observed_at", label: "Observed" },
      ])}
      <h2>Research errors / limitations</h2>${table(errs, [{ key: "stage", label: "Stage" }, { key: "url", label: "URL", render: (r) => link(r.url) }, { key: "message", label: "Message" }])}
      <form method="post" action="/optout" class="f" style="margin-top:16px"><input type="hidden" name="author_id" value="${id}"><input name="reason" placeholder="Opt-out reason"><button>Record opt-out & hide</button></form>`;
    return c.html(layout(a.name, body, "/leads"));
  });

  app.get("/books", (c) =>
    c.html(
      layout(
        "Book analysis",
        table(Q.bookAnalysis(db), [
          { key: "author", label: "Author" },
          { key: "title", label: "Title", render: (r) => link(r.url, String(r.title)) },
          { key: "platform", label: "Platform" },
          { key: "publication_status", label: "Status", render: (r) => `${esc(r.publication_status)} ${r.status_evidence_url ? link(r.status_evidence_url, "[ev]") : ""}` },
          { key: "publication_date", label: "Date" },
          { key: "review_count", label: "Ratings" },
          { key: "rating", label: "Avg" },
          { key: "series", label: "Series" },
          { key: "formats", label: "Formats" },
          { key: "metadata_issues", label: "Metadata issues" },
          { key: "distribution_opportunities", label: "Distribution" },
          { key: "inspection_scope", label: "Scope" },
        ]),
        "/books",
      ),
    ),
  );

  app.get("/contacts", (c) => {
    const rows = Q.contacts(db);
    const cols = [
      { key: "author", label: "Author", render: (r: any) => `<a href="/authors/${r.author_id}">${esc(r.author)}</a>` },
      { key: "email", label: "Email", render: (r: any) => esc(r.email ?? "—") },
      { key: "contact_type", label: "Type" },
      { key: "verification_status", label: "Status" },
      { key: "verification_method", label: "Method" },
      { key: "confidence", label: "Confidence" },
      { key: "source_url", label: "Source", render: (r: any) => link(r.source_url) },
      { key: "last_checked_at", label: "Checked" },
    ];
    const verified = rows.filter((r) => r.email && ["provider_verified", "delivery_confirmed"].includes(String(r.verification_status)));
    const unverified = rows.filter((r) => r.email && !["provider_verified", "delivery_confirmed", "invalid"].includes(String(r.verification_status)));
    const invalid = rows.filter((r) => r.verification_status === "invalid");
    const pages = rows.filter((r) => !r.email);
    return c.html(
      layout(
        "Contact database",
        `<p class="muted">Publicly listed professional addresses only. Nothing is guessed, probed or emailed. "domain_mx_checked" means the domain accepts mail in general — not that this mailbox exists.</p>
        <h2>Verified (provider / confirmed) — ${verified.length}</h2>${table(verified, cols)}
        <h2>Publicly listed, not provider-verified — ${unverified.length}</h2>${table(unverified, cols)}
        <h2>Invalid — ${invalid.length}</h2>${table(invalid, cols)}
        <h2>Contact pages without a public email — ${pages.length}</h2>${table(pages, cols)}`,
        "/contacts",
      ),
    );
  });

  app.get("/runs", (c) => {
    const rows = Q.runs(db);
    const form = `<div class="card"><h2>New run</h2><form method="post" action="/runs" enctype="multipart/form-data" class="f">
      <label>Name<input name="name" value="Batch ${new Date().toISOString().slice(0, 10)}"></label>
      <label>Mode<select name="mode"><option value="discover">Discover via configured search providers</option><option value="seed">Seed file (JSON candidates)</option></select></label>
      <label>Seed JSON<input type="file" name="seed" accept="application/json"></label><button>Create & start</button></form>
      <p class="muted">Uses the saved research controls. Seed candidates are re-fetched and verified by the pipeline; nothing in a seed is trusted as-is.</p></div>`;
    return c.html(
      layout(
        "Research runs",
        form +
          table(rows, [
            { key: "id", label: "#" },
            { key: "name", label: "Name", render: (r) => `<a href="/runs/${r.id}">${esc(r.name)}</a>` },
            { key: "status", label: "Status" },
            { key: "candidates_total", label: "Candidates" },
            { key: "candidates_done", label: "Saved" },
            { key: "candidates_skipped", label: "Skipped" },
            { key: "candidates_failed", label: "Failed" },
            { key: "api_calls", label: "HTTP calls" },
            { key: "api_cost_usd", label: "API $" },
            { key: "started_at", label: "Started" },
            { key: "finished_at", label: "Finished" },
            {
              key: "x",
              label: "Control",
              render: (r) =>
                ["start", "pause", "resume", "cancel"]
                  .map((a) => `<form method="post" action="/runs/${r.id}/${a}" style="display:inline"><button style="padding:2px 6px;font-size:12px">${a}</button></form>`)
                  .join(" "),
            },
          ]),
        "/runs",
      ),
    );
  });

  app.get("/runs/:id", (c) => {
    const id = Number(c.req.param("id"));
    const run = db.prepare("SELECT * FROM research_runs WHERE id = ?").get(id) as any;
    if (!run) return c.html(layout("Not found", ""), 404);
    return c.html(
      layout(
        `Run #${id}: ${run.name}`,
        `<p>Status <b>${esc(run.status)}</b> · ${run.candidates_done}/${run.candidates_total} saved · ${run.candidates_skipped} skipped · ${run.candidates_failed} failed</p><pre>${esc(run.notes ?? "")}</pre>` +
          table(Q.runCandidates(db, id), [
            { key: "candidate_key", label: "Candidate" },
            { key: "status", label: "Status" },
            { key: "message", label: "Outcome" },
            { key: "author_id", label: "Author", render: (r) => (r.author_id ? `<a href="/authors/${r.author_id}">#${r.author_id}</a>` : "") },
          ]),
        "/runs",
      ),
    );
  });

  app.post("/runs", async (c) => {
    const form = await c.req.parseBody();
    const config = ResearchConfigSchema.parse(getSetting(db, "research_config", {}));
    const name = String(form.name ?? "Batch");
    if (form.mode === "seed") {
      const f = form.seed as File | undefined;
      if (!f || typeof f === "string") return c.text("Seed file required", 400);
      const { ok, rejected } = parseCandidates(JSON.parse(await f.text()));
      const runId = createRun(db, name, config, ok);
      if (rejected.length) db.prepare("UPDATE research_runs SET notes = ? WHERE id = ?").run(`Rejected ${rejected.length} malformed seed entries.`, runId);
      launch(db, runId);
      return c.redirect(`/runs/${runId}`);
    }
    const e = env();
    const fetcher = new Fetcher(db, { userAgent: e.USER_AGENT, requestsPerSecondPerHost: config.requestsPerSecondPerHost });
    const providers = buildSearchProviders(fetcher, { brave: e.BRAVE_SEARCH_API_KEY, tavily: e.TAVILY_API_KEY, serpapi: e.SERPAPI_API_KEY, googleBooks: e.GOOGLE_BOOKS_API_KEY });
    const { candidates, queries, resultUrls } = await discoverCandidates(db, null, config, providers, fetcher, console.log);
    const runId = createRun(db, name, config, candidates);
    db.prepare("UPDATE research_runs SET notes = ? WHERE id = ?").run(`Discovery: ${queries} queries, ${resultUrls} result URLs, ${candidates.length} candidates.`, runId);
    launch(db, runId);
    return c.redirect(`/runs/${runId}`);
  });

  app.post("/runs/:id/:action", (c) => {
    const id = Number(c.req.param("id"));
    const action = c.req.param("action");
    if (action === "pause") setRunStatus(db, id, "paused");
    else if (action === "cancel") setRunStatus(db, id, "cancelled");
    else if (action === "resume" || action === "start") {
      const st = (db.prepare("SELECT status FROM research_runs WHERE id = ?").get(id) as any)?.status;
      if (st && !["completed", "cancelled"].includes(st)) {
        db.prepare("UPDATE research_runs SET status = 'pending' WHERE id = ?").run(id);
        launch(db, id);
      }
    }
    return c.redirect("/runs");
  });

  app.get("/settings", (c) => {
    const cfg = ResearchConfigSchema.parse(getSetting(db, "research_config", {}));
    const e = env();
    const creds = [
      ["ANTHROPIC_API_KEY", !!e.ANTHROPIC_API_KEY],
      ["BRAVE_SEARCH_API_KEY", !!e.BRAVE_SEARCH_API_KEY],
      ["TAVILY_API_KEY", !!e.TAVILY_API_KEY],
      ["SERPAPI_API_KEY", !!e.SERPAPI_API_KEY],
      ["GOOGLE_BOOKS_API_KEY", !!e.GOOGLE_BOOKS_API_KEY],
      ["ZEROBOUNCE_API_KEY", !!e.ZEROBOUNCE_API_KEY],
      ["NEVERBOUNCE_API_KEY", !!e.NEVERBOUNCE_API_KEY],
    ];
    const f = (k: string, v: unknown, hint = "") => `<label>${esc(k)}${hint ? ` <span>${esc(hint)}</span>` : ""}<input name="${esc(k)}" value="${esc(Array.isArray(v) ? v.join(", ") : v)}" size="${Array.isArray(v) ? 60 : 12}"></label>`;
    const body = `<form method="post" class="f" style="flex-direction:column;align-items:stretch;max-width:900px">
      ${f("countries", cfg.countries)}${f("languages", cfg.languages)}${f("platforms", cfg.platforms, "empty = all permitted")}${f("genres", cfg.genres)}${f("authorTypes", cfg.authorTypes)}${f("serviceCategories", cfg.serviceCategories, "A–K")}
      <div class="f">${f("batchSize", cfg.batchSize)}${f("minLeadScore", cfg.minLeadScore)}${f("maxReviewCount", cfg.maxReviewCount, "inclusive")}${f("searchLimitPerQuery", cfg.searchLimitPerQuery)}${f("maxSearchQueries", cfg.maxSearchQueries)}${f("requestsPerSecondPerHost", cfg.requestsPerSecondPerHost)}${f("maxApiSpendUsd", cfg.maxApiSpendUsd)}</div>
      <div class="f"><label>researchDepth<select name="researchDepth">${["shallow", "standard", "deep"].map((d) => `<option ${d === cfg.researchDepth ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label>emailDiscovery<select name="emailDiscovery"><option ${cfg.emailDiscovery ? "selected" : ""}>true</option><option ${!cfg.emailDiscovery ? "selected" : ""}>false</option></select></label>
      <label>verificationProvider<select name="verificationProvider">${["none", "zerobounce", "neverbounce"].map((d) => `<option ${d === cfg.verificationProvider ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label>useBrowser<select name="useBrowser"><option ${cfg.useBrowser ? "selected" : ""}>true</option><option ${!cfg.useBrowser ? "selected" : ""}>false</option></select></label></div>
      <button style="align-self:start">Save</button></form>
      <h2>Credentials (from environment)</h2>${table(creds.map(([k, v]) => ({ k, v: v ? "configured" : "missing" })), [{ key: "k", label: "Variable" }, { key: "v", label: "State" }])}
      <h2>Sources and access limits</h2>${table(db.prepare("SELECT key, name, access_mode, limitation FROM discovery_sources ORDER BY access_mode, name").all() as any[], [
        { key: "name", label: "Source" },
        { key: "access_mode", label: "Access" },
        { key: "limitation", label: "Limitation" },
      ])}`;
    return c.html(layout("Research controls", body, "/settings"));
  });

  app.post("/settings", async (c) => {
    const form = await c.req.parseBody();
    const list = (v: unknown) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const cfg = ResearchConfigSchema.parse({
      countries: list(form.countries),
      languages: list(form.languages),
      platforms: list(form.platforms),
      genres: list(form.genres),
      authorTypes: list(form.authorTypes),
      serviceCategories: list(form.serviceCategories),
      batchSize: Number(form.batchSize),
      minLeadScore: Number(form.minLeadScore),
      maxReviewCount: Number(form.maxReviewCount),
      searchLimitPerQuery: Number(form.searchLimitPerQuery),
      maxSearchQueries: Number(form.maxSearchQueries),
      requestsPerSecondPerHost: Number(form.requestsPerSecondPerHost),
      maxApiSpendUsd: Number(form.maxApiSpendUsd),
      researchDepth: form.researchDepth,
      emailDiscovery: form.emailDiscovery === "true",
      verificationProvider: form.verificationProvider,
      useBrowser: form.useBrowser === "true",
    });
    setSetting(db, "research_config", cfg);
    return c.redirect("/settings");
  });

  app.get("/exports", (c) => {
    const sets = exportSets(db);
    const body = `<p><a href="/exports/workbook.xlsx"><button>Download Excel workbook (all sheets)</button></a></p>` +
      table(sets.map((s) => ({ name: s.name, n: s.rows.length })), [
        { key: "name", label: "Dataset" },
        { key: "n", label: "Rows" },
        { key: "csv", label: "CSV", render: (r) => `<a href="/exports/${esc(r.name)}.csv">download</a>` },
      ]) + `<p class="muted">Unverified contacts are exported separately from verified ones.</p>`;
    return c.html(layout("Export center", body, "/exports"));
  });
  app.get("/exports/workbook.xlsx", async (c) => {
    const buf = await (await buildWorkbook(db)).xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="authorscout_research.xlsx"' },
    });
  });
  app.get("/exports/:name{[a-z_]+\\.csv}", (c) => {
    const name = c.req.param("name").replace(/\.csv$/, "");
    const set = exportSets(db).find((s) => s.name === name);
    if (!set) return c.text("Unknown dataset", 404);
    return new Response(toCsv(set.rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` } });
  });

  app.get("/errors", (c) =>
    c.html(
      layout(
        "Research errors & limitations",
        table(Q.researchErrors(db).reverse(), [
          { key: "run_id", label: "Run" },
          { key: "author", label: "Author" },
          { key: "stage", label: "Stage" },
          { key: "source", label: "Source" },
          { key: "url", label: "URL", render: (r) => link(r.url) },
          { key: "message", label: "Message" },
          { key: "occurred_at", label: "When" },
        ]),
        "/errors",
      ),
    ),
  );

  app.post("/optout", async (c) => {
    const form = await c.req.parseBody();
    const id = Number(form.author_id);
    const a = db.prepare("SELECT name, website_domain FROM authors WHERE id = ?").get(id) as any;
    if (a) {
      db.prepare("INSERT INTO opt_outs(author_name, domain, reason, created_at) VALUES (?,?,?,?)").run(a.name, a.website_domain, String(form.reason ?? ""), nowIso());
      db.prepare("UPDATE authors SET opted_out = 1 WHERE id = ?").run(id);
    }
    return c.redirect("/leads");
  });

  return app;
}
