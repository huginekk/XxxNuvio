const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// === REAL-DEBRID API TOKEN ===
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';

app.use(cors());

// Odblokování odkazu přes Real-Debrid API (podporuje Eporner i RedTube)
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
        title: `⚡ Real-Debrid Direct (${res.data.filename || 'Direct MP4'})`,
        url: res.data.download
      };
    }
  } catch (err) {
    console.warn('[RD Error]:', err.response?.data?.error || err.message);
  }
  return null;
}

// Odblokování torrentu přes Real-Debrid API
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
            title: `⚡ Real-Debrid Torrent Direct (${unrestrictRes.data.filename || 'MP4'})`,
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

// MANIFEST PRO NUVIO (Zdroje / Servry)
const manifest = {
  id: "org.fullporn.nuvio.custom",
  version: "5.0.0",
  name: "Multi-Source Adult Catalog",
  description: "Doplněk pro Nuvio s výběrem serverů (Eporner, RedTube, Torrenty) a Real-Debrid",
  logo: "https://www.eporner.com/favicon.ico",
  background: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "other"],
  idPrefixes: ["fp:", "ep:", "rt:", "st:"],
  catalogs: [
    {
      type: "other",
      id: "fp_main",
      name: "Server: Eporner (HD / 4K)",
      extra: [
        {
          name: "genre",
          isRequired: false,
          options: [
            "Vše", "4K", "1080p", "720p",
            "SexArt", "Nubiles", "MetArt", "TeamSkeet", "Brazzers", "Vixen",
            "Amateur", "Anal", "POV", "MILF", "VR", "Asian", "Latina"
          ]
        },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "other",
      id: "cat_redtube",
      name: "Server: RedTube",
      extra: [
        {
          name: "genre",
          isRequired: false,
          options: ["Vše", "Amateur", "Anal", "Asian", "Big Tits", "Ebony", "Japanese", "Lesbian", "MILF", "POV", "VR"]
        },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "other",
      id: "cat_torrents",
      name: "Server: Torrent Studio Scény (4K / RD)",
      extra: [
        {
          name: "genre",
          isRequired: false,
          options: ["Vše", "4K", "1080p", "Brazzers", "Vixen", "SexArt", "Naughty America", "Digital Playground"]
        },
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

// 1. CATALOG ENDPOINT
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const catalogId = req.params.id;
  const extraStr = req.params.extra || '';
  const extra = parseExtra(extraStr);
  const { search, genre, skip } = extra;
  const page = skip ? Math.floor(parseInt(skip) / 30) + 1 : 1;

  try {
    const metas = [];

    // A. SERVER REDTUBE
    if (catalogId === 'cat_redtube') {
      const query = search || (genre && genre !== 'Vše' ? genre : 'all');
      const rtUrl = `https://api.redtube.com/?data=redtube.Videos.searchVideo&output=json&search=${encodeURIComponent(query)}&thumbsize=big&page=${page}`;
      console.log(`[Fetch RedTube] ${rtUrl}`);

      const response = await axios.get(rtUrl, { timeout: 8000 });
      if (response.data && response.data.videos) {
        response.data.videos.forEach(item => {
          const v = item.video;
          if (!v) return;
          metas.push({
            id: `rt:${v.video_id}`,
            type: "other",
            name: v.title,
            poster: v.default_thumb || v.thumbs?.[0]?.src || manifest.background,
            description: `Zdroj: RedTube | Délka: ${v.duration || '?'} min | Hodnocení: ${v.rating || '5'}/5`
          });
        });
      }
    }

    // B. SERVER TORRENTY (SolidTorrents API)
    else if (catalogId === 'cat_torrents') {
      let query = search || (genre && genre !== 'Vše' ? genre : '1080p');
      const stUrl = `https://solidtorrents.to/api/v1/search?q=${encodeURIComponent(query)}&category=nsfw`;
      console.log(`[Fetch Torrents] ${stUrl}`);

      const response = await axios.get(stUrl, { timeout: 8000 });
      if (response.data && response.data.results) {
        response.data.results.slice(0, 30).forEach(item => {
          if (!item.infohash) return;
          const sizeStr = formatSize(item.size);
          metas.push({
            id: `st:${item.infohash}`,
            type: "other",
            name: item.title,
            poster: manifest.background,
            description: `Zdroj: Torrent | Velikost: ${sizeStr} | Seeds: ${item.swarms?.seeders || 0}`
          });
        });
      }
    }

    // C. SERVER EPORNER (Výchozí pro fp_main)
    else {
      let query = search || (genre && genre !== 'Vše' ? genre : 'all');
      const epUrl = `https://www.eporner.com/api/v2/video/search/?query=${encodeURIComponent(query)}&per_page=30&page=${page}&format=json`;
      console.log(`[Fetch Eporner] ${epUrl}`);

      const response = await axios.get(epUrl, { timeout: 8000 });
      if (response.data && response.data.videos) {
        response.data.videos.forEach(v => {
          metas.push({
            id: `fp:${v.id}`,
            type: "other",
            name: v.title,
            poster: v.default_thumb ? v.default_thumb.src : manifest.background,
            description: `Zdroj: Eporner | Délka: ${v.length_min || '?'} min | Hodnocení: ${v.rate || '100'}%`
          });
        });
      }
    }

    console.log(`[Catalog Success] Server: ${catalogId} -> Odesláno ${metas.length} položek.`);
    res.json({ metas });
  } catch (err) {
    console.error(`[Catalog Error ${catalogId}]:`, err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT
app.get(['/meta/:type/:id.json', '/meta/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');

  // A. RedTube Meta
  if (rawId.startsWith('rt:')) {
    const videoId = rawId.replace('rt:', '');
    try {
      const resRt = await axios.get(`https://api.redtube.com/?data=redtube.Videos.getVideoById&video_id=${videoId}&output=json&thumbsize=big`, { timeout: 6000 });
      const v = resRt.data?.video || resRt.data?.videos?.[0]?.video;
      if (v) {
        return res.json({
          meta: {
            id: rawId,
            type: "other",
            name: v.title,
            poster: v.default_thumb || manifest.background,
            background: v.default_thumb || manifest.background,
            description: `Délka: ${v.duration || '?'} min. Hodnocení: ${v.rating || '5'}/5.`
          }
        });
      }
    } catch (e) {}
  }

  // B. Eporner Meta
  if (rawId.startsWith('fp:') || rawId.startsWith('ep:')) {
    const videoId = rawId.replace(/^(fp:|ep:)/, '');
    try {
      const resEp = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}&format=json`, { timeout: 6000 });
      if (resEp.data) {
        const v = resEp.data;
        return res.json({
          meta: {
            id: rawId,
            type: "other",
            name: v.title,
            poster: v.default_thumb ? v.default_thumb.src : manifest.background,
            background: v.default_thumb ? v.default_thumb.src : manifest.background,
            description: `Délka: ${v.length_min} min. Zhlédnutí: ${v.views}. Hodnocení: ${v.rate}%`
          }
        });
      }
    } catch (e) {}
  }

  // Výchozí Meta fallback
  res.json({
    meta: {
      id: rawId,
      type: "other",
      name: "Detail videa",
      poster: manifest.background,
      background: manifest.background,
      description: "Přehrávání přes Real-Debrid."
    }
  });
});

// 3. STREAM ENDPOINT
app.get(['/stream/:type/:id.json', '/stream/:type/:id'], async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const streams = [];

  try {
    // A. RedTube Stream (Real-Debrid + Direct Embed)
    if (rawId.startsWith('rt:')) {
      const videoId = rawId.replace('rt:', '');
      const rtPageUrl = `https://www.redtube.com/${videoId}`;
      
      const rdStream = await unrestrictWithRD(rtPageUrl);
      if (rdStream) {
        streams.push(rdStream);
      }
      streams.push({
        title: "Standard RedTube Player",
        url: `https://embed.redtube.com/?id=${videoId}`
      });
    }

    // B. Torrent Stream (Real-Debrid Magnet)
    else if (rawId.startsWith('st:')) {
      const infoHash = rawId.replace('st:', '');
      const rdTorrent = await unrestrictMagnetWithRD(infoHash);
      if (rdTorrent) {
        streams.push(rdTorrent);
      }
      streams.push({
        title: "Torrent Stream (InfoHash)",
        infoHash: infoHash
      });
    }

    // C. Eporner Stream (Real-Debrid + Direct Embed)
    else {
      const videoId = rawId.replace(/^(fp:|ep:)/, '');
      const epPageUrl = `https://www.eporner.com/video-${videoId}/`;

      const rdStream = await unrestrictWithRD(epPageUrl);
      if (rdStream) {
        streams.push(rdStream);
      }

      const resEp = await axios.get(`https://www.eporner.com/api/v2/video/id/?id=${videoId}&format=json`, { timeout: 6000 });
      if (resEp.data && resEp.data.embed) {
        streams.push({
          title: "Standard Web Stream",
          url: resEp.data.embed
        });
      }
    }

    console.log(`[Stream Success] ID: ${rawId} -> Vráceno ${streams.length} streamů.`);
    res.json({ streams });
  } catch (err) {
    console.error(`[Stream Error ${rawId}]:`, err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => console.log(`Addon v5.0.0 spuštěn na portu ${PORT}`));
