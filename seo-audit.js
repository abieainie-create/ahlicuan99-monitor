const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const START_URL = process.env.TARGET_URL || "https://ahlicuan99.blogspot.com/";
const MAX_PAGES = Number(process.env.SEO_MAX_PAGES || 20);
const OUT = path.join(__dirname, "docs", "seo.json");

(async () => {
  let browser;
  const checkedAt = new Date().toISOString();
  const pages = [];
  const technical = {};

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);

    const homeResponse = await page.goto(START_URL, { waitUntil: "domcontentloaded" });
    const origin = new URL(START_URL).origin;
    const urls = await page.locator("a[href]").evaluateAll(as =>
      [...new Set(as.map(a => a.href).filter(h => {
        try { return new URL(h).origin === location.origin && !h.includes("#"); } catch { return false; }
      }))]
    );
    const targets = [START_URL, ...urls.filter(u => u !== START_URL)].slice(0, MAX_PAGES);

    for (const url of targets) {
      try {
        const response = url === START_URL ? homeResponse : await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        const data = await page.evaluate(() => {
          const meta = document.querySelector('meta[name="description"]');
          const robots = document.querySelector('meta[name="robots"]');
          const canonical = document.querySelector('link[rel="canonical"]');
          const images = [...document.images];
          return {
            title: document.title.trim(),
            description: meta?.content?.trim() || "",
            canonical: canonical?.href || "",
            h1Count: document.querySelectorAll("h1").length,
            images: images.length,
            imagesMissingAlt: images.filter(img => !img.hasAttribute("alt") || !img.getAttribute("alt").trim()).length,
            robots: robots?.content || ""
          };
        });
        const issues = [];
        if (!response || response.status() >= 400) issues.push("Halaman tidak merespons normal");
        if (!data.title) issues.push("Judul halaman kosong");
        if (!data.description) issues.push("Meta description belum ada");
        if (!data.canonical) issues.push("Canonical URL belum ditemukan");
        if (data.h1Count === 0) issues.push("Tidak ditemukan heading H1");
        if (data.imagesMissingAlt > 0) issues.push(data.imagesMissingAlt + " gambar belum memiliki teks ALT");
        if (/noindex/i.test(data.robots)) issues.push("Halaman memakai noindex");
        pages.push({ url, httpStatus: response?.status() ?? null, ...data, issues, ok: issues.length === 0 });
      } catch (error) {
        pages.push({ url, httpStatus: null, issues: ["Gagal memeriksa: " + error.message], ok: false });
      }
    }

    for (const [name, endpoint] of Object.entries({
      robotsTxt: new URL("/robots.txt", origin).href,
      sitemapXml: new URL("/sitemap.xml", origin).href
    })) {
      try {
        const r = await page.request.get(endpoint, { timeout: 20000 });
        technical[name] = { url: endpoint, status: r.status(), ok: r.ok() };
      } catch (e) {
        technical[name] = { url: endpoint, status: null, ok: false, error: e.message };
      }
    }
  } catch (error) {
    technical.error = error.message;
  } finally {
    if (browser) await browser.close();
  }

  const issuesCount = pages.reduce((n, p) => n + p.issues.length, 0);
  const report = {
    checkedAt,
    target: START_URL,
    totalPages: pages.length,
    pagesWithIssues: pages.filter(p => p.issues.length).length,
    totalIssues: issuesCount,
    technical,
    pages
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("SEO_AUDIT_RESULT " + JSON.stringify({ totalPages: report.totalPages, pagesWithIssues: report.pagesWithIssues, totalIssues: report.totalIssues, technical }));
})();
