const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 7000;
const BASE_URL = 'https://fullporn.to';

app.use(cors());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchPage(targetUrl) {
  return await axios.get(targetUrl, {
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
      'Referer': BASE_URL,
      'Cache-Control': 'no-cache'
    },
    timeout: 15000,
    validateStatus: () => true
  });
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
  version: "1.0.5",
  name: "FullPorn Catalog",
  description: "Doplněk pro Nuvio s přímým parsováním streamů",
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

// 1. CATALOG ENDPOINT (Očištěný od menu a navigace)
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

    console.log(`[Catalog Request] URL: ${targetUrl}`);
    const response = await fetchPage(targetUrl);
    
    if (response.status !== 200) {
      console.warn(`[Catalog Response] HTTP status: ${response.status}`);
      return res.json({ metas: [] });
    }

    const $ = cheerio.load(response.data || '');

    // ODSTRANĚNÍ HLAVIČEK, PATIČEK A MENU (aby se neparsovaly odkazy z navigace)
    $('header, nav, footer, .menu, .sidebar, .widget, .navigation, .mobile-menu').remove();

    const metas = [];

    // Hledáme pouze odkazy obsahující obrázky v hlavním obsahu
    $('a').each((_, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      
      // Vyfiltrování systémových odkazů a kategorií
      if (!href || href === '#' || href.includes('/category/') || href.includes('/tag/') || href.includes('/search/') || href.includes('/page/')) return;

      const img = link.find('img').first();
      if (!img.length) return; // Pokud odkaz nemá obrázek, přeskočí se

      const title = link.attr('title') || img.attr('alt') || img.attr('title') || link.text().trim();
      let poster = img.attr('data-src') || img.attr('src') || img.attr('data-lazy-src') || img.attr('data-original') || '';

      // Ignorujeme loga, ikony a menu tlačítka
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes('nejnovější') || lowerTitle.includes('nejlepší') || lowerTitle.includes('kategorie') || lowerTitle.includes('pornohvězdy') || lowerTitle.includes('fullporn')) return;
      if (!poster || poster.includes('logo') || poster.includes('favicon')) return;

      if (title.length > 5) {
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

    console.log(`[Catalog Success] Nalezeno reálných videí: ${metas.length}`);
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
    description: "Detail videa z FullPorn.to."
  };

  try {
    console.log(`[Meta Request] URL: ${targetUrl}`);
    const response = await fetchPage(targetUrl);
    if (response.status !== 200) {
      return res.json({ meta: defaultMeta });
    }

    const $ = cheerio.load(response.data);
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
    console.log(`[Stream Request] URL: ${targetUrl}`);
    const response = await fetchPage(targetUrl);
    const streams = [];

    if (response.status === 200) {
      const $ = cheerio.load(response.data);

      // Metoda 1: Přímé MP4 / M3U8 tagy
      $('video source, video').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        const resLabel = $(el).attr('res') || $(el).attr('label') || 'HD';
        if (src && !src.startsWith('blob:')) {
          streams.push({
            title: `Přímý přehrávač (${resLabel})`,
            url: src.startsWith('http') ? src : `${BASE_URL}${src}`
          });
        }
      });

      // Metoda 2: Inline JS odkazy (.mp4 nebo .m3u8)
      if (streams.length === 0) {
        const scriptText = $('script').text();
        const matches = scriptText.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*/g);
        if (matches) {
          const unique = [...new Set(matches)];
          unique.forEach((u, i) => {
            streams.push({
              title: u.includes('.m3u8') ? 'HLS Stream (Auto Quality)' : `Direct Server ${i + 1}`,
              url: u
            });
          });
        }
      }

      // Metoda 3: iFrame přehrávače
      if (streams.length === 0) {
        $('iframe').each((_, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src');
          if (src && !src.includes('facebook') && !src.includes('twitter') && !src.includes('google')) {
            streams.push({
              title: "External Embed Player",
              url: src.startsWith('http') ? src : `https:${src}`
            });
          }
        });
      }
    }

    console.log(`[Stream Success] Nalezeno streamů: ${streams.length}`);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Addon v1.0.5 běží na portu ${PORT}`);
});
