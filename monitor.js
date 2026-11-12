const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const START_URL = process.env.TARGET_URL || "https://ahlicuan99.blogspot.com/";
const MAX_PAGES = Number(process.env.MAX_PAGES || 12);
const TIMEOUT_MS = 30000;
const DATA_DIR = path.join(__dirname, "docs");
const STATUS_FILE = path.join(DATA_DIR, "status.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

function sameOrigin(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

(async () => {
  let browser;
  let failures = 0;
  const pages = [];
  const startedAt = new Date().toISOString();

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: "AhliCuan99-Monitor/1.0 (+website availability check)"
    });
    page.setDefaultNavigationTimeout(TIMEOUT_MS);

    const response = await page.goto(START_URL, { waitUntil: "domcontentloaded" });
    const homeStatus = response ? response.status() : null;
    pages.push({ url: page.url(), status: homeStatus, ok: !!response && homeStatus < 400 });
    if (!response || homeStatus >= 400) failures++;

    const origin = new URL(START_URL).origin;
    const links = await page.locator("a[href]").evaluateAll(anchors =>
      anchors.map(a => a.href).filter(href => href && !href.startsWith("javascript:"))
    );
    const targets = [...new Set(links)]
      .filter(url => sameOrigin(url, origin) && !url.includes("#"))
      .slice(0, MAX_PAGES);

    for (const url of targets) {
      try {
        const result = await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
        const status = result ? result.status() : null;
        pages.push({ url, status, ok: !!result && status < 400 });
        if (!result || status >= 400) failures++;
      } catch (error) {
        pages.push({ url, status: null, ok: false, error: error.message });
        failures++;
      }
    }
  } catch (error) {
    failures++;
    pages.push({ url: START_URL, status: null, ok: false, error: error.message });
    console.error("MONITOR FAILED:", error);
  } finally {
    if (browser) await browser.close();

    const result = {
      checkedAt: startedAt,
      target: START_URL,
      total: pages.length,
      successful: pages.filter(p => p.ok).length,
      failures,
      status: failures === 0 ? "UP" : "ISSUES",
      pages
    };

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(result, null, 2));

    let history = [];
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); } catch {}
    history.unshift({
      checkedAt: result.checkedAt,
      status: result.status,
      total: result.total,
      successful: result.successful,
      failures: result.failures
    });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 168), null, 2));

    console.log("MONITOR_RESULT " + JSON.stringify(result));
    if (failures > 0) process.exitCode = 1;
  }
})();
