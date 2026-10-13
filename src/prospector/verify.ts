import type { Fetcher } from "../adapters/fetch/http.js";
import { FetchBlockedError } from "../adapters/fetch/http.js";
import { extractPage, contactPageCandidates, type PageInfo } from "../analysis/extract.js";
import { SEED_ONLY, platformOf } from "../adapters/sources.js";
import { domainOf, normalizeKey } from "../util/text.js";
import type { ProspectCandidate } from "./candidate.js";
import { detectSignals, EBOOK_TERMS, RETAILERS, AUTHOR_PROFILE, PROVIDER_PROFILE, type SignalHit } from "./lexicon.js";
import { resolveMxRobust, type MxLookup } from "../email/verify.js";
import { countryFromImpressum, countryFromMentionsLegales, countryFromText, marketByName } from "./markets.js";

/** Hosts the agent never fetches: bot-blocking or terms prohibit automated access. Evidence there stays unverified. */
export const NO_FETCH_HOSTS =
  /(^|\.)(amazon\.[a-z.]+|a\.co|amzn\.to|amzn\.eu|reddit\.com|kickstarter\.com|indiegogo\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com|kboards\.com|upwork\.com|fiverr\.com|threads\.net|youtube\.com|discord\.com)$/i;

/** Shared hosting platforms: the domain does not identify one author. */
export const SHARED_HOSTS =
  /(^|\.)(bsky\.app|bsky\.social|mastodon\.[a-z]+|wordpress\.com|blogspot\.com|substack\.com|medium\.com|wixsite\.com|weebly\.com|carrd\.co|linktr\.ee|beacons\.ai|goodreads\.com|wattpad\.com|github\.io|squarespace\.com|tumblr\.com|ko-fi\.com|patreon\.com|campsite\.bio|bio\.link|allmylinks\.com|about\.me|google\.com|amazon\.[a-z.]+|books2read\.com|payhip\.com|gumroad\.com|itch\.io|twitch\.tv|buymeacoffee\.com|linkin\.bio|lnk\.bio|solo\.to|hoo\.be|withkoji\.com|msha\.ke|stan\.store|bookbub\.com|bookfunnel\.com|storygraph\.com|tapas\.io|webtoons\.com|royalroad\.com|ao3\.org|archiveofourown\.org)$/i;

export interface PageCheck {
  url: string;
  role: "source" | "website" | "contact" | "additional" | "profile";
  ok: boolean;
  status?: number;
  note?: string;
  nameFound: boolean;
  quoteFound?: boolean;
  ebookConnection: boolean;
  own: boolean;
}

export interface FoundContactEmail {
  email: string;
  pageUrl: string;
  attribution: string;
  /** DNS MX check of the domain: says mail can be routed there, not that the mailbox exists. */
  mx?: "mx_found" | "no_mx" | "unchecked";
}

export interface Verification {
  pages: PageCheck[];
  sourceAccessible: boolean;
  sourceBlockedReason?: string;
  quoteVerified: boolean;
  /** Signals from text the agent fetched itself, restricted to attributable text. */
  signals: SignalHit[];
  identityVerified: boolean;
  identityBasis: string;
  ebookConnection: boolean;
  ebookBasis: string;
  isServiceProvider: boolean;
  country?: { country: string; quote: string; url: string };
  bookTitleVerified: boolean;
  emails: FoundContactEmail[];
  /** Addresses seen on the author's pages but not attributable to the author (agent, publisher, host, other person). */
  emailsRejected: string[];
  contactPage?: string;
  officialWebsite?: string;
  retailers: string[];
  platformsMentioned: string[];
  audit: string[];
  evidenceDate?: string;
  currentYearMentioned: boolean;
  language?: string;
  errors: string[];
}

export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when the quote appears in the text: exact after normalisation, or ≥80% of its 5-word shingles. */
export function containsQuote(text: string, quote: string): boolean {
  const t = normalizeForMatch(text);
  const q = normalizeForMatch(quote);
  if (!q) return false;
  if (t.includes(q)) return true;
  const words = q.split(" ");
  if (words.length < 6) return false;
  let hit = 0;
  const shingles = words.length - 4;
  for (let i = 0; i < shingles; i++) if (t.includes(words.slice(i, i + 5).join(" "))) hit++;
  return hit / shingles >= 0.8;
}

export function nameInText(name: string, text: string): boolean {
  const t = ` ${normalizeKey(text)} `;
  const n = normalizeKey(name);
  if (!n) return false;
  if (t.includes(` ${n} `)) return true;
  // Accept surname + first-name initial forms ("J. Smith") for multi-part names.
  const parts = n.split(" ").filter((p) => p.length > 1);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    return t.includes(` ${last} `) && t.includes(` ${parts[0]} `);
  }
  return false;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"')]+|\b(?:www\.)[a-z0-9-]+\.[a-z.]{2,}[^\s<>"')]*|\b[a-z0-9-]+\.(?:com|net|org|co\.uk|com\.au|ca|de|fr|nl|ie|nz|io|me|uk|eu|ch|at|se|no|dk|fi|be|es|it|jp|sg|ink|art|blog|author|books|page|site|website|online|world|xyz)\b(?:\/[^\s<>"')]*)?/gi;

/** Candidate personal-site URLs mentioned in a profile bio. */
export function websitesInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_IN_TEXT)) {
    // Skip the domain part of an email address ("jane@gmail.com").
    if ((m.index ?? 0) > 0 && text[(m.index ?? 0) - 1] === "@") continue;
    let u = m[0].replace(/[.,;:!?]+$/, "");
    if (!/^https?:/i.test(u)) u = `https://${u}`;
    const host = domainOf(u);
    if (!host || NO_FETCH_HOSTS.test(host) || SHARED_HOSTS.test(host) && !/\.(wordpress|blogspot|substack|wixsite|weebly|carrd)\./i.test(host)) continue;
    if (/(^|\.)(bsky\.app|bsky\.social|linktr\.ee|instagram|tiktok|facebook|youtube|patreon|ko-fi|threads|twitch|itch\.io|buymeacoffee|a\.co|amzn|discord|spotify|apple\.com|google\.com)/i.test(host)) continue;
    if (/(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton|aol|gmx|web\.de|email-provider|list-manage|mailerlite|mailchimp|kit\.com|convertkit|substack\.com$|accounts\.google)/i.test(host)) continue;
    out.push(u);
  }
  return [...new Set(out)];
}

const RETAILER_TEXT: [RegExp, string][] = [
  [/\b(kdp|kindle direct publishing|kindle unlimited|\bku\b|kindle)\b/i, "Amazon KDP"],
  [/\bkobo\b/i, "Kobo"],
  [/\bapple books\b|\bibooks\b/i, "Apple Books"],
  [/\bgoogle play( books)?\b/i, "Google Play Books"],
  [/\bdraft2digital\b|\bd2d\b|\bbooks2read\b/i, "Draft2Digital"],
  [/\bingram ?spark\b/i, "IngramSpark"],
  [/\bsmashwords\b/i, "Smashwords"],
  [/\bbarnes ?& ?noble\b|\bnook\b/i, "Barnes & Noble"],
  [/\bwattpad\b/i, "Wattpad"],
  [/\bkickstarter\b/i, "Kickstarter"],
  [/\bpayhip\b|\bbookfunnel\b|\bgumroad\b|\bshopify\b/i, "Direct sales"],
];

export function platformsInText(text: string): string[] {
  return RETAILER_TEXT.filter(([re]) => re.test(text)).map(([, n]) => n);
}

function retailersFromLinks(info: PageInfo): string[] {
  const out = new Set<string>();
  for (const l of info.links) {
    const host = domainOf(l.href) ?? "";
    for (const [name, re] of Object.entries(RETAILERS)) if (re.test(host)) out.add(name);
  }
  return [...out];
}

interface Fetched {
  check: PageCheck;
  info?: PageInfo;
  lang?: string;
}

async function fetchPage(fetcher: Fetcher, url: string, role: PageCheck["role"], name: string, own: boolean): Promise<Fetched> {
  const host = domainOf(url) ?? "";
  const base: PageCheck = { url, role, ok: false, nameFound: false, ebookConnection: false, own };
  if (NO_FETCH_HOSTS.test(host) || SEED_ONLY.has(platformOf(url))) {
    return { check: { ...base, note: `not fetched: ${host} blocks automated access or its terms prohibit it` } };
  }
  try {
    const r = await fetcher.get(url);
    if (r.status >= 400) return { check: { ...base, status: r.status, note: `HTTP ${r.status}` } };
    const info = extractPage(r.body, r.finalUrl);
    const lang = /<html[^>]*\blang=["']?([a-zA-Z-]{2,8})/i.exec(r.body)?.[1]?.slice(0, 2).toLowerCase();
    const text = `${info.title} ${info.metaDescription} ${info.text}`;
    return {
      check: { ...base, ok: true, status: r.status, nameFound: nameInText(name, text), ebookConnection: EBOOK_TERMS.test(text) || info.retailerLinks.length > 0 },
      info,
      lang,
    };
  } catch (e) {
    const note = e instanceof FetchBlockedError ? `blocked: ${e.message}` : `error: ${(e as Error).message}`;
    return { check: { ...base, note } };
  }
}

function pageText(info: PageInfo): string {
  return `${info.title}\n${info.metaDescription}\n${info.text}`;
}

const NOW_YEAR = () => new Date().getFullYear();

/**
 * Re-fetches every page a candidate cites and records what the agent itself could confirm.
 * Nothing in the candidate is trusted: quotes, names, countries, emails and categories are all re-checked.
 */
export async function verifyCandidate(c: ProspectCandidate, fetcher: Fetcher, mxLookup: MxLookup | null = resolveMxRobust): Promise<Verification> {
  const v: Verification = {
    pages: [],
    sourceAccessible: false,
    quoteVerified: false,
    signals: [],
    identityVerified: false,
    identityBasis: "",
    ebookConnection: false,
    ebookBasis: "",
    isServiceProvider: false,
    bookTitleVerified: false,
    emails: [],
    emailsRejected: [],
    retailers: [],
    platformsMentioned: [],
    audit: [],
    currentYearMentioned: false,
    errors: [],
  };
  const ownTexts: { url: string; text: string }[] = [];
  const allTexts: { url: string; text: string }[] = [];
  const name = c.name;

  // 1. Source evidence.
  let sourceText = "";
  let sourceOwn = false;
  if (c.apiText) {
    // Fetched by the agent through a public API (Bluesky/Mastodon): the post belongs to the profile owner.
    sourceText = c.apiText;
    sourceOwn = true;
    v.sourceAccessible = true;
    v.pages.push({ url: c.sourceUrl, role: "source", ok: true, nameFound: true, ebookConnection: EBOOK_TERMS.test(c.apiText), own: true, note: "post text retrieved via public API" });
  } else {
    const siteDomain = domainOf(c.officialWebsite);
    const srcDomain = domainOf(c.sourceUrl);
    sourceOwn = !!siteDomain && !!srcDomain && (srcDomain === siteDomain || srcDomain.endsWith(`.${siteDomain}`)) && !SHARED_HOSTS.test(siteDomain);
    const f = await fetchPage(fetcher, c.sourceUrl, "source", name, sourceOwn);
    v.pages.push(f.check);
    if (f.info) {
      v.sourceAccessible = true;
      sourceText = pageText(f.info);
      if (f.lang) v.language = f.lang;
      // Personal blog subdomains (jane.substack.com, janesmith.wordpress.com) count as the author's own page.
      const sub = srcDomain?.split(".")[0] ?? "";
      if (!sourceOwn && srcDomain && SHARED_HOSTS.test(srcDomain) && normalizeKey(name).replace(/ /g, "").includes(sub) && sub.length > 4) sourceOwn = true;
      f.check.own = sourceOwn;
    } else v.sourceBlockedReason = f.check.note;
  }
  if (sourceText) allTexts.push({ url: c.sourceUrl, text: sourceText });

  if (c.evidenceQuote && sourceText) v.quoteVerified = containsQuote(sourceText, c.evidenceQuote);
  const srcCheck = v.pages.find((p) => p.role === "source");
  if (srcCheck) srcCheck.quoteFound = c.evidenceQuote ? v.quoteVerified : undefined;

  // Signals: own pages may be scanned whole; third-party pages only inside the verified quote region.
  if (sourceText) {
    if (sourceOwn) {
      ownTexts.push({ url: c.sourceUrl, text: sourceText });
      if (c.apiText) v.signals.push(...detectSignals(c.apiText, { wholeTextIsOnePost: true }));
      else v.signals.push(...detectSignals(c.evidenceQuote && v.quoteVerified ? c.evidenceQuote : sourceText, { wholeTextIsOnePost: !!(c.evidenceQuote && v.quoteVerified) }));
    } else if (c.evidenceQuote && v.quoteVerified) {
      // Third-party pages (forums, directories): only the verified quote itself is attributable to the candidate.
      v.signals.push(...detectSignals(c.evidenceQuote, { wholeTextIsOnePost: true }));
    }
  }

  // 2. Profile bio from API.
  if (c.apiProfileText) {
    ownTexts.push({ url: c.profileUrl ?? c.sourceUrl, text: c.apiProfileText });
    allTexts.push({ url: c.profileUrl ?? c.sourceUrl, text: c.apiProfileText });
    v.pages.push({ url: c.profileUrl ?? c.sourceUrl, role: "profile", ok: true, nameFound: true, ebookConnection: EBOOK_TERMS.test(c.apiProfileText), own: true, note: "profile retrieved via public API" });
  }

  // 3. Official website + contact page.
  let website = c.officialWebsite;
  if (!website && c.apiProfileText) website = websitesInText(c.apiProfileText)[0];
  if (website) {
    const f = await fetchPage(fetcher, website, "website", name, true);
    v.pages.push(f.check);
    if (f.info) {
      v.officialWebsite = f.info.url;
      const t = pageText(f.info);
      const named = f.check.nameFound || (!!c.businessName && nameInText(c.businessName, t));
      f.check.nameFound = named;
      if (named) {
        ownTexts.push({ url: f.info.url, text: t });
        if (!v.language && f.lang) v.language = f.lang;
      }
      allTexts.push({ url: f.info.url, text: t });
      v.retailers.push(...retailersFromLinks(f.info));
      const siteDomain = domainOf(f.info.url) ?? "";
      if (named) {
        for (const e of f.info.emails) addEmail(v, c, e.email, f.info.url, siteDomain);
        v.audit.push(...auditSite(f.info));
      }
      const contactUrls = c.contactPage ? [c.contactPage] : contactPageCandidates(f.info, siteDomain.replace(/^www\./, "")).filter((u) => /contact|kontakt|impressum|contacto|contatti|yhteys|kontakta/i.test(u)).slice(0, 1);
      for (const cu of contactUrls) {
        const cf = await fetchPage(fetcher, cu, "contact", name, true);
        v.pages.push(cf.check);
        if (cf.info && named) {
          v.contactPage = cf.info.url;
          for (const e of cf.info.emails) addEmail(v, c, e.email, cf.info.url, siteDomain);
          ownTexts.push({ url: cf.info.url, text: pageText(cf.info) });
          allTexts.push({ url: cf.info.url, text: pageText(cf.info) });
        }
      }
      if (named && !v.contactPage && f.info.emails.length === 0) {
        const anyContact = contactPageCandidates(f.info, siteDomain.replace(/^www\./, ""))[0];
        if (anyContact && /contact|kontakt/i.test(anyContact)) v.contactPage = anyContact;
      }
    }
  }

  // 4. Additional sources.
  for (const u of c.additionalUrls.slice(0, 3)) {
    const f = await fetchPage(fetcher, u, "additional", name, false);
    v.pages.push(f.check);
    if (f.info) {
      const t = pageText(f.info);
      allTexts.push({ url: f.info.url, text: t });
      const host = domainOf(f.info.url) ?? "";
      const own = f.check.nameFound && !!v.officialWebsite && host === domainOf(v.officialWebsite);
      if (own) ownTexts.push({ url: f.info.url, text: t });
      if (c.evidenceQuote && !v.quoteVerified && containsQuote(t, c.evidenceQuote)) {
        v.quoteVerified = true;
        f.check.quoteFound = true;
        v.signals.push(...detectSignals(c.evidenceQuote, { wholeTextIsOnePost: true }));
      }
    }
  }

  // 5. Identity.
  const site = v.pages.find((p) => p.role === "website");
  const profile = v.pages.find((p) => p.role === "profile");
  const profileIsAuthor = !!c.apiProfileText && AUTHOR_PROFILE.test(c.apiProfileText);
  if (site?.ok && site.nameFound) {
    v.identityVerified = true;
    v.identityBasis = `Name found on official website ${site.url}`;
  } else if (profile && profileIsAuthor && looksLikeNamedIdentity(name)) {
    v.identityVerified = true;
    v.identityBasis = "Public profile describes the account holder as an author/writer";
  } else if (!c.apiText && srcCheck?.ok && sourceOwn && srcCheck.nameFound) {
    v.identityVerified = true;
    v.identityBasis = `Name found on author-owned source page ${c.sourceUrl}`;
  } else if (v.pages.some((p) => p.role === "additional" && p.ok && p.nameFound) && srcCheck?.ok && srcCheck.nameFound) {
    v.identityVerified = true;
    v.identityBasis = "Name found on the source page and on an independent additional source";
  } else {
    v.identityBasis = "Identity not confirmed on any page the agent could fetch";
  }
  const bio = `${c.apiProfileText ?? ""}`;
  const handleAndDomain = `${c.profileUrl ?? ""} ${v.officialWebsite ?? c.officialWebsite ?? ""}`.toLowerCase();
  v.isServiceProvider =
    (PROVIDER_PROFILE.test(bio) && !/\b(author|novelist)\b/i.test(bio.replace(PROVIDER_PROFILE, ""))) ||
    (/edit(s|ing|or|orial)|designs?\b|covers?\b|formatt|proofread|illustrat|narrat|translat|publishingservices/.test(handleAndDomain) && !/author|books|writes|novel/.test(handleAndDomain));

  // 6. eBook / publishing connection from own text.
  const ownJoined = ownTexts.map((t) => t.text).join("\n");
  const ebookHit = EBOOK_TERMS.exec(ownJoined);
  if (v.retailers.length) {
    v.ebookConnection = true;
    v.ebookBasis = `Retailer/store links on official website: ${v.retailers.join(", ")}`;
  } else if (ebookHit) {
    v.ebookConnection = true;
    v.ebookBasis = `Author-owned text mentions "${ebookHit[0]}"`;
  } else if (v.signals.some((s) => s.kind === "explicit" && s.category && ["Editing", "Proofreading", "Formatting", "Cover Design", "Publishing Setup", "Audiobook", "Translation"].includes(s.category))) {
    v.ebookConnection = true;
    v.ebookBasis = "Verified request for book-production services (eBook format itself not confirmed)";
  } else v.ebookBasis = "No eBook or digital-publishing evidence on fetched author-owned text";
  v.platformsMentioned = platformsInText(ownJoined + "\n" + (c.evidenceQuote && v.quoteVerified ? c.evidenceQuote : ""));

  // 7. Location: claimed quote must be on a fetched page; otherwise look for location phrasing on own pages.
  // A birthplace or childhood home is not evidence of where the author is located now.
  const birthplaceOnly = (q: string) => /\b(born|grew up|raised|originally from|geboren|né|née|nacido|nata|nato)\b/i.test(q) && !/\b(lives?|living|based|resides?|now|lebt|wohnt|vit|vive|woont)\b/i.test(q);
  if (c.locationQuote && !birthplaceOnly(c.locationQuote)) {
    const hit = allTexts.find((t) => containsQuote(t.text, c.locationQuote!) || normalizeForMatch(t.text).includes(normalizeForMatch(c.locationQuote!)));
    if (hit) {
      const m = marketByName(c.country);
      const detected = countryFromText(c.locationQuote) ?? (m && new RegExp(`\\b(${m.places.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i").test(c.locationQuote) ? { country: m.country, quote: c.locationQuote } : null);
      if (detected) v.country = { country: detected.country, quote: c.locationQuote, url: hit.url };
      else if (c.country && normalizeForMatch(c.locationQuote).includes(normalizeForMatch(c.country))) v.country = { country: c.country, quote: c.locationQuote, url: hit.url };
    }
  }
  if (!v.country) {
    for (const t of ownTexts) {
      const found = countryFromText(t.text, c.name) ?? countryFromImpressum(t.text) ?? countryFromMentionsLegales(t.text);
      if (found) {
        v.country = { ...found, url: t.url };
        break;
      }
    }
  }

  if (c.bookTitle) v.bookTitleVerified = allTexts.some((t) => normalizeForMatch(t.text).includes(normalizeForMatch(c.bookTitle!)));
  const yr = NOW_YEAR();
  v.currentYearMentioned = new RegExp(`\\b(${yr}|${yr + 1})\\b`).test(ownJoined + (v.quoteVerified ? sourceText : ""));
  v.evidenceDate = c.evidenceDate;
  if (!v.language && c.language) v.language = c.language;
  // De-duplicate emails, keep first attribution.
  const seen = new Set<string>();
  v.emails = v.emails.filter((e) => plausibleEmail(e.email) && (seen.has(e.email) ? false : (seen.add(e.email), true)));
  if (mxLookup) {
    for (const e of v.emails.slice(0, 3)) {
      try {
        e.mx = (await mxLookup(e.email.split("@")[1])).length ? "mx_found" : "no_mx";
      } catch (err) {
        const code = (err as { code?: string }).code;
        e.mx = code === "ENOTFOUND" || code === "ENODATA" ? "no_mx" : "unchecked";
      }
    }
    v.emails = v.emails.filter((e) => e.mx !== "no_mx" || (v.emailsRejected.push(`${e.email} (domain has no MX records)`), false));
  }
  return v;
}

const COMMON_TLDS = new Set("com net org edu gov co io me info biz eu uk de fr nl be lu ch at it es pt ie se no dk fi is au nz ca us jp kr sg ae in za mx br ar pl cz gr hu ro tr il online email ink art blog page site website xyz books author club life live world studio media design agency press pub store shop space tech app dev cafe today news fun moe".split(" "));

/** Rejects text-extraction artefacts ("blog@wordpress.com.subscribe", "raise@work.this") and platform addresses. */
export function plausibleEmail(email: string): boolean {
  const m = /^[^@\s]+@([a-z0-9-]+\.)+([a-z]{2,24})$/i.exec(email);
  if (!m) return false;
  if (!COMMON_TLDS.has(m[2].toLowerCase())) return false;
  return !/@(wordpress\.com|wixpress\.com|sentry\.|squarespace\.com|example\.)|^(noreply|no-reply|donotreply)@/i.test(email);
}

const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|me|mac|proton|protonmail|pm|aol|gmx|web|posteo|mailbox|orange|free|laposte|sfr|wanadoo|libero|virgilio|t-online|freenet|bluewin|btinternet|sky|virginmedia|bigpond|optusnet|xtra|shaw|telus|rogers|sympatico|comcast|att|verizon|zoho|fastmail|hey)\./i;

/** Name/brand tokens (≥4 letters) used to attribute an off-domain address to the author. */
function identityTokens(c: ProspectCandidate, siteDomain: string): string[] {
  const words = [c.name, c.businessName ?? "", siteDomain.split(".")[0]].flatMap((s) => normalizeKey(s).split(" "));
  return [...new Set(words.filter((w) => w.length >= 4 && !["author", "books", "writer", "official", "press", "the"].includes(w)))];
}

/**
 * Records an address only when it is attributable to the author: same domain as their site, or a mailbox whose
 * address carries their name/brand. Agents', publishers', hosts' and other people's addresses are rejected.
 */
function addEmail(v: Verification, c: ProspectCandidate, email: string, pageUrl: string, siteDomain: string): void {
  const [local, ed = ""] = email.split("@");
  const sd = siteDomain.replace(/^www\./, "");
  if (ed === sd || ed.endsWith(`.${sd}`) || sd.endsWith(`.${ed}`)) {
    v.emails.push({ email, pageUrl, attribution: "on author's own website, same domain" });
    return;
  }
  const hay = `${local} ${ed}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (identityTokens(c, sd).some((t) => hay.includes(t))) {
    v.emails.push({ email, pageUrl, attribution: FREEMAIL.test(ed) ? "on author's own website (personal mailbox carrying the author's name)" : "on author's own website (author-named business domain)" });
    return;
  }
  v.emailsRejected.push(`${email} (not attributable to the author)`);
}

/** A personal or pen name with at least two capitalised parts ("Jane Doe", "J. K. Smith"), or a CJK name. */
export function looksLikeNamedIdentity(name: string): boolean {
  const n = name.replace(/[^\p{L}\s.'-]/gu, " ").trim();
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(n)) return true;
  const parts = n.split(/\s+/).filter((w) => w.replace(/\./g, "").length > 0);
  return parts.length >= 2 && parts.length <= 5 && parts.slice(0, 2).every((w) => /^\p{Lu}/u.test(w)) && !/^[A-Z]+$/.test(parts.join(""));
}

/** Concrete, observable website issues (used as supporting evidence only). */
export function auditSite(info: PageInfo): string[] {
  const out: string[] = [];
  const yr = NOW_YEAR();
  if (info.copyrightYear && info.copyrightYear <= yr - 3) out.push(`Website footer copyright is ${info.copyrightYear} (possibly outdated)`);
  if (!info.https) out.push("Website served without HTTPS");
  const r = retailersFromLinks(info);
  if (r.length === 1 && r[0] === "Amazon") out.push("Only Amazon retailer links found on homepage (no Kobo/Apple/Google/B&N)");
  if (!info.newsletterSignals.length) out.push("No newsletter signup detected on homepage");
  return out;
}
