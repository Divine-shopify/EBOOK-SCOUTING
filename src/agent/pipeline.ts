import type { DB } from "../db/db.js";
import { nowIso, tx } from "../db/db.js";
import type { ResearchConfig } from "../config.js";
import { Fetcher, FetchBlockedError } from "../adapters/fetch/http.js";
import { renderWithBrowser } from "../adapters/fetch/browser.js";
import { platformOf, SEED_ONLY } from "../adapters/sources.js";
import { extractPage, extractGoodreadsExtras, contactPageCandidates, type PageInfo, type FoundEmail } from "../analysis/extract.js";
import { classifyStatus, type PublicationStatus } from "../analysis/status.js";
import { detectOpportunities, isLargePublisher } from "../analysis/opportunities.js";
import { scoreLead, type ScoreBreakdown } from "../analysis/scoring.js";
import { classifyEmail, type ContactType } from "../email/classify.js";
import { verifyEmail, type VerificationProvider, type MxLookup } from "../email/verify.js";
import type { Analyzer } from "../adapters/ai/analyzer.js";
import { canonicalCountry, pageSupportsCountry } from "./country.js";
import type { Candidate } from "./candidate.js";
import { normalizeKey, domainOf, truncate, cleanText } from "../util/text.js";

export interface PipelineContext {
  db: DB;
  fetcher: Fetcher;
  runId: number | null;
  config: ResearchConfig;
  analyzer: Analyzer;
  verifier: VerificationProvider | null;
  mxLookup?: MxLookup;
  log: (msg: string) => void;
  today?: Date;
}

export type CandidateOutcome =
  | { kind: "saved"; authorId: number; score: ScoreBreakdown; status: PublicationStatus; emails: number; deduplicatedInto: boolean }
  | { kind: "skipped"; reason: string; authorId?: number }
  | { kind: "failed"; reason: string };

interface Fetched {
  url: string;
  platform: string;
  info: PageInfo;
  html: string;
}

const SEEKING_RE = /[^.!?\n]{0,120}\b(looking for|seeking|in search of|need(ing)?|hiring|searching for|suche|cherche|busco|cerco|zoek)\b[^.!?\n]{0,40}\b(an? )?(editor|proofreader|cover (designer|artist)|illustrator|formatter|publisher|publishing (help|support|partner)|marketing (help|support)|book marketer|lektor|korrektor|coverdesigner|éditeur|correcteur|editorial)\b[^.!?\n]{0,80}[.!?]?/i;
const CROWDFUND_RE = /kickstarter\.com|kicktraq\.com|indiegogo\.com|unbound\.com|ulule\.com|startnext\.com|gofundme\.com/i;

function recordError(ctx: PipelineContext, stage: string, message: string, url?: string | null, authorId?: number | null) {
  ctx.db
    .prepare("INSERT INTO research_errors(run_id, author_id, stage, source, url, message, occurred_at) VALUES (?,?,?,?,?,?,?)")
    .run(ctx.runId, authorId ?? null, stage, url ? platformOf(url) : null, url ?? null, truncate(message, 1000), nowIso());
}

async function fetchPage(ctx: PipelineContext, url: string, stage: string, errors: { stage: string; url: string; message: string }[]): Promise<Fetched | null> {
  const platform = platformOf(url);
  if (SEED_ONLY.has(platform)) {
    errors.push({ stage, url, message: `Not fetched: ${platform} is reference-only (automated access restricted by terms or bot protection).` });
    return null;
  }
  try {
    const r = await ctx.fetcher.get(url);
    if (r.status !== 200) {
      errors.push({ stage, url, message: `HTTP ${r.status}` });
      return null;
    }
    let html = r.body;
    let info = extractPage(html, r.finalUrl);
    // JS-rendered author sites: optional headless browser pass.
    if (ctx.config.useBrowser && info.text.length < 400 && platform === "author_site") {
      try {
        const b = await renderWithBrowser(r.finalUrl);
        html = b.html;
        info = extractPage(html, b.finalUrl);
      } catch (e: any) {
        errors.push({ stage, url, message: `Browser render failed: ${e?.message}` });
      }
    }
    if (info.text.length < 80 && !info.book) {
      errors.push({ stage, url, message: "Page returned almost no readable content (likely JS-rendered or bot-challenged)." });
    }
    return { url: r.finalUrl, platform, info, html };
  } catch (e: any) {
    const msg = e instanceof FetchBlockedError ? `Blocked (${e.reason}): ${e.message}` : `Fetch failed: ${e?.message ?? e}`;
    errors.push({ stage, url, message: msg });
    return null;
  }
}

function nameMatches(haystack: string, name: string): boolean {
  const h = ` ${normalizeKey(haystack)} `;
  const n = normalizeKey(name);
  if (!n) return false;
  if (h.includes(` ${n} `)) return true;
  // tolerate initials: "J. P. Alters" vs "J.P. Alters"
  const compact = n.replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");
  return h.replace(/\b([a-z]) (?=[a-z]\b)/g, "$1").includes(` ${compact} `);
}

function monthsBetween(dateStr: string | null | undefined, today: Date): number | null {
  if (!dateStr) return null;
  let t = Date.parse(dateStr);
  if (!Number.isFinite(t)) {
    const y = dateStr.match(/(19|20)\d{2}/)?.[0];
    if (!y) return null;
    t = Date.parse(`${y}-07-01`);
  }
  return Math.round((today.getTime() - t) / (30.44 * 86400_000));
}

function goodreadsPubDate(line?: string): string | null {
  if (!line) return null;
  const m = line.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/);
  if (m) {
    const d = new Date(m[0] + " UTC");
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return line.match(/(19|20)\d{2}/)?.[0] ?? null;
}

/** Researches one candidate end-to-end and persists all findings in a single transaction. */
export async function researchCandidate(ctx: PipelineContext, c: Candidate): Promise<CandidateOutcome> {
  const today = ctx.today ?? new Date();
  const errors: { stage: string; url: string; message: string }[] = [];
  const displayName = cleanText(c.penName || c.authorName);
  const authorKey = normalizeKey(displayName);
  const siteDomain = domainOf(c.websiteUrl);

  // Opt-out registry is honoured before any fetching.
  const optOut = ctx.db
    .prepare("SELECT id FROM opt_outs WHERE (author_name IS NOT NULL AND lower(author_name) = lower(?)) OR (domain IS NOT NULL AND domain = ?)")
    .get(displayName, siteDomain ?? "__none__");
  if (optOut) return { kind: "skipped", reason: "Author/domain is on the opt-out list." };

  // ---- 1. Book pages
  const bookUrls = [...new Set([c.goodreadsUrl, ...(c.bookUrls ?? [])].filter(Boolean) as string[])];
  const bookPages: Fetched[] = [];
  for (const u of bookUrls.slice(0, ctx.config.researchDepth === "shallow" ? 2 : 5)) {
    const p = await fetchPage(ctx, u, "book_page", errors);
    if (p) bookPages.push(p);
  }
  const gr = bookPages.find((p) => p.platform === "goodreads");
  const grExtras = gr ? extractGoodreadsExtras(gr.html) : null;
  const ldPage = bookPages.find((p) => p.info.book && (nameMatches(p.info.book.authors.join(" "), c.authorName) || (c.penName && nameMatches(p.info.book.authors.join(" "), c.penName))) ) ?? bookPages.find((p) => p.info.book);
  const ld = ldPage?.info.book ?? null;
  const bookPageVerified = bookPages.some(
    (p) => nameMatches(p.info.text + " " + (p.info.book?.authors.join(" ") ?? ""), c.authorName) || (c.penName ? nameMatches(p.info.text, c.penName) : false),
  );

  const ratingCount = ld?.ratingCount ?? null;
  const reviewCount = ld?.reviewCount ?? null;
  const observedCounts = [ratingCount, reviewCount].filter((n): n is number => n != null);
  let countForFilter: number | null = observedCounts.length ? Math.max(...observedCounts) : null;
  let countSource = countForFilter != null ? `${ldPage?.platform} (${ratingCount ?? "?"} ratings / ${reviewCount ?? "?"} reviews) ${ldPage?.url}` : null;
  if (countForFilter == null && c.reviewCountObserved != null) {
    countForFilter = c.reviewCountObserved;
    countSource = `seed observation: ${c.reviewCountSource ?? "unspecified source"} (not re-fetched)`;
  }
  if (countForFilter != null && countForFilter > ctx.config.maxReviewCount) {
    return { kind: "skipped", reason: `Book has ${countForFilter} ratings/reviews (> ${ctx.config.maxReviewCount}) per ${countSource}.` };
  }

  // ---- 2. Goodreads author page (allowed by robots) for website + work count
  let grAuthorUrl: string | null = null;
  let bookCount: number | null = null;
  let websiteUrl = c.websiteUrl ?? null;
  if (gr) {
    const authorLink = gr.info.links.find((l) => /goodreads\.com\/author\/show\//.test(l.href));
    if (authorLink) {
      grAuthorUrl = authorLink.href.split("?")[0];
      if (ctx.config.researchDepth !== "shallow") {
        const ap = await fetchPage(ctx, grAuthorUrl, "author_profile", errors);
        if (ap) {
          const works = ap.info.text.match(/([\d,]+)\s+distinct works/i);
          if (works) bookCount = Number(works[1].replace(/,/g, ""));
          if (!websiteUrl) {
            const w = ap.html.match(/<div class="dataTitle">\s*Website\s*<\/div>\s*<div class="dataItem">\s*<a[^>]*href="([^"]+)"/i);
            if (w && /^https?:\/\//.test(w[1])) websiteUrl = w[1];
          }
        }
      }
    }
  }

  // ---- 3. Author website + contact/about/press pages
  const sitePages: Fetched[] = [];
  const domain = domainOf(websiteUrl);
  if (websiteUrl) {
    const home = await fetchPage(ctx, websiteUrl, "author_website", errors);
    if (home) {
      sitePages.push(home);
      const maxPages = ctx.config.researchDepth === "shallow" ? 2 : ctx.config.researchDepth === "deep" ? 10 : 5;
      const extra = [c.contactPageUrl, ...contactPageCandidates(home.info, domainOf(home.url) ?? domain ?? "")].filter(Boolean) as string[];
      for (const u of [...new Set(extra)].filter((u) => u !== home.url).slice(0, maxPages)) {
        const p = await fetchPage(ctx, u, "author_website", errors);
        if (p) sitePages.push(p);
      }
    }
  } else if (c.contactPageUrl) {
    const p = await fetchPage(ctx, c.contactPageUrl, "author_website", errors);
    if (p) sitePages.push(p);
  }
  const siteText = sitePages.map((p) => p.info.text).join(" ");
  const websiteFetched = sitePages.length > 0;
  const titleOnSite = websiteFetched && normalizeKey(siteText).includes(normalizeKey(c.bookTitle).slice(0, 40));
  const nameOnSite = websiteFetched && (nameMatches(siteText, c.authorName) || (c.penName ? nameMatches(siteText, c.penName) : false));

  // ---- 4. Status evidence + country evidence pages
  let statusEvidenceText: string | null = null;
  const fetchedByUrl = new Map([...bookPages, ...sitePages].map((p) => [p.url, p]));
  if (c.statusEvidenceUrl) {
    const p = fetchedByUrl.get(c.statusEvidenceUrl) ?? (await fetchPage(ctx, c.statusEvidenceUrl, "status_evidence", errors));
    if (p) {
      statusEvidenceText = p.info.text;
      fetchedByUrl.set(p.url, p);
    }
  }
  let country: string | null = null;
  let countryEvidenceUrl: string | null = null;
  const claimed = canonicalCountry(c.countryClaim);
  if (claimed) {
    const candidates = [c.countryEvidenceUrl, ...sitePages.map((p) => p.url)].filter(Boolean) as string[];
    for (const u of [...new Set(candidates)]) {
      const p = fetchedByUrl.get(u) ?? (u === c.countryEvidenceUrl ? await fetchPage(ctx, u, "country_evidence", errors) : null);
      if (p && pageSupportsCountry(p.info.text, claimed)) {
        country = claimed;
        countryEvidenceUrl = p.url;
        break;
      }
    }
    if (!country) errors.push({ stage: "country_evidence", url: c.countryEvidenceUrl ?? "", message: `Country claim '${claimed}' not confirmed on any fetched page; country left blank.` });
  }

  // ---- 5. Signals
  const allText = [statusEvidenceText ?? "", siteText, ...bookPages.map((p) => p.info.text)].join(" \n ");
  let explicitSeeking = allText.match(SEEKING_RE)?.[0]?.trim() ?? null;
  if (explicitSeeking && /\b(we|our clients|our authors|services|we offer)\b/i.test(explicitSeeking)) explicitSeeking = null; // vendor copy, not the author
  const crowdfunding = [...bookUrls, c.statusEvidenceUrl ?? ""].some((u) => CROWDFUND_RE.test(u));
  const retailerLinks = [...new Set([...sitePages.flatMap((p) => p.info.retailerLinks), ...bookUrls])];
  const retailerPlatforms = [...new Set(retailerLinks.map(platformOf))];
  const newsletterSignals = [...new Set(sitePages.flatMap((p) => p.info.newsletterSignals))];
  const storeSignals = [...new Set(sitePages.flatMap((p) => p.info.storeSignals))];
  const socialLinks = [...new Set(sitePages.flatMap((p) => p.info.socialLinks))];
  const copyrightYear = sitePages[0]?.info.copyrightYear ?? null;

  const formats: string[] = [];
  if (ld?.bookFormat) formats.push(String(ld.bookFormat).replace(/^https?:\/\/schema\.org\//, ""));
  if (grExtras?.formatsLine) formats.push(grExtras.formatsLine);
  if (retailerPlatforms.some((p) => ["amazon", "kobo", "apple_books", "smashwords", "draft2digital"].includes(p)) && /kindle|ebook/i.test(allText)) formats.push("ebook (retailer/site mention)");

  // If the inspected edition shows no ebook format, check the full editions list (robots-allowed on Goodreads).
  let ebookEditionFound: boolean | null = null;
  if (gr && !formats.some((f) => /kindle|ebook|e-book|epub|nook|kobo/i.test(f))) {
    const ed = gr.info.links.find((l) => /goodreads\.com\/work\/editions\//.test(l.href));
    if (ed) {
      const ep = await fetchPage(ctx, ed.href.split("?")[0], "editions", errors);
      if (ep) {
        ebookEditionFound = /kindle edition|\bebook\b|e-book|nook|kobo/i.test(ep.info.text);
        if (ebookEditionFound) formats.push("ebook (editions list)");
        fetchedByUrl.set(ep.url, ep);
      }
    }
  }

  const publicationDate = goodreadsPubDate(grExtras?.publicationLine) ?? ld?.datePublished ?? c.publicationDate ?? null;
  const platforms = [...new Set([...bookUrls.map(platformOf), ...(c.discoveryPlatform ? [c.discoveryPlatform.toLowerCase()] : [])])];

  // Optional AI pass (spend-limited by the runner)
  let aiNotes: string[] = [];
  if (ctx.analyzer.enabled) {
    try {
      const { findings, costUsd } = await ctx.analyzer.analyze({
        authorName: displayName,
        bookTitle: c.bookTitle,
        pages: [...fetchedByUrl.values()].map((p) => ({ url: p.url, text: p.info.text })),
      });
      ctx.db.prepare("INSERT INTO api_usage(run_id, provider, operation, units, cost_usd, at) VALUES (?,?,?,?,?,?)").run(ctx.runId, "anthropic", "analyze", 1, costUsd, nowIso());
      if (findings) {
        aiNotes = findings.observations;
        // Only accept a seeking quote that literally appears in the fetched text.
        if (!explicitSeeking && findings.explicitSeekingQuote && allText.includes(findings.explicitSeekingQuote.slice(0, 60))) explicitSeeking = findings.explicitSeekingQuote;
      }
    } catch (e: any) {
      errors.push({ stage: "ai_analysis", url: "", message: e?.message ?? String(e) });
    }
  }

  const { status, reason: statusReason } = classifyStatus({
    hint: c.statusHint === "other_formats" ? "other_formats_only" : c.statusHint,
    evidenceText: statusEvidenceText,
    goodreadsExpected: grExtras?.expected,
    ebookEditionFound,
    datePublished: publicationDate,
    formats,
    platforms,
    today,
  });

  const description = ld?.description ?? (ldPage ? ldPage.info.metaDescription : null) ?? null;
  const publisher = ld?.publisher ?? null;
  const publisherIsLarge = isLargePublisher(publisher) || isLargePublisher(grExtras?.publicationLine);
  const selfPublished = publisherIsLarge ? false : /self[- ]published|independently published|indie author|selfpublisher|autoédit|autopublic/i.test(allText) ? true : null;
  const language = ld?.inLanguage ?? c.language ?? null;
  const series = grExtras?.series ?? null;

  const opportunities = detectOpportunities(
    {
      status,
      reviewCount: countForFilter,
      rating: ld?.ratingValue ?? c.ratingObserved ?? null,
      descriptionLength: description ? description.length : null,
      hasWebsite: !!websiteUrl,
      websiteFetched,
      websiteUrl: sitePages[0]?.url ?? websiteUrl,
      websiteHttps: sitePages[0]?.info.https ?? true,
      websiteCopyrightYear: copyrightYear,
      newsletterSignals,
      storeSignals,
      retailerPlatforms,
      socialLinkCount: socialLinks.length,
      bookLanguage: language,
      series,
      formats,
      bookCount,
      explicitSeeking,
      crowdfunding,
      bookUrl: ldPage?.url ?? bookPages[0]?.url ?? bookUrls[0] ?? null,
      statusEvidenceUrl: c.statusEvidenceUrl ?? null,
      publisherIsLarge,
      currentYear: today.getFullYear(),
    },
    ctx.config.serviceCategories,
  );

  // ---- 6. Emails (only from fetched, attributable pages; never guessed)
  const emailFinds: { found: FoundEmail; page: Fetched }[] = [];
  if (ctx.config.emailDiscovery) {
    for (const p of [...sitePages, ...[...fetchedByUrl.values()].filter((x) => !sitePages.includes(x) && x.platform === "author_site")]) {
      for (const f of p.info.emails) emailFinds.push({ found: f, page: p });
    }
  }
  const contactRows: { email: string; type: ContactType; confidence: "high" | "medium" | "low"; note: string; page: Fetched; method: string }[] = [];
  for (const { found, page } of emailFinds) {
    const cls = classifyEmail(found, domain, page.url);
    if (cls.type === "unknown" && cls.confidence === "low") continue; // unattributable third-party addresses are not stored
    contactRows.push({ email: found.email, type: cls.type, confidence: cls.confidence, note: `${cls.note} Found via ${found.method}.`, page, method: found.method });
  }
  {
    const best = new Map<string, (typeof contactRows)[number]>();
    const pageRank = (u: string) => (/contact|kontakt|impressum|press|media/i.test(u) ? 0 : /about|bio/i.test(u) ? 1 : 2);
    for (const r of contactRows) {
      const cur = best.get(r.email);
      if (!cur || pageRank(r.page.url) < pageRank(cur.page.url)) best.set(r.email, r);
    }
    contactRows.splice(0, contactRows.length, ...best.values());
  }
  const verified = new Map<string, Awaited<ReturnType<typeof verifyEmail>>>();
  for (const r of contactRows) {
    if (!verified.has(r.email)) verified.set(r.email, await verifyEmail(r.email, { provider: ctx.verifier, mxLookup: ctx.mxLookup }));
  }
  const contactPage = sitePages.find((p) => /contact|kontakt|impressum|contatti|contacto/i.test(p.url));
  const typeRank: ContactType[] = ["author_business", "author_direct", "general_inquiry", "agent", "publicist", "publisher"];
  const bestContactType = contactRows.map((r) => r.type).sort((a, b) => typeRank.indexOf(a) - typeRank.indexOf(b))[0] ?? null;

  const identity: "verified" | "partially_verified" | "unverified" =
    websiteFetched && nameOnSite && (titleOnSite || bookPageVerified) ? "verified" : bookPageVerified || nameOnSite ? "partially_verified" : "unverified";

  const score = scoreLead({
    opportunities,
    status,
    explicitSeeking,
    crowdfunding,
    selfPublished,
    publisherIsLarge,
    bookCount,
    hasSeries: !!series,
    monthsSinceRelease: status === "published_ebook" || status === "other_formats_only" ? monthsBetween(publicationDate, today) : null,
    identity,
    bestContactType,
    hasContactPage: !!contactPage || !!c.contactPageUrl,
  });

  if (identity === "unverified" && bookPages.length === 0 && sitePages.length === 0) {
    for (const e of errors) recordError(ctx, e.stage, e.message, e.url || null, null);
    return { kind: "failed", reason: "No source page could be fetched to verify the author; nothing stored as a lead." };
  }

  // ---- 7. Persist (dedupe on name key, then website domain)
  const ts = nowIso();
  const result = tx(ctx.db, () => {
    const existing = (ctx.db.prepare("SELECT id FROM authors WHERE dedupe_key = ?").get(authorKey) ??
      (domain ? ctx.db.prepare("SELECT id FROM authors WHERE website_domain = ?").get(domain) : undefined)) as { id: number } | undefined;
    let authorId: number;
    const genres = [...new Set([...(c.genres ?? []), ...(grExtras?.genres ?? [])])].slice(0, 8).join(", ") || null;
    if (existing) {
      authorId = existing.id;
      ctx.db
        .prepare(
          `UPDATE authors SET pen_name = COALESCE(?, pen_name), country = COALESCE(?, country), country_evidence_url = COALESCE(?, country_evidence_url),
           language = COALESCE(?, language), genres = COALESCE(?, genres), website_url = COALESCE(?, website_url), website_domain = COALESCE(?, website_domain),
           book_count = COALESCE(?, book_count), identity_status = ?, research_status = 'researched', last_run_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(c.penName ?? null, country, countryEvidenceUrl, language, genres, websiteUrl, domain, bookCount, identity, ctx.runId, ts, authorId);
    } else {
      const r = ctx.db
        .prepare(
          `INSERT INTO authors(dedupe_key, name, pen_name, country, country_evidence_url, language, genres, website_url, website_domain, book_count,
           upcoming_releases, identity_status, research_status, first_seen_run_id, last_run_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'researched',?,?,?,?)`,
        )
        .run(authorKey, cleanText(c.authorName), c.penName ?? null, country, countryEvidenceUrl, language, genres, websiteUrl, domain, bookCount,
          status === "forthcoming" ? c.bookTitle : null, identity, ctx.runId, ctx.runId, ts, ts);
      authorId = Number(r.lastInsertRowid);
    }
    if (status === "forthcoming") ctx.db.prepare("UPDATE authors SET upcoming_releases = ? WHERE id = ?").run(c.bookTitle, authorId);

    const profiles = new Set<string>([...(c.profileUrls ?? []), ...(grAuthorUrl ? [grAuthorUrl] : []), ...(websiteUrl ? [websiteUrl] : []), ...socialLinks.slice(0, 10)]);
    for (const u of profiles) {
      ctx.db.prepare("INSERT OR IGNORE INTO author_profiles(author_id, platform, url, verified, created_at) VALUES (?,?,?,?,?)").run(authorId, platformOf(u), u, sitePages.some((p) => p.info.socialLinks.includes(u)) || u === websiteUrl || u === grAuthorUrl ? 1 : 0, ts);
    }

    const bookKey = `${authorKey}|${normalizeKey(c.bookTitle)}`;
    const bookUrl = ldPage?.url ?? bookPages[0]?.url ?? bookUrls[0] ?? null;
    const metadataIssues = opportunities.filter((o) => o.code.startsWith("D") || o.code === "C14").map((o) => o.rationale).join(" | ") || null;
    const distribution = opportunities.filter((o) => ["C09", "C07", "J01", "B04", "C02", "I01"].includes(o.code)).map((o) => o.rationale).join(" | ") || null;
    const bookVals = [
      authorId, bookKey, ld?.name ?? c.bookTitle, bookUrl, bookUrl ? platformOf(bookUrl) : null, (c.genres ?? grExtras?.genres ?? []).slice(0, 3).join(", ") || null,
      publicationDate, status, c.statusEvidenceUrl ?? (status === "forthcoming" && gr ? gr.url : null), [...new Set(formats.map((f) => f.replace(/^\d+ pages, /, "")))].join("; ") || null,
      truncate(description, 4000), description?.length ?? null, ld?.image ?? ldPage?.info.ogImage ?? null,
      countForFilter, countSource, ld?.ratingValue ?? c.ratingObserved ?? null, series, ld?.isbn ?? null,
      [newsletterSignals.length ? `newsletter: ${newsletterSignals.join(", ")}` : null, socialLinks.length ? `${socialLinks.length} social profiles linked` : null, crowdfunding ? "crowdfunding campaign" : null].filter(Boolean).join("; ") || null,
      retailerLinks.slice(0, 15).join(" "), metadataIssues, distribution,
      bookPages.length ? "listing_only" : "not_inspected", ts, ts, ts,
    ];
    ctx.db
      .prepare(
        `INSERT INTO books(author_id, dedupe_key, title, url, platform, genre, publication_date, publication_status, status_evidence_url, formats, description,
         description_length, cover_url, review_count, review_count_source, rating, series, isbn, promotional_activity, purchase_links, metadata_issues,
         distribution_opportunities, inspection_scope, analyzed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(dedupe_key) DO UPDATE SET url=COALESCE(excluded.url, url), platform=COALESCE(excluded.platform, platform), publication_date=COALESCE(excluded.publication_date, publication_date),
         publication_status=excluded.publication_status, status_evidence_url=COALESCE(excluded.status_evidence_url, status_evidence_url), formats=COALESCE(excluded.formats, formats),
         description=COALESCE(excluded.description, description), description_length=COALESCE(excluded.description_length, description_length), cover_url=COALESCE(excluded.cover_url, cover_url),
         review_count=COALESCE(excluded.review_count, review_count), review_count_source=COALESCE(excluded.review_count_source, review_count_source), rating=COALESCE(excluded.rating, rating),
         series=COALESCE(excluded.series, series), promotional_activity=excluded.promotional_activity, purchase_links=excluded.purchase_links, metadata_issues=excluded.metadata_issues,
         distribution_opportunities=excluded.distribution_opportunities, inspection_scope=excluded.inspection_scope, analyzed_at=excluded.analyzed_at, updated_at=excluded.updated_at`,
      )
      .run(...(bookVals as any[]));
    const bookId = (ctx.db.prepare("SELECT id FROM books WHERE dedupe_key = ?").get(bookKey) as { id: number }).id;

    const ev = ctx.db.prepare(
      "INSERT OR IGNORE INTO evidence(author_id, book_id, run_id, kind, claim, source_url, source_title, excerpt, observed_at) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    for (const p of bookPages) {
      ev.run(authorId, bookId, ctx.runId, "book_listing", `Book listing fetched (${p.platform}); author name ${nameMatches(p.info.text + " " + (p.info.book?.authors.join(" ") ?? ""), c.authorName) ? "matches" : "NOT matched"}.`, p.url, truncate(p.info.title, 300), truncate(p.info.book?.description ?? p.info.metaDescription, 500), ts);
    }
    for (const u of bookUrls.filter((u) => SEED_ONLY.has(platformOf(u)))) {
      ev.run(authorId, bookId, ctx.runId, "reference_link", `Reference listing on ${platformOf(u)} (not fetched; platform restricts automated access).`, u, null, null, ts);
    }
    if (countForFilter != null) ev.run(authorId, bookId, ctx.runId, "review_count", `${countForFilter} ratings/reviews (≤ ${ctx.config.maxReviewCount} filter).`, ldPage?.url ?? null, null, countSource, ts);
    ev.run(authorId, bookId, ctx.runId, "publication_status", `${status}: ${statusReason}`, c.statusEvidenceUrl ?? bookUrl, null, null, ts);
    if (country) ev.run(authorId, null, ctx.runId, "country", `Based in ${country} (stated on page).`, countryEvidenceUrl, null, null, ts);
    if (websiteFetched) ev.run(authorId, null, ctx.runId, "identity", `Official website fetched; name ${nameOnSite ? "present" : "absent"}, book title ${titleOnSite ? "present" : "absent"}.`, sitePages[0].url, truncate(sitePages[0].info.title, 300), null, ts);
    if (explicitSeeking) ev.run(authorId, bookId, ctx.runId, "buying_signal", "Explicit public request for services.", c.statusEvidenceUrl ?? sitePages[0]?.url ?? null, null, truncate(explicitSeeking, 500), ts);
    if (crowdfunding) ev.run(authorId, bookId, ctx.runId, "buying_signal", "Public crowdfunding campaign for the book.", bookUrls.find((u) => CROWDFUND_RE.test(u)) ?? c.statusEvidenceUrl ?? null, null, null, ts);
    for (const n of aiNotes) ev.run(authorId, bookId, ctx.runId, "ai_observation", n, null, null, null, ts);
    if (c.notes) ev.run(authorId, bookId, ctx.runId, "seed_note", "Discovery note (unverified by pipeline)", c.statusEvidenceUrl ?? null, null, truncate(c.notes, 1000), ts);
    if (c.discoveryQuery) ev.run(authorId, null, ctx.runId, "discovery", `Discovered via ${c.discoveryPlatform ?? "search"}: ${truncate(c.discoveryQuery, 200)}`, null, null, null, ts);

    ctx.db.prepare("DELETE FROM service_opportunities WHERE author_id = ? AND book_id = ?").run(authorId, bookId);
    const so = ctx.db.prepare("INSERT OR REPLACE INTO service_opportunities(author_id, book_id, service_code, rationale, strength, evidence_url, created_at) VALUES (?,?,?,?,?,?,?)");
    for (const o of opportunities) so.run(authorId, bookId, o.code, o.rationale, o.strength, o.evidenceUrl, ts);

    for (const r of contactRows) {
      const v = verified.get(r.email)!;
      const status = v.status === "invalid" ? "invalid" : v.status;
      ctx.db
        .prepare(
          `INSERT INTO contacts(author_id, email, contact_type, source_url, source_title, discovered_at, last_checked_at, verification_status, verification_method, confidence, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(author_id, email, source_url) DO UPDATE SET last_checked_at=excluded.last_checked_at, verification_status=excluded.verification_status,
             verification_method=excluded.verification_method, contact_type=excluded.contact_type, confidence=excluded.confidence, notes=excluded.notes`,
        )
        .run(authorId, r.email, r.type, r.page.url, truncate(r.page.info.title, 300), ts, ts, status, v.method, r.confidence, r.note);
      const cid = (ctx.db.prepare("SELECT id FROM contacts WHERE author_id = ? AND email = ? AND source_url = ?").get(authorId, r.email, r.page.url) as { id: number }).id;
      ctx.db
        .prepare(
          "INSERT INTO email_verifications(contact_id, checked_at, publicly_listed, syntax_valid, domain_has_mx, mx_hosts, provider, provider_result, resulting_status, details) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(cid, ts, 1, v.syntaxValid ? 1 : 0, v.domainHasMx == null ? null : v.domainHasMx ? 1 : 0, v.mxHosts.join(", ") || null, v.provider, v.providerResult, v.status, v.details);
    }
    if (!contactRows.length && (contactPage || c.contactPageUrl)) {
      const url = contactPage?.url ?? c.contactPageUrl!;
      ctx.db
        .prepare(
          `INSERT OR IGNORE INTO contacts(author_id, email, contact_type, source_url, source_title, discovered_at, last_checked_at, verification_status, verification_method, confidence, notes)
           VALUES (?, NULL, 'contact_form_only', ?, ?, ?, ?, 'unknown', 'no email published', 'medium', 'No public email address found; contact page retained as research reference.')`,
        )
        .run(authorId, url, truncate(contactPage?.info.title, 300), ts, ts);
    }

    ctx.db
      .prepare(
        `INSERT INTO lead_scores(author_id, run_id, opportunity_evidence, buying_signal, commercial_fit, author_activity, identity_verification, contact_availability, total, priority, explanation, scored_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(authorId, ctx.runId, score.opportunityEvidence, score.buyingSignal, score.commercialFit, score.authorActivity, score.identityVerification, score.contactAvailability, score.total, score.priority, score.explanation.join("\n"), ts);

    for (const e of errors) recordError(ctx, e.stage, e.message, e.url || null, authorId);
    return { authorId, deduplicatedInto: !!existing };
  });

  return { kind: "saved", authorId: result.authorId, score, status, emails: contactRows.length, deduplicatedInto: result.deduplicatedInto };
}
