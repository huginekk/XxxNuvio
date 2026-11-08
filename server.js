const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';
const DEFAULT_POSTER = 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Adult_content_icon.svg';

app.use(cors());

function extractCleanId(rawParamId) {
  if (!rawParamId) return '';
  let decoded = decodeURIComponent(rawParamId);
  return decoded.replace(/\.json$/, '').trim();
}

// 1. STREAMY EPORNER (Přímé MP4 odkaze v nejvyšší kvalitě)
async function getEpornerStreams(videoId) {
  const streams = [];
  try {
    const res = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 7000 });
    if (res.data && res.data.files) {
      const files = res.data.files;
      // Procházení dostupných kvalit (1080p, 720p, 480p)
      const qualities = Object.keys(files).sort().reverse();
      qualities.forEach(q => {
        if (files[q] && files[q].url) {
          streams.push({
            title: `🔞 Eporner direct [${q.toUpperCase()}]`,
            url: files[q].url
          });
        }
      });
    }
  } catch (err) {
    console.warn('[Eporner Stream Error]:', err.message);
  }
  return streams;
}

// 2. ADULT TORRENTIO / REAL-DEBRID (Vyhledávání reálných XXX torrentů)
async function getAdultTorrentStreams(query) {
  const streams = [];
  try {
    // Dotaz na vyhledávání přes Torrentio s filterem bez cenzury
    const searchUrl = `https://torrentio.strem.fun/stream/movie/tt${encodeURIComponent(query)}.json`;
    const res = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 8000
    });

    if (res.data && res.data.streams) {
      for (const s of res.data.streams) {
        let streamUrl = s.url;
        if (s.infoHash && RD_TOKEN) {
          streamUrl = `https://torrentio.strem.fun/realdebrid/${RD_TOKEN}/${s.infoHash}/${s.fileIdx || 0}`;
        }
        if (streamUrl) {
          streams.push({
            title: `⚡ Real-Debrid Torrent [${s.title.split('\n')[0]}]`,
            url: streamUrl
          });
        }
      }
    }
  } catch (err) {}
  return streams;
}

const manifest = {
  id: "org.adult.eporner.nuvio",
  version: "3.0.0",
  name: "🔞 Adult Catalog (Eporner & XXX)",
  description: "Přímé streamy v HD kvality z Eporneru a Real-Debrid",
  logo: DEFAULT_POSTER,
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["ep:"],
  catalogs: [
    {
      type: "movie",
      id: "ep_popular",
      name: "🔥 Eporner - Populární",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "ep_top",
      name: "⭐ Eporner - Nejlépe hodnocené",
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

// 1. CATALOG ENDPOINT
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
    console.error('[Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT
app.get('/meta/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = extractCleanId(rawIdParam);
  const videoId = cleanId.replace('ep:', '');

  try {
    const response = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 7000 });
    const v = response.data;
    if (v && v.title) {
      const img = v.default_thumb?.src || DEFAULT_POSTER;
      return res.json({
        meta: {
          id: cleanId,
          type: "movie",
          name: v.title,
          poster: img,
          background: img,
          description: `Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '0'}/5 | Zobrazení: ${v.views || 0}`
        }
      });
    }
  } catch (e) {}

  res.json({
    meta: {
      id: cleanId,
      type: "movie",
      name: "Adult Video",
      poster: DEFAULT_POSTER,
      background: DEFAULT_POSTER,
      description: "Přehrávání obsahu..."
    }
  });
});

// 3. STREAM ENDPOINT
app.get('/stream/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = extractCleanId(rawIdParam);
  const videoId = cleanId.replace('ep:', '');

  const streams = await getEpornerStreams(videoId);
  console.log(`[Stream Success] Odesláno ${streams.length} přímých MP4 streamů pro ${cleanId}`);
  res.json({ streams });
});

app.listen(PORT, () => console.log(`Eporner Addon v3.0.0 spuštěn na portu ${PORT}`));
