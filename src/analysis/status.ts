export type PublicationStatus = "unpublished" | "forthcoming" | "published_ebook" | "other_formats_only" | "serial" | "unclear";

export interface StatusInputs {
  hint?: string | null;
  /** Text of the page cited as status evidence, if it was fetched. */
  evidenceText?: string | null;
  goodreadsExpected?: boolean;
  /** Result of checking all editions (e.g. Goodreads /work/editions): true = an ebook edition exists, false = editions checked and none is an ebook. */
  ebookEditionFound?: boolean | null;
  datePublished?: string | null;
  formats: string[];
  platforms: string[];
  today?: Date;
}

const FORTHCOMING_RE = /(coming soon|pre-?order|forthcoming|release date|releases? on|out (on|in) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|expected publication|launch(es|ing)? (on|in)|erscheint|vorbestell|à paraître|précommande|binnenkort|in uscita|próximamente|kickstarter|crowdfund)/i;
const UNPUBLISHED_RE = /(manuscript|querying|work in progress|\bwip\b|seeking (a )?(publisher|agent|editor)|looking for (a )?(publisher|agent|editor|cover designer)|first draft|currently writing|beta readers?|manuskript|manuscrit)/i;
const SERIAL_PLATFORMS = new Set(["royalroad", "wattpad", "inkitt", "scribblehub", "substack", "medium"]);
const EBOOK_FORMAT_RE = /(kindle|ebook|e-book|epub|digital|nook|kobo)/i;

/**
 * Classifies a project's publishing status from supporting evidence only.
 * A missing marketplace listing is never treated as proof of "unpublished".
 */
export function classifyStatus(input: StatusInputs): { status: PublicationStatus; reason: string } {
  // "Unknown Binding" says nothing about formats.
  const i = { ...input, formats: input.formats.filter((f) => !/unknown binding/i.test(f)) };
  const today = i.today ?? new Date();
  if (i.goodreadsExpected) return { status: "forthcoming", reason: "Goodreads lists an 'Expected publication' date." };
  if (i.datePublished) {
    const d = Date.parse(i.datePublished);
    if (Number.isFinite(d) && d > today.getTime()) return { status: "forthcoming", reason: `Listing gives a future publication date (${i.datePublished}).` };
  }
  const ev = i.evidenceText ?? "";
  if (i.hint === "forthcoming" && FORTHCOMING_RE.test(ev)) return { status: "forthcoming", reason: "Cited announcement page contains release/pre-order wording." };
  if (i.hint === "unpublished" && UNPUBLISHED_RE.test(ev)) return { status: "unpublished", reason: "Cited page describes a manuscript/work-in-progress stage." };
  if (i.hint === "serial" || i.platforms.some((p) => SERIAL_PLATFORMS.has(p))) {
    if (i.formats.some((f) => EBOOK_FORMAT_RE.test(f))) return { status: "published_ebook", reason: "Serial platform presence plus an ebook edition." };
    if (i.platforms.some((p) => SERIAL_PLATFORMS.has(p))) return { status: "serial", reason: "Published as a web serial on a reading platform." };
  }
  if (i.formats.some((f) => EBOOK_FORMAT_RE.test(f))) return { status: "published_ebook", reason: `Listing shows an ebook/Kindle format (${i.formats.join(", ")}).` };
  if (i.ebookEditionFound === true) return { status: "published_ebook", reason: "An ebook/Kindle edition is listed among the book's editions." };
  if (i.platforms.some((p) => ["amazon", "apple_books", "kobo", "googlebooks", "smashwords", "draft2digital", "payhip", "gumroad"].includes(p)) && i.hint === "published_ebook")
    return { status: "published_ebook", reason: "Listed on an ebook retailer (format not machine-confirmed)." };
  if (i.formats.length && i.ebookEditionFound === false)
    return { status: "other_formats_only", reason: `All listed editions checked; only non-ebook formats (${i.formats.join(", ")}).` };
  if (i.formats.length && i.hint === "other_formats_only")
    return { status: "other_formats_only", reason: `Only non-ebook formats observed (${i.formats.join(", ")}); editions list not confirmed.` };
  if (i.hint === "forthcoming" || i.hint === "unpublished") return { status: "unclear", reason: `Seed suggested '${i.hint}' but the cited page could not confirm it.` };
  return { status: "unclear", reason: "Insufficient evidence to determine status." };
}
