const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 7000;
const BASE_URL = 'https://fullporn.to';

app.use(cors());

// HTTP klient s realistickými hlavičkami
const httpClient = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': BASE_URL
  },
  timeout: 12000
});

// Vylepšený Manifest
const manifest = {
  id: "org.fullporn.nuvio.custom",
  version: "1.0.1",
  name: "FullPorn Catalog",
  description: "Katalog s vyhledáváním a filtrováním",
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
        {
          name: "genre",
          isRequired: false,
          options: ["4k", "1080p", "720p", "amateur", "anal", "pov", "milf", "asian", "latina", "blonde"]
        },
        { name: "skip", isRequired: false }
      ]
    }
  ],
  behaviorHints: { adult: true }
};

app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Helper pro parsování parametrů
function parseExtraArgs(extraParam) {
  if (!extraParam) return {};
  const cleaned = extraParam.replace(/\.json$/, '');
  const result = {};
  const pairs = cleaned.split('&');
  for (const pair of pairs) {
    const [key, val] = pair.split('=');
    if (key && val) {
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}

// Helper pro vytvoření čitelného názvu ze slug ID
function formatTitle(slug) {
  return slug
    .replace(/^fp:/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// 1. CATALOG ENDPOINT
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const extraParam = req.params.extra || '';
  const extraArgs = parseExtraArgs(extraParam);
  const { search, genre, skip } = extraArgs;

  try {
    let targetUrl = `${BASE_URL}/`;
    const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;

    if (search) {
      targetUrl = `${BASE_URL}/search/${encodeURIComponent(search)}/${page > 1 ? 'page/' + page + '/' : ''}`;
    } else if (genre) {
      targetUrl = `${BASE_URL}/category/${encodeURIComponent(genre.toLowerCase())}/${page > 1 ? 'page/' + page + '/' : ''}`;
    } else if (page > 1) {
      targetUrl = `${BASE_URL}/page/${page}/`;
    }

    console.log(`[Catalog Request] URL: ${targetUrl}`);
    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);
    const metas = [];

    // Široké selektory pro zachycení všech typů kartiček videí
    $('a[href*="/video/"], a[href*="/watch/"], .post a, .video-item a, article a, .item a').each((_, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      
      // Vyfiltrujeme pouze unikátní odkazy na videa
      if (!href || href === '#' || href.includes('/category/') || href.includes('/tag/')) return;

      const img = link.find('img').first();
      const title = link.attr('title') || link.text().trim() || img.attr('alt') || 'Video Stream';
      const poster = img.attr('data-src') || img.attr('src') || img.attr('data-lazy-src') || '';

      const slugMatch = href.match(/\/([^\/]+)\/?$/);
      if (slugMatch && slugMatch[1]) {
        const videoSlug = slugMatch[1];
        const id = `fp:${videoSlug}`;

        // Zamezení duplicit v poli
        if (!metas.some(m => m.id === id) && title.length > 2) {
          metas.push({
            id,
            type: "other",
            name: title.length > 60 ? title.substring(0, 60) + '...' : title,
            poster: poster.startsWith('http') ? poster : (poster ? `${BASE_URL}${poster}` : manifest.background),
            description: `Kategorie: ${genre || 'Vše'}`
          });
        }
      }
    });

    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT (Detail videa s bezpečnostním fallbackem)
app.get(['/meta/:type/:id.json'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const slug = rawId.replace('fp:', '');
  const fallbackTitle = formatTitle(slug);

  // Bezpečnostní základní objekt, který se vrátí vždy, i když web zablokuje dotaz
  let metaResponse = {
    id: rawId,
    type: req.params.type || "other",
    name: fallbackTitle,
    poster: manifest.background,
    background: manifest.background,
    description: "Detail videa načten ze zdroje FullPorn.",
    genres: ["Adult"]
  };

  try {
    const targetUrl = `${BASE_URL}/${slug}/`;
    console.log(`[Meta Request] URL: ${targetUrl}`);
    
    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);

    const title = $('h1').first().text().trim() || $('.entry-title').text().trim();
    const poster = $('meta[property="og:image"]').attr('content') || $('video').attr('poster') || '';
    const description = $('meta[name="description"]').attr('content') || $('.description').text().trim() || '';

    if (title) metaResponse.name = title;
    if (poster) {
      metaResponse.poster = poster;
      metaResponse.background = poster;
    }
    if (description) metaResponse.description = description;

  } catch (err) {
    console.warn(`[Meta Warning] Nepodařilo se stáhnut detail z webu (${err.message}), použije se fallback meta.`);
  }

  // Nuvio VŽDY dostane platný meta objekt
  res.json({ meta: metaResponse });
});

// 3. STREAM ENDPOINT (Extrakce přímých odkazů)
app.get(['/stream/:type/:id.json'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const slug = rawId.replace('fp:', '');

  try {
    const targetUrl = `${BASE_URL}/${slug}/`;
    console.log(`[Stream Request] URL: ${targetUrl}`);
    
    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);
    const streams = [];

    // Detekce <source> a <video> tagů
    $('video source, video').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      const label = $(el).attr('res') || $(el).attr('label') || 'HD';
      if (src && !src.startsWith('blob:')) {
        streams.push({
          title: `Direct Stream (${label})`,
          url: src.startsWith('http') ? src : `${BASE_URL}${src}`
        });
      }
    });

    // Detekce JavaScriptových MP4/M3U8 odkazů uvnitř inline skriptů
    if (streams.length === 0) {
      const scripts = $('script').text();
      const matches = scripts.match(/https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*/g);
      if (matches) {
        const unique = [...new Set(matches)];
        unique.forEach((url, i) => {
          streams.push({
            title: url.includes('.m3u8') ? `HLS Auto Stream` : `Server Stream ${i + 1}`,
            url: url
          });
        });
      }
    }

    // Detekce iframe vkládaných přehrávačů
    if (streams.length === 0) {
      $('iframe').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.includes('facebook') && !src.includes('twitter')) {
          streams.push({
            title: "Embed Player",
            url: src.startsWith('http') ? src : `https:${src}`
          });
        }
      });
    }

    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Addon server spuštěn na portu ${PORT}`);
});
