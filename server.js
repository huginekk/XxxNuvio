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
  return decoded.replace(/\.json$/, '').trim();
}

// Přímé MP4 streamy z Eporneru (všechny dostupné kvality 1080p, 720p, 480p)
async function getEpornerStreams(videoId) {
  const streams = [];
  try {
    const res = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 7000 });
    if (res.data && res.data.files) {
      const files = res.data.files;
      const qualities = Object.keys(files).sort().reverse();
      qualities.forEach(q => {
        if (files[q] && files[q].url) {
          streams.push({
            title: `🔞 Direct MP4 [${q.toUpperCase()}]`,
            url: files[q].url
          });
        }
      });
    }
  } catch (err) {}
  return streams;
}

const manifest = {
  id: "org.pure.adult.nuvio.v6",
  version: "6.0.0",
  name: "🔞 Pure XXX Catalog",
  description: "Pouze 100% adult videa s okamžitým přímým přehráváním",
  logo: DEFAULT_POSTER,
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["ep:"],
  catalogs: [
    {
      type: "movie",
      id: "ep_popular",
      name: "🔥 XXX Most Popular",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "ep_top",
      name: "⭐ XXX Top Rated HD",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "ep_latest",
      name: "🎬 XXX Latest Uploads",
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

// 1. CATALOG ENDPOINT (Čistý XXX obsah z Eporner API)
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { id: catalogId, extra: extraStr } = req.params;
  const extra = parseExtra(extraStr);
  const { search, skip } = extra;
  const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;
  const metas = [];

  try {
    let orderParam = 'most-popular';
    if (catalogId === 'ep_top') orderParam = 'top-rated';
    if (catalogId === 'ep_latest') orderParam = 'latest';

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
          description: `Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '0'}/5`
        }
      });
    }
  } catch (e) {}

  res.json({
    meta: { id: cleanId, type: "movie", name: "XXX Video", poster: DEFAULT_POSTER, background: DEFAULT_POSTER, description: "Přehrávání..." }
  });
});

// 3. STREAM ENDPOINT
app.get('/stream/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = extractCleanId(rawIdParam);
  const videoId = cleanId.replace('ep:', '');

  const streams = await getEpornerStreams(videoId);
  res.json({ streams });
});

app.listen(PORT, () => console.log(`Pure Adult Engine v6.0.0 spuštěn na portu ${PORT}`));
