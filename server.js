const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 7000;
const BASE_URL = 'https://fullporn.to';

app.use(cors());

// HTTP klient s kompletními hlavičkami prohlížeče
const httpClient = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'cs,en-US;q=0.7,en;q=0.3',
    'Referer': BASE_URL
  },
  timeout: 15000,
  maxRedirects: 5
});

// Pomocné funkce pro kódování a dekódování přesné URL cesty v ID
function encodePathToId(path) {
  const cleanPath = path.startsWith('http') ? path.replace(BASE_URL, '') : path;
  return 'fp:' + Buffer.from(cleanPath).toString('base64url');
}

function decodeIdToPath(id) {
  try {
    const raw = id.replace(/^fp:/, '').replace(/\.json$/, '');
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    return decoded.startsWith('/') ? decoded : '/' + decoded;
  } catch (e) {
    return '/' + id.replace(/^fp:/, '').replace(/\.json$/, '');
  }
}

// Manifest pro Nuvio / Stremio
const manifest = {
  id: "org.fullporn.nuvio.custom",
  version: "1.0.2",
  name: "FullPorn Catalog",
  description: "Katalog s vyhledáváním a přímým parsováním streamů",
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

    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);
    const metas = [];

    $('a').each((_, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      
      // Hledáme pouze odkazy směřující na detail videa
      if (!href || href === '#' || href.includes('/category/') || href.includes('/tag/') || href.includes('/search/')) return;
      if (!href.includes('/video/') && !href.includes('/watch/') && !href.match(/\/[a-zA-Z0-9-]+\/$/)) return;

      const img = link.find('img').first();
      const title = link.attr('title') || img.attr('alt') || link.text().trim();
      let poster = img.attr('data-src') || img.attr('src') || img.attr('data-lazy-src') || img.attr('data-original') || '';

      if (title && title.length > 3 && poster) {
        if (!poster.startsWith('http')) {
          poster = poster.startsWith('//') ? `https:${poster}` : `${BASE_URL}${poster}`;
        }

        const id = encodePathToId(href);
        if (!metas.some(m => m.id === id)) {
          metas.push({
            id,
            type: "other",
            name: title.length > 70 ? title.substring(0, 70) + '...' : title,
            poster: poster,
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

// 2. META ENDPOINT (Detail videa s fotkou a popisem)
app.get('/meta/:type/:id.json', async (req, res) => {
  const rawId = req.params.id;
  const path = decodeIdToPath(rawId);
  const targetUrl = `${BASE_URL}${path}`;

  try {
    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);

    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || 'Detail videa';
    
    // Extrakce plakátu z Meta tagů nebo Video tagu
    let poster = $('meta[property="og:image"]').attr('content') || 
                 $('meta[name="twitter:image"]').attr('content') || 
                 $('video').attr('poster') || 
                 $('.player img').attr('src') || '';

    if (poster && !poster.startsWith('http')) {
      poster = poster.startsWith('//') ? `https:${poster}` : `${BASE_URL}${poster}`;
    }

    const description = $('meta[property="og:description"]').attr('content') || 
                        $('meta[name="description"]').attr('content') || 
                        $('.entry-content, .description').text().trim() || '';

    const genres = [];
    $('.tags a, .categories a, a[rel="tag"]').each((_, el) => {
      genres.push($(el).text().trim());
    });

    const meta = {
      id: rawId,
      type: req.params.type || "other",
      name: title,
      poster: poster || manifest.background,
      background: poster || manifest.background,
      description: description || "Přímý stream z FullPorn.to",
      genres: genres.length ? genres : ["Adult"]
    };

    res.json({ meta });
  } catch (err) {
    console.error('[Meta Error]:', err.message);
    res.json({
      meta: {
        id: rawId,
        type: "other",
        name: "Video Stream",
        poster: manifest.background,
        background: manifest.background,
        description: "Meta informace nebylo možné načíst."
      }
    });
  }
});

// 3. STREAM ENDPOINT (Extrakce přímých odkazů a iFrame zdrojů)
app.get('/stream/:type/:id.json', async (req, res) => {
  const rawId = req.params.id;
  const path = decodeIdToPath(rawId);
  const targetUrl = `${BASE_URL}${path}`;

  try {
    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);
    const streams = [];

    // Metoda 1: Přímé tagy <source> nebo <video>
    $('video source, video').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      const label = $(el).attr('res') || $(el).attr('label') || 'HD Stream';
      if (src && !src.startsWith('blob:')) {
        streams.push({
          title: `Direct MP4 (${label})`,
          url: src.startsWith('http') ? src : (src.startsWith('//') ? `https:${src}` : `${BASE_URL}${src}`)
        });
      }
    });

    // Metoda 2: Hledání zdrojů v JavaScriptu (MP4, M3U8, HLS)
    if (streams.length === 0) {
      const scriptContent = $('script').text();
      const matches = scriptContent.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*/g);
      
      if (matches) {
        const uniqueUrls = [...new Set(matches)];
        uniqueUrls.forEach((url, index) => {
          const isHls = url.includes('.m3u8');
          streams.push({
            title: isHls ? `HLS Playlist (Auto Quality)` : `Server Stream ${index + 1}`,
            url: url
          });
        });
      }
    }

    // Metoda 3: iFrame přehrávače a externí servery
    if (streams.length === 0) {
      $('iframe').each((_, el) => {
        let src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.includes('facebook') && !src.includes('twitter') && !src.includes('google')) {
          if (!src.startsWith('http')) {
            src = src.startsWith('//') ? `https:${src}` : `${BASE_URL}${src}`;
          }
          streams.push({
            title: "Embed Player (Přehrávač)",
            url: src
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
  console.log(`Addon server běží na portu ${PORT}`);
});
