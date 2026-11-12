const { chromium } = require("playwright");

const START_URL = process.env.TARGET_URL || "https://ahlicuan99.blogspot.com/";
const MAX_PAGES = Number(process.env.MAX_PAGES || 12);
const TIMEOUT_MS = 30000;

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

(async () => {
  let browser;
  let failures = 0;
  const checked = new Set();

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: "AhliCuan99-Monitor/1.0 (+scheduled website availability check)"
    });

    page.setDefaultNavigationTimeout(TIMEOUT_MS);
    page.setDefaultTimeout(10000);

    console.log(`Starting website check: ${START_URL}`);
    const response = await page.goto(START_URL, { waitUntil: "domcontentloaded" });
    const status = response ? response.status() : "no-response";
    console.log(`HOME ${status} ${page.url()}`);

    if (!response || status >= 400) failures++;

    const origin = new URL(START_URL).origin;
    const links = await page.locator("a[href]").evaluateAll((anchors) =>
      anchors.map((a) => a.href)
        .filter((href) => href && !href.startsWith("javascript:"))
    );

    const targets = [...new Set(links)]
      .filter((url) => sameOrigin(url, origin))
      .filter((url) => !url.includes("#"))
      .slice(0, MAX_PAGES);

    for (const url of targets) {
      if (checked.has(url)) continue;
      checked.add(url);

      try {
        const result = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: TIMEOUT_MS
        });
        const code = result ? result.status() : "no-response";
        console.log(`${code} ${page.url()}`);
        if (!result || code >= 400) failures++;
      } catch (error) {
        failures++;
        console.error(`ERROR ${url}: ${error.message}`);
      }
    }

    console.log(`SUMMARY checked=${checked.size + 1} failures=${failures}`);
    if (failures > 0) process.exitCode = 1;
  } catch (error) {
    console.error("MONITOR FAILED:", error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
