/**
 * Target markets. Measure: IMF World Economic Outlook projected 2026 nominal GDP per capita (current USD),
 * read via IMF-sourced tables (statisticsoftheworld.com IMF.NGDPDPC; seasiastats.com, 7 Sep 2026) on 2026-10-12.
 * Microstates without a meaningful book market (Liechtenstein, Macao, San Marino) are skipped.
 * Values are recorded only where the source table showed them; the rest are in the IMF top tier but unvalued here.
 */
export interface Market {
  country: string;
  gdpPerCapitaUsd2026?: number;
  languages: string[];
  /** Words used to recognise the country on a page (country names, demonyms, major cities). */
  places: string[];
}

export const MARKETS: Market[] = [
  { country: "Luxembourg", gdpPerCapitaUsd2026: 158_733, languages: ["fr", "de", "lb", "en"], places: ["Luxembourg"] },
  { country: "Ireland", gdpPerCapitaUsd2026: 140_186, languages: ["en", "ga"], places: ["Ireland", "Irish", "Dublin", "Cork", "Galway", "Limerick", "Kerry", "Wicklow"] },
  { country: "Switzerland", gdpPerCapitaUsd2026: 126_177, languages: ["de", "fr", "it", "en"], places: ["Switzerland", "Swiss", "Schweiz", "Suisse", "Zurich", "Zürich", "Geneva", "Genève", "Basel", "Bern", "Lausanne", "Lucerne", "Luzern"] },
  { country: "Iceland", gdpPerCapitaUsd2026: 110_048, languages: ["is", "en"], places: ["Iceland", "Icelandic", "Reykjavik", "Reykjavík"] },
  { country: "Singapore", gdpPerCapitaUsd2026: 107_758, languages: ["en", "zh", "ms"], places: ["Singapore", "Singaporean"] },
  { country: "Norway", gdpPerCapitaUsd2026: 105_877, languages: ["no", "en"], places: ["Norway", "Norwegian", "Norge", "Oslo", "Bergen", "Trondheim", "Stavanger"] },
  { country: "United States", gdpPerCapitaUsd2026: 94_430, languages: ["en", "es"], places: ["United States", "USA", "U.S.", "America", "California", "Texas", "Florida", "New York", "Washington", "Oregon", "Colorado", "Arizona", "Georgia", "Ohio", "Michigan", "Illinois", "Chicago", "Los Angeles", "Seattle", "Boston", "Pennsylvania", "Virginia", "North Carolina", "Tennessee", "Minnesota", "Wisconsin", "Massachusetts", "New Jersey", "Utah", "Nevada", "Kentucky", "Indiana", "Missouri", "Alabama", "Louisiana", "Oklahoma", "Kansas", "Iowa", "Maine", "Vermont", "Montana", "Idaho", "Alaska", "Hawaii", "Maryland", "Connecticut", "South Carolina", "New Mexico", "Arkansas", "Mississippi", "Nebraska", "Wyoming", "Delaware", "Rhode Island", "New Hampshire", "Texas", "Austin", "Denver", "Portland", "Atlanta", "Dallas", "Houston", "Brooklyn", "San Francisco", "San Diego", "Philadelphia", "Nashville", "Phoenix", "Midwest", "Pacific Northwest", "Cincinnati", "Cleveland", "Columbus, Ohio", "Detroit", "Pittsburgh", "Baltimore", "Miami", "Orlando", "Tampa", "Sacramento", "San Antonio", "Charlotte", "Raleigh", "Indianapolis", "Milwaukee", "Minneapolis", "St. Louis", "Kansas City", "Salt Lake City", "Las Vegas", "Albuquerque", "Boise", "Colorado Springs", "Memphis", "Louisville", "Richmond, Virginia", "New Orleans", "Honolulu", "Anchorage", "Omaha", "Des Moines", "Spokane", "Tucson"] },
  { country: "Denmark", gdpPerCapitaUsd2026: 83_445, languages: ["da", "en"], places: ["Denmark", "Danish", "Danmark", "Copenhagen", "København", "Aarhus"] },
  { country: "Netherlands", gdpPerCapitaUsd2026: 79_918, languages: ["nl", "en"], places: ["Netherlands", "Dutch", "Nederland", "Holland", "Amsterdam", "Rotterdam", "Utrecht", "The Hague", "Den Haag", "Eindhoven", "Groningen"] },
  { country: "Australia", languages: ["en"], places: ["Australia", "Australian", "Aussie", "Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Hobart", "Canberra", "Queensland", "Tasmania", "Victoria, Australia", "New South Wales", "Gold Coast"] },
  { country: "Austria", languages: ["de", "en"], places: ["Austria", "Austrian", "Österreich", "Vienna", "Wien", "Graz", "Salzburg", "Innsbruck", "Linz"] },
  { country: "Sweden", languages: ["sv", "en"], places: ["Sweden", "Swedish", "Sverige", "Stockholm", "Gothenburg", "Göteborg", "Malmö", "Uppsala"] },
  { country: "Belgium", languages: ["nl", "fr", "de", "en"], places: ["Belgium", "Belgian", "België", "Belgique", "Brussels", "Bruxelles", "Antwerp", "Antwerpen", "Ghent", "Gent", "Liège", "Leuven"] },
  { country: "Finland", languages: ["fi", "sv", "en"], places: ["Finland", "Finnish", "Suomi", "Helsinki", "Tampere", "Turku"] },
  { country: "Germany", languages: ["de", "en"], places: ["Germany", "German author", "Deutschland", "Berlin", "Munich", "München", "Hamburg", "Cologne", "Köln", "Frankfurt", "Stuttgart", "Düsseldorf", "Leipzig", "Dresden", "Bavaria", "Bayern"] },
  { country: "Canada", languages: ["en", "fr"], places: ["Canada", "Canadian", "Toronto", "Vancouver", "Montreal", "Montréal", "Ottawa", "Calgary", "Edmonton", "Winnipeg", "Halifax", "Quebec", "Québec", "Ontario", "British Columbia", "Alberta", "Nova Scotia", "Manitoba", "Saskatchewan", "New Brunswick", "Newfoundland"] },
  { country: "United Arab Emirates", languages: ["ar", "en"], places: ["United Arab Emirates", "UAE", "Dubai", "Abu Dhabi", "Sharjah"] },
  { country: "New Zealand", languages: ["en", "mi"], places: ["New Zealand", "Aotearoa", "Kiwi author", "Auckland", "Wellington", "Christchurch", "Dunedin", "Hamilton, NZ", "Tauranga"] },
  { country: "United Kingdom", languages: ["en"], places: ["United Kingdom", "UK", "U.K.", "Britain", "British", "England", "English author", "Scotland", "Scottish", "Wales", "Welsh", "Northern Ireland", "London", "Manchester", "Birmingham", "Leeds", "Liverpool", "Bristol", "Edinburgh", "Glasgow", "Cardiff", "Belfast", "Yorkshire", "Cornwall", "Devon", "Kent", "Sussex", "Surrey", "Oxford", "Cambridge", "Brighton", "Nottingham", "Sheffield", "Newcastle", "Norfolk", "Suffolk", "Essex", "Lancashire", "Cumbria", "Somerset", "Dorset", "Hampshire"] },
  { country: "France", languages: ["fr", "en"], places: ["France", "French author", "Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux", "Nantes", "Lille", "Brittany", "Bretagne", "Normandy", "Normandie", "Provence"] },
  { country: "Japan", languages: ["ja", "en"], places: ["Japan", "Japanese", "Tokyo", "Osaka", "Kyoto", "Yokohama", "Hokkaido", "Okinawa"] },
  { country: "South Korea", languages: ["ko", "en"], places: ["South Korea", "Korea", "Seoul", "Busan"] },
  { country: "Italy", languages: ["it", "en"], places: ["Italy", "Italian author", "Italia", "Rome", "Roma", "Milan", "Milano", "Florence", "Firenze", "Naples", "Napoli", "Turin", "Torino", "Venice", "Bologna", "Sicily", "Sardinia", "Tuscany"] },
  { country: "Spain", languages: ["es", "ca", "en"], places: ["Spain", "Spanish author", "España", "Madrid", "Barcelona", "Valencia", "Seville", "Sevilla", "Málaga", "Bilbao", "Mallorca", "Canary Islands", "Andalusia", "Catalonia"] },
];

export const MARKET_MEASURE =
  "IMF World Economic Outlook projected 2026 nominal GDP per capita (current USD), read 2026-10-12 via IMF-sourced tables; microstates without a meaningful book market excluded.";

export function marketByName(name: string | undefined | null): Market | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  const alias: Record<string, string> = { usa: "United States", us: "United States", "u.s.": "United States", uk: "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom", uae: "United Arab Emirates", korea: "South Korea", holland: "Netherlands" };
  const target = (alias[n] ?? name).toLowerCase();
  return MARKETS.find((m) => m.country.toLowerCase() === target);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds a country stated in text via location phrasing ("based in", "lives in", "from", "Dublin, Ireland").
 * Bare mentions (e.g. a book set in Paris) are ignored.
 */
export function countryFromText(text: string, name?: string): { country: string; quote: string } | null {
  // The location phrase must be about the author (first person, "author/writer", or their name nearby), not a character
  // in a book blurb ("his son living in New York").
  const nameTokens = (name ?? "").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 3);
  const aboutAuthor = (idx: number) => {
    const w = text.slice(Math.max(0, idx - 160), idx).toLowerCase();
    return /\b(i|i'm|i am|my|we|author|writer|novelist|poet|autor|autorin|auteur|autrice|escritora?|scrittrice|scrittore)\b/.test(w) || nameTokens.some((t) => w.includes(t));
  };
  const lead = String.raw`(?:based (?:in|out of)|lives? (?:in|on)|living (?:in|on)|resides? in|residing in|hails? from|is from|i'?m from|author from|writer from|grew up in .{0,40}? now lives in|calls? .{0,30}? home|lebt (?:in|mit .{0,40}? in)|wohnt in|vit (?:à|en|au)|vive en|vive a|woont in|bor i|asuu)`;
  for (const m of MARKETS) {
    for (const p of m.places) {
      if (p.length < 3) continue;
      const re = new RegExp(String.raw`${lead}\s+(?:the\s+)?(?:[A-Z][\p{L}'.-]+(?:\s[A-Z][\p{L}'.-]+)?,\s+)?${escapeRe(p)}\b`, "iu");
      const hit = re.exec(text);
      if (hit && aboutAuthor(hit.index)) return { country: m.country, quote: text.slice(Math.max(0, hit.index - 40), hit.index + hit[0].length + 20).replace(/\s+/g, " ").trim() };
    }
  }
  return null;
}

/** German Impressum addresses ("91438 Bad Windsheim") imply Germany: five-digit postcodes are German (AT/CH use four). */
export function countryFromImpressum(text: string): { country: string; quote: string } | null {
  if (!/\bimpressum\b/i.test(text) || /\b(österreich|austria|schweiz|switzerland|suisse)\b/i.test(text)) return null;
  const m = /\b(?:D-)?(\d{5})\s+([A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ]?[a-zäöüß]+)*)/.exec(text.slice(text.search(/\bimpressum\b/i)));
  return m ? { country: "Germany", quote: `Impressum address: ${m[1]} ${m[2]}` } : null;
}

/** French "mentions légales" addresses ("75011 Paris") imply France when no other country is named. */
export function countryFromMentionsLegales(text: string): { country: string; quote: string } | null {
  const at = text.search(/mentions l[ée]gales/i);
  if (at < 0 || /\b(belgique|suisse|luxembourg|canada|québec)\b/i.test(text)) return null;
  const m = /\b(\d{5})\s+([A-ZÉÈ][\p{L}'-]+(?:[ -][\p{L}'-]+)*)/u.exec(text.slice(at));
  return m ? { country: "France", quote: `Mentions légales address: ${m[1]} ${m[2]}` } : null;
}
