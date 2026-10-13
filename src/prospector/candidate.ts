import { z } from "zod";

/**
 * A prospect candidate as produced by any discovery channel (keyless social APIs, keyed web search,
 * or a researcher's seed file). Everything here is a *claim* until the verifier re-fetches the pages.
 */
export const ProspectCandidateSchema = z.object({
  name: z.string().min(2),
  firstName: z.string().optional(),
  businessName: z.string().optional(),
  authorType: z.string().optional(),
  /** Claimed location; recorded as verified only when locationQuote is found on a fetched page. */
  country: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  locationQuote: z.string().optional(),
  language: z.string().optional(),
  bookTitle: z.string().optional(),
  genre: z.string().optional(),
  platforms: z.array(z.string()).default([]),
  /** Page that carries the evidence of need. */
  sourceUrl: z.string().url(),
  /** Verbatim text from sourceUrl showing the need; the verifier must find it in its own fetch. */
  evidenceQuote: z.string().optional(),
  /** Date the evidence was posted, when known (ISO). */
  evidenceDate: z.string().optional(),
  additionalUrls: z.array(z.string().url()).default([]),
  officialWebsite: z.string().url().optional(),
  contactPage: z.string().url().optional(),
  /** Social/profile URL identifying the person (Bluesky, Mastodon, Goodreads author page...). */
  profileUrl: z.string().url().optional(),
  /** Pre-fetched source text from an API (Bluesky/Mastodon). Treated as agent-fetched. */
  apiText: z.string().optional(),
  /** Profile bio text returned by an API. */
  apiProfileText: z.string().optional(),
  notes: z.string().optional(),
  discovery: z
    .object({ channel: z.string(), query: z.string().optional(), provider: z.string().optional(), market: z.string().optional(), date: z.string().optional(), batch: z.number().int().optional() })
    .default({ channel: "seed_file" }),
});
export type ProspectCandidate = z.infer<typeof ProspectCandidateSchema>;

export function parseCandidates(raw: unknown): { ok: ProspectCandidate[]; rejected: { index: number; error: string }[] } {
  const arr = Array.isArray(raw) ? raw : [];
  const ok: ProspectCandidate[] = [];
  const rejected: { index: number; error: string }[] = [];
  arr.forEach((c, index) => {
    const r = ProspectCandidateSchema.safeParse(c);
    if (r.success) ok.push(r.data);
    else rejected.push({ index, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  });
  return { ok, rejected };
}
