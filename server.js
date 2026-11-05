const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// === REAL-DEBRID API TOKEN ===
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';

app.use(cors());

// Odblokování magnetu přes Real-Debrid API na přímý MP4/MKV stream
async function unrestrictMagnetWithRD(infoHash) {
  if (!RD_TOKEN) return null;
  try {
    const magnet = `magnet:?xt=urn:btih:${infoHash}`;
    const addParams = new URLSearchParams();
    addParams.append('magnet', magnet);
    const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', addParams, {
      headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
      timeout: 8000
    });

    if (addRes.data && addRes.data.id) {
      const torrentId = addRes.data.id;
      const selectParams = new URLSearchParams();
      selectParams.append('files', 'all');
      await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, selectParams, {
        headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
        timeout: 8000
      });

      const infoRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
        headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
        timeout: 8000
      });

      if (infoRes.data && infoRes.data.links && infoRes.data.links.length > 0) {
        const unrestrictParams = new URLSearchParams();
        unrestrictParams.append('link', infoRes.data.links[0]);
        const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', unrestrictParams, {
          headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
          timeout: 8000
        });

        if (unrestrictRes.data && unrestrictRes.data.download) {
          return {
            title: `⚡ Real-Debrid Direct (${unrestrictRes.data.filename || 'Direct MP4'})`,
            url: unrestrictRes.data.download
          };
        }
      }
    }
  } catch (err) {
    console.warn('[RD Torrent Error]:', err.response?.data?.error || err.message);
  }
  return null;
}

// Získání funkčních dat z API
async function fetchTorrents(searchQuery) {
  const query = searchQuery ? encodeURIComponent(searchQuery) : '1080p';
  const urls = [
    `https://apibay.org/q.php?q=${query}&cat=500`,
    `https://apibay.org/q.php?q=xxx&cat=500`,
    `https://apibay.org/q.php?q=hd&cat=500`
  ];

  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 8000
      });
      let data = res.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { data = null; }
      }
      if (Array.isArray(data) && data.length > 0 && data[0].id !== '0') {
        return data;
      }
    } catch (e) {
      console.warn(`[Fetch Warning] ${e.message}`);
    }
  }
  return [];
}

// Manifest přesně odpovídající starému nastavení v Nuvio
const manifest = {
  id: "org.fullporn.nuvio.custom",
  version: "3.3.0",
  name: "FullPorn Catalog",
  description: "Doplněk pro Nuvio s přímým odblokováním přes Real-Debrid",
  logo: "https://thepiratebay.org/favicon.ico",
  background: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "other"],
  idPrefixes: ["fp:", "tpba:", "ep:"],
  catalogs: [
    {
      type: "other",
      id: "fp_main",
      name: "FullPorn - Všechna videa",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
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

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (isNaN(b) || b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 1. CATALOG ENDPOINT (Reaguje na jakékoliv ID katalogu)
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const extraStr = req.params.extra || '';
  const extra = parseExtra(extraStr);
  const { search } = extra;

  try {
    const rawItems = await fetchTorrents(search);
    const metas = [];

    rawItems.forEach(item => {
      if (!item.info_hash || item.id === '0') return;
      const sizeStr = formatSize(item.size);
      metas.push({
        id: `fp:${item.info_hash}`,
        type: "other",
        name: item.name,
        poster: manifest.background,
        description: `Velikost: ${sizeStr} | Seeds: ${item.seeders}`
      });
    });

    console.log(`[Catalog Success] Odpovídám s ${metas.length} položkami.`);
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT
app.get(['/meta/:type/:id.json', '/meta/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const infoHash = rawId.replace(/^(fp:|tpba:|ep:)/, '');

  res.json({
    meta: {
      id: rawId,
      type: "other",
      name: `Adult Stream (${infoHash.substring(0, 8)})`,
      poster: manifest.background,
      background: manifest.background,
      description: "Přehrávání přes Real-Debrid."
    }
  });
});

// 3. STREAM ENDPOINT
app.get(['/stream/:type/:id.json', '/stream/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const infoHash = rawId.replace(/^(fp:|tpba:|ep:)/, '');

  try {
    const streams = [];

    // Odblokování přes Real-Debrid
    const rdResult = await unrestrictMagnetWithRD(infoHash);
    if (rdResult) {
      streams.push(rdResult);
    }

    // Záložní magnet odkaz
    streams.push({
      title: "Torrent Stream (InfoHash)",
      infoHash: infoHash
    });

    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => console.log(`Addon v3.3.0 spuštěn na portu ${PORT}`));
