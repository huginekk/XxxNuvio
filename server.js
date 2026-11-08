const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// Loga a záložní obrázky pro jednotlivé zdroje
const IMG_EPORNER = 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Adult_content_icon.svg';
const IMG_HQPORNER = 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=500';
const IMG_REDTUBE = 'https://upload.wikimedia.org/wikipedia/commons/4/4c/RedTube_logo.svg';

app.use(cors());

function extractCleanId(rawParamId) {
  if (!rawParamId) return '';
  let decoded = decodeURIComponent(rawParamId);
  return decoded.replace(/\.json$/, '').trim();
}

// === 1. EPORNER ===
async function getEpornerStreams(videoId) {
  const streams = [];
  try {
    const res = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 7000 });
    if (res.data && res.data.files) {
      const files = res.data.files;
      Object.keys(files).sort().reverse().forEach(q => {
        if (files[q] && files[q].url) {
          streams.push({
            title: `🔞 Eporner [${q.toUpperCase()}]`,
            url: files[q].url
          });
        }
      });
    }
  } catch (err) {}
  return streams;
}

// === 2. HQPORNER ===
async function getHqpornerStreams(videoId) {
  const streams = [];
  try {
    // HQPorner API fallback / direct MP4 resolver
    const res = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 7000 });
    if (res.data && res.data.files) {
      const files = res.data.files;
      Object.keys(files).sort().reverse().forEach(q => {
        if (files[q] && files[q].url) {
          streams.push({
            title: `🎬 HQPorner HD [${q.toUpperCase()}]`,
            url: files[q].url
          });
        }
      });
    }
  } catch (err) {}
  return streams;
}

// === 3. REDTUBE ===
async function getRedtubeStreams(videoId) {
  const streams = [];
  try {
    const res = await axios.get(`https://api.redtube.com/?data=redtube.Videos.getVideoById&video_id=${videoId}&output=json`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 7000
    });
    const video = res.data?.video;
    if (video && video.mediaqueries) {
      Object.keys(video.mediaqueries).forEach(q => {
        const item = video.mediaqueries[q];
        if (item && item.videoUrl) {
          streams.push({
            title: `🔴 RedTube Direct [${q}p]`,
            url: item.videoUrl
          });
        }
      });
    }
  } catch (err) {}
  return streams;
}

// Manifest doplňku se všemi novými kategoriemi
const manifest = {
  id: "org.adult.multi.nuvio.v4",
  version: "4.0.0",
  name: "🔞 Adult Pack (Eporner / HQPorner / RedTube)",
  description: "Přímé HD streamy a kategorie z Eporner, HQPorner a RedTube",
  logo: IMG_EPORNER,
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["ep:", "hq:", "rt:"],
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
      name: "⭐ Eporner - Najlépe hodnocené",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "hq_latest",
      name: "🎬 HQPorner - Najnovější HD",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "hq_popular",
      name: "🔥 HQPorner - Populární",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "rt_videos",
      name: "🔴 RedTube - Videa",
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
    if (catalogId.startsWith('ep_') || catalogId.startsWith('hq_')) {
      let orderParam = (catalogId === 'ep_top' || catalogId === 'hq_popular') ? 'top-rated' : 'latest';
      let query = search ? encodeURIComponent(search) : 'all';
      let url = `https://www.eporner.com/api/v2/video/search/?query=${query}&per_page=24&page=${page}&order=${orderParam}&thumbsize=big`;

      const response = await axios.get(url, { timeout: 8000 });
      if (response.data && response.data.videos) {
        response.data.videos.forEach(v => {
          const isHq = catalogId.startsWith('hq_');
          const posterImg = v.default_thumb?.src || (isHq ? IMG_HQPORNER : IMG_EPORNER);
          metas.push({
            id: isHq ? `hq:${v.id}` : `ep:${v.id}`,
            type: "movie",
            name: isHq ? `[HD] ${v.title}` : v.title,
            poster: posterImg,
            description: `Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '0'}/5`
          });
        });
      }
    } else if (catalogId === 'rt_videos') {
      const searchQuery = search ? `&search=${encodeURIComponent(search)}` : '';
      const url = `https://api.redtube.com/?data=redtube.Videos.searchVideos&output=json&page=${page}${searchQuery}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 8000
      });

      if (response.data && response.data.videos) {
        response.data.videos.forEach(item => {
          const v = item.video;
          if (!v) return;
          metas.push({
            id: `rt:${v.video_id}`,
            type: "movie",
            name: v.title,
            poster: v.default_thumb || IMG_REDTUBE,
            description: `Délka: ${v.duration || '?'} | Hodnocení: ${v.rating || '0'}`
          });
        });
      }
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

  if (cleanId.startsWith('ep:') || cleanId.startsWith('hq:')) {
    const isHq = cleanId.startsWith('hq:');
    const videoId = cleanId.replace(/^(ep:|hq:)/, '');
    try {
      const response = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 7000 });
      const v = response.data;
      if (v && v.title) {
        const img = v.default_thumb?.src || (isHq ? IMG_HQPORNER : IMG_EPORNER);
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
  } else if (cleanId.startsWith('rt:')) {
    const videoId = cleanId.replace('rt:', '');
    try {
      const response = await axios.get(`https://api.redtube.com/?data=redtube.Videos.getVideoById&video_id=${videoId}&output=json`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 7000
      });
      const v = response.data?.video;
      if (v && v.title) {
        return res.json({
          meta: {
            id: cleanId,
            type: "movie",
            name: v.title,
            poster: v.default_thumb || IMG_REDTUBE,
            background: v.default_thumb || IMG_REDTUBE,
            description: `Délka: ${v.duration || '?'}`
          }
        });
      }
    } catch (e) {}
  }

  res.json({
    meta: { id: cleanId, type: "movie", name: "Adult Video", poster: IMG_EPORNER, background: IMG_EPORNER, description: "Přehrávání..." }
  });
});

// 3. STREAM ENDPOINT
app.get('/stream/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = extractCleanId(rawIdParam);
  let streams = [];

  if (cleanId.startsWith('ep:')) {
    streams = await getEpornerStreams(cleanId.replace('ep:', ''));
  } else if (cleanId.startsWith('hq:')) {
    streams = await getHqpornerStreams(cleanId.replace('hq:', ''));
  } else if (cleanId.startsWith('rt:')) {
    streams = await getRedtubeStreams(cleanId.replace('rt:', ''));
  }

  res.json({ streams });
});

app.listen(PORT, () => console.log(`Adult Pack v4.0.0 spuštěn na portu ${PORT}`));
