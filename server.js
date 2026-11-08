const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

const TMDB_KEY = 'bcd898f31f5a923f94ccedb7d9c2b1a7';
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';
const DEFAULT_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/4/4c/RedTube_logo.svg';

app.use(cors());

function extractCleanId(rawParamId) {
  if (!rawParamId) return '';
  let decoded = decodeURIComponent(rawParamId);
  return decoded.replace(/\.json$/, '').trim();
}

// 1. EPORNER STREAMS
async function getEpornerStreams(videoId) {
  const streams = [];
  try {
    const res = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}`, { timeout: 7000 });
    if (res.data && res.data.files) {
      const files = res.data.files;
      Object.keys(files).forEach(q => {
        if (files[q] && files[q].url) {
          streams.push({
            title: `🔞 Eporner direct [${q}]`,
            url: files[q].url
          });
        }
      });
    }
  } catch (err) {}
  return streams;
}

// 2. REDTUBE STREAMS
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
            title: `🔞 RedTube direct [${q}p]`,
            url: item.videoUrl
          });
        }
      });
    }
  } catch (err) {}
  return streams;
}

// 3. TORRENTIO / REAL-DEBRID STREAMS
async function getTorrentStreams(tmdbId) {
  const streams = [];
  try {
    // Získání IMDb ID z TMDB
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`, { timeout: 6000 });
    const imdbId = tmdbRes.data?.imdb_id;

    if (imdbId) {
      const torrentioUrl = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
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
              title: `⚡ Real-Debrid Torrent [${s.title.split('\n')[0]}]`,
              url: streamUrl
            });
          }
        }
      }
    }
  } catch (err) {}
  return streams;
}

// Manifest s novou sekcí 🔞 Torrenty (XXX Filmy)
const manifest = {
  id: "org.adult.catalog.nuvio",
  version: "2.2.0",
  name: "Adult Catalog (Eporner / RedTube / Torrents)",
  description: "Dospělý obsah, webové videa a torrenty s Real-Debrid",
  logo: DEFAULT_LOGO,
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["rt:", "ep:", "tmdb:"],
  catalogs: [
    {
      type: "movie",
      id: "torrents_cat",
      name: "🔞 Torrenty (XXX Filmy)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "eporner_cat",
      name: "🔞 Eporner Videa",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "redtube_cat",
      name: "🔞 RedTube Videa",
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
    if (catalogId === 'torrents_cat') {
      // Dospělé filmy z TMDB pro torrenty
      const url = search
        ? `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(search)}&include_adult=true&page=${page}`
        : `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=10749&include_adult=true&sort_by=popularity.desc&page=${page}`;
      
      const response = await axios.get(url, { timeout: 8000 });
      if (response.data && response.data.results) {
        response.data.results.forEach(item => {
          if (!item.title) return;
          const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : DEFAULT_LOGO;
          metas.push({
            id: `tmdb:${item.id}`,
            type: "movie",
            name: item.title,
            poster: poster,
            description: item.overview || `Hodnocení: ${item.vote_average}/10`
          });
        });
      }
    } else if (catalogId === 'eporner_cat') {
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
      // RedTube Catalog
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
  } else if (cleanId.startsWith('tmdb:')) {
    const tmdbId = cleanId.replace('tmdb:', '');
    try {
      const response = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=cs-CZ`, { timeout: 6000 });
      const data = response.data;
      if (data && data.id) {
        const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : DEFAULT_LOGO;
        return res.json({
          meta: {
            id: cleanId,
            type: "movie",
            name: data.title,
            poster: poster,
            background: poster,
            description: data.overview || 'Adult Film'
          }
        });
      }
    } catch (e) {}
  }

  res.json({
    meta: { id: cleanId, type: "movie", name: "Adult Video", poster: DEFAULT_LOGO, background: DEFAULT_LOGO, description: "Přehrávání..." }
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
  } else if (cleanId.startsWith('tmdb:')) {
    const tmdbId = cleanId.replace('tmdb:', '');
    streams = await getTorrentStreams(tmdbId);
  }

  res.json({ streams });
});

app.listen(PORT, () => console.log(`Adult Addon v2.2.0 spuštěn na portu ${PORT}`));
      
