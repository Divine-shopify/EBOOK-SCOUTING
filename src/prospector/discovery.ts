import type { Fetcher } from "../adapters/fetch/http.js";
import type { SearchProvider } from "../adapters/search/types.js";
import { extractPage } from "../analysis/extract.js";
import { domainOf, sleep } from "../util/text.js";
import type { DB } from "../db/db.js";
import type { ProspectCandidate } from "./candidate.js";
import { EXPLICIT_REQUEST, PROVIDER_PROMO, PROVIDER_PROFILE, STAGE_TERMS, detectSignals, type SignalHit } from "./lexicon.js";
import { ingest, logSearch } from "./store.js";
import { NO_FETCH_HOSTS, looksLikeNamedIdentity } from "./verify.js";

/** Service-request phrases searched on social APIs, with the market/language they target. */
export const SOCIAL_QUERIES: { q: string; language: string; market?: string }[] = [
  { q: '"looking for a cover designer"', language: "en" },
  { q: '"looking for a cover artist"', language: "en" },
  { q: '"need a cover designer"', language: "en" },
  { q: '"recommend a cover designer"', language: "en" },
  { q: '"looking for an editor" book', language: "en" },
  { q: '"looking for an editor" manuscript', language: "en" },
  { q: '"need an editor" my book', language: "en" },
  { q: '"looking for a developmental editor"', language: "en" },
  { q: '"looking for a copy editor"', language: "en" },
  { q: '"looking for a line editor"', language: "en" },
  { q: '"looking for a proofreader"', language: "en" },
  { q: '"need a proofreader"', language: "en" },
  { q: '"looking for a formatter"', language: "en" },
  { q: '"ebook formatting" help', language: "en" },
  { q: '"epub" formatting help my book', language: "en" },
  { q: '"kindle formatting"', language: "en" },
  { q: '"looking for an illustrator" book', language: "en" },
  { q: '"children\'s book illustrator" looking', language: "en" },
  { q: '"looking for a narrator" audiobook', language: "en" },
  { q: '"audiobook narrator" looking for my book', language: "en" },
  { q: '"looking for a translator" my book', language: "en" },
  { q: '"translate my book"', language: "en" },
  { q: '"book marketing" help indie author', language: "en" },
  { q: '"looking for a publicist" book', language: "en" },
  { q: '"amazon ads" help my book', language: "en" },
  { q: '"author website" need help', language: "en" },
  { q: '"web designer" author website', language: "en" },
  { q: '"self-publishing" help first book', language: "en" },
  { q: '"kdp" help upload', language: "en" },
  { q: '"draft2digital" help', language: "en" },
  { q: '"going wide" kobo help', language: "en" },
  { q: '"blurb" help my book', language: "en" },
  { q: '"newsletter" setup author help', language: "en" },
  { q: '"cover reveal" ebook preorder', language: "en" },
  { q: '"looking for an illustrator" "my book"', language: "en" },
  { q: '"looking for an illustrator" picture book', language: "en" },
  { q: '"looking for a book cover"', language: "en" },
  { q: '"cover artist" "my book" looking', language: "en" },
  { q: '"cover designer" recommendations indie', language: "en" },
  { q: '"cover designer" recs', language: "en" },
  { q: '"need a cover" for my book', language: "en" },
  { q: '"seeking a cover artist"', language: "en" },
  { q: '"seeking an editor"', language: "en" },
  { q: '"seeking an illustrator"', language: "en" },
  { q: '"hiring an editor" book', language: "en" },
  { q: '"hire an editor" my novel', language: "en" },
  { q: '"editor recommendations" book', language: "en" },
  { q: '"recommend an editor"', language: "en" },
  { q: '"recommend a proofreader"', language: "en" },
  { q: '"recommend a formatter"', language: "en" },
  { q: '"looking for a sensitivity reader"', language: "en" },
  { q: '"looking for an audiobook narrator"', language: "en" },
  { q: '"narrator for my book"', language: "en" },
  { q: '"translator for my book"', language: "en" },
  { q: '"translator for my novel"', language: "en" },
  { q: '"formatting my ebook"', language: "en" },
  { q: '"format my book"', language: "en" },
  { q: '"vellum" formatting help', language: "en" },
  { q: '"atticus" formatting help', language: "en" },
  { q: '"help with my book launch"', language: "en" },
  { q: '"book marketing" "looking for"', language: "en" },
  { q: '"looking for an arc" team', language: "en" },
  { q: '"street team" looking for my book', language: "en" },
  { q: '"author website" redesign', language: "en" },
  { q: '"need a new website" author', language: "en" },
  { q: '"bookfunnel" help', language: "en" },
  { q: '"selling direct" ebooks help', language: "en" },
  { q: '"amazon ads" "my book" help', language: "en" },
  { q: '"book description" help "my book"', language: "en" },
  { q: '"keywords" kdp help', language: "en" },
  { q: '"isbn" self publishing help', language: "en" },
  { q: '"ingramspark" help', language: "en" },
  { q: '"kobo writing life"', language: "en" },
  { q: '"go wide" ebook help', language: "en" },
  { q: '"new covers" series relaunch', language: "en" },
  { q: '"preorder" ebook "my new book"', language: "en" },
  { q: '"suche" Lektorat Buch', language: "de", market: "Germany" },
  { q: 'Coverdesigner gesucht', language: "de", market: "Germany" },
  { q: 'Illustrator gesucht Kinderbuch', language: "de", market: "Germany" },
  { q: 'Sprecher gesucht Hörbuch', language: "de", market: "Germany" },
  { q: '"cherche" correctrice roman', language: "fr", market: "France" },
  { q: '"cherche" traducteur roman', language: "fr", market: "France" },
  { q: '"busco" editor novela', language: "es", market: "Spain" },
  { q: '"busco" traductor novela', language: "es", market: "Spain" },
  { q: '"cerco" illustratore libro', language: "it", market: "Italy" },
  { q: '"op zoek naar" illustrator boek', language: "nl", market: "Netherlands" },
  { q: '"suche" Coverdesigner', language: "de", market: "Germany" },
  { q: 'Lektorin gesucht Roman', language: "de", market: "Germany" },
  { q: '"Korrektorat" gesucht', language: "de", market: "Germany" },
  { q: 'Selfpublishing Hilfe E-Book', language: "de", market: "Germany" },
  { q: '"cherche" correcteur roman', language: "fr", market: "France" },
  { q: '"cherche" illustrateur couverture', language: "fr", market: "France" },
  { q: 'autoédition aide couverture', language: "fr", market: "France" },
  { q: '"busco" corrector novela', language: "es", market: "Spain" },
  { q: '"busco" ilustrador portada', language: "es", market: "Spain" },
  { q: '"op zoek naar" redacteur boek', language: "nl", market: "Netherlands" },
  { q: '"cerco" editor romanzo', language: "it", market: "Italy" },
  { q: '"söker" redaktör bok', language: "sv", market: "Sweden" },
];

export const MASTODON_TAGS = ["amwriting", "writingcommunity", "selfpublishing", "indieauthor", "selfpub", "authorsofmastodon", "writers", "booksky", "selfpublished", "indiepublishing", "amediting", "writer"];
// writing.exchange and mstdn.social answer 422 to unauthenticated tag timelines (tested 2026-10-12).
export const MASTODON_INSTANCES = ["mastodon.social", "mastodon.online", "wandering.shop"];

/** Strips emoji, decorations and taglines from a display name ("Jane Doe 📚 | Fantasy Author" → "Jane Doe"). */
export function cleanDisplayName(raw: string): string {
  let s = raw.normalize("NFKC").replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, " ");
  s = s.split(/\s[|•·—–\-\/]\s|\s\(|,\s(?:author|writer)|\s\[/i)[0];
  s = s.replace(/[^\p{L}\p{N}\s.'&-]/gu, " ").replace(/\s+/g, " ").trim();
  s = s.split(" ").filter((w) => !/^[oO0]{2,}$/.test(w)).join(" ");
  s = s.replace(/^((published|bestselling|best-selling|indie|award-winning|usa today|debut)\s+)+/i, "");
  s = s.replace(/^(author|writer|novelist|autor|autorin|auteur|auteure)\s+/i, "").replace(/(\s+(author|writer|books|writes|novelist|official))+$/i, "").trim();
  return s;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Pre-filter: keep only first-person requests or production-stage posts, drop provider advertising. */
export function isPromising(text: string): boolean {
  if (PROVIDER_PROMO.test(text)) return false;
  return EXPLICIT_REQUEST.test(text) && detectSignals(text, { wholeTextIsOnePost: true }).some((s) => s.kind === "explicit") || STAGE_TERMS.some((s) => s.re.test(text)) && /\b(e-?book|kindle|kdp|self-?pub|indie)\b/i.test(text);
}

interface BskyPost {
  uri: string;
  author: { did: string; handle: string; displayName?: string };
  record: { text: string; createdAt: string; langs?: string[]; reply?: unknown };
}

/** Bluesky public AppView (api.bsky.app): keyless post search and profile lookup. */
export class BlueskyDiscovery {
  constructor(private fetcher: Fetcher, private base = "https://api.bsky.app/xrpc") {}

  async searchPosts(q: string, pages = 2, language?: string): Promise<BskyPost[]> {
    const out: BskyPost[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < pages; i++) {
      const params = new URLSearchParams({ q, limit: "100", sort: "latest" });
      if (language) params.set("lang", language);
      if (cursor) params.set("cursor", cursor);
      const data = await this.getWithBackoff<{ posts: BskyPost[]; cursor?: string }>(`${this.base}/app.bsky.feed.searchPosts?${params}`);
      out.push(...data.posts);
      cursor = data.cursor;
      if (!cursor || !data.posts.length) break;
    }
    return out;
  }

  /** The AppView intermittently answers 403/429 under load; retry with backoff and never cache failures. */
  private async getWithBackoff<T>(url: string, attempts = 4): Promise<T> {
    let last = 0;
    for (let i = 0; i < attempts; i++) {
      const r = await this.fetcher.get(url, { useCache: false, skipRobots: true });
      last = r.status;
      if (r.status === 200) return JSON.parse(r.body) as T;
      await sleep(4000 * 2 ** i);
    }
    throw new Error(`Bluesky HTTP ${last} after ${attempts} attempts`);
  }

  async profiles(dids: string[]): Promise<Map<string, { displayName?: string; description?: string; handle: string }>> {
    const map = new Map<string, { displayName?: string; description?: string; handle: string }>();
    for (let i = 0; i < dids.length; i += 25) {
      const params = new URLSearchParams();
      for (const d of dids.slice(i, i + 25)) params.append("actors", d);
      const data = await this.getWithBackoff<{ profiles: any[] }>(`${this.base}/app.bsky.actor.getProfiles?${params}`).catch(() => null);
      if (data) for (const p of data.profiles) map.set(p.did, { displayName: p.displayName, description: p.description, handle: p.handle });
    }
    return map;
  }

  /** Runs one query and turns qualifying posts into candidates. */
  async discover(q: string, opts: { pages?: number; language?: string; market?: string; maxAgeMonths?: number } = {}): Promise<{ reviewed: number; candidates: ProspectCandidate[]; rejected: Record<string, number> }> {
    const posts = await this.searchPosts(q, opts.pages ?? 2, opts.language);
    const rejected: Record<string, number> = {};
    const bump = (k: string) => (rejected[k] = (rejected[k] ?? 0) + 1);
    const maxAge = (opts.maxAgeMonths ?? 30) * 30.44 * 86400_000;
    const keep = posts.filter((p) => {
      if (Date.now() - Date.parse(p.record.createdAt) > maxAge) return bump("older than cutoff"), false;
      if (!isPromising(p.record.text)) return bump("no first-person request or production-stage wording / provider promotion"), false;
      return true;
    });
    const profiles = await this.profiles([...new Set(keep.map((p) => p.author.did))]);
    const candidates: ProspectCandidate[] = [];
    for (const p of keep) {
      const prof = profiles.get(p.author.did);
      const bio = prof?.description ?? "";
      if (PROVIDER_PROFILE.test(bio) && !/\bauthor\b/i.test(bio)) {
        bump("service provider profile");
        continue;
      }
      const name = cleanDisplayName(prof?.displayName || p.author.displayName || "") || p.author.handle.split(".")[0];
      if (name.length < 2) {
        bump("no usable display name");
        continue;
      }
      const rkey = p.uri.split("/").pop();
      candidates.push({
        name,
        platforms: [],
        sourceUrl: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
        evidenceQuote: p.record.text,
        evidenceDate: p.record.createdAt,
        additionalUrls: [],
        profileUrl: `https://bsky.app/profile/${p.author.handle}`,
        apiText: p.record.text,
        apiProfileText: `${prof?.displayName ?? ""}\n${bio}`,
        language: p.record.langs?.[0],
        discovery: { channel: "bluesky", query: q, provider: "bluesky-public-api", market: opts.market, date: new Date().toISOString().slice(0, 10) },
      });
    }
    return { reviewed: posts.length, candidates, rejected };
  }
}

/** Mastodon public hashtag timelines (no key). Statuses are filtered locally for request wording. */
export class MastodonDiscovery {
  constructor(private fetcher: Fetcher) {}

  async discover(instance: string, tag: string, pages = 3, maxAgeMonths = 30): Promise<{ reviewed: number; candidates: ProspectCandidate[]; rejected: Record<string, number> }> {
    const rejected: Record<string, number> = {};
    const bump = (k: string) => (rejected[k] = (rejected[k] ?? 0) + 1);
    const candidates: ProspectCandidate[] = [];
    let maxId: string | undefined;
    let reviewed = 0;
    for (let i = 0; i < pages; i++) {
      const params = new URLSearchParams({ limit: "40" });
      if (maxId) params.set("max_id", maxId);
      const { status, data } = await this.fetcher.getJson<any[]>(`https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?${params}`);
      if (status !== 200 || !Array.isArray(data)) throw new Error(`Mastodon ${instance} HTTP ${status}`);
      if (!data.length) break;
      for (const s of data) {
        reviewed++;
        const text = htmlToText(s.content ?? "");
        if (Date.now() - Date.parse(s.created_at) > maxAgeMonths * 30.44 * 86400_000) {
          bump("older than cutoff");
          continue;
        }
        if (s.account?.bot) {
          bump("bot account");
          continue;
        }
        if (!isPromising(text)) {
          bump("no first-person request or production-stage wording / provider promotion");
          continue;
        }
        const note = htmlToText(s.account?.note ?? "");
        const fields = (s.account?.fields ?? []).map((f: any) => `${f.name}: ${htmlToText(f.value)}`).join("\n");
        if (PROVIDER_PROFILE.test(note) && !/\bauthor\b/i.test(note)) {
          bump("service provider profile");
          continue;
        }
        const name = cleanDisplayName(s.account?.display_name || s.account?.username || "");
        candidates.push({
          name,
          platforms: [],
          sourceUrl: s.url ?? s.uri,
          evidenceQuote: text,
          evidenceDate: s.created_at,
          additionalUrls: [],
          profileUrl: s.account?.url,
          apiText: text,
          apiProfileText: `${s.account?.display_name ?? ""}\n${note}\n${fields}`,
          language: s.language ?? undefined,
          discovery: { channel: "mastodon", query: `#${tag}@${instance}`, provider: "mastodon-public-api", date: new Date().toISOString().slice(0, 10) },
        });
      }
      maxId = data[data.length - 1]?.id;
    }
    return { reviewed, candidates, rejected };
  }
}

/**
 * Keyed web search (Brave/Tavily/SerpAPI): results whose fetched page shows request/stage wording and names its owner
 * (meta author or og:site_name) become candidates; everything else is logged as rejected.
 */
export async function webSearchDiscover(provider: SearchProvider, fetcher: Fetcher, q: string, limit = 10): Promise<{ reviewed: number; candidates: ProspectCandidate[]; rejected: Record<string, number> }> {
  const results = await provider.search(q, { limit });
  const rejected: Record<string, number> = {};
  const bump = (k: string) => (rejected[k] = (rejected[k] ?? 0) + 1);
  const candidates: ProspectCandidate[] = [];
  for (const r of results) {
    const host = domainOf(r.url) ?? "";
    if (NO_FETCH_HOSTS.test(host)) {
      bump("result host blocks automated access");
      continue;
    }
    try {
      const page = await fetcher.get(r.url);
      if (page.status >= 400) {
        bump(`HTTP ${page.status}`);
        continue;
      }
      const owner = /<meta[^>]+name=["']author["'][^>]+content=["']([^"']{3,80})["']/i.exec(page.body)?.[1] ?? /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{3,80})["']/i.exec(page.body)?.[1];
      const info = extractPage(page.body, page.finalUrl);
      const sig = detectSignals(info.text).find((s) => s.kind === "explicit") ?? detectSignals(info.text).find((s) => s.kind === "stage");
      if (!sig) {
        bump("no request or production-stage wording on page");
        continue;
      }
      if (!owner) {
        bump("page owner not identifiable");
        continue;
      }
      candidates.push({
        name: cleanDisplayName(owner),
        platforms: [],
        sourceUrl: page.finalUrl,
        evidenceQuote: sig.snippet,
        additionalUrls: [],
        officialWebsite: new URL(page.finalUrl).origin + "/",
        discovery: { channel: "web_search", query: q, provider: provider.name, date: new Date().toISOString().slice(0, 10) },
      });
    } catch (e) {
      bump(`fetch error`);
    }
    await sleep(0);
  }
  return { reviewed: results.length, candidates, rejected };
}

export const fmtReasons = (r: Record<string, number>) => Object.entries(r).map(([k, n]) => `${k} (${n})`).join("; ");

/** Runs the keyless social discovery sweep and logs every query. */
export async function runSocialDiscovery(
  db: DB,
  fetcher: Fetcher,
  opts: { bluesky?: boolean; mastodon?: boolean; pages?: number; maxQueries?: number; onLog?: (s: string) => void } = {},
): Promise<{ queries: number; added: number }> {
  const log = opts.onLog ?? (() => {});
  let queries = 0;
  let added = 0;
  if (opts.bluesky !== false) {
    const bs = new BlueskyDiscovery(fetcher);
    for (const sq of SOCIAL_QUERIES.slice(0, opts.maxQueries ?? SOCIAL_QUERIES.length)) {
      queries++;
      try {
        const r = await bs.discover(sq.q, { pages: opts.pages ?? 2, language: sq.language === "en" ? undefined : sq.language, market: sq.market });
        const ing = ingest(db, r.candidates, "bluesky");
        added += ing.added;
        logSearch(db, { query: sq.q, market: sq.market ?? "Global", language: sq.language, provider: "bluesky-public-api", sourceType: "Public social posts", resultsReviewed: r.reviewed, candidatesAdded: ing.added, rejected: r.reviewed - r.candidates.length, rejectionReasons: fmtReasons(r.rejected), nextDirection: ing.added ? "verify candidates; vary service wording" : "low yield: try local-language or platform-specific wording" });
        log(`bluesky ${sq.q}: reviewed ${r.reviewed}, new candidates ${ing.added}`);
      } catch (e) {
        logSearch(db, { query: sq.q, provider: "bluesky-public-api", resultsReviewed: 0, candidatesAdded: 0, error: (e as Error).message });
        log(`bluesky ${sq.q}: ERROR ${(e as Error).message}`);
      }
    }
  }
  if (opts.mastodon !== false) {
    const md = new MastodonDiscovery(fetcher);
    for (const inst of MASTODON_INSTANCES) {
      for (const tag of MASTODON_TAGS) {
        queries++;
        try {
          const r = await md.discover(inst, tag, opts.pages ?? 3);
          const ing = ingest(db, r.candidates, "mastodon");
          added += ing.added;
          logSearch(db, { query: `#${tag}`, market: "Global", provider: `mastodon-public-api (${inst})`, sourceType: "Public hashtag timeline", resultsReviewed: r.reviewed, candidatesAdded: ing.added, rejected: r.reviewed - r.candidates.length, rejectionReasons: fmtReasons(r.rejected), nextDirection: ing.added ? "verify candidates" : "hashtag low yield on this instance" });
          log(`mastodon #${tag}@${inst}: reviewed ${r.reviewed}, new ${ing.added}`);
        } catch (e) {
          logSearch(db, { query: `#${tag}`, provider: `mastodon-public-api (${inst})`, resultsReviewed: 0, candidatesAdded: 0, error: (e as Error).message });
          log(`mastodon #${tag}@${inst}: ERROR ${(e as Error).message}`);
        }
      }
    }
  }
  return { queries, added };
}



/** First explicit request in a blog post, judged as one author-owned post. */
function explicitIn(text: string): SignalHit | undefined {
  return detectSignals(text, { wholeTextIsOnePost: false }).find((s) => s.kind === "explicit" && !PROVIDER_PROMO.test(s.snippet));
}

/**
 * Keyless blog-platform search: Substack post search and the WordPress.com Reader search API. Posts are scanned with
 * the lexicon; a first-person request in a post written within `maxAgeMonths` becomes a candidate whose source is the
 * post page itself (re-fetched and quote-checked by the verifier).
 */
export async function blogSearchDiscover(
  fetcher: Fetcher,
  q: string,
  opts: { pages?: number; maxAgeMonths?: number; platform: "substack" | "wordpress" },
): Promise<{ reviewed: number; candidates: ProspectCandidate[]; rejected: Record<string, number> }> {
  const rejected: Record<string, number> = {};
  const bump = (k: string) => (rejected[k] = (rejected[k] ?? 0) + 1);
  const cutoff = Date.now() - (opts.maxAgeMonths ?? 12) * 30.44 * 86400_000;
  const candidates: ProspectCandidate[] = [];
  let reviewed = 0;
  type Post = { url: string; date: string; author: string; site: string; html: string };
  const posts: Post[] = [];
  if (opts.platform === "substack") {
    for (let page = 0; page < (opts.pages ?? 3); page++) {
      const { status, data } = await fetcher.getJson<{ results?: any[]; more?: boolean }>(`https://substack.com/api/v1/post/search?includePlatformResults=true&page=${page}&query=${encodeURIComponent(q)}`);
      if (status !== 200 || !data) throw new Error(`Substack search HTTP ${status}`);
      for (const p of data.results ?? []) {
        const url = String(p.canonical_url ?? "");
        posts.push({ url, date: p.post_date, author: (p.publishedBylines ?? []).map((b: any) => b.name).filter(Boolean)[0] ?? "", site: url ? new URL(url).origin + "/" : "", html: p.body_html ?? p.truncated_body_text ?? p.description ?? "" });
      }
      if (!data.more) break;
    }
  } else {
    let handle: string | undefined;
    for (let page = 0; page < (opts.pages ?? 3); page++) {
      const { status, data } = await fetcher.getJson<{ posts?: any[]; next_page?: string }>(
        `https://public-api.wordpress.com/rest/v1.1/read/search?number=20&q=${encodeURIComponent(q)}${handle ? `&page_handle=${encodeURIComponent(handle)}` : ""}`,
      );
      if (status !== 200 || !data) throw new Error(`WordPress search HTTP ${status}`);
      for (const p of data.posts ?? []) posts.push({ url: p.URL, date: p.date, author: p.author?.name ?? "", site: p.author?.URL || (p.URL ? new URL(p.URL).origin + "/" : ""), html: p.content ?? "" });
      handle = data.next_page;
      if (!handle || !(data.posts ?? []).length) break;
    }
  }
  for (const p of posts) {
    reviewed++;
    if (!p.url || Date.parse(p.date) < cutoff) {
      bump("older than cutoff");
      continue;
    }
    const text = htmlToText(p.html);
    const hit = explicitIn(text);
    if (!hit) {
      bump("no first-person service request");
      continue;
    }
    const name = cleanDisplayName(p.author);
    if (!looksLikeNamedIdentity(name)) {
      bump("byline is not a full personal/pen name");
      continue;
    }
    const sentence = hit.snippet.length > 300 ? hit.snippet.slice(0, 300) : hit.snippet;
    candidates.push({
      name,
      platforms: [],
      sourceUrl: p.url,
      evidenceQuote: sentence,
      evidenceDate: p.date,
      additionalUrls: [],
      officialWebsite: p.site || undefined,
      discovery: { channel: opts.platform, query: q, provider: opts.platform === "substack" ? "substack-search-api" : "wordpress-reader-search-api", date: new Date().toISOString().slice(0, 10) },
    });
  }
  return { reviewed, candidates, rejected };
}

export const BLOG_QUERIES = [
  '"looking for an editor"', '"looking for a cover artist"', '"looking for a cover designer"', '"looking for an illustrator"', '"looking for a proofreader"',
  '"looking for a narrator"', '"looking for a translator"', '"looking for a formatter"', '"need an editor" my book', '"need a cover" my book',
  '"hire an editor" my book', '"hire an illustrator" my book', '"seeking an editor"', '"seeking an illustrator"', '"seeking a cover artist"',
  '"searching for an editor"', '"searching for an illustrator"', '"on the hunt for" editor book', '"recommend an editor"', '"recommend a cover designer"',
  '"help with book marketing"', '"help formatting my book"', '"kindle formatting" help', '"epub" help my book', '"author website" help',
  '"audiobook narrator" my book', '"illustrator for my picture book"', '"cover designer for my"', '"editor for my novel"', '"developmental editor" looking',
];

export async function runBlogDiscovery(db: DB, fetcher: Fetcher, opts: { pages?: number; maxQueries?: number; onLog?: (s: string) => void } = {}): Promise<{ queries: number; added: number }> {
  const log = opts.onLog ?? (() => {});
  let queries = 0;
  let added = 0;
  for (const platform of ["substack", "wordpress"] as const) {
    for (const q of BLOG_QUERIES.slice(0, opts.maxQueries ?? BLOG_QUERIES.length)) {
      queries++;
      const provider = platform === "substack" ? "substack-search-api" : "wordpress-reader-search-api";
      try {
        const r = await blogSearchDiscover(fetcher, q, { pages: opts.pages ?? 3, platform });
        const ing = ingest(db, r.candidates, platform);
        added += ing.added;
        logSearch(db, { query: q, market: "Global", language: "en", provider, sourceType: "Public blog posts", resultsReviewed: r.reviewed, candidatesAdded: ing.added, rejected: r.reviewed - r.candidates.length, rejectionReasons: fmtReasons(r.rejected), nextDirection: ing.added ? "verify candidates" : "low yield phrasing" });
        log(`${provider} ${q}: reviewed ${r.reviewed}, new ${ing.added}`);
      } catch (e) {
        logSearch(db, { query: q, provider, resultsReviewed: 0, candidatesAdded: 0, error: (e as Error).message });
        log(`${provider} ${q}: ERROR ${(e as Error).message}`);
      }
    }
  }
  return { queries, added };
}
