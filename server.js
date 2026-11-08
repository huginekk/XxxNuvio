const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';
const DEFAULT_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/4/4c/RedTube_logo.svg';

app.use(cors());

// Pomocné funkce pro dekódování ID
function extractCleanId(rawParamId) {
  if (!rawParamId) return '';
  let decoded = decodeURIComponent(rawParamId);
  return decoded.replace(/\.json$/, '').trim();
}

// 1. ZÍSKÁNÍ STREAMŮ Z REDTUBE
async function getRedtubeStreams(videoId) {
  const streams = [];
  try {
    const res = await axios.get(`https://api.redtube.com/?data=redtube.Videos.getVideoById&video_id=${videoId}&output=json`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 6000
    });

    const video = res.data?.video;
    if (video && video.mediaqueries) {
      // Procházení kvality videa (720p, 1080p atd.)
      Object.keys(video.mediaqueries).forEach(quality => {
        const media = video.mediaqueries[quality];
        if (media && media.videoUrl) {
          streams.push({
            title: `🔞 RedTube ${quality}p`,
            url: media.videoUrl
          });
        }
      });
    }
  } catch (err) {
    console.warn('[RedTube Stream Warning]:', err.message);
  }
  return streams;
}

// 2. ZÍSKÁNÍ STREAMŮ Z EPORNER
async function getEpornerStreams(videoId) {
  const streams = [];
  try {
    const res = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 6000 });
    if (res.data && res.data.files) {
      const files = res.data.files;
      Object.keys(files).forEach(quality => {
        if (files[quality] && files[quality].url) {
          streams.push({
            title: `🔞 Eporner ${quality}`,
            url: files[quality].url
          });
        }
      });
    }
  } catch (err) {
    console.warn('[Eporner Stream Warning]:', err.message);
  }
  return streams;
}

// 3. ZÍSKÁNÍ STREAMŮ Z TORRENTIO + REAL-DEBRID
async function getTorrentStreams(cleanId) {
  const streams = [];
  try {
    const torrentioUrl = `https://torrentio.strem.fun/stream/movie/${cleanId}.json`;
    const res = await axios.get(torrentioUrl, {
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
            title: `⚡ RD Torrent [${s.title.split('\n')[0]}]`,
            url: streamUrl
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Torrent Stream Warning]:', err.message);
  }
  return streams;
}

const manifest = {
  id: "org.adult.catalog.nuvio",
  version: "2.1.0",
  name: "Adult Catalog (Eporner / RedTube / Torrents)",
  description: "Katalog dospělého obsahu s přímými streamy a Real-Debrid",
  logo: DEFAULT_LOGO,
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["rt:", "ep:", "tmdb:"],
  catalogs: [
    {
      type: "movie",
      id: "redtube_cat",
      name: "🔞 RedTube Videa",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "eporner_cat",
      name: "🔞 Eporner Videa",
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
    if (catalogId === 'eporner_cat') {
      const query = search ? encodeURIComponent(search) : 'all';
      const url = `https://www.eporner.com/api/v2/video/search/?query=${query}&per_page=20&page=${page}&thumbsize=big`;
      const response = await axios.get(url, { timeout: 8000 });

      if (response.data && response.data.videos) {
        response.data.videos.forEach(v => {
          metas.push({
            id: `ep:${v.id}`,
            type: "movie",
            name: v.title,
            poster: v.default_thumb?.src || DEFAULT_LOGO,
            description: `Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '0'}`
          });
        });
      }
    } else {
      // RedTube catalog
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
            poster: v.default_thumb || DEFAULT_LOGO,
            description: `Délka: ${v.duration || '?'} | Hodnocení: ${v.rating || '0'}`
          });
        });
      }
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

  if (cleanId.startsWith('ep:')) {
    const videoId = cleanId.replace('ep:', '');
    try {
      const response = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 6000 });
      const v = response.data;
      if (v && v.title) {
        return res.json({
          meta: {
            id: cleanId,
            type: "movie",
            name: v.title,
            poster: v.default_thumb?.src || DEFAULT_LOGO,
            background: v.default_thumb?.src || DEFAULT_LOGO,
            description: `Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '0'}`
          }
        });
      }
    } catch (e) {}
  } else if (cleanId.startsWith('rt:')) {
    const videoId = cleanId.replace('rt:', '');
    try {
      const response = await axios.get(`https://api.redtube.com/?data=redtube.Videos.getVideoById&video_id=${videoId}&output=json`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 6000
      });
      const v = response.data?.video;
      if (v && v.title) {
        return res.json({
          meta: {
            id: cleanId,
            type: "movie",
            name: v.title,
            poster: v.default_thumb || DEFAULT_LOGO,
            background: v.default_thumb || DEFAULT_LOGO,
            description: `Délka: ${v.duration || '?'}`
          }
        });
      }
    } catch (e) {}
  }

  // Fallback Meta
  res.json({
    meta: {
      id: cleanId,
      type: "movie",
      name: "Adult Video",
      poster: DEFAULT_LOGO,
      background: DEFAULT_LOGO,
      description: "Přehrávání obsahu..."
    }
  });
});

// 3. STREAM ENDPOINT
app.get('/stream/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = extractCleanId(rawIdParam);
  let streams = [];

  if (cleanId.startsWith('ep:')) {
    const videoId = cleanId.replace('ep:', '');
    streams = await getEpornerStreams(videoId);
  } else if (cleanId.startsWith('rt:')) {
    const videoId = cleanId.replace('rt:', '');
    streams = await getRedtubeStreams(videoId);
  } else {
    // Torrentio / TMDB fallback
    streams = await getTorrentStreams(cleanId);
  }

  console.log(`[Stream Success] Odesláno ${streams.length} streamů pro ${cleanId}`);
  res.json({ streams });
});

app.listen(PORT, () => console.log(`Adult Addon v2.1.0 spuštěn na portu ${PORT}`));
