/**
 * Registry of discovery sources and how AuthorScout may access each one.
 * access_mode:
 *   api          – official public API used directly
 *   api_key      – official API, requires credentials (see .env.example)
 *   fetch        – public page fetch, robots.txt-checked and rate-limited
 *   seed_only    – not fetched automatically (ToS / bot protection); URLs accepted from
 *                  configured search providers or curated seed files and recorded as references
 */
export interface SourceDef {
  key: string;
  name: string;
  category: "marketplace" | "community" | "social" | "search" | "directory" | "web";
  baseUrl?: string;
  accessMode: "api" | "api_key" | "fetch" | "seed_only";
  limitation?: string;
}

export const DISCOVERY_SOURCES: SourceDef[] = [
  { key: "openlibrary", name: "Open Library", category: "directory", baseUrl: "https://openlibrary.org", accessMode: "api" },
  { key: "googlebooks", name: "Google Play Books / Google Books API", category: "marketplace", baseUrl: "https://www.googleapis.com/books/v1", accessMode: "api", limitation: "Keyless quota is shared and was exhausted (HTTP 429) during the initial run; set GOOGLE_BOOKS_API_KEY." },
  { key: "brave", name: "Brave Search API", category: "search", baseUrl: "https://api.search.brave.com", accessMode: "api_key", limitation: "Requires BRAVE_SEARCH_API_KEY." },
  { key: "tavily", name: "Tavily Search API", category: "search", baseUrl: "https://api.tavily.com", accessMode: "api_key", limitation: "Requires TAVILY_API_KEY." },
  { key: "serpapi", name: "SerpAPI (Google results)", category: "search", baseUrl: "https://serpapi.com", accessMode: "api_key", limitation: "Requires SERPAPI_API_KEY." },
  { key: "goodreads", name: "Goodreads", category: "community", baseUrl: "https://www.goodreads.com", accessMode: "fetch", limitation: "Only /book/show and /author/show pages (robots.txt allows); /search is disallowed and not used. 5s crawl delay." },
  { key: "amazon", name: "Amazon Kindle Store", category: "marketplace", baseUrl: "https://www.amazon.com", accessMode: "seed_only", limitation: "Bot protection returns 404/503 to automated clients; Amazon conditions of use prohibit scraping. URLs recorded as references only." },
  { key: "apple_books", name: "Apple Books", category: "marketplace", baseUrl: "https://books.apple.com", accessMode: "fetch" },
  { key: "kobo", name: "Kobo", category: "marketplace", baseUrl: "https://www.kobo.com", accessMode: "seed_only", limitation: "HTTP 403 to automated clients during the initial run." },
  { key: "bn", name: "Barnes & Noble / NOOK", category: "marketplace", baseUrl: "https://www.barnesandnoble.com", accessMode: "seed_only", limitation: "Bot protection; reference only." },
  { key: "draft2digital", name: "Draft2Digital (Books2Read links)", category: "marketplace", baseUrl: "https://books2read.com", accessMode: "fetch" },
  { key: "smashwords", name: "Smashwords", category: "marketplace", baseUrl: "https://www.smashwords.com", accessMode: "fetch" },
  { key: "publishdrive", name: "PublishDrive", category: "marketplace", accessMode: "seed_only", limitation: "No public author catalogue." },
  { key: "streetlib", name: "StreetLib", category: "marketplace", accessMode: "seed_only", limitation: "No public author catalogue." },
  { key: "lulu", name: "Lulu", category: "marketplace", baseUrl: "https://www.lulu.com", accessMode: "fetch" },
  { key: "ingramspark", name: "IngramSpark", category: "marketplace", accessMode: "seed_only", limitation: "No public author catalogue." },
  { key: "bookbaby", name: "BookBaby Bookshop", category: "marketplace", baseUrl: "https://store.bookbaby.com", accessMode: "fetch" },
  { key: "blurb", name: "Blurb", category: "marketplace", baseUrl: "https://www.blurb.com", accessMode: "fetch" },
  { key: "gumroad", name: "Gumroad", category: "marketplace", baseUrl: "https://gumroad.com", accessMode: "fetch" },
  { key: "payhip", name: "Payhip", category: "marketplace", baseUrl: "https://payhip.com", accessMode: "fetch" },
  { key: "shopify", name: "Shopify bookstores", category: "web", accessMode: "fetch" },
  { key: "woocommerce", name: "WooCommerce bookstores", category: "web", accessMode: "fetch" },
  { key: "author_site", name: "Independent author websites", category: "web", accessMode: "fetch" },
  { key: "wattpad", name: "Wattpad", category: "community", baseUrl: "https://www.wattpad.com", accessMode: "fetch" },
  { key: "inkitt", name: "Inkitt", category: "community", baseUrl: "https://www.inkitt.com", accessMode: "fetch" },
  { key: "royalroad", name: "Royal Road", category: "community", baseUrl: "https://www.royalroad.com", accessMode: "seed_only", limitation: "HTTP 403 (Cloudflare) to automated clients during the initial run." },
  { key: "scribblehub", name: "Scribble Hub", category: "community", baseUrl: "https://www.scribblehub.com", accessMode: "fetch" },
  { key: "reedsy", name: "Reedsy Discovery", category: "community", baseUrl: "https://reedsy.com/discovery", accessMode: "fetch" },
  { key: "substack", name: "Substack", category: "community", accessMode: "fetch" },
  { key: "medium", name: "Medium", category: "community", accessMode: "fetch" },
  { key: "kickstarter", name: "Kickstarter (book campaigns)", category: "community", baseUrl: "https://www.kickstarter.com", accessMode: "seed_only", limitation: "Cloudflare challenge for automated clients." },
  { key: "instagram", name: "Instagram", category: "social", accessMode: "seed_only", limitation: "Login wall; profile URLs recorded as references only." },
  { key: "tiktok", name: "TikTok / BookTok", category: "social", accessMode: "seed_only", limitation: "Login wall / bot protection." },
  { key: "youtube", name: "YouTube / BookTube", category: "social", accessMode: "seed_only", limitation: "Use YouTube Data API (not configured)." },
  { key: "facebook", name: "Facebook author pages", category: "social", accessMode: "seed_only", limitation: "Login wall." },
  { key: "linkedin", name: "LinkedIn", category: "social", accessMode: "seed_only", limitation: "ToS prohibits automated access; reference only." },
  { key: "x", name: "X", category: "social", accessMode: "seed_only", limitation: "Login wall / paid API." },
  { key: "pinterest", name: "Pinterest", category: "social", accessMode: "seed_only" },
  { key: "claude_websearch", name: "Claude Code WebSearch (operator-assisted seed discovery)", category: "search", accessMode: "seed_only", limitation: "Used by the operator session to produce seed files; every seed URL is re-fetched and re-verified by the pipeline." },
];

/** Maps a URL to a source/platform key. */
export function platformOf(url: string): string {
  let h = "";
  try {
    h = new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
  const rules: [RegExp, string][] = [
    [/goodreads\.com$/, "goodreads"],
    [/(^|\.)amazon\.[a-z.]+$|amzn\.(to|eu)$/, "amazon"],
    [/books\.apple\.com$/, "apple_books"],
    [/play\.google\.com$|books\.google\./, "googlebooks"],
    [/kobo\.com$/, "kobo"],
    [/barnesandnoble\.com$/, "bn"],
    [/books2read\.com$|draft2digital\.com$/, "draft2digital"],
    [/smashwords\.com$/, "smashwords"],
    [/lulu\.com$/, "lulu"],
    [/bookbaby\.com$/, "bookbaby"],
    [/blurb\.[a-z.]+$/, "blurb"],
    [/gumroad\.com$/, "gumroad"],
    [/payhip\.com$/, "payhip"],
    [/wattpad\.com$/, "wattpad"],
    [/inkitt\.com$/, "inkitt"],
    [/royalroad\.com$/, "royalroad"],
    [/scribblehub\.com$/, "scribblehub"],
    [/reedsy\.com$/, "reedsy"],
    [/substack\.com$/, "substack"],
    [/medium\.com$/, "medium"],
    [/kickstarter\.com$/, "kickstarter"],
    [/instagram\.com$/, "instagram"],
    [/tiktok\.com$/, "tiktok"],
    [/youtube\.com$|youtu\.be$/, "youtube"],
    [/facebook\.com$/, "facebook"],
    [/linkedin\.com$/, "linkedin"],
    [/(^|\.)x\.com$|twitter\.com$/, "x"],
    [/pinterest\./, "pinterest"],
    [/openlibrary\.org$/, "openlibrary"],
    [/unbound\.com$/, "unbound"],
    [/indiegogo\.com$/, "indiegogo"],
    [/lovelybooks\.de$/, "lovelybooks"],
    [/babelio\.com$/, "babelio"],
    [/thalia\.de$|weltbild\.de$|hugendubel\.de$/, "de_retailer"],
    [/bod\.[a-z]+$|epubli\.(de|com)$|tolino-media\.de$|neobooks\.com$/, "de_selfpub"],
  ];
  for (const [re, key] of rules) if (re.test(h)) return key;
  return "author_site";
}

export const SEED_ONLY = new Set(DISCOVERY_SOURCES.filter((s) => s.accessMode === "seed_only").map((s) => s.key));
