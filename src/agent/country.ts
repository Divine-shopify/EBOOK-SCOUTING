/** Country names and common native names / major cities used to confirm a country claim on the cited page. */
export const COUNTRY_ALIASES: Record<string, string[]> = {
  "United States": ["united states", "usa", "u.s.", "america", "california", "texas", "new york", "florida", "washington", "oregon", "colorado", "ohio", "michigan", "georgia", "virginia", "north carolina", "illinois", "massachusetts", "pennsylvania", "arizona", "minnesota", "tennessee", "utah", "wisconsin", "missouri", "kentucky", "indiana", "maryland", "new jersey", "connecticut", "louisiana", "alabama", "iowa", "kansas", "nevada", "maine", "vermont", "idaho", "montana", "alaska", "hawaii"],
  "United Kingdom": ["united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "london", "manchester", "edinburgh", "glasgow", "bristol", "yorkshire", "cornwall", "devon", "birmingham", "leeds", "liverpool", "cardiff", "brighton", "oxford", "cambridge", "kent", "sussex"],
  Canada: ["canada", "ontario", "quebec", "british columbia", "alberta", "manitoba", "nova scotia", "toronto", "vancouver", "montreal", "calgary", "ottawa", "saskatchewan", "new brunswick"],
  Australia: ["australia", "sydney", "melbourne", "brisbane", "perth", "adelaide", "queensland", "victoria", "new south wales", "tasmania", "canberra"],
  Germany: ["germany", "deutschland", "berlin", "hamburg", "münchen", "munich", "köln", "cologne", "frankfurt", "stuttgart", "düsseldorf", "leipzig", "dresden", "bayern", "bavaria", "nrw"],
  France: ["france", "paris", "lyon", "marseille", "toulouse", "bordeaux", "nantes", "lille", "bretagne", "normandie"],
  Netherlands: ["netherlands", "nederland", "holland", "amsterdam", "rotterdam", "utrecht", "den haag", "the hague", "eindhoven", "groningen"],
  Spain: ["spain", "españa", "madrid", "barcelona", "valencia", "sevilla", "seville", "málaga", "bilbao", "andalucía", "cataluña", "catalonia"],
  Italy: ["italy", "italia", "roma", "rome", "milano", "milan", "napoli", "torino", "turin", "firenze", "florence", "bologna", "venezia", "sicilia"],
  Switzerland: ["switzerland", "schweiz", "suisse", "svizzera", "zürich", "zurich", "geneva", "genève", "basel", "bern", "lausanne", "luzern"],
  Austria: ["austria", "österreich", "wien", "vienna", "graz", "linz", "salzburg", "innsbruck", "kärnten", "tirol"],
  Belgium: ["belgium", "belgië", "belgique", "brussels", "bruxelles", "brussel", "antwerp", "antwerpen", "ghent", "gent", "liège", "leuven"],
  Sweden: ["sweden", "sverige", "stockholm", "göteborg", "gothenburg", "malmö", "uppsala"],
  Norway: ["norway", "norge", "oslo", "bergen", "trondheim", "stavanger"],
  Denmark: ["denmark", "danmark", "copenhagen", "københavn", "aarhus", "odense"],
  Finland: ["finland", "suomi", "helsinki", "tampere", "turku", "espoo"],
  Iceland: ["iceland", "ísland", "reykjavík", "reykjavik"],
  Ireland: ["ireland", "éire", "dublin", "cork", "galway", "limerick", "kerry"],
  Luxembourg: ["luxembourg", "luxemburg", "lëtzebuerg"],
  "New Zealand": ["new zealand", "aotearoa", "auckland", "wellington", "christchurch", "dunedin", "otago"],
  Japan: ["japan", "日本", "tokyo", "東京", "osaka", "kyoto", "yokohama", "hokkaido", "okinawa", "fukuoka"],
  "South Korea": ["south korea", "korea", "대한민국", "한국", "seoul", "서울", "busan"],
  Singapore: ["singapore"],
  "United Arab Emirates": ["united arab emirates", "uae", "dubai", "abu dhabi", "sharjah"],
  Israel: ["israel", "tel aviv", "jerusalem", "haifa", "ישראל"],
};

export function canonicalCountry(claim: string | null | undefined): string | null {
  if (!claim) return null;
  const c = claim.trim().toLowerCase();
  for (const [name, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (name.toLowerCase() === c || aliases.includes(c)) return name;
  }
  return claim.trim();
}

/** True when the page text mentions the claimed country (or one of its aliases) as a whole word. */
export function pageSupportsCountry(text: string, country: string): boolean {
  const aliases = COUNTRY_ALIASES[country] ?? [country.toLowerCase()];
  const t = text.toLowerCase();
  return [country.toLowerCase(), ...aliases].some((a) => {
    if (/[^\x00-\x7f]/.test(a) && !/[a-zà-ÿ]/i.test(a)) return t.includes(a);
    const re = new RegExp(`(^|[^\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
    return re.test(t);
  });
}
