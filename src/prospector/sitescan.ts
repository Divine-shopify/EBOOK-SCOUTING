import type { Fetcher } from "../adapters/fetch/http.js";
import { extractPage, type PageInfo } from "../analysis/extract.js";
import { nowIso, type DB } from "../db/db.js";
import { domainOf } from "../util/text.js";
import type { ProspectCandidate } from "./candidate.js";
import { releaseTiming } from "./dates.js";
import { cleanDisplayName } from "./discovery.js";
import { detectSignals, type SignalHit } from "./lexicon.js";
import { ingest, intakeKey, logSearch } from "./store.js";
import { NO_FETCH_HOSTS, SHARED_HOSTS, looksLikeNamedIdentity, nameInText } from "./verify.js";

/**
 * Bulk site scan: author websites collected from public directories (association member lists, event author lists,
 * release calendars) are scanned for current publishing evidence. A hit becomes an ordinary candidate, which the
 * verifier then re-checks like any other — the scan only decides what is worth verifying.
 */
export interface SiteEntry {
  url: string;
  name?: string;
  businessName?: string;
  country?: string;
  region?: string;
  city?: string;
  language?: string;
  authorType?: string;
  genre?: string;
  /** Directory or list the site came from (logged as the research method). */
  source: string;
  directoryUrl?: string;
}

export interface ScanOutcome {
  candidate?: ProspectCandidate;
  reason: string;
}

/** Internal pages likely to carry release news (multilingual). */
const NEWS_LINK =
  /(book|books|novel|series|reihe|serie|bücher|buecher|buch|livres|livre|romans|libros|libri|boeken|böcker|bøger|kirjat|news|neuigkeiten|aktuelles|actualit|novedades|nieuws|nyheter|uutiset|blog|coming|upcoming|new-release|releases|release|neuerscheinung|parutions|à-paraître|prochainement|uscite|works|catalog|shop|store|preorder|pre-order)/i;

/** Generic teasers that are often just menu labels; they count only when the snippet carries a current date. */
const WEAK_STAGE_MATCH = /^(coming soon|bientôt disponible|prochainement|próximamente|prossimamente|binnenkort|demnächst|kommer snart|bald)$/i;

const YEAR_RE = () => {
  const y = new Date().getFullYear();
  return new RegExp(`\\b(${y}|${y + 1})\\b`);
};

/** Best guess of the author's name from the site itself (og:site_name / title), only if it reads as a personal name. */
export function nameFromSite(info: PageInfo, html: string): string | null {
  const og = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{3,80})["']/i.exec(html)?.[1];
  for (const raw of [og, info.title].filter(Boolean) as string[]) {
    for (const part of raw.split(/\s[|–—·:\-]\s|\s[|–—·]\s?/)) {
      const n = cleanDisplayName(part.replace(/\b(home|welcome|official( site| website)?|website|site|author|autorin|autor|auteure?|writer|books|bücher)\b/gi, " "));
      if (looksLikeNamedIdentity(n) && n.split(" ").length <= 4) return n;
    }
  }
  return null;
}

function scoreHit(h: SignalHit, pageMentionsYear: boolean): number {
  if (h.kind === "explicit") return 100;
  const timing = releaseTiming(h.snippet);
  if (timing === "passed") return 0;
  if (timing === "current") return 60;
  return pageMentionsYear && !WEAK_STAGE_MATCH.test((h.match ?? "").trim()) ? 30 : 0;
}

export async function scanSite(e: SiteEntry, fetcher: Fetcher): Promise<ScanOutcome> {
  let home: URL;
  try {
    home = new URL(/^https?:/i.test(e.url) ? e.url : `https://${e.url}`);
  } catch {
    return { reason: "invalid URL" };
  }
  const host = home.hostname.replace(/^www\./, "");
  if (NO_FETCH_HOSTS.test(host)) return { reason: "host not fetched (bot-blocking/terms)" };
  if (SHARED_HOSTS.test(host) && home.pathname.length < 2 && !/\.(wordpress|blogspot|substack|wixsite|weebly)\./i.test(home.hostname)) return { reason: "shared platform root, not an author site" };
  let r;
  try {
    r = await fetcher.get(home.toString());
  } catch (err) {
    return { reason: `fetch failed: ${(err as Error).message.slice(0, 60)}` };
  }
  if (r.status >= 400) return { reason: `HTTP ${r.status}` };
  const info = extractPage(r.body, r.finalUrl);
  if (info.text.length < 200) return { reason: "page text too short (JavaScript-only site?)" };
  const homeText = `${info.title} ${info.metaDescription} ${info.text}`;
  const name = e.name?.trim() || nameFromSite(info, r.body);
  if (!name) return { reason: "author name not determinable from site" };
  if (!nameInText(name, homeText) && !(e.businessName && nameInText(e.businessName, homeText))) return { reason: "listed name not found on site" };

  const finalHost = domainOf(r.finalUrl);
  const pages: { url: string; text: string }[] = [{ url: r.finalUrl, text: homeText }];
  const links = [...new Set(info.links.filter((l) => domainOf(l.href) === finalHost && (NEWS_LINK.test(l.href) || NEWS_LINK.test(l.text))).map((l) => l.href.split("#")[0]))]
    .filter((u) => u !== r!.finalUrl && !/\.(jpg|jpeg|png|gif|pdf|webp|zip|mp3)$/i.test(u) && !/(wp-login|cart|checkout|account|feed|tag\/|category\/|privacy|impressum|datenschutz|cookie)/i.test(u))
    .slice(0, 4);
  for (const u of links) {
    try {
      const p = await fetcher.get(u);
      if (p.status < 400) {
        const pi = extractPage(p.body, p.finalUrl);
        pages.push({ url: p.finalUrl, text: `${pi.title} ${pi.text}` });
      }
    } catch {
      /* a failed subpage is not fatal */
    }
  }

  let best: { hit: SignalHit; url: string; score: number } | null = null;
  for (const p of pages) {
    const year = YEAR_RE().test(p.text);
    for (const h of detectSignals(p.text)) {
      const s = scoreHit(h, year);
      if (s > 0 && (!best || s > best.score)) best = { hit: h, url: p.url, score: s };
    }
  }
  if (!best) return { reason: "no current service-need or production-stage wording" };

  const origin = new URL(r.finalUrl).origin + "/";
  return {
    reason: best.hit.kind === "explicit" ? "explicit request" : best.score >= 60 ? "dated upcoming release" : "production stage + current year",
    candidate: {
      name,
      businessName: e.businessName,
      authorType: e.authorType,
      country: e.country,
      region: e.region,
      city: e.city,
      language: e.language,
      genre: e.genre,
      platforms: [],
      sourceUrl: best.url,
      evidenceQuote: best.hit.snippet.slice(0, 400),
      additionalUrls: e.directoryUrl ? [e.directoryUrl] : [],
      officialWebsite: origin,
      discovery: { channel: "site_scan", query: e.source, provider: "directory-crawl + site scan", market: e.country, date: new Date().toISOString().slice(0, 10) },
    },
  };
}

export function enqueueSites(db: DB, entries: SiteEntry[], list: string): { added: number; skipped: number } {
  const ins = db.prepare("INSERT OR IGNORE INTO px_site_queue(url_key, list, payload, status, queued_at) VALUES (?,?,?,'pending',?)");
  let added = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const e of entries) {
      if (!e.url) continue;
      const u = /^https?:/i.test(e.url) ? e.url : `https://${e.url}`;
      if (Number(ins.run(intakeKey(u).split("/")[0], list, JSON.stringify(e), nowIso()).changes) > 0) added++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { added, skipped: entries.length - added };
}

/** Scans every pending site (resumable: each site's result is committed on its own) and logs one entry per list. */
export async function runSiteScan(
  db: DB,
  fetcher: Fetcher,
  opts: { concurrency?: number; limit?: number; batch?: number; onLog?: (s: string) => void } = {},
): Promise<{ scanned: number; candidates: number }> {
  const log = opts.onLog ?? (() => {});
  const rows = db.prepare("SELECT id, list, payload FROM px_site_queue WHERE status = 'pending' ORDER BY id LIMIT ?").all(opts.limit ?? 100000) as { id: number; list: string; payload: string }[];
  const perList = new Map<string, { reviewed: number; added: number; reasons: Record<string, number>; country?: string }>();
  const upd = db.prepare("UPDATE px_site_queue SET status = ?, outcome = ?, scanned_at = ? WHERE id = ?");
  let next = 0;
  let scanned = 0;
  let candidates = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      const e = JSON.parse(row.payload) as SiteEntry;
      const stats = perList.get(row.list) ?? { reviewed: 0, added: 0, reasons: {}, country: e.country };
      perList.set(row.list, stats);
      let out: ScanOutcome;
      try {
        out = await scanSite(e, fetcher);
      } catch (err) {
        out = { reason: `error: ${(err as Error).message.slice(0, 60)}` };
      }
      stats.reviewed++;
      scanned++;
      if (out.candidate) {
        if (opts.batch) out.candidate.discovery = { ...out.candidate.discovery, batch: opts.batch };
        const ing = ingest(db, [out.candidate], "site_scan");
        stats.added += ing.added;
        candidates += ing.added;
      } else {
        const key = out.reason.replace(/: .*/, "").replace(/HTTP \d+/, "HTTP error");
        stats.reasons[key] = (stats.reasons[key] ?? 0) + 1;
      }
      upd.run(out.candidate ? "candidate" : "rejected", out.reason, nowIso(), row.id);
      if (scanned % 50 === 0) log(`scanned ${scanned}/${rows.length}, candidates ${candidates}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 8) }, worker));
  for (const [list, s] of perList) {
    logSearch(db, {
      query: list,
      market: s.country ?? "Mixed",
      provider: "directory-crawl + site scan",
      sourceType: "Author websites from public directory",
      resultsReviewed: s.reviewed,
      candidatesAdded: s.added,
      rejected: s.reviewed - s.added,
      rejectionReasons: Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join("; "),
      nextDirection: s.added / Math.max(1, s.reviewed) < 0.03 ? "low yield list; prefer release calendars and event lists" : "verify candidates",
      batch: opts.batch,
    });
  }
  return { scanned, candidates };
}
