const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// Váš Real-Debrid API token a TMDB API klíč
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';
const TMDB_KEY = 'bcd898f31f5a923f94ccedb7d9c2b1a7';
const DEFAULT_POSTER = 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Adult_content_icon.svg';

app.use(cors());

function extractCleanId(rawParamId) {
  if (!rawParamId) return '';
  let decoded = decodeURIComponent(rawParamId);
  return decoded.replace(/\.json$/, '').replace(/^(tmdb:|tmdb%3A)/i, '').trim();
}

// Vyhledání XXX streamů přes Torrentio + Real-Debrid
async function getAdultRealDebridStreams(imdbId) {
  const streams = [];
  try {
    const torrentioUrl = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
    const res = await axios.get(torrentioUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 8000
    });

    if (res.data && res.data.streams) {
      for (const s of res.data.streams) {
        let streamUrl = s.url;

        // Pokud je k dispozici infoHash, převedeme ho přes Real-Debrid API
        if (s.infoHash && RD_TOKEN) {
          streamUrl = `https://torrentio.strem.fun/realdebrid/${RD_TOKEN}/${s.infoHash}/${s.fileIdx || 0}`;
        }

        if (streamUrl) {
          const titleLine = (s.title || '').split('\n')[0];
          streams.push({
            title: `⚡ RD Ultra HD [${titleLine}]`,
            url: streamUrl
          });
        }
      }
    }
  } catch (err) {
    console.warn('[RD Stream Warning]:', err.message);
  }
  return streams;
}

const manifest = {
  id: "org.adult.realdebrid.v5",
  version: "5.0.0",
  name: "🔞 Adult Real-Debrid Pack",
  description: "Dospělé XXX filmy v 1080p/4K s přímým přehráváním přes Real-Debrid",
  logo: DEFAULT_POSTER,
  background: DEFAULT_POSTER,
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["tmdb:"],
  catalogs: [
    {
      type: "movie",
      id: "xxx_popular",
      name: "🔥 XXX Premium Filmy",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "xxx_top",
      name: "⭐ XXX 1080p & 4K Trháky",
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
    let url = '';
    if (search) {
      url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(search)}&include_adult=true&page=${page}`;
    } else if (catalogId === 'xxx_top') {
      url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=10749&include_adult=true&sort_by=vote_average.desc&vote_count.gte=10&page=${page}`;
    } else {
      url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=10749&include_adult=true&sort_by=popularity.desc&page=${page}`;
    }

    const response = await axios.get(url, { timeout: 8000 });

    if (response.data && response.data.results) {
      response.data.results.forEach(item => {
        if (!item.title) return;
        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : DEFAULT_POSTER;
        metas.push({
          id: `tmdb:${item.id}`,
          type: "movie",
          name: item.title,
          poster: poster,
          description: item.overview || `Hodnocení: ${item.vote_average}/10 | Rok: ${(item.release_date || '').split('-')[0]}`
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
  const tmdbId = extractCleanId(rawIdParam);

  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=cs-CZ`;
    const response = await axios.get(url, { timeout: 8000 });
    const data = response.data;

    if (data && data.id) {
      const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : DEFAULT_POSTER;
      const background = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : poster;

      return res.json({
        meta: {
          id: `tmdb:${data.id}`,
          type: "movie",
          name: data.title || data.original_title,
          poster: poster,
          background: background,
          description: data.overview || 'Adult Premium Title',
          releaseInfo: (data.release_date || '').split('-')[0]
        }
      });
    }
  } catch (err) {
    console.error('[Meta Error]:', err.message);
  }

  res.json({
    meta: {
      id: `tmdb:${tmdbId}`,
      type: "movie",
      name: "XXX Film",
      poster: DEFAULT_POSTER,
      background: DEFAULT_POSTER,
      description: "Přehrávání přes Real-Debrid..."
    }
  });
});

// 3. STREAM ENDPOINT
app.get('/stream/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const tmdbId = extractCleanId(rawIdParam);

  try {
    // 1. Zjistíme IMDb ID
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`, { timeout: 6000 });
    const imdbId = tmdbRes.data?.imdb_id;

    if (!imdbId) {
      return res.json({ streams: [] });
    }

    // 2. Vytáhneme Real-Debrid streamy
    const streams = await getAdultRealDebridStreams(imdbId);
    console.log(`[Stream Success] Odesláno ${streams.length} Real-Debrid streamů pro ${imdbId}`);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => console.log(`Adult Real-Debrid Addon v5.0.0 spuštěn na portu ${PORT}`));
