import type { Fetcher } from "../fetch/http.js";
import type { SearchOptions, SearchProvider, SearchResult } from "./types.js";

/** Open Library search API — keyless, open data (https://openlibrary.org/dev/docs/api/search). */
export class OpenLibrarySearch implements SearchProvider {
  readonly name = "openlibrary";
  readonly costPerQueryUsd = 0;
  constructor(private fetcher: Fetcher) {}
  isConfigured() {
    return true;
  }
  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(opts.limit),
      fields: "key,title,author_name,author_key,first_publish_year,language,ratings_count,edition_count,ebook_access,id_goodreads,isbn,publisher,subject",
    });
    if (opts.language) params.set("lang", opts.language);
    const { status, data } = await this.fetcher.getJson<{ docs: any[] }>(`https://openlibrary.org/search.json?${params}`);
    if (status !== 200 || !data) throw new Error(`Open Library search failed with HTTP ${status}`);
    return data.docs.map((d) => ({
      title: d.title,
      url: `https://openlibrary.org${d.key}`,
      snippet: [d.author_name?.join(", "), d.first_publish_year].filter(Boolean).join(" · "),
      provider: this.name,
      query,
      meta: {
        authors: d.author_name ?? [],
        authorKeys: d.author_key ?? [],
        firstPublishYear: d.first_publish_year ?? null,
        languages: d.language ?? [],
        ratingsCount: d.ratings_count ?? null,
        editionCount: d.edition_count ?? null,
        ebookAccess: d.ebook_access ?? null,
        goodreadsIds: d.id_goodreads ?? [],
        publishers: d.publisher ?? [],
      },
    }));
  }
}

/** Google Books API — keyless works with a small shared quota; GOOGLE_BOOKS_API_KEY recommended. */
export class GoogleBooksSearch implements SearchProvider {
  readonly name = "googlebooks";
  readonly costPerQueryUsd = 0;
  constructor(private fetcher: Fetcher, private apiKey?: string) {}
  isConfigured() {
    return true;
  }
  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, maxResults: String(Math.min(opts.limit, 40)), printType: "books", orderBy: "newest" });
    if (opts.language) params.set("langRestrict", opts.language);
    if (this.apiKey) params.set("key", this.apiKey);
    const { status, data } = await this.fetcher.getJson<{ items?: any[]; error?: { message: string } }>(`https://www.googleapis.com/books/v1/volumes?${params}`);
    if (status !== 200 || !data) throw new Error(`Google Books search failed with HTTP ${status}${data?.error ? `: ${data.error.message}` : ""}`);
    return (data.items ?? []).map((it) => {
      const v = it.volumeInfo ?? {};
      return {
        title: v.title,
        url: v.canonicalVolumeLink ?? v.infoLink ?? `https://books.google.com/books?id=${it.id}`,
        snippet: v.description?.slice(0, 300),
        provider: this.name,
        query,
        meta: {
          authors: v.authors ?? [],
          publishedDate: v.publishedDate ?? null,
          publisher: v.publisher ?? null,
          ratingsCount: v.ratingsCount ?? null,
          averageRating: v.averageRating ?? null,
          isEbook: it.saleInfo?.isEbook ?? null,
          country: it.saleInfo?.country ?? null,
          language: v.language ?? null,
          categories: v.categories ?? [],
          pageCount: v.pageCount ?? null,
        },
      };
    });
  }
}

/** Brave Search API (https://api.search.brave.com). Requires BRAVE_SEARCH_API_KEY. */
export class BraveSearch implements SearchProvider {
  readonly name = "brave";
  readonly costPerQueryUsd = 0.005;
  constructor(private apiKey?: string) {}
  isConfigured() {
    return !!this.apiKey;
  }
  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    if (!this.apiKey) throw new Error("BRAVE_SEARCH_API_KEY not configured");
    const params = new URLSearchParams({ q: query, count: String(Math.min(opts.limit, 20)) });
    if (opts.language) params.set("search_lang", opts.language);
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { accept: "application/json", "x-subscription-token": this.apiKey },
    });
    if (!res.ok) throw new Error(`Brave search HTTP ${res.status}`);
    const data: any = await res.json();
    return (data.web?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.description, provider: this.name, query }));
  }
}

/** Tavily Search API. Requires TAVILY_API_KEY. */
export class TavilySearch implements SearchProvider {
  readonly name = "tavily";
  readonly costPerQueryUsd = 0.008;
  constructor(private apiKey?: string) {}
  isConfigured() {
    return !!this.apiKey;
  }
  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    if (!this.apiKey) throw new Error("TAVILY_API_KEY not configured");
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: Math.min(opts.limit, 20), search_depth: "basic" }),
    });
    if (!res.ok) throw new Error(`Tavily search HTTP ${res.status}`);
    const data: any = await res.json();
    return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content, provider: this.name, query }));
  }
}

/** SerpAPI (Google results). Requires SERPAPI_API_KEY. */
export class SerpApiSearch implements SearchProvider {
  readonly name = "serpapi";
  readonly costPerQueryUsd = 0.015;
  constructor(private apiKey?: string) {}
  isConfigured() {
    return !!this.apiKey;
  }
  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    if (!this.apiKey) throw new Error("SERPAPI_API_KEY not configured");
    const params = new URLSearchParams({ engine: "google", q: query, num: String(Math.min(opts.limit, 20)), api_key: this.apiKey });
    if (opts.language) params.set("hl", opts.language);
    const res = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
    const data: any = await res.json();
    return (data.organic_results ?? []).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet, provider: this.name, query }));
  }
}

export function buildSearchProviders(fetcher: Fetcher, keys: { brave?: string; tavily?: string; serpapi?: string; googleBooks?: string }): SearchProvider[] {
  return [
    new BraveSearch(keys.brave),
    new TavilySearch(keys.tavily),
    new SerpApiSearch(keys.serpapi),
    new OpenLibrarySearch(fetcher),
    new GoogleBooksSearch(fetcher, keys.googleBooks),
  ];
}
