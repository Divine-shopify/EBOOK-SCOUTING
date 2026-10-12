import { resolveMx } from "node:dns/promises";

/**
 * Verification ladder (strictly separated, never conflated):
 *  publicly_listed     – address appears on an attributable public page (set at discovery)
 *  syntax_valid        – RFC-ish syntax check passed (not proof of deliverability)
 *  domain_mx_checked   – domain publishes MX records (not proof the mailbox exists)
 *  provider_verified   – a configured third-party verifier reported "valid"
 *  delivery_confirmed  – only set manually after legitimate, authorised correspondence
 *  invalid             – syntax failed, domain has no mail routing, or provider rejected
 *  unknown             – checks could not be completed
 * AuthorScout never sends mail, never performs SMTP RCPT probing, and never guesses addresses.
 */
export type VerificationStatus = "publicly_listed" | "syntax_valid" | "domain_mx_checked" | "provider_verified" | "delivery_confirmed" | "invalid" | "unknown";

export const SYNTAX_RE = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+-]{1,64}(?<!\.)@(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

export function isSyntaxValid(email: string): boolean {
  return SYNTAX_RE.test(email);
}

export interface VerificationProvider {
  readonly name: string;
  isConfigured(): boolean;
  verify(email: string): Promise<{ result: "valid" | "invalid" | "catch_all" | "unknown"; raw: string }>;
}

export class ZeroBounceProvider implements VerificationProvider {
  readonly name = "zerobounce";
  constructor(private apiKey?: string) {}
  isConfigured() {
    return !!this.apiKey;
  }
  async verify(email: string) {
    const res = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(this.apiKey!)}&email=${encodeURIComponent(email)}`);
    const data: any = await res.json();
    const s = String(data.status ?? "unknown");
    return { result: (s === "valid" ? "valid" : s === "invalid" ? "invalid" : s === "catch-all" ? "catch_all" : "unknown") as any, raw: s };
  }
}

export class NeverBounceProvider implements VerificationProvider {
  readonly name = "neverbounce";
  constructor(private apiKey?: string) {}
  isConfigured() {
    return !!this.apiKey;
  }
  async verify(email: string) {
    const res = await fetch(`https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(this.apiKey!)}&email=${encodeURIComponent(email)}`);
    const data: any = await res.json();
    const s = String(data.result ?? "unknown");
    return { result: (s === "valid" ? "valid" : s === "invalid" ? "invalid" : s === "catchall" ? "catch_all" : "unknown") as any, raw: s };
  }
}

/** MX lookup via DNS-over-HTTPS (works behind HTTP proxies where UDP DNS is unavailable). */
export async function dohResolveMx(domain: string): Promise<{ exchange: string; priority: number }[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw Object.assign(new Error(`DoH HTTP ${res.status}`), { code: "EDOH" });
  const data: any = await res.json();
  if (data.Status === 3) throw Object.assign(new Error("NXDOMAIN"), { code: "ENOTFOUND" });
  if (data.Status !== 0) throw Object.assign(new Error(`DNS status ${data.Status}`), { code: "ESERVFAIL" });
  const answers = (data.Answer ?? []).filter((a: any) => a.type === 15);
  if (!answers.length) throw Object.assign(new Error("No MX records"), { code: "ENODATA" });
  return answers.map((a: any) => {
    const [prio, host] = String(a.data).split(/\s+/);
    return { priority: Number(prio), exchange: (host ?? "").replace(/\.$/, "") || "." };
  });
}

/** Uses system DNS first, falling back to DoH when the resolver gives no usable answer. */
export async function resolveMxRobust(domain: string): Promise<{ exchange: string; priority: number }[]> {
  try {
    const r = await resolveMx(domain);
    if (r.length) return r;
  } catch {
    /* fall through to DoH */
  }
  return dohResolveMx(domain);
}

export type MxLookup = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

export interface VerificationOutcome {
  status: VerificationStatus;
  method: string;
  syntaxValid: boolean;
  domainHasMx: boolean | null;
  mxHosts: string[];
  provider: string | null;
  providerResult: string | null;
  details: string;
}

/** Runs the non-intrusive checks. The highest rung actually reached is reported. */
export async function verifyEmail(email: string, opts: { provider?: VerificationProvider | null; mxLookup?: MxLookup } = {}): Promise<VerificationOutcome> {
  const mxLookup = opts.mxLookup ?? resolveMxRobust;
  const steps: string[] = ["publicly listed on source page"];
  if (!isSyntaxValid(email)) {
    return { status: "invalid", method: "syntax", syntaxValid: false, domainHasMx: null, mxHosts: [], provider: null, providerResult: null, details: "Failed syntax check" };
  }
  steps.push("syntax valid");
  const domain = email.split("@")[1];
  let domainHasMx: boolean | null = null;
  let mxHosts: string[] = [];
  try {
    const mx = await mxLookup(domain);
    mxHosts = mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange).filter(Boolean);
    domainHasMx = mxHosts.length > 0 && !(mxHosts.length === 1 && mxHosts[0] === "."); // null MX (RFC 7505) => no mail
  } catch (e: any) {
    // NXDOMAIN => the domain cannot receive mail. NODATA (no MX) is not conclusive (implicit A-record routing), so stays unknown.
    domainHasMx = e?.code === "ENOTFOUND" ? false : null;
    steps.push(`MX lookup error: ${e?.code ?? e?.message}`);
  }
  if (domainHasMx === false) {
    return { status: "invalid", method: steps.concat("no MX records").join("; "), syntaxValid: true, domainHasMx, mxHosts, provider: null, providerResult: null, details: "Domain does not publish mail routing (MX)." };
  }
  let status: VerificationStatus = domainHasMx ? "domain_mx_checked" : "syntax_valid";
  if (domainHasMx) steps.push(`MX: ${mxHosts.slice(0, 3).join(", ")}`);
  let provider: string | null = null;
  let providerResult: string | null = null;
  if (opts.provider?.isConfigured()) {
    try {
      const r = await opts.provider.verify(email);
      provider = opts.provider.name;
      providerResult = r.raw;
      steps.push(`${provider}: ${r.raw}`);
      if (r.result === "valid") status = "provider_verified";
      else if (r.result === "invalid") status = "invalid";
    } catch (e: any) {
      steps.push(`provider error: ${e?.message}`);
    }
  }
  return { status, method: steps.join("; "), syntaxValid: true, domainHasMx, mxHosts, provider, providerResult, details: steps.join("; ") };
}
