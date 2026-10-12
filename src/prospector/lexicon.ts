/**
 * Phrase lexicon that turns verified page/post text into service signals.
 * Categories are only ever derived from text the agent fetched itself — never from a model's or a seed's claim.
 */

export const OPPORTUNITY_CATEGORIES = [
  "Editing", "Proofreading", "Formatting", "Cover Design", "Publishing Setup", "Distribution", "Listing Optimization",
  "Marketing", "Advertising", "Author Website", "Direct Sales", "Audiobook", "Translation", "Automation", "Multiple Services", "Other",
] as const;
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

interface ServiceTerm {
  re: RegExp;
  category: OpportunityCategory;
  service: string;
}

/** Service nouns (multilingual). Matched inside request phrases and on their own for stage/expansion context. */
export const SERVICE_TERMS: ServiceTerm[] = [
  { re: /\bdevelopmental edit(or|ing)\b|\bstructural edit(or|ing)\b/i, category: "Editing", service: "Developmental editing" },
  { re: /\bline edit(or|ing)\b/i, category: "Editing", service: "Line editing" },
  { re: /\bcopy ?edit(or|ing|s)?\b/i, category: "Editing", service: "Copyediting" },
  { re: /\bmanuscript (assessment|critique|evaluation)\b/i, category: "Editing", service: "Manuscript assessment" },
  { re: /\b(an? |my |book |fiction |novel |romance |fantasy |good |affordable |new )?editor\b|\bediting\b/i, category: "Editing", service: "Manuscript editing" },
  { re: /\blektor(at|in)?\b|\bredacteur\b|\bredaktör\b|\bcorrect(eur|rice)\b|\bcorrector(a)?\b|\bcorrettore\b|\bkorrektor(at)?\b/i, category: "Editing", service: "Manuscript editing (local-language)" },
  { re: /\bproof ?read(er|ing|ers)?\b|\bproofing\b|\bkorrekturles(er|erin|ung|en)\b|\bkorrekturläsare\b/i, category: "Proofreading", service: "Proofreading" },
  { re: /\b(e-?book |kindle |epub |interior |book )?format(ter|ting)\b|\bvellum\b|\batticus\b|\binterior (design|layout)\b|\btypesett(er|ing)\b|\bmaquet(ador|ación|tiste)\b|\bbuchsatz\b/i, category: "Formatting", service: "eBook / interior formatting" },
  { re: /\bepub\b|\bmobi\b|\bconvert(ing)? (my |the )?(manuscript|book|novel)\b/i, category: "Formatting", service: "EPUB conversion" },
  { re: /\bfixed[- ]layout\b/i, category: "Formatting", service: "Fixed-layout eBook" },
  { re: /\bcover (art(ist)?|designer|design|artwork|illustrat(or|ion))\b|\bbook cover\b|\bcover\b(?= for (my|a|the) (book|novel|series))|\bcoverdesign(er)?\b|\bcovergestalt(er|ung)\b|\bportada\b|\bcouverture\b|\bcopertina\b|\bomslag(sdesign|ontwerp)?\b/i, category: "Cover Design", service: "eBook cover design" },
  { re: /\billustrat(or|ions?|eur|ore|ador)\b|\bchildren'?s book art(ist)?\b/i, category: "Cover Design", service: "Book illustration" },
  { re: /\b(kdp|kindle direct publishing)\b|\bisbn\b|\bupload(ing)? (my |the )?(book|e-?book|manuscript)\b|\bself[- ]publish(ing)? (help|assistant|consultant)\b|\bpublishing (help|assistant|consultant|coach)\b/i, category: "Publishing Setup", service: "KDP / publishing setup" },
  { re: /\bdraft2digital\b|\bd2d\b|\bgo(ing)? wide\b|\bkobo\b|\bapple books\b|\bgoogle play books\b|\bingramspark\b|\bdistribut(ion|e|ing) (my|the) (e-?book|book)/i, category: "Distribution", service: "Multi-platform distribution" },
  { re: /\bblurb\b|\bbook description\b|\bmetadata\b|\bkeywords?\b|\bcategor(y|ies) (selection|research)\b|\bamazon (page|listing)\b/i, category: "Listing Optimization", service: "Book description / metadata" },
  { re: /\bmarketing\b|\bpublicist\b|\bbook promo(tion|ter)?\b|\blaunch (team|plan|help)\b|\barc readers?\b|\badvance readers?\b|\breview(er)?s? (team|copies)\b|\bbook tour\b|\bstreet team\b/i, category: "Marketing", service: "Book marketing / launch support" },
  { re: /\b(amazon|facebook|fb|meta|bookbub|tiktok) ads\b|\bads (manager|management|help|expert|person)\b|\badvertising\b/i, category: "Advertising", service: "Advertising campaigns" },
  { re: /\b(author )?website\b|\bweb ?(designer|developer|site)\b|\blanding page\b|\bsquarespace\b|\bwordpress\b|\bwix\b/i, category: "Author Website", service: "Author website" },
  { re: /\bdirect sales\b|\bsell(ing)? direct\b|\bshopify\b|\bpayhip\b|\bbookfunnel\b|\bweb ?store\b|\bonline store\b/i, category: "Direct Sales", service: "Direct-sales storefront" },
  { re: /\baudio ?book\b|\bnarrat(or|ion)\b|\bvoice actor\b|\bacx\b|\bh(ö|oe)rbuch\b|\bsprecher(in)?\b/i, category: "Audiobook", service: "Audiobook production" },
  { re: /\btranslat(or|ion|e|ing)\b|\b(ü|ue)bersetz(er|erin|ung)\b|\btraduct(eur|rice|or|ora)\b|\btraduttore\b|\bvertaler\b|\böversättare\b|\blocali[sz]ation\b/i, category: "Translation", service: "eBook translation" },
  { re: /\bnewsletter\b|\bmailerlite\b|\bmailchimp\b|\bconvertkit\b|\bkit\.com\b|\bautomation\b|\breader magnet\b|\blead magnet\b/i, category: "Automation", service: "Newsletter / automation" },
];

const REQUEST_VERB =
  String.raw`(?:i'?m|i am|we'?re|we are|i'?ve been|still|currently|now|also|desperately|actively)?\s*(?:looking for|searching for|in search of|seeking|in need of|need(?:ing)?|want(?:ing)? to (?:hire|find|commission)|hiring|recruiting|on the hunt for|could use|trying to find|recommend(?:ations?)? for|recs? for|suggestions for|anyone know (?:a|an|of)|can anyone recommend|who do you (?:use|recommend) for)`;
const LOCAL_REQUEST = String.raw`(?:suche|wir suchen|ich suche|gesucht|cherche|je cherche|nous cherchons|recherche|busco|buscamos|se busca|cerco|cerchiamo|op zoek naar|zoek(?:t|en)?|söker|vi söker|leter etter|søger|etsin)`;

/** First-person requests for a service: the strongest buying signal. */
export const EXPLICIT_REQUEST = new RegExp(
  String.raw`\b(?:${REQUEST_VERB}|${LOCAL_REQUEST})\b[^.!?\n]{0,60}?\b(?:edit(?:or|ing)|proof ?read(?:er|ing)?|format(?:ter|ting)|cover(?: art(?:ist)?| designer| design)?|illustrat\w*|narrat\w*|translat\w*|publicist|marketing|promotion|ads|website|web ?designer|lektor\w*|korrektor\w*|coverdesign\w*|übersetz\w*|redacteur|corrector\w*|correct(?:eur|rice)|traduct\w*|illustrateur|graphiste|ilustrador\w*|maquetador\w*|portada|couverture|copertina|editor\w*|grafico|omslag\w*|redaktör|korrekturläsare|sprecher\w*|hörbuch\w*|isbn|kdp|epub|blurb)`,
  "i",
);

/** Wording typical of service providers advertising (not a buyer). Checked against the whole post/quote region. */
export const PROVIDER_PROMO =
  /\b(commissions? (are )?open|my (rates|services|portfolio|premades?|schedule|books are open)|premade covers?|i offer|we offer|our services|book (a slot|me|now)|dm me (for|to|with)|hire me|slots? (open|available)|openings? (in|for)|bookings? (available|open)|i'?m available|now booking|taking on (new |a few )?(more )?clients|i can help (you|with)|my (editing|design|formatting|cover) (business|services|work)|get in touch for (a )?quote|i got you|check (out )?(my|her|him|them|their) |(free|a) sample edit|sample edits|send (me|over) (a|your)|reach out to (me|chat)|hit me up|starting at \$|i start at \$|rates start|reasonable rates|payment plans?|discount(ed)? rates|promo(tion)? code|limited (time )?offer|amazing offer|if you'?re (an author )?(looking|in need)|if you are (looking|in need)|if (anyone|you|publishers|authors|any authors)( out there)? (is |are )?(looking|need)|in case (anyone|you)|for anyone (who'?s |who is )?looking|anyone looking for an?|any authors (here )?looking|hit up|go to|can'?t recommend|highly recommend|i recommend|i'?d recommend|you should (check|try|hire)|he'?s your guy|she'?s your (gal|girl|person)|they'?re your|do you (still )?need an?|need an? (editor|proofreader|cover designer|formatter)\?|looking for an? [a-z ]{0,30}\?|are you (looking|in need))/i;

export const TRADITIONAL_PITCH = /#(bluepit|pitmad|dvpit|pitdark|kissmad|sffpit|pbpitch|querying|amquerying|mswl|faithpitch|iwsgpit)\b|\bquery(ing)? (agents|letter)\b|\bliterary agent\b|\bseeking (representation|an agent)\b/i;

/** The request must be the poster's own and current: not negated, past, hypothetical or about a third party. */
const NOT_OWN_REQUEST = /\b(not|no longer|never|don'?t|doesn'?t|didn'?t|wasn'?t)\s+(\w+\s+){0,2}(looking|need|seeking|searching)|\b(was|were|when i was|when i|once i|after i|before i|until i|if i|is|(?<!\bwe )are|he'?s|she'?s|they'?re)\s+(\w+\s+){0,2}(looking|need(ing)?|seeking|searching|start looking)/i;
const FIRST_PERSON = /\b(i|i'm|im|i am|i've|ive|i'd|we|we're|we are|my|our|me|us)\b/i;
const THIRD_PARTY_SUBJECT = /\b(journal|magazine|company|agency|press|team|university|department|organisation|organization|he|she|they|my (friend|son|daughter|wife|husband|partner|client|mom|dad|sister|brother))\b/i;

/** Applies grammatical checks to a candidate request match inside its sentence. */
export function isOwnRequest(sentence: string, matchOffset: number): boolean {
  const before = sentence.slice(0, matchOffset);
  const window = sentence.slice(Math.max(0, matchOffset - 40), matchOffset + 40);
  if (NOT_OWN_REQUEST.test(window)) return false;
  if (THIRD_PARTY_SUBJECT.test(before) && !/\b(i|i'm|we|we're)\b/i.test(before.slice(-25))) return false;
  if (sentence.trim().endsWith("?") && !/\b(anyone|any recs|recommend|recommendations|suggestions|know (a|an|of|any)|who do you)\b/i.test(sentence)) return false;
  // Either a first-person subject, or the sentence opens with the request ("Looking for a cover designer for my romance.").
  return FIRST_PERSON.test(before) || before.replace(/[#@\w.-]*[:,!]\s*$/, "").trim().split(/\s+/).filter(Boolean).length <= 3;
}

/** Pre-launch / production-stage wording (medium intent: a project is in production). */
export const STAGE_TERMS: { re: RegExp; label: string; status: "Forthcoming" | "In Progress" | "Unpublished" | "Relaunch" }[] = [
  { re: /\bcover reveal\b/i, label: "Cover reveal announced", status: "Forthcoming" },
  { re: /\bpre-?orders? (are )?(open|live|available)\b|\bavailable (for|to) pre-?order\b|\bpre-?order (now|today|it|my)\b/i, label: "Pre-order live", status: "Forthcoming" },
  { re: /\bcoming soon\b|\brelease date\b|\breleases? (on|in) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|spring|summer|autumn|fall|winter|20\d\d)/i, label: "Upcoming release", status: "Forthcoming" },
  { re: /\b(currently|now|still) (editing|revising|drafting|writing)\b|\bin (the )?(editing|revision|edits) (stage|phase)\b|\bwith my editor\b|\bfinal (edits|draft)\b/i, label: "Manuscript in production", status: "In Progress" },
  { re: /\b(finished|completed) (my |the )?(manuscript|first draft|novel)\b|\bmanuscript is (finished|complete|done)\b/i, label: "Manuscript complete", status: "Unpublished" },
  { re: /\b(first|debut) (book|novel|e-?book)\b.{0,60}\b(self-?publish|indie|kdp|kindle)/i, label: "Debut self-published book", status: "Unpublished" },
  { re: /\bself-?publish(ing)? (my|our) (first|debut|new|next)\b|\bplanning to self-?publish\b|\bgoing to self-?publish\b|\bdecided to self-?publish\b/i, label: "Planning to self-publish", status: "Unpublished" },
  { re: /\b(relaunch|re-?launch|re-?release|new covers? for (the|my) series|re-?covering|second edition)\b/i, label: "Relaunch / re-cover", status: "Relaunch" },
  { re: /\b(neuerscheinung|erscheint (am|im)|vorbestellbar|à paraître|bientôt disponible|próximamente|en preventa|in uscita|binnenkort verkrijgbaar|kommer snart)\b/i, label: "Upcoming release (local language)", status: "Forthcoming" },
];

/** Text that ties a page to eBooks / digital publishing. */
export const EBOOK_TERMS =
  /\b(e-?books?|kindle( unlimited| edition)?|kdp|epub|kobo|apple books|google play books|draft2digital|smashwords|ingramspark|nook|self-?publish(ed|ing)?|indie (author|publishing)|digital edition|e-?book|ebook|livre numérique|libro electrónico|e-?boek|e-?bok)\b/i;

/** Retailer link hosts, used for distribution analysis of an author's site. */
export const RETAILERS: Record<string, RegExp> = {
  Amazon: /(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.(to|eu)$|(^|\.)a\.co$/i,
  Kobo: /(^|\.)kobo\.com$/i,
  "Apple Books": /(^|\.)books\.apple\.com$|(^|\.)itunes\.apple\.com$/i,
  "Google Play Books": /(^|\.)play\.google\.com$/i,
  "Barnes & Noble": /(^|\.)barnesandnoble\.com$/i,
  Smashwords: /(^|\.)smashwords\.com$/i,
  "Books2Read (D2D)": /(^|\.)books2read\.com$|(^|\.)draft2digital\.com$/i,
  Payhip: /(^|\.)payhip\.com$/i,
  BookFunnel: /(^|\.)bookfunnel\.com$|(^|\.)dl\.bookfunnel\.com$/i,
  Gumroad: /(^|\.)gumroad\.com$/i,
  Shopify: /(^|\.)myshopify\.com$/i,
};

/** Words that mark a profile as a service provider rather than an author-buyer. */
export const PROVIDER_PROFILE =
  /\b(freelance (editor|proofreader|designer|formatter|illustrator)|(book )?cover (designer|artist)|book (designer|formatter|coach)|(developmental|line|copy|book|fiction) editor|proofreader|formatter|editing services|publishing services|design studio|commissions open|hire me|for hire|literary agent|ghostwriter for hire|narrator for hire|translator for hire)\b/i;
export const AUTHOR_PROFILE =
  /\b(author|writer|novelist|poet|writes|writing|books?|series|self-?pub(lished)?|indie author|autor(in)?|auteur(e)?|escritor(a)?|scrittore|scrittrice|schrijver|författare|forfatter|kirjailija)\b/i;

export interface SignalHit {
  kind: "explicit" | "stage" | "service_context";
  label: string;
  category?: OpportunityCategory;
  service?: string;
  status?: string;
  snippet: string;
}

function snippetAround(text: string, index: number, len: number, pad = 140): string {
  return text.slice(Math.max(0, index - pad), Math.min(text.length, index + len + pad)).replace(/\s+/g, " ").trim();
}

/** Services named inside a piece of text. */
export function servicesIn(text: string): { category: OpportunityCategory; service: string }[] {
  const out = new Map<string, { category: OpportunityCategory; service: string }>();
  for (const t of SERVICE_TERMS) if (t.re.test(text)) out.set(t.service, { category: t.category, service: t.service });
  // A generic "editor" match is redundant once a more specific editing service matched.
  if ([...out.values()].filter((s) => s.category === "Editing").length > 1) out.delete("Manuscript editing");
  return [...out.values()];
}

/** Sentence containing position i. */
function sentenceAt(text: string, i: number): { sentence: string; start: number } {
  // Sentence boundaries are ". ", "! ", "? " or newlines, so dots inside handles and URLs do not split.
  const re = /[.!?](?=\s|$)|\n/g;
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(re)) {
    const pos = m.index ?? 0;
    if (pos < i) start = pos + 1;
    else {
      end = pos + 1;
      break;
    }
  }
  return { sentence: text.slice(start, end), start };
}

/** Scans verified text for explicit requests and production-stage wording. */
export function detectSignals(raw: string, opts: { wholeTextIsOnePost?: boolean } = {}): SignalHit[] {
  const hits: SignalHit[] = [];
  const text = raw.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
  // Pitch-party / querying posts seek a traditional publisher's editor or agent, not a paid service.
  if (opts.wholeTextIsOnePost && TRADITIONAL_PITCH.test(text)) return [];
  // A post that reads as provider advertising yields no buyer signals at all.
  if (opts.wholeTextIsOnePost && PROVIDER_PROMO.test(text)) return [];
  const global = new RegExp(EXPLICIT_REQUEST.source, "gi");
  for (const m of text.matchAll(global)) {
    const idx = m.index ?? 0;
    const { sentence, start } = sentenceAt(text, idx);
    if (PROVIDER_PROMO.test(sentence)) continue;
    if (!isOwnRequest(sentence, idx - start)) continue;
    for (const s of servicesIn(m[0])) {
      hits.push({ kind: "explicit", label: `Explicit request: ${s.service}`, category: s.category, service: s.service, snippet: snippetAround(text, idx, m[0].length) });
    }
  }
  for (const st of STAGE_TERMS) {
    const m = st.re.exec(text);
    if (m) hits.push({ kind: "stage", label: st.label, status: st.status, snippet: snippetAround(text, m.index, m[0].length) });
  }
  return dedupeHits(hits);
}

function dedupeHits(h: SignalHit[]): SignalHit[] {
  const seen = new Set<string>();
  return h.filter((x) => {
    const k = `${x.kind}|${x.service ?? x.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Collapses a set of categories into the single workbook value. */
export function categoryLabel(cats: OpportunityCategory[]): OpportunityCategory {
  const uniq = [...new Set(cats)];
  if (!uniq.length) return "Other";
  return uniq.length === 1 ? uniq[0] : "Multiple Services";
}
