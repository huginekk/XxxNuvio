const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// === VÁŠ REAL-DEBRID API TOKEN ===
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';

app.use(cors());

// Odblokování přes Real-Debrid
async function unrestrictWithRD(targetUrl) {
  if (!RD_TOKEN) return null;
  try {
    const params = new URLSearchParams();
    params.append('link', targetUrl);

    const res = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', params, {
      headers: {
        'Authorization': `Bearer ${RD_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 8000
    });

    if (res.data && res.data.download) {
      return {
        title: `⚡ Real-Debrid Direct (${res.data.filename || '4K/HD MP4'})`,
        url: res.data.download
      };
    }
  } catch (err) {
    console.warn('[RD Error]:', err.response?.data?.error || err.message);
  }
  return null;
}

// Manifest pro Nuvio
const manifest = {
  id: "org.adult.nuvio.eporner",
  version: "2.0.0",
  name: "Adult Catalog (Real-Debrid)",
  description: "Stabilní adult katalog s vyhledáváním a 4K streamy přes Real-Debrid",
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
        { name: "genre", isRequired: false, options: ["4k", "1080p", "720p", "vr", "amateur", "anal", "pov", "milf", "asian", "latina"] },
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

// 1. CATALOG ENDPOINT (Oficiální API)
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const extraStr = req.params.extra || '';
  const extra = parseExtra(extraStr);
  const { search, genre, skip } = extra;

  try {
    const page = skip ? Math.floor(parseInt(skip) / 30) + 1 : 1;
    let query = search || genre || 'all';
    
    const apiUrl = `https://www.eporner.com/api/v2/video/search/?query=${encodeURIComponent(query)}&per_page=30&page=${page}&format=json`;
    console.log(`[API Request]: ${apiUrl}`);

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

// 3. STREAM ENDPOINT (Vygenerování přímých MP4 + Real-Debrid)
app.get(['/stream/:type/:id.json', '/stream/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const videoId = rawId.replace('ep:', '');

  try {
    const pageUrl = `https://www.eporner.com/video-${videoId}/`;
    const streams = [];

    // Pokus o odblokování/urychlení stránky přes Real-Debrid
    const rdStream = await unrestrictWithRD(pageUrl);
    if (rdStream) {
      streams.push(rdStream);
    }

    // Získání detailů videa z API pro přímé MP4 záložní streamy
    const apiUrl = `https://www.eporner.com/api/v2/video/id/?id=${videoId}&format=json`;
    const response = await axios.get(apiUrl, { timeout: 10000 });

    if (response.data && response.data.embed) {
      streams.push({
        title: "Standard Web Player",
        url: response.data.embed
      });
    }

    res.json({ streams });
  } catch (err) {
    console.error('[Stream API Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Addon v2.0.0 běží na portu ${PORT}`);
});
