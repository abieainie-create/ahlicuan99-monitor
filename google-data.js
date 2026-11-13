const fs = require("fs");
const path = require("path");
const { BetaAnalyticsDataClient } = require("@google-analytics/data");
const { google } = require("googleapis");
const OUT = path.join(__dirname, "docs", "google-data.json");
const PROPERTY_URL = process.env.SEARCH_CONSOLE_SITE_URL || "https://ahlicuan99.blogspot.com/";
const GA4_PROPERTY_ID = (process.env.GA4_PROPERTY_ID || "").trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
async function getGa4ReportWithRetry(client, request) {
  let lastError;
  const maxAttempts = 5;
  const delays = [10000, 20000, 40000, 60000];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const [response] = await client.runReport(request, { timeout: 120000 });
      return response;
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      console.error(`GA4 attempt ${attempt + 1}/${maxAttempts} failed:`, message);
      if (attempt < maxAttempts - 1) {
        const delay = delays[attempt] || 60000;
        console.log(`Retrying GA4 in ${delay / 1000} seconds...`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
async function main() {
  const report = { checkedAt: new Date().toISOString(), siteUrl: PROPERTY_URL,
    analytics: { configured: Boolean(GA4_PROPERTY_ID), ok: false },
    searchConsole: { configured: true, ok: false } };
  if (GA4_PROPERTY_ID) {
    try {
      const client = new BetaAnalyticsDataClient();
      const response = await getGa4ReportWithRetry(client, {
        property: `properties/${GA4_PROPERTY_ID}`,
        dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }]
      });
      const values = response.rows?.[0]?.metricValues || [];
      report.analytics = { configured: true, ok: true,
        period: "28 hari terakhir hingga kemarin",
        activeUsers: Number(values[0]?.value || 0),
        sessions: Number(values[1]?.value || 0),
        pageViews: Number(values[2]?.value || 0) };
    } catch (error) {
      report.analytics = { configured: true, ok: false, error: error.message };
      console.error("GA4 API error after retries:", error.message);
    }
  } else report.analytics.message = "Tambahkan GitHub repository variable GA4_PROPERTY_ID.";
  try {
    const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] });
    const searchconsole = google.searchconsole({ version: "v1", auth });
    const response = await searchconsole.searchanalytics.query({ siteUrl: PROPERTY_URL,
      requestBody: { startDate: dateDaysAgo(28), endDate: dateDaysAgo(3), dimensions: [], rowLimit: 1 } });
    const row = response.data.rows?.[0] || {};
    report.searchConsole = { configured: true, ok: true,
      period: "28 hari terakhir, data sampai 3 hari lalu",
      clicks: Number(row.clicks || 0), impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0), averagePosition: Number(row.position || 0) };
  } catch (error) {
    report.searchConsole = { configured: true, ok: false, error: error.message };
    console.error("Search Console API error:", error.message);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("GOOGLE_DATA_RESULT " + JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
