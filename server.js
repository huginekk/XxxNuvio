const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 7000;
const BASE_URL = 'https://fullporn.to';
const DEFAULT_POSTER = 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Adult_content_icon.svg';

app.use(cors());

// Seznam hlavních kategorií z FullPorn.to
const CATEGORIES = [
  { id: "latest", name: "🔥 FullPorn - Nejnovější", path: "/" },
  { id: "popular", name: "⭐ FullPorn - Populární", path: "/popular/" },
  { id: "top-rated", name: "🏆 FullPorn - Nejlépe hodnocené", path: "/top-rated/" },
  { id: "anal", name: "🍑 Kategorie: Anal", path: "/category/anal/" },
  { id: "milf", name: "👩 Kategorie: MILF", path: "/category/milf/" },
  { id: "asian", name: "🌸 Kategorie: Asian", path: "/category/asian/" },
  { id: "amateur", name: "📹 Kategorie: Amateur", path: "/category/amateur/" },
  { id: "latina", name: "💃 Kategorie: Latina", path: "/category/latina/" },
  { id: "ebony", name: "🖤 Kategorie: Ebony", path: "/category/ebony/" },
  { id: "japanese", name: "⛩️ Kategorie: Japanese / JAV", path: "/category/japanese/" },
  { id: "lesbian", name: "👭 Kategorie: Lesbian", path: "/category/lesbian/" },
  { id: "vr", name: "🥽 Kategorie: VR Porn", path: "/category/vr-porn/" }
];

// Pomocná funkce pro headless scraping v Chromu
async function scrapePage(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const content = await page.content();
    await browser.close();
    return content;
  } catch (err) {
    if (browser) await browser.close();
    console.error(`[Scrape Error] ${url}:`, err.message);
    return null;
  }
}

// Extrakce přímého streamu (.mp4 / .m3u8) z detailu videa
async function extractDirectStream(videoUrl) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    let mediaUrl = null;

    // Odchytávání přímo z síťových požadavků prohlížeče
    page.on('response', response => {
      const u = response.url();
      if ((u.includes('.mp4') || u.includes('.m3u8')) && !u.includes('preview')) {
        mediaUrl = u;
      }
    });

    await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    
    // Pokud neodchytil síť, vytáhneme odkaz přímo z HTML video tagu
    if (!mediaUrl) {
      mediaUrl = await page.evaluate(() => {
        const video = document.querySelector('video source') || document.querySelector('video');
        return video ? video.src : null;
      });
    }

    await browser.close();
    return mediaUrl;
  } catch (err) {
    if (browser) await browser.close();
    console.error(`[Stream Extraction Error] ${videoUrl}:`, err.message);
    return null;
  }
}

const manifest = {
  id: "org.fullporn.oci.v8",
  version: "8.0.0",
  name: "🔞 FullPorn.to Engine",
  description: "Přímé HD streamy ze serveru FullPorn.to se všemi kategoriemi",
  logo: DEFAULT_POSTER,
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["fp:"],
  catalogs: CATEGORIES.map(c => ({
    type: "movie",
    id: c.id,
    name: c.name,
    extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
  })),
  behaviorHints: { adult: true }
};

app.get('/manifest.json', (req, res) => res.json(manifest));

function parseExtra(extraStr) {
  if (!extraStr) return {};
  const cleaned = extraStr.replace(/\.json$/, '');
  const params = new URLSearchParams(cleaned);
  const res = {};
  for (const [k, v] of params.entries()) res[k] = v;
  return res;
}

// 1. CATALOG ENDPOINT
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { id: catalogId, extra: extraStr } = req.params;
  const extra = parseExtra(extraStr);
  const { search, skip } = extra;
  const pageNum = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;
  const metas = [];

  try {
    const catObj = CATEGORIES.find(c => c.id === catalogId) || CATEGORIES[0];
    let fetchUrl = `${BASE_URL}${catObj.path}`;
    
    if (search) {
      fetchUrl = `${BASE_URL}/search/${encodeURIComponent(search)}/`;
    } else if (pageNum > 1) {
      fetchUrl = `${fetchUrl}page/${pageNum}/`;
    }

    const html = await scrapePage(fetchUrl);
    if (html) {
      // Regex zápis pro vytahování videí a náhledů z HTML
      const itemRegex = /<a href="(\/video\/[^"]+)" class="[^"]*title[^"]*">([^<]+)<\/a>[\s\S]*?<img [^>]*src="([^"]+)"/g;
      let match;
      while ((match = itemRegex.exec(html)) !== null) {
        const videoPath = match[1];
        const title = match[2].trim();
        const thumb = match[3];
        const videoSlug = Buffer.from(videoPath).toString('base64url');

        metas.push({
          id: `fp:${videoSlug}`,
          type: "movie",
          name: title,
          poster: thumb.startsWith('http') ? thumb : `${BASE_URL}${thumb}`,
          description: `Zdroj: FullPorn.to | ${catObj.name}`
        });
      }
    }
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Handler Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT
app.get('/meta/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = rawIdParam.replace(/\.json$/, '').replace('fp:', '');
  
  try {
    const videoPath = Buffer.from(cleanId, 'base64url').toString('utf8');
    const videoUrl = `${BASE_URL}${videoPath}`;

    res.json({
      meta: {
        id: `fp:${cleanId}`,
        type: "movie",
        name: "FullPorn HD Video",
        poster: DEFAULT_POSTER,
        background: DEFAULT_POSTER,
        description: `Přehrávání obsahu z ${videoUrl}`
      }
    });
  } catch (e) {
    res.json({ meta: { id: rawIdParam, type: "movie", name: "FullPorn Video", poster: DEFAULT_POSTER } });
  }
});

// 3. STREAM ENDPOINT
app.get('/stream/*/:id*', async (req, res) => {
  const fullPath = req.params.id + (req.params[0] || '');
  const cleanId = fullPath.replace(/\.json$/, '').replace('fp:', '');

  try {
    const videoPath = Buffer.from(cleanId, 'base64url').toString('utf8');
    const targetUrl = `${BASE_URL}${videoPath}`;
    
    console.log(`[Stream Resolution] Extrahuji stream z: ${targetUrl}`);
    const directMediaUrl = await extractDirectStream(targetUrl);

    if (directMediaUrl) {
      return res.json({
        streams: [
          {
            name: "FullPorn Direct",
            title: "🔞 Direct HD Stream (Oracle VPS)",
            url: directMediaUrl
          }
        ]
      });
    }
  } catch (err) {
    console.error('[Stream Handler Error]:', err.message);
  }

  res.json({ streams: [] });
});

app.listen(PORT, () => console.log(`FullPorn.to Engine v8.0.0 spuštěn na portu ${PORT}`));
