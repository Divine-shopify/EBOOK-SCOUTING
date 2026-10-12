/** Normalizes a person/title string for deduplication. */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function truncate(s: string | null | undefined, n: number): string | null {
  if (s == null) return null;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
