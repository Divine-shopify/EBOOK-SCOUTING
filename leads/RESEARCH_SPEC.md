# Lead research spec (for research agents)

You research real authors and return **verified** leads for Femi Emmanuel, a designer and book-services specialist.
Accuracy beats volume. A lead you cannot verify is logged as rejected, never padded.

## Acceptance rules (all mandatory)

1. **Email**: a complete address that you personally saw, verbatim, on a public page you fetched (author's own site contact/about/Impressum/press page, publisher-approved author page, or the author's public professional profile). Record that exact page as `Email Source URL`.
   - Never guess, construct, or infer an address from a domain or name pattern. No contact-form-only leads.
   - Not acceptable: a publisher's general submissions inbox, an agent's inbox unless clearly presented as the way to contact this author, unrelated directory listings, personal phone numbers or home addresses (never record those).
   - The merge tool re-fetches `Email Source URL` and rejects the lead if the address is not literally on that page. If the address only appears after JavaScript runs, or is an image, reject it.
2. **Identity**: the email page must clearly belong to the same person as the books (same name/pen name, links to the books, or the books link to the site).
3. **Books**: at least one verifiable book on a book platform (Amazon, Goodreads, Apple Books, Kobo, Google Play Books, B&N, publisher catalogue, Smashwords, Wattpad, etc.). Read the official description/synopsis before using any plot detail.
4. **Two books**: select **at least two** suitable titles for outreach whenever the author has two or more. If only one exists, say so in `Other Notes` using the words "only one verifiable book" and why.
5. **Location**: only from an explicit statement ("lives in", "based in", Impressum address country, bio). Never from publisher, setting, university or birthplace. Otherwise `Country` = `Unknown / not publicly verified`. City only if stated; never record street addresses.
6. **Platforms Actually Reviewed**: list only the platforms whose pages you actually fetched or whose search results you actually read for this author.

Prefer independent / small-press / hybrid authors who plausibly buy services. Skip household-name bestsellers.
Skip authors whose sites say they do not accept unsolicited marketing or vendor pitches.

## Services (choose `Primary Recommended Service` verbatim from this list)

Book trailers · Book promotion and marketing · Book formatting · Ebook formatting · Editing · Proofreading · Cover design · Interior layout · Publishing-related assistance · Facebook Ads · Ads management · SEO optimization · YouTube automation · Book-focused website design · AEO (Answer Engine Optimization) · GEO (Generative Engine Optimization) · Email marketing · Christmas preorder campaigns · Email templates · Book sales marketing · Sales bots · Customer retention · Reader-engagement automation · Marketing and sales workflow automation · 12-month book marketing roadmap · TikTok Shop

Pick the service the evidence supports; do **not** default to Book trailers. Examples: a visually striking premise → Book trailers; a series with several books → 12-month book marketing roadmap or Customer retention; no newsletter signup on the site → Email marketing; a dated or missing books page → Book-focused website design; an upcoming release → Book promotion and marketing; holiday-themed book → Christmas preorder campaigns. Never criticise book quality without evidence; editing/proofreading/cover design only when there is a concrete public basis (e.g. author publicly asking, a re-launch announced). If unsure, say so in the fit explanation.

## Publishing Status (start the field with one of these, then a short reason)

Confirmed KDP · Likely independent/KDP · Amazon-listed, KDP unverified · Traditional publisher · Independent publisher, evidence available · Mixed publishing model · Publishing status unclear

"Confirmed KDP" only if the author says they publish via KDP or the listing shows "Independently published" plus author statement. Amazon listing alone = "Amazon-listed, KDP unverified".

## Outreach email

Write in the author's language when their site is not in English (sign-off name stays "Femi Emmanuel"); otherwise English.
Subject: short, specific to the books, not generic (never "Book Marketing Services", "Promote Your Book", etc.).
Body model (adapt; 110–190 words; no placeholders left; mention each selected title by its exact title):

> Hi [first name],
> My name is Femi Emmanuel. I'm a designer and book services specialist, helping authors professionally present, publish, and promote their books.
> I came across [BOOK 1] and [BOOK 2] while researching your work. I was particularly interested in [verified element from book 1] and [verified element from book 2].
> Those details gave me an idea for how [service] could help present your books to more of the readers who may enjoy them. [1–2 sentences on the concept, verified facts only.]
> I'd be happy to put together a complimentary concept sample so you can see the direction I have in mind. (only if fitting; never claim a sample already exists)
> Would you be open to taking a look?
> Warm regards,
> Femi Emmanuel

No promises of sales/reach, no "guarantee", no invented awards/reviews/numbers, no list of many services.

## Output: one JSON file

Write `leads/batches/<your batch name>.json`:

```json
{
  "batch": "<batch name>",
  "leads": [
    {
      "Author Name": "Jane Doe",
      "Verified Public Email": ["jane@janedoebooks.com"],
      "Official Author Website": "https://janedoebooks.com",
      "Other Relevant Author Profile URLs": ["https://www.goodreads.com/author/show/...", "https://www.amazon.com/stores/author/B0..."],
      "Selected Book Titles for Outreach": ["Title One", "Title Two"],
      "Additional Discoverable Books and Series": "Series name (books 1–4): ...; other titles ...",
      "Book Genres": ["Cozy mystery"],
      "Verified Book Descriptions or Synopses": "Title One: <1–2 sentence paraphrase of official blurb>. Title Two: ...",
      "Book URLs Across Relevant Platforms": ["https://...", "https://..."],
      "Amazon Book URL": "",
      "Amazon Author URL": "",
      "Personalized Subject Line": "...",
      "Personalized Email Body": "Hi Jane,\n\nMy name is Femi Emmanuel. ...\n\nWarm regards,\nFemi Emmanuel",
      "Primary Recommended Service": "Book trailers",
      "Secondary Service Opportunity": ["Email marketing"],
      "Evidence-Based Service-Fit Explanation": "Why, citing what you saw.",
      "Reader and Review Signals": "e.g. Goodreads 3.9 avg / 120 ratings on Title One (as of research date); or 'none observed'",
      "Discoverability and Promotional Observations": "What promotion is visible (newsletter, socials, trailers) — observed facts only.",
      "Country": "Canada",
      "Region, State, or Province": "Ontario",
      "City": "",
      "Geographic Evidence and Relationship": "Current base: About page says 'lives in Ontario' (URL).",
      "Email Source URL": "https://janedoebooks.com/contact",
      "Author Identity Evidence URL": "https://janedoebooks.com/about",
      "Book Evidence Source URLs": ["https://www.goodreads.com/book/show/...", "https://..."],
      "Other Relevant Platform Evidence URLs": [],
      "Evidence Type": "Official author website; Goodreads book pages",
      "Email Attribution": "Author direct (on own website contact page)",
      "Publishing Status": "Likely independent/KDP — books show 'Independently published'; author bio mentions self-publishing",
      "Research Date": "2026-10-19",
      "Platforms Actually Reviewed": ["Official website", "Goodreads", "Amazon (search results)"],
      "Confidence and Manual Verification Notes": "Opportunity scores (1–5): premise 4, visual setting 4, series potential 3, identifiable audience 4; reader signals 2. Confidence: medium. ...",
      "Other Notes": ""
    }
  ],
  "log": [
    { "Country or Target Market": "Kenya", "Geographic Division": "", "City": "", "Language": "English", "Search Query": "Kenyan author self-published novel contact email", "Candidate Name": "X", "Email": "", "Source URL": "https://...", "Evidence Type": "author website", "Platform": "Google search", "Decision": "rejected", "Rejection Reason": "contact form only" }
  ]
}
```

Log **every** meaningful candidate you looked at (accepted ones with Decision `accepted`). Use the date 2026-10-19.
