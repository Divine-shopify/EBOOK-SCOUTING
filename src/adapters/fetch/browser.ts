/**
 * Optional Playwright-based renderer for JavaScript-heavy author websites.
 * Only used when ResearchConfig.useBrowser is true. Applies the same SSRF guard and
 * robots.txt check as the HTTP fetcher (callers must invoke Fetcher.robotsCheck first).
 */
import { assertSafeUrl } from "./http.js";

export async function renderWithBrowser(url: string, executablePath?: string): Promise<{ html: string; finalUrl: string }> {
  await assertSafeUrl(url);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: executablePath ?? process.env.BROWSER_EXECUTABLE ?? "/opt/pw-browsers/chromium",
    headless: true,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });
  try {
    const ctx = await browser.newContext({ userAgent: process.env.USER_AGENT, javaScriptEnabled: true });
    const page = await ctx.newPage();
    // Never submit forms or click; read-only navigation.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(1500);
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await browser.close();
  }
}
