import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DB } from "../../db/db.js";
import { nowIso } from "../../db/db.js";
import { sleep } from "../../util/text.js";

let proxyInstalled = false;
/** Routes global fetch through HTTPS_PROXY/HTTP_PROXY when configured. */
export function installProxyFromEnv(): void {
  if (proxyInstalled) return;
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
  proxyInstalled = true;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  fromCache: boolean;
}

export class FetchBlockedError extends Error {
  constructor(message: string, public readonly reason: "robots" | "unsafe_url" | "seed_only" | "too_large") {
    super(message);
  }
}

export interface FetcherOptions {
  userAgent: string;
  requestsPerSecondPerHost: number;
  cacheTtlHours?: number;
  maxBytes?: number;
  timeoutMs?: number;
  retries?: number;
  /** Largest body stored in the cache (bulk scans store less to keep the database small). */
  cacheBodyMax?: number;
  /** Hosts with an explicit crawl delay override, in ms. */
  hostDelayMs?: Record<string, number>;
  onRequest?: (host: string) => void;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Rejects non-http(s) URLs and hosts resolving to private/loopback ranges (SSRF guard for untrusted links). */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchBlockedError(`Invalid URL: ${raw}`, "unsafe_url");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new FetchBlockedError(`Blocked scheme ${u.protocol}`, "unsafe_url");
  if (u.username || u.password) throw new FetchBlockedError("Credentials in URL are not allowed", "unsafe_url");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new FetchBlockedError(`Blocked host ${host}`, "unsafe_url");
  const check = (ip: string) => {
    if (isIP(ip) === 4 && PRIVATE_V4.some((r) => r.test(ip))) throw new FetchBlockedError(`Blocked private address ${ip}`, "unsafe_url");
    if (isIP(ip) === 6 && (/^(::1|fc|fd|fe80)/i.test(ip) || ip === "::")) throw new FetchBlockedError(`Blocked private address ${ip}`, "unsafe_url");
  };
  if (isIP(host)) check(host);
  else if (!process.env.HTTPS_PROXY && !process.env.https_proxy) {
    // Behind a proxy DNS is resolved by the proxy; otherwise verify locally.
    try {
      for (const a of await lookup(host, { all: true })) check(a.address);
    } catch (e) {
      if (e instanceof FetchBlockedError) throw e;
    }
  }
  return u;
}

/** Tiny robots.txt evaluator: longest-match Allow/Disallow for our UA group or '*'. */
export function robotsAllows(robotsTxt: string, userAgent: string, path: string): { allowed: boolean; crawlDelaySec?: number } {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  const ua = userAgent.toLowerCase();
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[]; delay?: number };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (val === "" && key === "disallow") continue;
      cur.rules.push({ allow: key === "allow", path: val });
    } else if (key === "crawl-delay") cur.delay = Number(val) || undefined;
  }
  const token = ua.split(/[\/\s]/)[0];
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = applicable.flatMap((g) => g.rules);
  const toRe = (p: string) =>
    new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$") );
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    const pattern = r.path.endsWith("$") ? r.path : r.path;
    if (toRe(pattern).test(path)) {
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  const delay = applicable.find((g) => g.delay)?.delay;
  return { allowed: best ? best.allow : true, crawlDelaySec: delay };
}

export class Fetcher {
  private lastHit = new Map<string, number>();
  private robots = new Map<string, { txt: string; at: number }>();
  constructor(private db: DB | null, private opts: FetcherOptions) {
    installProxyFromEnv();
  }

  private async throttle(host: string, extraDelayMs = 0): Promise<void> {
    const minGap = Math.max(1000 / this.opts.requestsPerSecondPerHost, this.opts.hostDelayMs?.[host] ?? 0, extraDelayMs);
    const last = this.lastHit.get(host) ?? 0;
    const wait = last + minGap - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastHit.set(host, Date.now());
  }

  private async rawGet(u: URL, accept = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5"): Promise<FetchResult> {
    const maxBytes = this.opts.maxBytes ?? 3_000_000;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000);
    try {
      this.opts.onRequest?.(u.hostname);
      const res = await fetch(u, { headers: { "user-agent": this.opts.userAgent, accept, "accept-language": "en;q=0.9,*;q=0.5" }, redirect: "follow", signal: ctrl.signal });
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            ctrl.abort();
            break;
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return { url: u.toString(), finalUrl: res.url || u.toString(), status: res.status, contentType: res.headers.get("content-type") ?? "", body, fromCache: false };
    } finally {
      clearTimeout(t);
    }
  }

  async robotsCheck(u: URL): Promise<{ allowed: boolean; crawlDelaySec?: number }> {
    const origin = u.origin;
    let entry = this.robots.get(origin);
    if (!entry || Date.now() - entry.at > 6 * 3600_000) {
      let txt = "";
      try {
        await this.throttle(u.hostname);
        const r = await this.rawGet(new URL("/robots.txt", origin), "text/plain");
        txt = r.status >= 200 && r.status < 300 ? r.body : "";
      } catch {
        txt = "";
      }
      entry = { txt, at: Date.now() };
      this.robots.set(origin, entry);
    }
    return robotsAllows(entry.txt, this.opts.userAgent, u.pathname + u.search);
  }

  /** GET a public page: SSRF-guarded, robots-checked, throttled, cached, retried. */
  async get(raw: string, { useCache = true, skipRobots = false }: { useCache?: boolean; skipRobots?: boolean } = {}): Promise<FetchResult> {
    const u = await assertSafeUrl(raw);
    const ttl = (this.opts.cacheTtlHours ?? 72) * 3600_000;
    if (useCache && this.db) {
      const row = this.db.prepare("SELECT * FROM http_cache WHERE url = ?").get(u.toString()) as any;
      if (row && Date.now() - Date.parse(row.fetched_at) < ttl) {
        return { url: row.url, finalUrl: row.final_url, status: row.status, contentType: row.content_type, body: row.body ?? "", fromCache: true };
      }
    }
    let delayMs = 0;
    if (!skipRobots) {
      const rb = await this.robotsCheck(u);
      if (!rb.allowed) throw new FetchBlockedError(`robots.txt disallows ${u.pathname} on ${u.hostname}`, "robots");
      if (rb.crawlDelaySec) delayMs = Math.min(rb.crawlDelaySec, 30) * 1000;
    }
    const retries = this.opts.retries ?? 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.throttle(u.hostname, delayMs);
        const r = await this.rawGet(u);
        if ((r.status === 429 || r.status >= 500) && attempt < retries) {
          await sleep(1500 * 2 ** attempt);
          continue;
        }
        if (this.db && r.status < 500) {
          this.db
            .prepare(
              `INSERT INTO http_cache(url, status, final_url, content_type, body, fetched_at) VALUES (?,?,?,?,?,?)
               ON CONFLICT(url) DO UPDATE SET status=excluded.status, final_url=excluded.final_url, content_type=excluded.content_type, body=excluded.body, fetched_at=excluded.fetched_at`,
            )
            .run(u.toString(), r.status, r.finalUrl, r.contentType, r.body.slice(0, this.opts.cacheBodyMax ?? 3_000_000), nowIso());
        }
        return r;
      } catch (e) {
        lastErr = e;
        if (attempt < retries) await sleep(1500 * 2 ** attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async getJson<T = unknown>(raw: string): Promise<{ status: number; data: T | null; finalUrl: string }> {
    const r = await this.get(raw, { skipRobots: true });
    try {
      return { status: r.status, data: JSON.parse(r.body) as T, finalUrl: r.finalUrl };
    } catch {
      return { status: r.status, data: null, finalUrl: r.finalUrl };
    }
  }
}
