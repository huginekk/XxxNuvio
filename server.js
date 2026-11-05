const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// === VÁŠ REAL-DEBRID API TOKEN ===
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';

app.use(cors());

// Pomocná funkce pro konverzi Magnetu na přímý stream přes Real-Debrid API
async function getRDStreamFromMagnet(magnetLink) {
  if (!RD_TOKEN) return null;
  try {
    // 1. Přidání magnetu do Real-Debridu
    const addParams = new URLSearchParams();
    addParams.append('magnet', magnetLink);
    const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', addParams, {
      headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
      timeout: 8000
    });

    if (addRes.data && addRes.data.id) {
      const torrentId = addRes.data.id;
      
      // 2. Výběr všech souborů v torrentu
      const selectParams = new URLSearchParams();
      selectParams.append('files', 'all');
      await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, selectParams, {
        headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
        timeout: 8000
      });

      // 3. Získání informací o stáhnutém souboru
      const infoRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
        headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
        timeout: 8000
      });

      if (infoRes.data && infoRes.data.links && infoRes.data.links.length > 0) {
        // 4. Odblokování prvního video odkazu na přímé MP4/MKV
        const unrestrictParams = new URLSearchParams();
        unrestrictParams.append('link', infoRes.data.links[0]);
        const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', unrestrictParams, {
          headers: { 'Authorization': `Bearer ${RD_TOKEN}` },
          timeout: 8000
        });

        if (unrestrictRes.data && unrestrictRes.data.download) {
          return unrestrictRes.data.download;
        }
      }
    }
  } catch (err) {
    console.warn('[RD Torrent Error]:', err.response?.data?.error || err.message);
  }
  return null;
}

const manifest = {
  id: "org.tpb.adult.nuvio.custom",
  version: "3.0.0",
  name: "TPB Adult Catalog (Real-Debrid)",
  description: "Rychlý adult katalog využívající TPB torrenty a Real-Debrid",
  logo: "https://thepiratebay.org/favicon.ico",
  background: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "other"],
  idPrefixes: ["tpba:"],
  catalogs: [
    {
      type: "other",
      id: "tpba_main",
      name: "TPB Adult - Top Videa",
      extra: [
        { name: "search", isRequired: false },
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

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (isNaN(b) || b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 1. CATALOG ENDPOINT (Čistý JSON z TPB API)
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const extraStr = req.params.extra || '';
  const extra = parseExtra(extraStr);
  const { search } = extra;

  try {
    // Kategorie 500 = Adult v PirateBay API
    let apiUrl = 'https://apibay.org/q.php?q=top100:500';
    if (search) {
      apiUrl = `https://apibay.org/q.php?q=${encodeURIComponent(search)}&cat=500`;
    }

    console.log(`[TPB API Request]: ${apiUrl}`);
    const response = await axios.get(apiUrl, { timeout: 10000 });
    const metas = [];

    if (Array.isArray(response.data)) {
      response.data.forEach(item => {
        if (item.id === '0' || !item.info_hash) return;

        const sizeStr = formatSize(item.size);
        metas.push({
          id: `tpba:${item.info_hash}`,
          type: "other",
          name: item.name,
          poster: manifest.background,
          description: `Velikost: ${sizeStr} | Seeders: ${item.seeders} | Leechers: ${item.leechers}`
        });
      });
    }

    console.log(`[TPB Catalog Success] Nalezeno ${metas.length} torrent položek.`);
    res.json({ metas });
  } catch (err) {
    console.error('[TPB Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT
app.get(['/meta/:type/:id.json', '/meta/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const infoHash = rawId.replace('tpba:', '');

  res.json({
    meta: {
      id: rawId,
      type: "other",
      name: `Torrent Stream (${infoHash.substring(0, 8)})`,
      poster: manifest.background,
      background: manifest.background,
      description: "Přehrávání torrent videa přes Real-Debrid."
    }
  });
});

// 3. STREAM ENDPOINT (Generování přímého odkaz přes Real-Debrid + Fallback InfoHash)
app.get(['/stream/:type/:id.json', '/stream/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const infoHash = rawId.replace('tpba:', '');
  const magnet = `magnet:?xt=urn:btih:${infoHash}`;

  try {
    const streams = [];

    // Metoda A: Získání přímého vysokorychlostního odkazu z vášho Real-Debridu
    const rdUrl = await getRDStreamFromMagnet(magnet);
    if (rdUrl) {
      streams.push({
        title: "⚡ Real-Debrid High-Speed Stream",
        url: rdUrl
      });
    }

    // Metoda B: Předání standardního InfoHash přímo do Nuvio přehrávače
    streams.push({
      title: "Torrent Stream (InfoHash)",
      infoHash: infoHash
    });

    console.log(`[Stream Success] Vráceno streamů: ${streams.length}`);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Addon v3.0.0 (TPB Architecture) běží na portu ${PORT}`);
});
