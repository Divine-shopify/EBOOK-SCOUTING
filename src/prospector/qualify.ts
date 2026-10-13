import type { ProspectCandidate } from "./candidate.js";
import type { Verification } from "./verify.js";
import { BIG_PUBLISHER, aboutOtherAuthor, categoryLabel, servicesIn, type OpportunityCategory } from "./lexicon.js";
import { domainOf, normalizeKey } from "../util/text.js";
import { SHARED_HOSTS } from "./verify.js";
import { cleanDisplayName } from "./discovery.js";
import { releaseTiming } from "./dates.js";

export const COLUMNS = [
  "Prospect Name", "First Name", "Author or Business Name", "Country", "State or Region", "City", "Preferred Language",
  "Author Type", "Book Title", "Book Topic or Genre", "Book Status", "Publishing Platform", "Publishing Stage",
  "Service Opportunity", "Opportunity Category", "Buying Intent", "Evidence of Need", "Opportunity Rationale",
  "Public Professional Email", "Public Contact Page", "Official Website", "Source URL", "Additional Source URL",
  "Evidence Type", "Research Confidence", "Lead Status", "Date Researched", "Notes",
] as const;
export type Column = (typeof COLUMNS)[number];
export type ProspectRecord = Record<Column, string>;

export type Level = "High" | "Medium" | "Low";
export type LeadStatus = "Ready" | "Needs Review" | "Excluded";

export interface Decision {
  record: ProspectRecord;
  status: LeadStatus;
  intent: Level;
  confidence: Level;
  categories: OpportunityCategory[];
  reasons: string[];
  dedupKeys: string[];
  identityKey: string;
}

const LANG_NAMES: Record<string, string> = { en: "English", de: "German", fr: "French", es: "Spanish", it: "Italian", nl: "Dutch", sv: "Swedish", no: "Norwegian", nb: "Norwegian", da: "Danish", fi: "Finnish", ja: "Japanese", ko: "Korean", pt: "Portuguese", is: "Icelandic", ar: "Arabic", zh: "Chinese", pl: "Polish", ga: "Irish" };

export function monthsSince(iso: string | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / (30.44 * 86400_000);
}

const AUTHOR_TYPES = ["Independent Author", "Self-Published Author", "Traditionally Published Author", "Author-Owned Business", "Independent Publisher", "Other Verified Type"];
const EVIDENCE_TYPES = ["Official Author Website", "Publishing Platform", "Public Service Request", "Public Professional Profile", "Publisher Website", "Author Interview", "Public Forum", "Public Social Profile", "Public Business Profile", "Other Verified Source"];

function stageFor(cats: OpportunityCategory[], stageLabels: string[], status: string): string {
  if (stageLabels.some((l) => /relaunch/i.test(l))) return "Expansion";
  if (stageLabels.some((l) => /pre-order|upcoming release|cover reveal/i.test(l))) return "Pre-Launch";
  if (cats.some((c) => c === "Editing" || c === "Proofreading")) return "Manuscript Preparation";
  if (cats.some((c) => c === "Cover Design" || c === "Formatting" || c === "Publishing Setup")) return "Production";
  if (cats.some((c) => c === "Translation" || c === "Audiobook" || c === "Distribution")) return "Expansion";
  if (cats.some((c) => c === "Marketing" || c === "Advertising" || c === "Listing Optimization")) return status === "Published" ? "Established Catalog" : "Pre-Launch";
  if (stageLabels.some((l) => /manuscript/i.test(l))) return "Manuscript Preparation";
  return "Unclear";
}

function bookStatusFor(stageStatuses: string[], cats: OpportunityCategory[], claimed?: string): string {
  if (stageStatuses.includes("Relaunch")) return "Relaunch";
  if (stageStatuses.includes("Forthcoming")) return "Forthcoming";
  if (stageStatuses.includes("In Progress")) return "In Progress";
  if (stageStatuses.includes("Unpublished")) return "Unpublished";
  if (cats.some((c) => ["Editing", "Proofreading", "Cover Design", "Formatting", "Publishing Setup"].includes(c))) return "In Progress";
  const ok = ["Unpublished", "In Progress", "Forthcoming", "Published", "Relaunch"];
  return claimed && ok.includes(claimed) ? claimed : "Unclear";
}

function evidenceTypeFor(c: ProspectCandidate, v: Verification, explicit: boolean): string {
  const host = domainOf(c.sourceUrl) ?? "";
  if (explicit && (c.apiText || /forum|community|thread|discussion/i.test(c.sourceUrl))) return "Public Service Request";
  if (c.apiText) return "Public Social Profile";
  if (v.officialWebsite && host === domainOf(v.officialWebsite)) return "Official Author Website";
  if (/forum|community|thread|discussion|absolutewrite|nanowrimo/i.test(c.sourceUrl)) return "Public Forum";
  if (/goodreads|bookbub|smashwords|draft2digital|books2read|kobo|wattpad|leanpub|payhip|gumroad/i.test(host)) return "Publishing Platform";
  if (/interview|podcast|spotlight|meet-the-author/i.test(c.sourceUrl)) return "Author Interview";
  if (explicit) return "Public Service Request";
  return "Other Verified Source";
}

function firstNameOf(c: ProspectCandidate): string {
  if (c.firstName) return c.firstName;
  if (c.businessName && c.businessName === c.name) return "";
  const first = c.name.replace(/[^\p{L}\s.'-]/gu, " ").trim().split(/\s+/)[0] ?? "";
  return first.length > 1 && !first.includes(".") && /^\p{Lu}/u.test(first) ? first : "";
}

export function dedupKeysFor(c: ProspectCandidate, v: Verification): string[] {
  const keys = new Set<string>();
  keys.add(`name:${normalizeKey(c.name)}`);
  if (c.businessName) keys.add(`name:${normalizeKey(c.businessName)}`);
  const site = domainOf(v.officialWebsite ?? c.officialWebsite);
  if (site && !SHARED_HOSTS.test(site)) keys.add(`domain:${site}`);
  for (const e of v.emails) keys.add(`email:${e.email}`);
  if (c.profileUrl) keys.add(`profile:${c.profileUrl.toLowerCase().replace(/\/+$/, "")}`);
  return [...keys];
}

/** Applies the qualification rules and builds the 28-column record. */
export function qualify(raw: ProspectCandidate, v: Verification, today = new Date()): Decision {
  // Social display names are normalised again so rule improvements apply to already-queued candidates.
  const c = raw.apiText ? { ...raw, name: cleanDisplayName(raw.name) || raw.name } : raw;
  const reasons: string[] = [];
  const explicit = v.signals.filter((s) => s.kind === "explicit");
  const stage = v.signals.filter((s) => s.kind === "stage");
  const age = monthsSince(v.evidenceDate, today);
  // Explicit requests stay current for 12 months; production-stage posts (pre-order, cover reveal) for 6.
  const stageOnly = !v.signals.some((s) => s.kind === "explicit");
  const timing = releaseTiming(v.quoteVerified && c.evidenceQuote ? c.evidenceQuote : v.signals.map((s) => s.snippet).join(" "), today);
  const fresh = stageOnly
    ? timing === "passed" ? false : timing === "current" ? true : age != null ? age <= 6 : v.currentYearMentioned
    : age != null ? age <= 12 : v.currentYearMentioned || timing === "current";
  const ageNote = age != null ? `${Math.round(age)} months old` : v.currentYearMentioned ? "undated; author-owned text mentions the current/next year" : "undated";

  // Categories come only from verified text.
  let cats = [...new Set(explicit.map((s) => s.category!).filter(Boolean))];
  let services = [...new Set(explicit.map((s) => s.service!).filter(Boolean))];
  if (!cats.length && stage.length && v.quoteVerified && c.evidenceQuote) {
    // Stage wording without an explicit request: services named in the verified quote, if any.
    const named = servicesIn(c.evidenceQuote);
    cats = [...new Set(named.map((s) => s.category))];
    services = named.map((s) => s.service);
  }
  if (!cats.length && stage.length) {
    if (stage.some((s) => s.status === "Forthcoming")) {
      cats = ["Marketing"];
      services = ["eBook launch planning", "Pre-order / ARC campaign support"];
    } else if (stage.some((s) => s.status === "Relaunch")) {
      cats = ["Cover Design", "Marketing"];
      services = ["Series cover redesign", "Relaunch marketing"];
    } else {
      cats = ["Editing", "Formatting"];
      services = ["Manuscript editing / proofreading", "eBook formatting"];
    }
  }

  // Evidence that concerns another author's book, or a title with a large traditional publisher, does not count.
  const evidenceText = v.quoteVerified && c.evidenceQuote ? c.evidenceQuote : v.signals.map((x) => x.snippet).join(" ");
  const otherAuthor = !c.apiText && stageOnly && aboutOtherAuthor(evidenceText, c.name);
  const bigPublisher = BIG_PUBLISHER.exec(evidenceText)?.[0];
  if (otherAuthor || bigPublisher) {
    explicit.length = 0;
    stage.length = 0;
    reasons.push(otherAuthor ? "evidence appears to describe another author's book (review/interview/catalogue)" : `evidence concerns a title with traditional publisher "${bigPublisher}"`);
  }

  // Buying intent.
  let intent: Level = "Low";
  if (explicit.length && fresh) intent = "High";
  else if (explicit.length && (age == null || age <= 24)) intent = "Medium";
  else if (stage.length && fresh) intent = "Medium";
  if (explicit.length && age != null && age > 24) reasons.push(`explicit request is ${Math.round(age)} months old (stale)`);
  if (!explicit.length && stage.length && timing === "passed") reasons.push("release date cited in the evidence has already passed");
  else if (!explicit.length && stage.length && !fresh) reasons.push("production-stage wording without a current date");
  if (!explicit.length && !stage.length) reasons.push("no verified service-need wording in agent-fetched text");

  // Confidence.
  const evidenceAgentVerified = (v.sourceAccessible && (!!c.apiText || v.quoteVerified || (!c.evidenceQuote && v.signals.length > 0)));
  let confidence: Level = "Low";
  if (v.identityVerified && v.ebookConnection && evidenceAgentVerified && fresh && (explicit.length || stage.length)) confidence = "High";
  else if (v.identityVerified && evidenceAgentVerified && (explicit.length || stage.length)) confidence = "Medium";
  if (confidence === "High" && !v.ebookBasis.startsWith("Retailer") && !/mentions/.test(v.ebookBasis)) confidence = "Medium";

  // Lead status.
  let status: LeadStatus;
  // Bookshops, review blogs, events and media are not authors or publishing businesses.
  const notAuthorEntity = /\b(bookstore|bookshop|book store|book shop|library|libraries|magazine|book reviews?|reviews|book club|podcast|festival|convention|bookcon|book fair|buchhandlung|librairie|librería|libreria)\b/i.test(c.name);
  if (notAuthorEntity) reasons.push("entity is a bookshop, review site, event or media outlet, not an author or publisher");
  const tradOnly = !!v.tradPublisher && !v.indieSignals && !explicit.length;
  if (tradOnly) reasons.push(`author's site names traditional publisher "${v.tradPublisher}" and shows no self-publishing activity`);
  if (v.isServiceProvider || notAuthorEntity) {
    status = "Excluded";
    reasons.push(notAuthorEntity ? "not an author or publishing business" : "profile describes a service provider, not an author/buyer");
  } else if (!tradOnly && intent !== "Low" && confidence !== "Low" && v.identityVerified && v.ebookConnection) {
    status = "Ready";
  } else if ((explicit.length || stage.length || (c.evidenceQuote && !v.sourceAccessible)) && !(age != null && age > 24)) {
    status = "Needs Review";
    if (!v.identityVerified) reasons.push(v.identityBasis);
    if (!v.ebookConnection) reasons.push(v.ebookBasis);
    if (!v.sourceAccessible) reasons.push(`evidence page not verifiable by the agent (${v.sourceBlockedReason ?? "inaccessible"})`);
    else if (c.evidenceQuote && !v.quoteVerified) reasons.push("evidence quote not found on the fetched source page");
  } else {
    status = "Excluded";
  }
  if (status !== "Ready" && intent === "High") intent = "Medium";

  const explicitSnippet = explicit[0]?.snippet ?? stage[0]?.snippet;
  const evidenceQuote = v.quoteVerified && c.evidenceQuote ? c.evidenceQuote : explicitSnippet ?? "";
  const evidence = evidenceQuote
    ? `${explicit.length ? "Explicit request" : "Production-stage evidence"}: "${evidenceQuote.slice(0, 600)}" (${ageNote}${v.evidenceDate ? `, posted ${v.evidenceDate.slice(0, 10)}` : ""})`
    : c.evidenceQuote
      ? `Claimed (not agent-verified): "${c.evidenceQuote.slice(0, 400)}"`
      : "";
  const catLabel = categoryLabel(cats);
  const rationale = explicit.length
    ? `The author publicly asked for ${services.join(", ").toLowerCase()}, so this service is directly relevant (explicit request${fresh ? ", recent" : `, ${ageNote}`}).`
    : stage.length
      ? `${stage.map((s) => s.label).join("; ")} indicates a project in production, so ${services.join(", ").toLowerCase()} may be relevant. This is inferred: no paid-service request has been confirmed.`
      : "No verified service need.";

  const stageStatuses = stage.map((s) => s.status!).filter(Boolean);
  const bookStatus = bookStatusFor(stageStatuses, cats);
  const authorType = tradOnly ? "Traditionally Published Author" : c.authorType && AUTHOR_TYPES.includes(c.authorType) ? c.authorType : /self-?publish|indie author|\bkdp\b/i.test(`${c.apiProfileText ?? ""} ${v.ebookBasis}`) ? "Self-Published Author" : "Independent Author";
  const platforms = [...new Set([...v.retailers, ...v.platformsMentioned])];
  const email = v.emails.find((e) => /same domain/.test(e.attribution)) ?? v.emails[0];

  const notes: string[] = [];
  notes.push(`Identity: ${v.identityBasis}.`);
  notes.push(`eBook link: ${v.ebookBasis}.`);
  if (v.country) notes.push(`Location evidence: "${v.country.quote}" (${v.country.url}).`);
  else if (c.country) notes.push(`Claimed location "${c.country}" not confirmed on a fetched page.`);
  if (c.bookTitle && !v.bookTitleVerified) notes.push(`Claimed book title "${c.bookTitle}" not found on fetched pages; left blank.`);
  if (email) notes.push(`Email publicly displayed ${email.attribution} (${email.pageUrl}); ${email.mx === "mx_found" ? "domain has MX records, mailbox not verified" : "not deliverability-checked"}.`);
  if (v.emailsRejected.length) notes.push(`Not recorded: ${v.emailsRejected.slice(0, 3).join("; ")}.`);
  if (v.audit.length) notes.push(`Site audit: ${v.audit.join("; ")}.`);
  if (stage.length && explicit.length) notes.push(`Also: ${stage.map((s) => s.label).join("; ")}.`);
  if (reasons.length) notes.push(`Review/exclusion reasons: ${reasons.join("; ")}.`);
  if (c.discovery.query) notes.push(`Found via ${c.discovery.provider ?? c.discovery.channel} query "${c.discovery.query}".`);

  const loc = v.country ? { country: v.country.country, region: c.region && normalizeForLoc(v.country.quote, c.region) ? c.region : "", city: c.city && normalizeForLoc(v.country.quote, c.city) ? c.city : "" } : { country: "Unverified", region: "", city: "" };
  const lang = v.language ? LANG_NAMES[v.language] ?? v.language : "";

  const record: ProspectRecord = {
    "Prospect Name": c.name,
    "First Name": firstNameOf(c),
    "Author or Business Name": c.businessName ?? c.name,
    Country: loc.country,
    "State or Region": loc.region,
    City: loc.city,
    "Preferred Language": lang,
    "Author Type": authorType,
    "Book Title": c.bookTitle && v.bookTitleVerified ? c.bookTitle : "",
    "Book Topic or Genre": c.genre ?? "",
    "Book Status": bookStatus,
    "Publishing Platform": platforms.join(", "),
    "Publishing Stage": stageFor(cats, stage.map((s) => s.label), bookStatus),
    "Service Opportunity": services.join("; "),
    "Opportunity Category": cats.length ? catLabel : "",
    "Buying Intent": intent,
    "Evidence of Need": evidence,
    "Opportunity Rationale": rationale,
    "Public Professional Email": email?.email ?? "",
    "Public Contact Page": v.contactPage ?? "",
    "Official Website": v.officialWebsite ?? "",
    "Source URL": c.sourceUrl,
    "Additional Source URL": [c.profileUrl && c.profileUrl !== c.sourceUrl ? c.profileUrl : "", ...c.additionalUrls].filter(Boolean).join(" | "),
    "Evidence Type": EVIDENCE_TYPES.includes(evidenceTypeFor(c, v, explicit.length > 0)) ? evidenceTypeFor(c, v, explicit.length > 0) : "Other Verified Source",
    "Research Confidence": confidence,
    "Lead Status": status,
    "Date Researched": today.toISOString().slice(0, 10),
    Notes: notes.join(" "),
  };
  const dedupKeys = dedupKeysFor(c, v);
  const identityKey = dedupKeys.find((k) => k.startsWith("domain:")) ?? dedupKeys.find((k) => k.startsWith("profile:")) ?? dedupKeys[0];
  return { record, status, intent, confidence, categories: cats, reasons, dedupKeys, identityKey };
}

function normalizeForLoc(quote: string, part: string): boolean {
  return normalizeKey(quote).includes(normalizeKey(part));
}
