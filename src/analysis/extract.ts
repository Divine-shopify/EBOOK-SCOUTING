import * as cheerio from "cheerio";
import { cleanText } from "../util/text.js";
import { platformOf } from "../adapters/sources.js";

export interface BookLd {
  name?: string;
  authors: string[];
  ratingCount?: number;
  reviewCount?: number;
  ratingValue?: number;
  isbn?: string;
  bookFormat?: string;
  numberOfPages?: number;
  datePublished?: string;
  description?: string;
  inLanguage?: string;
  image?: string;
  publisher?: string;
}

export interface PageInfo {
  url: string;
  title: string;
  metaDescription: string;
  ogImage: string | null;
  text: string;
  links: { href: string; text: string }[];
  book: BookLd | null;
  emails: FoundEmail[];
  newsletterSignals: string[];
  storeSignals: string[];
  retailerLinks: string[];
  socialLinks: string[];
  copyrightYear: number | null;
  https: boolean;
  generator: string | null;
}

export interface FoundEmail {
  email: string;
  method: "mailto" | "text" | "deobfuscated" | "cloudflare";
  context: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
const OBFUSCATED_RE = /([A-Za-z0-9._%+-]+)\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|\s+at\s+)\s*([A-Za-z0-9-]+(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+|\.)\s*[A-Za-z0-9-]+)+)/gi;
const JUNK_EMAIL = /(example\.(com|org)|sentry|wixpress\.com|@\d+x\.|\.(png|jpe?g|gif|webp|svg|css|js)$|^u00|domain\.com|email\.com$|yourname|youremail|name@|user@|test@)/i;

/** Decodes Cloudflare email protection (data-cfemail) – the address is published on the page, just encoded. */
export function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function extractEmails(html: string, $?: cheerio.CheerioAPI): FoundEmail[] {
  const $$ = $ ?? cheerio.load(html);
  const found = new Map<string, FoundEmail>();
  const add = (email: string, method: FoundEmail["method"], context: string) => {
    const e = email.trim().replace(/^mailto:/i, "").split("?")[0].replace(/[.,;:]+$/, "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(e) || JUNK_EMAIL.test(e)) return;
    if (!found.has(e)) found.set(e, { email: e, method, context: cleanText(context).slice(0, 240) });
  };
  $$("a[href^='mailto:' i]").each((_, el) => {
    const href = $$(el).attr("href") ?? "";
    const ctx = $$(el).parent().text() || $$(el).text();
    try {
      add(decodeURIComponent(href.slice(7)), "mailto", ctx);
    } catch {
      add(href.slice(7), "mailto", ctx);
    }
  });
  $$("[data-cfemail]").each((_, el) => {
    const hex = $$(el).attr("data-cfemail");
    if (hex) add(decodeCfEmail(hex), "cloudflare", $$(el).parent().text());
  });
  $$("script, style, noscript").remove();
  const text = spacedText($$);
  for (const m of text.matchAll(EMAIL_RE)) {
    const i = m.index ?? 0;
    add(m[0], "text", text.slice(Math.max(0, i - 120), i + m[0].length + 60));
  }
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    const local = m[1];
    const domain = m[2].replace(/\s*(\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+)\s*/gi, ".").replace(/\s+/g, "");
    if (!/\.[a-z]{2,}$/i.test(domain)) continue;
    const i = m.index ?? 0;
    add(`${local}@${domain}`, "deobfuscated", text.slice(Math.max(0, i - 120), i + m[0].length + 60));
  }
  // Drop text matches that merely wrap a cleaner address found elsewhere (e.g. "xjane@site.comprivacy").
  const all = [...found.values()];
  return all.filter((f) => !all.some((o) => o !== f && o.email.length < f.email.length && f.email.includes(o.email) && f.method !== "mailto"));
}

/** Visible text with whitespace between elements, so adjacent nodes never glue together. */
export function spacedText($: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      if (n.type === "text") parts.push(n.data);
      else if (n.type === "tag" && !["script", "style", "noscript", "svg"].includes(n.name)) {
        parts.push(" ");
        walk(n.children ?? []);
        parts.push(" ");
      }
    }
  };
  const body: any = $("body").get(0) ?? $.root().get(0);
  walk(body?.children ?? []);
  return parts.join("").replace(/\s+/g, " ").trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m,
  );
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

export function parseJsonLdBooks($: cheerio.CheerioAPI): BookLd | null {
  const nodes: any[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      for (const n of asArray(parsed)) {
        nodes.push(n);
        for (const g of asArray(n?.["@graph"])) nodes.push(g);
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  const book = nodes.find((n) => asArray(n?.["@type"]).some((t: string) => /^(Book|Product|CreativeWork)$/.test(t)) && n.name);
  if (!book) return null;
  const agg = book.aggregateRating ?? {};
  const authors = asArray(book.author).map((a: any) => (typeof a === "string" ? a : a?.name)).filter(Boolean);
  const ed = asArray(book.workExample)[0] ?? {};
  return {
    name: decodeEntities(cleanText(String(book.name))),
    authors,
    ratingCount: num(agg.ratingCount),
    reviewCount: num(agg.reviewCount),
    ratingValue: num(agg.ratingValue),
    isbn: book.isbn ?? ed.isbn,
    bookFormat: book.bookFormat ?? ed.bookFormat,
    numberOfPages: num(book.numberOfPages ?? ed.numberOfPages),
    datePublished: book.datePublished ?? ed.datePublished,
    description: book.description ? decodeEntities(cleanText(String(book.description))) : undefined,
    inLanguage: typeof book.inLanguage === "string" ? book.inLanguage : book.inLanguage?.name,
    image: typeof book.image === "string" ? book.image : book.image?.url,
    publisher: typeof book.publisher === "string" ? book.publisher : book.publisher?.name,
  };
}

const NEWSLETTER_PATTERNS: [RegExp, string][] = [
  [/list-manage\.com|mailchimp/i, "Mailchimp"],
  [/convertkit|ck\.page|kit\.com\/|kit-form/i, "Kit/ConvertKit"],
  [/mailerlite/i, "MailerLite"],
  [/substack\.com\/(subscribe|embed)|\.substack\.com/i, "Substack"],
  [/bookfunnel/i, "BookFunnel"],
  [/flodesk/i, "Flodesk"],
  [/klaviyo/i, "Klaviyo"],
  [/sendinblue|brevo/i, "Brevo"],
  [/aweber/i, "AWeber"],
  [/beehiiv/i, "beehiiv"],
  [/newsletter|mailing list|sign up for (my|our) (news|updates)|join (my|the) (list|readers)|newsletter abonnieren|lettre d'information|nieuwsbrief/i, "newsletter wording"],
];
const STORE_PATTERNS: [RegExp, string][] = [
  [/cdn\.shopify\.com|myshopify\.com/i, "Shopify"],
  [/woocommerce|wc-ajax|add-to-cart=/i, "WooCommerce"],
  [/payhip\.com/i, "Payhip"],
  [/gumroad\.com/i, "Gumroad"],
  [/bookfunnel\.com\/.*(store|checkout)|delivery\.bookfunnel/i, "BookFunnel store"],
  [/ko-fi\.com\/s?\//i, "Ko-fi shop"],
  [/squarespace-commerce|\/cart\b/i, "Squarespace/other cart"],
];
const RETAILER_HOSTS = /amazon\.|amzn\.(to|eu)|books\.apple\.com|play\.google\.com|kobo\.com|barnesandnoble\.com|books2read\.com|smashwords\.com|bookshop\.org|waterstones\.com|thalia\.de|lulu\.com|bookbaby\.com|scribd\.com|audible\.|storytel\.|ingramspark|payhip\.com|gumroad\.com|draft2digital/i;
const SOCIAL_HOSTS = /instagram\.com|tiktok\.com|facebook\.com|twitter\.com|(^|\/\/)(www\.)?x\.com|youtube\.com|pinterest\.|linkedin\.com|threads\.net|bsky\.app|goodreads\.com\/author|bookbub\.com\/(authors|profile)|amazon\.[a-z.]+\/(stores|.*\/e\/)/i;

export function extractPage(html: string, url: string): PageInfo {
  const $ = cheerio.load(html);
  const book = parseJsonLdBooks($);
  const emails = extractEmails(html, cheerio.load(html));
  const links: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href") ?? "";
    if (/^(javascript|tel|mailto|data):/i.test(raw) || raw.startsWith("#")) return;
    try {
      links.push({ href: new URL(raw, url).toString(), text: cleanText($(el).text()).slice(0, 120) });
    } catch {
      /* skip */
    }
  });
  const htmlLower = html.slice(0, 2_000_000);
  const newsletterSignals = NEWSLETTER_PATTERNS.filter(([re]) => re.test(htmlLower)).map(([, n]) => n);
  const storeSignals = STORE_PATTERNS.filter(([re]) => re.test(htmlLower)).map(([, n]) => n);
  const retailerLinks = [...new Set(links.map((l) => l.href).filter((h) => RETAILER_HOSTS.test(h)))];
  const socialLinks = [...new Set(links.map((l) => l.href).filter((h) => SOCIAL_HOSTS.test(h)))];
  const generator = $("meta[name='generator']").attr("content") ?? null;
  $("script, style, noscript, svg").remove();
  const text = spacedText($);
  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
  return {
    url,
    title: cleanText($("title").first().text()),
    metaDescription: cleanText($("meta[name='description']").attr("content") ?? $("meta[property='og:description']").attr("content") ?? ""),
    ogImage: $("meta[property='og:image']").attr("content") ?? null,
    text: text.slice(0, 60_000),
    links,
    book,
    emails,
    newsletterSignals,
    storeSignals,
    retailerLinks,
    socialLinks,
    copyrightYear: years.length ? Math.max(...years) : null,
    https: url.startsWith("https:"),
    generator,
  };
}

/** Goodreads book/show specifics beyond JSON-LD (publication line, series, genres). */
export function extractGoodreadsExtras(html: string): { publicationLine?: string; expected?: boolean; series?: string; genres: string[]; formatsLine?: string } {
  const $ = cheerio.load(html);
  const pub = cleanText($("[data-testid='publicationInfo']").first().text());
  const series = cleanText($("h3.Text__italic a, [aria-label^='Book'] a[href*='/series/']").first().text()) || undefined;
  const genres: string[] = [];
  $("[data-testid='genresList'] a .Button__labelItem").each((_, el) => {
    genres.push(cleanText($(el).text()));
  });
  const formatsLine = cleanText($("[data-testid='pagesFormat']").first().text()) || undefined;
  return { publicationLine: pub || undefined, expected: /expected publication/i.test(pub), series, genres: genres.slice(0, 6), formatsLine };
}

/** Links on a site that likely lead to contact/about/press pages (multilingual). */
export function contactPageCandidates(info: PageInfo, siteDomain: string): string[] {
  const re = /(contact|about|press|media|kit|agent|rights|enquir|inquir|work-with|hire|kontakt|impressum|ueber|uber-mich|über|a-propos|propos|contacto|contatti|chi-sono|over-mij|contact-me|yhteys|kontakta|om-mig|om-meg|bio|newsletter)/i;
  const out = new Set<string>();
  for (const l of info.links) {
    let host = "";
    try {
      host = new URL(l.href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (host !== siteDomain) continue;
    if (re.test(l.href) || re.test(l.text)) out.add(l.href.split("#")[0]);
  }
  return [...out];
}

export function detectPlatform(url: string): string {
  return platformOf(url);
}
