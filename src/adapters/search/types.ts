export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  provider: string;
  query: string;
  /** Structured extras (e.g. author names, publish year) from book APIs. */
  meta?: Record<string, unknown>;
}

export interface SearchOptions {
  limit: number;
  language?: string;
  country?: string;
}

export interface SearchProvider {
  readonly name: string;
  /** Approximate cost per call in USD, for spending controls. */
  readonly costPerQueryUsd: number;
  isConfigured(): boolean;
  search(query: string, opts: SearchOptions): Promise<SearchResult[]>;
}
