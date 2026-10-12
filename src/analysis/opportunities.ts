import type { PublicationStatus } from "./status.js";

export interface OpportunityFacts {
  status: PublicationStatus;
  reviewCount: number | null;
  rating: number | null;
  descriptionLength: number | null;
  hasWebsite: boolean;
  websiteFetched: boolean;
  websiteUrl: string | null;
  websiteHttps: boolean;
  websiteCopyrightYear: number | null;
  newsletterSignals: string[];
  storeSignals: string[];
  retailerPlatforms: string[];
  socialLinkCount: number;
  bookLanguage: string | null;
  series: string | null;
  formats: string[];
  bookCount: number | null;
  explicitSeeking: string | null;
  crowdfunding: boolean;
  bookUrl: string | null;
  statusEvidenceUrl: string | null;
  publisherIsLarge: boolean;
  currentYear: number;
}

export interface Opportunity {
  code: string;
  rationale: string;
  strength: 1 | 2 | 3;
  evidenceUrl: string | null;
}

const LARGE_PUBLISHERS = /(penguin|random house|harpercollins|simon (&|and) schuster|hachette|macmillan|tor books|orbit|bloomsbury|scholastic|pan macmillan|faber|little, brown|del rey|berkley|ace books|s\. fischer|rowohlt|droemer|ullstein|gallimard|flammarion|albin michel|planeta|mondadori|feltrinelli|bonnier|gyldendal|kodansha|shueisha)/i;
export function isLargePublisher(p?: string | null): boolean {
  return !!p && LARGE_PUBLISHERS.test(p);
}

/** Evidence-driven rules. Each opportunity cites the observation that triggered it. */
export function detectOpportunities(f: OpportunityFacts, enabledCategories?: string[]): Opportunity[] {
  const out: Opportunity[] = [];
  const add = (code: string, strength: 1 | 2 | 3, rationale: string, evidenceUrl: string | null) => {
    if (enabledCategories && !enabledCategories.includes(code[0])) return;
    if (!out.some((o) => o.code === code)) out.push({ code, strength, rationale, evidenceUrl });
  };
  const site = f.websiteUrl;

  if (f.explicitSeeking) {
    const s = f.explicitSeeking.toLowerCase();
    if (/editor|editing|proofread/.test(s)) add("A02", 3, `Author publicly states: "${f.explicitSeeking}"`, f.statusEvidenceUrl);
    if (/cover/.test(s)) add("B01", 3, `Author publicly states: "${f.explicitSeeking}"`, f.statusEvidenceUrl);
    if (/publish/.test(s)) add("C17", 3, `Author publicly states: "${f.explicitSeeking}"`, f.statusEvidenceUrl);
    if (/market|promot/.test(s)) add("E01", 3, `Author publicly states: "${f.explicitSeeking}"`, f.statusEvidenceUrl);
  }

  switch (f.status) {
    case "forthcoming":
      add("E02", 3, "Book announced as forthcoming — prelaunch window is open.", f.statusEvidenceUrl ?? f.bookUrl);
      add("E12", 2, "Forthcoming release: ARC campaign timing applies.", f.statusEvidenceUrl ?? f.bookUrl);
      add("H07", 2, "Forthcoming release: preorder announcement emails apply.", f.statusEvidenceUrl ?? f.bookUrl);
      add("K03", 1, "Release coordination for an announced book.", f.statusEvidenceUrl ?? f.bookUrl);
      break;
    case "unpublished":
      add("A05", 3, "Public manuscript-stage project: assessment/editing precedes publication.", f.statusEvidenceUrl);
      add("A01", 2, "Manuscript-stage project will need proofreading.", f.statusEvidenceUrl);
      add("B01", 2, "Unpublished project will need a cover.", f.statusEvidenceUrl);
      add("C17", 2, "Unpublished project: publishing project management.", f.statusEvidenceUrl);
      break;
    case "serial":
      add("B04", 3, "Web serial with no confirmed ebook edition: EPUB conversion opportunity.", f.bookUrl);
      add("C02", 2, "Serial could be packaged and uploaded as an ebook.", f.bookUrl);
      add("B01", 2, "Ebook edition of a serial needs a retail cover.", f.bookUrl);
      break;
    case "other_formats_only":
      add("B04", 3, `Only non-ebook formats observed (${f.formats.join(", ") || "n/a"}).`, f.bookUrl);
      add("C02", 2, "No ebook edition observed: ebook upload and setup.", f.bookUrl);
      break;
    default:
      break;
  }

  if (f.status === "published_ebook" || f.status === "other_formats_only") {
    if (f.reviewCount != null && f.reviewCount < 50) {
      add("E13", 2, `Only ${f.reviewCount} public ratings/reviews observed — review-outreach coordination.`, f.bookUrl);
      add("E04", 1, `Low review volume (${f.reviewCount}) suggests limited reader reach.`, f.bookUrl);
    } else if (f.reviewCount != null && f.reviewCount <= 1000) {
      add("F01", 2, `${f.reviewCount} ratings shows traction that ads could scale (listing under the 1,000-review ceiling).`, f.bookUrl);
      add("E04", 2, `Established but modest audience (${f.reviewCount} ratings) — backlist marketing.`, f.bookUrl);
    }
    if (f.reviewCount != null && f.rating != null && f.rating >= 4.0 && f.reviewCount >= 20) {
      add("I01", 1, `Well-rated (${f.rating}) with ${f.reviewCount} ratings; no audiobook format observed.`, f.bookUrl);
    }
    if (f.formats.length && !f.formats.some((x) => /audio/i.test(x))) {
      /* audiobook covered above only when traction exists */
    }
  }

  if (f.descriptionLength != null && f.descriptionLength < 400 && f.status !== "unpublished") {
    add("D01", 2, `Book description is short (${f.descriptionLength} characters) on the inspected listing.`, f.bookUrl);
    add("C14", 1, "Description length below typical retailer best practice.", f.bookUrl);
  }

  const retailers = new Set(f.retailerPlatforms.filter((p) => p !== "goodreads" && p !== "author_site"));
  if (retailers.size === 1 && retailers.has("amazon") && f.status === "published_ebook") {
    add("C09", 2, "Only Amazon purchase links observed — wider distribution possible (if not enrolled in KDP Select).", site ?? f.bookUrl);
    add("C07", 1, "Draft2Digital could reach Apple/Kobo/B&N in one step.", site ?? f.bookUrl);
  }

  if (!f.hasWebsite) {
    add("G01", 3, "No official author website found.", null);
    add("H01", 1, "No website means no owned channel for a newsletter.", null);
  } else if (f.websiteFetched) {
    if (!f.newsletterSignals.length) {
      add("H01", 2, "Official website shows no newsletter signup.", site);
      add("G11", 2, "No newsletter signup integration detected on the website.", site);
    }
    if (!f.storeSignals.length && (f.bookCount ?? 0) >= 2 && f.status === "published_ebook") {
      add("G08", 1, "Website has no direct-sales store for a multi-book catalogue.", site);
    }
    if (f.websiteCopyrightYear && f.websiteCopyrightYear <= f.currentYear - 3) {
      add("G02", 2, `Website footer copyright year is ${f.websiteCopyrightYear} — site looks unmaintained.`, site);
    }
    if (!f.websiteHttps) add("G14", 2, "Website is served without HTTPS.", site);
  }

  if (f.socialLinkCount === 0 && f.websiteFetched) add("E05", 1, "No social media profiles linked from the website.", site);

  if (f.series) {
    add("D07", 1, `Book is part of a series (${f.series}).`, f.bookUrl);
    if (f.hasWebsite) add("G07", 1, "Series catalogue page opportunity.", site);
  }

  if (f.bookLanguage && !/^en/i.test(f.bookLanguage) && f.status !== "unpublished") {
    add("J01", 2, `Book language is ${f.bookLanguage}; English translation could open new markets.`, f.bookUrl);
    add("J04", 1, "Translated metadata/descriptions for international retailers.", f.bookUrl);
  }

  if (f.crowdfunding) add("K03", 2, "Public crowdfunding campaign: fulfilment and release management.", f.statusEvidenceUrl);

  return out.sort((a, b) => b.strength - a.strength);
}
