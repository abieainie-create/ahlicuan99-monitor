const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const START_URL = process.env.TARGET_URL || "https://ahlicuan99.blogspot.com/";
const MAX_PAGES = Number(process.env.MAX_PAGES || 12);
const TIMEOUT_MS = 30000;
const DATA_DIR = path.join(__dirname, "docs");
const STATUS_FILE = path.join(DATA_DIR, "status.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch { return value; }
}
function sameOrigin(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}
async function visitWithRetry(page, url) {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      lastResponse = await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      const status = lastResponse ? lastResponse.status() : null;
      if (status !== 429 && !(status >= 500 && status <= 599))
        return { status, ok: Boolean(lastResponse) && status < 400 };
      if (attempt < 2) await sleep(12000 * (attempt + 1));
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(5000 * (attempt + 1));
    }
  }
  const status = lastResponse ? lastResponse.status() : null;
  return { status, ok: Boolean(lastResponse) && status < 400,
    ...(!lastResponse && lastError ? { error: lastError.message } : {}) };
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
      userAgent: "Mozilla/5.0 (compatible; AhliCuan99-Monitor/1.1; +website availability check)"
    });
    page.setDefaultNavigationTimeout(TIMEOUT_MS);
    const home = await visitWithRetry(page, START_URL);
    pages.push({ url: START_URL, ...home });
    if (!home.ok) failures++;
    const origin = new URL(START_URL).origin;
    const links = await page.locator("a[href]").evaluateAll(as =>
      as.map(a => a.href).filter(h => h && !h.startsWith("javascript:")));
    const seen = new Set([normalizeUrl(START_URL)]);
    const targets = [];
    for (const link of links) {
      const normalized = normalizeUrl(link);
      if (!sameOrigin(normalized, origin) || seen.has(normalized)) continue;
      seen.add(normalized);
      targets.push(normalized);
      if (targets.length >= MAX_PAGES) break;
    }
    for (const url of targets) {
      await sleep(4000);
      try {
        const result = await visitWithRetry(page, url);
        pages.push({ url, ...result });
        if (!result.ok) failures++;
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
    const result = { checkedAt: startedAt, target: START_URL, total: pages.length,
      successful: pages.filter(p => p.ok).length, failures,
      status: failures === 0 ? "UP" : "ISSUES", pages };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(result, null, 2));
    let history = [];
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); } catch {}
    history.unshift({ checkedAt: result.checkedAt, status: result.status,
      total: result.total, successful: result.successful, failures: result.failures });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 168), null, 2));
    console.log("MONITOR_RESULT " + JSON.stringify(result));
    if (failures) console.warn(`Website monitoring found ${failures} issue(s); results saved and workflow continues.`);
  }
})();
