import { z } from "zod";

/** A research candidate. Seeds come from search providers or curated seed files; every URL is re-fetched and re-verified. */
export const CandidateSchema = z.object({
  authorName: z.string().min(2),
  penName: z.string().nullish(),
  countryClaim: z.string().nullish(),
  countryEvidenceUrl: z.string().url().nullish(),
  language: z.string().nullish(),
  genres: z.array(z.string()).nullish(),
  websiteUrl: z.string().url().nullish(),
  contactPageUrl: z.string().url().nullish(),
  profileUrls: z.array(z.string().url()).nullish(),
  bookTitle: z.string().min(1),
  bookUrls: z.array(z.string().url()).nullish(),
  goodreadsUrl: z.string().url().nullish(),
  statusHint: z.enum(["published_ebook", "forthcoming", "unpublished", "serial", "other_formats", "unclear"]).nullish(),
  statusEvidenceUrl: z.string().url().nullish(),
  publicationDate: z.string().nullish(),
  reviewCountObserved: z.number().int().nonnegative().nullish(),
  ratingObserved: z.number().nullish(),
  reviewCountSource: z.string().nullish(),
  discoveryQuery: z.string().nullish(),
  discoveryPlatform: z.string().nullish(),
  notes: z.string().nullish(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Parses a seed array, dropping (and reporting) malformed entries instead of failing the batch. */
export function parseCandidates(raw: unknown): { ok: Candidate[]; rejected: { index: number; error: string }[] } {
  const arr = Array.isArray(raw) ? raw : [];
  const ok: Candidate[] = [];
  const rejected: { index: number; error: string }[] = [];
  arr.forEach((item, index) => {
    // tolerate empty strings for optional URL fields
    if (item && typeof item === "object") {
      for (const k of ["countryEvidenceUrl", "websiteUrl", "contactPageUrl", "goodreadsUrl", "statusEvidenceUrl"]) {
        if ((item as any)[k] === "") (item as any)[k] = null;
      }
      for (const k of ["bookUrls", "profileUrls"]) {
        if (Array.isArray((item as any)[k])) (item as any)[k] = (item as any)[k].filter((u: unknown) => typeof u === "string" && /^https?:\/\//.test(u));
      }
    }
    const r = CandidateSchema.safeParse(item);
    if (r.success) ok.push(r.data);
    else rejected.push({ index, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  });
  return { ok, rejected };
}
