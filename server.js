const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 7000;
const BASE_URL = 'https://fullporn.to';

app.use(cors());

// Seznam veřejných proxy zprostředkovatelů pro případ blokace Render IP
const PROXY_PROVIDERS = [
  (url) => url, // Přímý požadavek
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`
];

async function fetchWithBypass(targetUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'cs-CZ,cs;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': BASE_URL
  };

  for (const getProxyUrl of PROXY_PROVIDERS) {
    try {
      const finalUrl = getProxyUrl(targetUrl);
      console.log(`[Fetch Attempt] Načítám: ${finalUrl}`);
      const res = await axios.get(finalUrl, { headers, timeout: 10000, validateStatus: () => true });

      // Pokud dostaneme 200 OK a HTML neobsahuje Cloudflare výzvu
      if (res.status === 200 && typeof res.data === 'string' && !res.data.includes('Just a moment...') && !res.data.includes('enable JavaScript')) {
        return res.data;
      }
      console.warn(`[Fetch Warning] URL vrátila kód ${res.status} nebo Cloudflare blok.`);
    } catch (e) {
      console.warn(`[Proxy Error] ${e.message}`);
    }
  }
  return null;
}

function encodeId(urlPath) {
  return 'fp:' + Buffer.from(urlPath).toString('hex');
}

function decodeId(id) {
  try {
    const hex = id.replace(/^fp:/, '').replace(/\.json$/, '');
    return Buffer.from(hex, 'hex').toString('utf8');
  } catch (e) {
    return '/';
  }
}

const manifest = {
  id: "org.fullporn.nuvio.custom",
  version: "1.0.6",
  name: "FullPorn Catalog",
  description: "Doplněk pro Nuvio s bypass rozhraním pro streamy",
  logo: "https://fullporn.to/favicon.ico",
  background: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "other"],
  idPrefixes: ["fp:"],
  catalogs: [
    {
      type: "other",
      id: "fp_main",
      name: "FullPorn - Všechna videa",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: ["4k", "1080p", "720p", "amateur", "anal", "pov", "milf"] },
        { name: "skip", isRequired: false }
      ]
    }
  ],
  behaviorHints: { adult: true }
};

app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

function parseExtra(extraStr) {
  if (!extraStr) return {};
  const cleaned = extraStr.replace(/\.json$/, '');
  const params = new URLSearchParams(cleaned);
  const res = {};
  for (const [k, v] of params.entries()) {
    res[k] = v;
  }
  return res;
}

// 1. CATALOG ENDPOINT
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const extraStr = req.params.extra || '';
  const extra = parseExtra(extraStr);
  const { search, genre, skip } = extra;

  try {
    let targetUrl = `${BASE_URL}/`;
    const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;

    if (search) {
      targetUrl = `${BASE_URL}/?s=${encodeURIComponent(search)}`;
    } else if (genre) {
      targetUrl = `${BASE_URL}/category/${encodeURIComponent(genre.toLowerCase())}/`;
    } else if (page > 1) {
      targetUrl = `${BASE_URL}/page/${page}/`;
    }

    const html = await fetchWithBypass(targetUrl);
    if (!html) {
      console.error('[Catalog Error] Nepodařilo se stáhnout HTML stránku přes žádný prvek.');
      return res.json({ metas: [] });
    }

    const $ = cheerio.load(html);

    // Odstranění nechtěných částí stránky
    $('header, nav, footer, .menu, .sidebar, .widget, .navigation').remove();

    const metas = [];

    // Selektory zaměřené na konkrétní karty videí
    $('.post, article, .video-item, .item, .thumb, .videoBlock, .grid-item').each((_, el) => {
      const container = $(el);
      const link = container.find('a[href*="/video/"], a[href*="/watch/"], a[href*="fullporn.to"]').first().length ?
                   container.find('a[href*="/video/"], a[href*="/watch/"], a[href*="fullporn.to"]').first() :
                   container.find('a').first();

      const href = link.attr('href') || '';
      if (!href || href === '#' || href.includes('/category/') || href.includes('/tag/')) return;

      const img = container.find('img').first();
      let poster = img.attr('data-src') || img.attr('src') || img.attr('data-lazy-src') || img.attr('data-original') || '';
      let title = link.attr('title') || img.attr('alt') || container.find('.title, .entry-title, h2, h3').text().trim();

      if (title && title.length > 4 && poster) {
        if (!poster.startsWith('http')) {
          poster = poster.startsWith('//') ? `https:${poster}` : `${BASE_URL}${poster}`;
        }

        const id = encodeId(href);
        if (!metas.some(m => m.id === id)) {
          metas.push({
            id,
            type: "other",
            name: title.length > 60 ? title.substring(0, 60) + '...' : title,
            poster: poster,
            description: `Zdroj: FullPorn.to`
          });
        }
      }
    });

    console.log(`[Catalog Success] Úspěšně naparsováno ${metas.length} videí.`);
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT
app.get(['/meta/:type/:id.json', '/meta/:type/:id'], async (req, res) => {
  const rawId = req.params.id;
  const targetPath = decodeId(rawId);
  const targetUrl = targetPath.startsWith('http') ? targetPath : `${BASE_URL}${targetPath}`;

  const defaultMeta = {
    id: rawId,
    type: "other",
    name: "Video Detail",
    poster: manifest.background,
    background: manifest.background,
    description: "Detail videa z FullPorn.to"
  };

  try {
    const html = await fetchWithBypass(targetUrl);
    if (!html) return res.json({ meta: defaultMeta });

    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || 'FullPorn Video';
    let poster = $('meta[property="og:image"]').attr('content') || $('video').attr('poster') || '';

    if (poster && !poster.startsWith('http')) {
      poster = poster.startsWith('//') ? `https:${poster}` : `${BASE_URL}${poster}`;
    }

    const description = $('meta[property="og:description"]').attr('content') || $('.entry-content').text().trim() || '';

    res.json({
      meta: {
        id: rawId,
        type: "other",
        name: title,
        poster: poster || manifest.background,
        background: poster || manifest.background,
        description: description || "Přímé přehrávání videa."
      }
    });
  } catch (err) {
    console.error('[Meta Error]:', err.message);
    res.json({ meta: defaultMeta });
  }
});

// 3. STREAM ENDPOINT
app.get(['/stream/:type/:id.json', '/stream/:type/:id'], async (req, res) => {
  const rawId = req.params.id;
  const targetPath = decodeId(rawId);
  const targetUrl = targetPath.startsWith('http') ? targetPath : `${BASE_URL}${targetPath}`;

  try {
    const html = await fetchWithBypass(targetUrl);
    const streams = [];

    if (html) {
      const $ = cheerio.load(html);

      // Přímé MP4 / M3U8 tagy
      $('video source, video').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.startsWith('blob:')) {
          streams.push({
            title: `Přímý MP4 Stream`,
            url: src.startsWith('http') ? src : `${BASE_URL}${src}`
          });
        }
      });

      // Extrakce z JavaScriptu
      const matches = html.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*/g);
      if (matches) {
        const unique = [...new Set(matches)];
        unique.forEach((u, i) => {
          streams.push({
            title: u.includes('.m3u8') ? 'HLS Auto Quality' : `Server Stream ${i + 1}`,
            url: u
          });
        });
      }

      // Embed iFrame přehrávače
      $('iframe').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.includes('facebook') && !src.includes('twitter') && !src.includes('google')) {
          streams.push({
            title: "Externí přehrávač (Embed)",
            url: src.startsWith('http') ? src : `https:${src}`
          });
        }
      });
    }

    console.log(`[Stream Success] Nalezeno streamů: ${streams.length}`);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Addon v1.0.6 běží na portu ${PORT}`);
});
