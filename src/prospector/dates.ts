/**
 * Release-date extraction from evidence text (en/de/fr/es/it/nl). Used to tell a still-upcoming release from one
 * that has already happened, so stale "coming soon" pages do not count as current production evidence.
 */
const MONTHS: [RegExp, number][] = [
  [/^(jan|janv|januar|janvier|enero|gennaio|januari)/i, 0],
  [/^(feb|févr|fevr|februar|février|febrero|febbraio|februari)/i, 1],
  [/^(mar(?!s)|märz|maerz|marzo|maart)|^mars/i, 2],
  [/^(apr|avr|avril|abril|aprile)/i, 3],
  [/^(may|mai|mayo|maggio|mei)/i, 4],
  [/^(jun|juin|junio|giugno)/i, 5],
  [/^(jul|juil|juillet|julio|luglio)/i, 6],
  [/^(aug|août|aout|agosto|augustus)/i, 7],
  [/^(sep|sept|septembre|septiembre|settembre)/i, 8],
  [/^(oct|okt|octobre|octubre|ottobre)/i, 9],
  [/^(nov|novembre|noviembre)/i, 10],
  [/^(dec|dez|déc|decembre|décembre|diciembre|dicembre)/i, 11],
];
const SEASONS: [RegExp, number, number][] = [
  [/^(early|anfang|début|principios|inizio)/i, 3, 30],
  [/^(spring|frühjahr|frühling|printemps|primavera|voorjaar)/i, 4, 31],
  [/^(summer|sommer|été|verano|estate|zomer)/i, 7, 31],
  [/^(fall|autumn|herbst|automne|otoño|autunno|najaar)/i, 10, 30],
  [/^(late|ende|fin|finales|fine)/i, 11, 31],
  [/^(winter|hiver|invierno|inverno)/i, 13, 28],
];

function monthOf(word: string): number | null {
  for (const [re, m] of MONTHS) if (re.test(word)) return m;
  return null;
}

/** Returns every date (as end-of-period Date) mentioned in the text. */
export function datesIn(text: string, now = new Date()): Date[] {
  const out: Date[] = [];
  const t = text.replace(/ /g, " ");
  const yy = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  // 16.04.2026 / 16/04/2026 / 16-04-26 (day-first) and 10-23-26 (US month-first when day > 12)
  for (const m of t.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/g)) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(new Date(Date.UTC(yy(m[3]), mo - 1, d)));
  }
  for (const m of t.matchAll(/\b(20\d\d)-(\d{2})-(\d{2})\b/g)) out.push(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  // 16 April 2026 / 16. April 2026 / April 16, 2026 / April 2026 / Sept 26
  for (const m of t.matchAll(/\b(?:(\d{1,2})(?:st|nd|rd|th|er)?\.?\s+)?([A-Za-zÀ-ÿ]{3,10})\.?,?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(20\d\d|'\d{2})\b/g)) {
    const mo = monthOf(m[2]);
    const year = m[4].startsWith("'") ? 2000 + Number(m[4].slice(1)) : m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
    if (mo != null && year >= 2015 && year <= 2035) {
      const day = Number(m[1] ?? m[3] ?? 0) || new Date(Date.UTC(year, mo + 1, 0)).getUTCDate();
      out.push(new Date(Date.UTC(year, mo, day)));
      continue;
    }
    const season = SEASONS.find(([re]) => re.test(m[2]));
    if (season && /^20\d\d$/.test(m[4])) out.push(new Date(Date.UTC(Number(m[4]), season[1] - 1, season[2])));
  }
  // Month + day without a year ("launches Feb. 8", "Coming June 12"): taken as this year.
  for (const m of t.matchAll(/\b([A-Za-zÀ-ÿ]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!,?\s*(?:20\d\d|'\d{2}|\d))/g)) {
    const mo = monthOf(m[1]);
    const d = Number(m[2]);
    if (mo != null && d >= 1 && d <= 31 && m[1].length >= 3) out.push(new Date(Date.UTC(now.getUTCFullYear(), mo, d)));
  }
  // Bare future year ("Coming 2027"): end of that year.
  for (const m of t.matchAll(/\b(20\d\d)\b/g)) {
    const y = Number(m[1]);
    if (y > now.getUTCFullYear() && y <= now.getUTCFullYear() + 3) out.push(new Date(Date.UTC(y, 11, 31)));
  }
  // Day + month without year ("Sortie le 22 NOVEMBRE", "launches 10th Nov"): assume the next occurrence.
  return out;
}

/** "passed" when every date in the text is more than graceDays in the past; "current" when any is not; else null. */
export function releaseTiming(text: string, now = new Date(), graceDays = 30): "passed" | "current" | null {
  const ds = datesIn(text, now);
  if (!ds.length) return null;
  const cutoff = now.getTime() - graceDays * 86400_000;
  return ds.some((d) => d.getTime() >= cutoff) ? "current" : "passed";
}

/**
 * Timing judged only from dates near the stage wording itself ("Pre-order now … releases Nov 10, 2026"), so an
 * unrelated date elsewhere in the snippet (a workshop, a footer) does not decide whether the release is current.
 */
export function releaseTimingNear(text: string, terms: string[], now = new Date()): "passed" | "current" | null {
  const verdicts: ("passed" | "current")[] = [];
  const lower = text.toLowerCase();
  for (const term of terms) {
    let i = lower.indexOf(term.toLowerCase());
    while (i >= 0) {
      const t = releaseTiming(text.slice(Math.max(0, i - 80), i + term.length + 120), now);
      if (t) verdicts.push(t);
      i = lower.indexOf(term.toLowerCase(), i + 1);
    }
  }
  if (!verdicts.length) return terms.length ? null : releaseTiming(text, now);
  return verdicts.includes("current") ? "current" : "passed";
}
