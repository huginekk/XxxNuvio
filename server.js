const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

const DEFAULT_POSTER = 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Adult_content_icon.svg';

app.use(cors());

function extractCleanId(rawParamId) {
  if (!rawParamId) return '';
  let decoded = decodeURIComponent(rawParamId);
  decoded = decoded.replace(/\.json$/, '').trim();
  // Vytáhne ID i v případě předpon ep: nebo tmdb:
  const match = decoded.match(/\d+/);
  return match ? match[0] : decoded;
}

// Získání streamů přímo z Eporner API
async function getEpornerStreams(videoId) {
  const streams = [];
  try {
    const res = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.eporner.com/'
      },
      timeout: 8000
    });

    if (res.data && res.data.files) {
      const files = res.data.files;
      // Projdeme všechny dostupné kvality
      for (const q of Object.keys(files)) {
        if (files[q] && files[q].url) {
          streams.push({
            name: "Eporner Direct",
            title: `🔞 ${q.toUpperCase()} (MP4 Direct)`,
            url: files[q].url
          });
        }
      }
    }
  } catch (err) {
    console.error(`[Eporner Fetch Error for ${videoId}]:`, err.message);
  }
  return streams;
}

const manifest = {
  id: "org.pure.adult.nuvio.v7",
  version: "7.0.0",
  name: "🔞 Pure Eporner XXX",
  description: "Přímé HD streamy bez cenzury pro Nuvio",
  logo: DEFAULT_POSTER,
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "other"],
  idPrefixes: ["ep:"],
  catalogs: [
    {
      type: "movie",
      id: "ep_popular",
      name: "🔥 Eporner Popular",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "ep_top",
      name: "⭐ Eporner Top Rated",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }
  ],
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

// 1. CATALOG
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { id: catalogId, extra: extraStr } = req.params;
  const extra = parseExtra(extraStr);
  const { search, skip } = extra;
  const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;
  const metas = [];

  try {
    let orderParam = catalogId === 'ep_top' ? 'top-rated' : 'most-popular';
    let query = search ? encodeURIComponent(search) : 'all';
    let url = `https://www.eporner.com/api/v2/video/search/?query=${query}&per_page=24&page=${page}&order=${orderParam}&thumbsize=big`;

    const response = await axios.get(url, { timeout: 8000 });

    if (response.data && response.data.videos) {
      response.data.videos.forEach(v => {
        metas.push({
          id: `ep:${v.id}`,
          type: "movie",
          name: v.title,
          poster: v.default_thumb?.src || DEFAULT_POSTER,
          description: `Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '0'}/5`
        });
      });
    }
    res.json({ metas });
  } catch (err) {
    res.json({ metas: [] });
  }
});

// 2. META
app.get('/meta/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const videoId = extractCleanId(rawIdParam);

  try {
    const response = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 7000 });
    const v = response.data;
    if (v && v.title) {
      const img = v.default_thumb?.src || DEFAULT_POSTER;
      return res.json({
        meta: {
          id: `ep:${videoId}`,
          type: "movie",
          name: v.title,
          poster: img,
          background: img,
          description: `Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '0'}/5`
        }
      });
    }
  } catch (e) {}

  res.json({
    meta: {
      id: `ep:${videoId}`,
      type: "movie",
      name: "XXX Video",
      poster: DEFAULT_POSTER,
      background: DEFAULT_POSTER,
      description: "Přehrávání..."
    }
  });
});

// 3. STREAM (Ošetřuje libovolný typ v URL z Nuvia)
app.get('/stream/*/:id*', async (req, res) => {
  const fullPath = req.params.id + (req.params[0] || '');
  const videoId = extractCleanId(fullPath);

  console.log(`[Stream Request] Vyžadován stream pro Eporner ID: ${videoId}`);
  const streams = await getEpornerStreams(videoId);

  console.log(`[Stream Output] Nalezeno streamů: ${streams.length}`);
  res.json({ streams });
});

app.listen(PORT, () => console.log(`Eporner Addon v7.0.0 spuštěn na portu ${PORT}`));
