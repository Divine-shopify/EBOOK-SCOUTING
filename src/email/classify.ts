import type { FoundEmail } from "../analysis/extract.js";

export type ContactType = "author_direct" | "author_business" | "agent" | "publisher" | "publicist" | "general_inquiry" | "contact_form_only" | "unknown";

const FREEMAIL = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|icloud|me|mac|aol|proton|protonmail|pm|gmx|web|t-online|freenet|orange|free|laposte|libero|virgilio|hotmail|yandex|mail|zoho|fastmail|hey|bigpond|optusnet|xtra|naver|daum|hanmail)\.[a-z.]+$/i;
const AGENT_CTX = /(literary agent|agent:|agency|represented by|representation|rights (enquiries|inquiries)|foreign rights|film rights|literaturagentur|agence littéraire)/i;
const PUBLISHER_CTX = /(publisher|publishing house|verlag|éditions|editorial|uitgeverij|casa editrice)/i;
const PUBLICIST_CTX = /(publicist|publicity|press (enquiries|inquiries)|media (enquiries|inquiries)|pr contact|presse)/i;
const BUSINESS_CTX = /(business|professional|bookings|speaking|events|collaborat|work with|commission|enquiries|inquiries|geschäftlich)/i;
const GENERIC_LOCAL = /^(info|hello|hi|contact|kontakt|mail|office|admin|team|support|enquiries|inquiries|press|media|bonjour|hallo|ciao|hola)$/i;

/**
 * Classifies a publicly listed address. Never upgrades an agent/publisher address to the author.
 */
export function classifyEmail(found: FoundEmail, authorDomain: string | null, pageUrl: string): { type: ContactType; confidence: "high" | "medium" | "low"; note: string } {
  const [local, domain] = found.email.split("@");
  const ctx = found.context;
  const onAuthorSite = !!authorDomain && pageUrl.toLowerCase().includes(authorDomain);
  const sameDomain = !!authorDomain && (domain === authorDomain || domain.endsWith("." + authorDomain));
  if (AGENT_CTX.test(ctx) && !sameDomain) return { type: "agent", confidence: onAuthorSite ? "high" : "medium", note: "Listed in an agent/rights context; belongs to a representative, not the author." };
  if (PUBLICIST_CTX.test(ctx) && !sameDomain) return { type: "publicist", confidence: onAuthorSite ? "high" : "medium", note: "Listed for press/publicity enquiries." };
  if (PUBLISHER_CTX.test(ctx) && !sameDomain && !onAuthorSite) return { type: "publisher", confidence: "medium", note: "Listed on a publisher page." };
  if (sameDomain) {
    if (GENERIC_LOCAL.test(local)) return { type: "general_inquiry", confidence: "high", note: "Generic inbox on the author's own domain." };
    return { type: BUSINESS_CTX.test(ctx) ? "author_business" : "author_direct", confidence: "high", note: "Address on the author's own domain, published on their site." };
  }
  if (onAuthorSite && FREEMAIL.test(found.email)) return { type: BUSINESS_CTX.test(ctx) ? "author_business" : "author_direct", confidence: "medium", note: "Webmail address published on the author's official site." };
  if (onAuthorSite) return { type: "unknown", confidence: "low", note: "Third-party domain on the author's site; relationship unclear (could be web designer, host, etc.)." };
  return { type: "unknown", confidence: "low", note: "Found off the author's site; attribution uncertain." };
}
