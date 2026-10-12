import type { Opportunity } from "./opportunities.js";
import type { PublicationStatus } from "./status.js";
import type { ContactType } from "../email/classify.js";

export interface ScoreInputs {
  opportunities: Opportunity[];
  status: PublicationStatus;
  explicitSeeking: string | null;
  crowdfunding: boolean;
  selfPublished: boolean | null;
  publisherIsLarge: boolean;
  bookCount: number | null;
  hasSeries: boolean;
  monthsSinceRelease: number | null;
  identity: "verified" | "partially_verified" | "unverified";
  bestContactType: ContactType | null;
  hasContactPage: boolean;
}

export interface ScoreBreakdown {
  opportunityEvidence: number;
  buyingSignal: number;
  commercialFit: number;
  authorActivity: number;
  identityVerification: number;
  contactAvailability: number;
  total: number;
  priority: "High priority" | "Qualified" | "Further research required" | "Low priority";
  explanation: string[];
}

export function priorityFor(total: number): ScoreBreakdown["priority"] {
  if (total >= 80) return "High priority";
  if (total >= 60) return "Qualified";
  if (total >= 40) return "Further research required";
  return "Low priority";
}

/** Transparent scoring: every point is tied to a recorded finding. Contact *availability* is scored; email validity is not. */
export function scoreLead(i: ScoreInputs): ScoreBreakdown {
  const why: string[] = [];
  const evidenced = i.opportunities.filter((o) => o.evidenceUrl || o.code === "G01");
  const strengthSum = evidenced.reduce((s, o) => s + o.strength, 0);
  const opportunityEvidence = Math.min(30, strengthSum * 3);
  why.push(`Opportunity evidence ${opportunityEvidence}/30: ${evidenced.length} evidenced opportunities (strength sum ${strengthSum} × 3, capped).`);

  let buyingSignal = 0;
  if (i.explicitSeeking) {
    buyingSignal = 25;
    why.push(`Buying signal 25/25: explicit public request ("${i.explicitSeeking}").`);
  } else if (i.crowdfunding) {
    buyingSignal = 15;
    why.push("Buying signal 15/25: active public crowdfunding for a book.");
  } else if (i.status === "forthcoming" && !i.publisherIsLarge) {
    buyingSignal = 15;
    why.push("Buying signal 15/25: announced forthcoming release without a large publisher.");
  } else if (i.status === "unpublished") {
    buyingSignal = 12;
    why.push("Buying signal 12/25: public manuscript-stage project.");
  } else if (i.status === "serial") {
    buyingSignal = 8;
    why.push("Buying signal 8/25: serial without an ebook edition.");
  } else if (i.monthsSinceRelease != null && i.monthsSinceRelease <= 6) {
    buyingSignal = 8;
    why.push("Buying signal 8/25: release within the last 6 months.");
  } else why.push("Buying signal 0/25: no explicit public buying signal found.");

  let commercialFit = 0;
  if (i.publisherIsLarge) why.push("Commercial fit: large traditional publisher handles production/marketing (0 for self-pub fit).");
  else if (i.selfPublished) {
    commercialFit += 8;
    why.push("Commercial fit +8: self-published/indie.");
  } else {
    commercialFit += 4;
    why.push("Commercial fit +4: small/unknown publisher.");
  }
  if ((i.bookCount ?? 0) >= 2) {
    commercialFit += 4;
    why.push(`Commercial fit +4: ${i.bookCount} identifiable books.`);
  }
  if (i.hasSeries) {
    commercialFit += 3;
    why.push("Commercial fit +3: series.");
  }
  commercialFit = Math.min(15, commercialFit);

  let authorActivity = 0;
  if (i.status === "forthcoming") authorActivity = 10;
  else if (i.monthsSinceRelease != null && i.monthsSinceRelease <= 12) authorActivity = 8;
  else if (i.status === "serial" || i.status === "unpublished") authorActivity = 7;
  else if (i.monthsSinceRelease != null && i.monthsSinceRelease <= 36) authorActivity = 4;
  else authorActivity = 2;
  why.push(`Author activity ${authorActivity}/10.`);

  const identityVerification = i.identity === "verified" ? 10 : i.identity === "partially_verified" ? 6 : 2;
  why.push(`Identity ${identityVerification}/10 (${i.identity}).`);

  let contactAvailability = 0;
  if (i.bestContactType === "author_direct" || i.bestContactType === "author_business" || i.bestContactType === "general_inquiry") contactAvailability = 10;
  else if (i.bestContactType === "agent" || i.bestContactType === "publicist" || i.bestContactType === "publisher") contactAvailability = 6;
  else if (i.hasContactPage) contactAvailability = 4;
  why.push(`Contact availability ${contactAvailability}/10 (${i.bestContactType ?? (i.hasContactPage ? "contact page only" : "none found")}).`);

  const total = opportunityEvidence + buyingSignal + commercialFit + authorActivity + identityVerification + contactAvailability;
  return { opportunityEvidence, buyingSignal, commercialFit, authorActivity, identityVerification, contactAvailability, total, priority: priorityFor(total), explanation: why };
}
