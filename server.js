// server.js - Black Hole Puppeteer Bing image scraper
const express = require('express');
const puppeteer = require('puppeteer');
const pLimit = require('p-limit');
const rateLimit = require('express-rate-limit');
const path = require('path');

const PORT = process.env.PORT || 10000;
const SAFE_MAP = { strict: 'strict', moderate: 'moderate', off: 'off' };
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
const limit = pLimit(CONCURRENCY);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests' })
});
app.use(limiter);

let browser = null;
let browserLaunching = null;

async function getBrowser() {
  if (browser) return browser;
  if (browserLaunching) return browserLaunching;
  browserLaunching = puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--disable-gpu'
    ],
    defaultViewport: { width: 1280, height: 800 },
    headless: process.env.HEADLESS !== 'false',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });
  browser = await browserLaunching;
  browserLaunching = null;
  return browser;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function extractFromPage(page) {
  const results = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a.iusc').forEach((a) => {
      const m = a.getAttribute('m');
      if (!m) return;
      try {
        const meta = JSON.parse(m);
        out.push({
          src: meta.murl || null,
          thumb: meta.turl || meta.murl || null,
          page: meta.purl || null,
          title: meta.pt || meta.s || null
        });
      } catch (e) {}
    });
    if (out.length === 0) {
      document.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || null;
        if (src && !src.startsWith('data:')) {
          out.push({ src, thumb: src, page: null, title: img.getAttribute('alt') || null });
        }
      });
    }
    return out;
  });
  const seen = new Set();
  const dedup = [];
  for (const r of results) {
    if (!r || !r.src) continue;
    if (seen.has(r.src)) continue;
    seen.add(r.src);
    dedup.push(r);
    if (dedup.length >= 80) break;
  }
  return dedup;
}

async function doSearch(q, safe) {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.setViewport({ width: 1280, height: 800 });

  const encoded = encodeURIComponent(q);
  const adlt = SAFE_MAP[safe] || 'moderate';
  const url = `https://www.bing.com/images/search?q=${encoded}&adlt=${adlt}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(700);
  await page.evaluate(() => { window.scrollBy(0, window.innerHeight * 2); });
  await sleep(500);

  const extracted = await extractFromPage(page);
  await page.close();
  return extracted;
}

app.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const safe = SAFE_MAP[req.query.safe] ? req.query.safe : 'moderate';
    if (!q) return res.status(400).json({ error: 'Missing query parameter `q`' });
    console.log(`[SEARCH] q="${q}" safe="${safe}"`);
    const results = await limit(() => doSearch(q, safe));
    return res.json({ query: q, safe, count: results.length, results });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Failed to fetch results' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0); });
process.on('SIGTERM', async () => { if (browser) await browser.close(); process.exit(0); });

app.listen(PORT, () => console.log(`Black Hole server running on port ${PORT}`));
