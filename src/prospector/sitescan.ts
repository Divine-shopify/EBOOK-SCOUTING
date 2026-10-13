import type { Fetcher } from "../adapters/fetch/http.js";
import { decodeEntities, extractPage, type PageInfo } from "../analysis/extract.js";
import { nowIso, type DB } from "../db/db.js";
import { domainOf } from "../util/text.js";
import type { ProspectCandidate } from "./candidate.js";
import { releaseTiming } from "./dates.js";
import { cleanDisplayName } from "./discovery.js";
import { BIG_PUBLISHER, aboutOtherAuthor, detectSignals, type SignalHit } from "./lexicon.js";
import { ingest, intakeKey } from "./store.js";
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
      if (/\b(writes|romance|books|media|press|publishing|blog|studio|official|personality)\b/i.test(part)) continue;
      const n = cleanDisplayName(decodeEntities(part).replace(/\b(home|welcome|official( site| website)?|website|site|author|autorin|autor|auteure?|writer|books|bücher)\b/gi, " "));
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
  const name = (e.name ? decodeEntities(e.name).trim() : "") || nameFromSite(info, r.body);
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
      if (aboutOtherAuthor(h.snippet, name) || BIG_PUBLISHER.test(h.snippet)) continue;
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
  opts: { concurrency?: number; limit?: number; batch?: number; shard?: [number, number]; onLog?: (s: string) => void } = {},
): Promise<{ scanned: number; candidates: number }> {
  const log = opts.onLog ?? (() => {});
  // Shards (k of N) let several processes scan disjoint parts of the queue in parallel.
  const [k, n] = opts.shard ?? [0, 1];
  const rows = db.prepare("SELECT id, list, payload FROM px_site_queue WHERE status = 'pending' AND id % ? = ? ORDER BY id LIMIT ?").all(n, k, opts.limit ?? 100000) as { id: number; list: string; payload: string }[];
  // Per-site outcomes are committed immediately; the research log aggregates them per list (see siteScanLog).
  const upd = db.prepare("UPDATE px_site_queue SET status = ?, outcome = ?, scanned_at = ?, batch = ? WHERE id = ?");
  let next = 0;
  let scanned = 0;
  let candidates = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      const e = JSON.parse(row.payload) as SiteEntry;
      let out: ScanOutcome;
      try {
        out = await scanSite(e, fetcher);
      } catch (err) {
        out = { reason: `error: ${(err as Error).message.slice(0, 60)}` };
      }
      scanned++;
      if (out.candidate) {
        if (opts.batch) out.candidate.discovery = { ...out.candidate.discovery, batch: opts.batch };
        const ing = ingest(db, [out.candidate], "site_scan");
        candidates += ing.added;
      }
      upd.run(out.candidate ? "candidate" : "rejected", out.reason, nowIso(), opts.batch ?? null, row.id);
      if (scanned % 50 === 0) log(`scanned ${scanned}/${rows.length}, candidates ${candidates}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 8) }, worker));
  return { scanned, candidates };
}

/** Research-log rows for bulk scans: one per directory list and batch, built from the per-site outcomes. */
export function siteScanLog(db: DB): { list: string; batch: number; date: string; reviewed: number; candidates: number; rejected: number; reasons: string; errors: string }[] {
  const rows = db.prepare("SELECT list, COALESCE(batch, 2) AS batch, status, outcome, scanned_at, payload FROM px_site_queue WHERE status != 'pending'").all() as any[];
  const m = new Map<string, { list: string; batch: number; date: string; reviewed: number; candidates: number; reasons: Record<string, number>; errors: Record<string, number> }>();
  for (const r of rows) {
    const key = `${r.batch}|${r.list}`;
    const e = m.get(key) ?? { list: r.list, batch: r.batch, date: String(r.scanned_at).slice(0, 10), reviewed: 0, candidates: 0, reasons: {}, errors: {} };
    m.set(key, e);
    e.reviewed++;
    if (r.status === "candidate") e.candidates++;
    else {
      const k = String(r.outcome ?? "").replace(/: .*/, "").replace(/HTTP \d+/, "HTTP error");
      const bucket: Record<string, number> = /HTTP|fetch failed|robots|too short|invalid URL|host not fetched/.test(k) ? e.errors : e.reasons;
      bucket[k] = (bucket[k] ?? 0) + 1;
    }
  }
  const fmt = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join("; ");
  return [...m.values()].map((e) => ({ list: e.list, batch: e.batch, date: e.date, reviewed: e.reviewed, candidates: e.candidates, rejected: e.reviewed - e.candidates, reasons: fmt(e.reasons), errors: fmt(e.errors) }));
}
