const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors());

const manifest = {
  id: "org.adult.nuvio.eporner",
  version: "2.2.0",
  name: "Adult Catalog",
  description: "Doplněk pro Nuvio s přímými MP4 streamy a HTTP hlavičkami",
  logo: "https://www.eporner.com/favicon.ico",
  background: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "other"],
  idPrefixes: ["ep:"],
  catalogs: [
    {
      type: "other",
      id: "ep_main",
      name: "Adult - Hlavní nabídka",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: ["4k", "1080p", "720p", "amateur", "anal", "pov", "milf", "asian", "latina"] },
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

// 1. CATALOG ENDPOINT
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const extraStr = req.params.extra || '';
  const extra = parseExtra(extraStr);
  const { search, genre, skip } = extra;

  try {
    const page = skip ? Math.floor(parseInt(skip) / 30) + 1 : 1;
    let query = search || genre || 'all';
    
    const apiUrl = `https://www.eporner.com/api/v2/video/search/?query=${encodeURIComponent(query)}&per_page=30&page=${page}&format=json`;
    const response = await axios.get(apiUrl, { timeout: 10000 });
    const metas = [];

    if (response.data && response.data.videos) {
      response.data.videos.forEach(v => {
        metas.push({
          id: `ep:${v.id}`,
          type: "other",
          name: v.title,
          poster: v.default_thumb ? v.default_thumb.src : manifest.background,
          description: `Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '100'}%`
        });
      });
    }

    res.json({ metas });
  } catch (err) {
    console.error('[Catalog API Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT
app.get(['/meta/:type/:id.json', '/meta/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const videoId = rawId.replace('ep:', '');

  try {
    const apiUrl = `https://www.eporner.com/api/v2/video/id/?id=${videoId}&format=json`;
    const response = await axios.get(apiUrl, { timeout: 10000 });

    if (response.data) {
      const v = response.data;
      return res.json({
        meta: {
          id: rawId,
          type: "other",
          name: v.title,
          poster: v.default_thumb ? v.default_thumb.src : manifest.background,
          background: v.default_thumb ? v.default_thumb.src : manifest.background,
          description: `Délka videa: ${v.length_min} min. Zhlédnutí: ${v.views}.`,
          genres: v.keywords ? v.keywords.split(',') : ["Adult"]
        }
      });
    }
  } catch (err) {
    console.error('[Meta API Error]:', err.message);
  }

  res.json({
    meta: {
      id: rawId,
      type: "other",
      name: "Video Detail",
      poster: manifest.background,
      background: manifest.background,
      description: "Detail videa."
    }
  });
});

// 3. STREAM ENDPOINT (Přímé MP4 + Předání Referer/UA hlaviček přehrávači)
app.get(['/stream/:type/:id.json', '/stream/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const videoId = rawId.replace('ep:', '');

  try {
    const embedUrl = `https://www.eporner.com/embed/${videoId}/`;
    console.log(`[Stream Request] Načítám embed: ${embedUrl}`);

    const response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': 'https://www.eporner.com/'
      },
      timeout: 10000
    });

    const streams = [];
    const html = response.data || '';

    const mp4Matches = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/g);

    if (mp4Matches) {
      const cleanUrls = [...new Set(mp4Matches.map(u => u.replace(/\\/g, '')))];

      for (const mp4Url of cleanUrls) {
        let quality = 'HD MP4';
        if (mp4Url.includes('1080p')) quality = '1080p Full HD';
        else if (mp4Url.includes('720p')) quality = '720p HD';
        else if (mp4Url.includes('480p')) quality = '480p SD';
        else if (mp4Url.includes('2160p') || mp4Url.includes('4k')) quality = '4K Ultra HD';

        streams.push({
          title: `Direct Stream (${quality})`,
          url: mp4Url,
          behaviorHints: {
            notSupported: false,
            requestHeaders: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              'Referer': 'https://www.eporner.com/'
            }
          }
        });
      }
    }

    console.log(`[Stream Success] Nalezeno funkčních streamů: ${streams.length}`);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Addon v2.2.0 běží na portu ${PORT}`);
});
