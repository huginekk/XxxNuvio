const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 7000;
const BASE_URL = 'https://fullporn.to';

app.use(cors());

// HTTP klient s vlastním User-Agentem pro obcházení základních blokací
const httpClient = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': BASE_URL
  },
  timeout: 10000
});

// Vlastní Nuvio / Stremio Manifest
const manifest = {
  id: "org.fullporn.nuvio.custom",
  version: "1.0.0",
  name: "FullPorn Catalog",
  description: "Katalog s vyhledáváním, filtrováním podle kvalit, žánrů a účinkujících z fullporn.to",
  logo: `${BASE_URL}/favicon.ico`,
  background: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "other"],
  idPrefixes: ["fp:"],
  catalogs: [
    {
      type: "other",
      id: "fp_main",
      name: "FullPorn - Hlavní nabídka",
      extra: [
        { name: "search", isRequired: false },
        {
          name: "genre",
          isRequired: false,
          options: [
            "4k", "1080p", "720p", "vr", "amateur", "anal",
            "pov", "milf", "asian", "latina", "blonde", "brunette"
          ]
        },
        {
          name: "sort",
          isRequired: false,
          options: ["Nejnovější", "Nejoblíbenější", "Nejlépe hodnocené"]
        },
        { name: "skip", isRequired: false }
      ]
    }
  ],
  behaviorHints: {
    adult: true,
    configurable: false
  }
};

// 1. MANIFEST ENDPOINT
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Helper pro dekódování URL parametrů z extraArgs
function parseExtraArgs(extraParam) {
  if (!extraParam) return {};
  const cleaned = extraParam.replace(/\.json$/, '');
  const params = new URLSearchParams(cleaned);
  const result = {};
  for (const [key, val] of params.entries()) {
    result[key] = val;
  }
  return result;
}

// 2. CATALOG ENDPOINT (Katalog videí + vyhledávání a filtry)
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { extra } = req.params;
  const extraArgs = parseExtraArgs(extra);
  const { search, genre, sort, skip } = extraArgs;

  try {
    let targetUrl = BASE_URL;
    const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;

    if (search) {
      targetUrl = `${BASE_URL}/search/${encodeURIComponent(search)}/${page > 1 ? 'page/' + page + '/' : ''}`;
    } else if (genre) {
      targetUrl = `${BASE_URL}/category/${encodeURIComponent(genre.toLowerCase())}/${page > 1 ? 'page/' + page + '/' : ''}`;
    } else {
      let sortPath = '';
      if (sort === 'Nejoblíbenější') sortPath = 'most-popular/';
      if (sort === 'Nejlépe hodnocené') sortPath = 'top-rated/';
      targetUrl = `${BASE_URL}/${sortPath}${page > 1 ? 'page/' + page + '/' : ''}`;
    }

    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);
    const metas = [];

    $('.video-item, .item, article, .post').each((_, el) => {
      const element = $(el);
      const linkEl = element.find('a').first();
      const href = linkEl.attr('href') || '';
      const title = element.find('.title, .video-title, h2, h3').text().trim() || linkEl.attr('title') || 'Video bez názvu';
      const imgEl = element.find('img').first();
      const poster = imgEl.attr('data-src') || imgEl.attr('src') || imgEl.attr('data-lazy-src') || '';
      
      const slugMatch = href.match(/\/([^\/]+)\/?$/);
      if (slugMatch && slugMatch[1]) {
        const id = `fp:${slugMatch[1]}`;
        metas.push({
          id,
          type: "other",
          name: title,
          poster: poster.startsWith('http') ? poster : `${BASE_URL}${poster}`,
          description: `Kategorie: ${genre || 'Vše'}`
        });
      }
    });

    res.json({ metas });
  } catch (err) {
    console.error('Catalog scraper error:', err.message);
    res.json({ metas: [] });
  }
});

// 3. META ENDPOINT (Detail videa)
app.get('/meta/:type/:id.json', async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const slug = rawId.replace('fp:', '');

  try {
    const targetUrl = `${BASE_URL}/${slug}/`;
    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);

    const title = $('h1').text().trim() || slug;
    const description = $('.description, .entry-content, .video-info').text().trim() || '';
    const poster = $('video').attr('poster') || $('meta[property="og:image"]').attr('content') || '';
    
    const genres = [];
    $('.tags a, .categories a, .tag-link').each((_, el) => {
      genres.push($(el).text().trim());
    });

    const meta = {
      id: rawId,
      type: "other",
      name: title,
      poster: poster,
      background: poster,
      description: description,
      genres: genres.length ? genres : ["Adult"]
    };

    res.json({ meta });
  } catch (err) {
    console.error('Meta scraper error:', err.message);
    res.json({ meta: null });
  }
});

// 4. STREAM ENDPOINT (Extrakce přímých odkazů na video)
app.get('/stream/:type/:id.json', async (req, res) => {
  const rawId = req.params.id.replace(/\.json$/, '');
  const slug = rawId.replace('fp:', '');

  try {
    const targetUrl = `${BASE_URL}/${slug}/`;
    const { data: html } = await httpClient.get(targetUrl);
    const $ = cheerio.load(html);
    const streams = [];

    // Metoda A: Získání zdrojů přímo z tagu <video> nebo <source>
    $('video source, video').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      const resLabel = $(el).attr('res') || $(el).attr('label') || 'HD';
      if (src) {
        streams.push({
          title: `Direct Stream (${resLabel})`,
          url: src.startsWith('http') ? src : `${BASE_URL}${src}`,
          quality: resLabel
        });
      }
    });

    // Metoda B: Vyhledání streamovací URL v JavaScriptových proměnných (regex fallback pro inline scripty)
    if (streams.length === 0) {
      const scriptContent = $('script').text();
      const mp4Matches = scriptContent.match(/https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*/g);
      
      if (mp4Matches) {
        const uniqueUrls = [...new Set(mp4Matches)];
        uniqueUrls.forEach((url, idx) => {
          const isHls = url.includes('.m3u8');
          streams.push({
            title: isHls ? `HLS Stream Auto` : `Stream Server ${idx + 1}`,
            url: url,
            type: isHls ? 'hls' : 'mp4'
          });
        });
      }
    }

    // Metoda C: Kontrola iFrame přehrávačů (např. embedované servery)
    if (streams.length === 0) {
      const iframeSrc = $('iframe').attr('src');
      if (iframeSrc) {
        streams.push({
          title: "External Embed Player",
          url: iframeSrc.startsWith('http') ? iframeSrc : `https:${iframeSrc}`
        });
      }
    }

    res.json({ streams });
  } catch (err) {
    console.error('Stream scraper error:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Addon server spuštěn na: http://localhost:${PORT}/manifest.json`);
});
