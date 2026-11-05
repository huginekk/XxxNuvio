const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = Number(process.env.PORT || 7000);
const SITE_URL = (process.env.SITE_URL || "https://fullporn.to").replace(/\/+$/, "");
const ADDON_ID = "org.community.fullporn";
const ADDON_NAME = "FullPorn.to – veřejný katalog";
const CATALOG_ID = "fullporn-latest";

const manifest = {
  id: ADDON_ID,
  version: "1.0.0",
  name: ADDON_NAME,
  description: "Katalog veřejně dostupného obsahu.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["fullporn:"],
  catalogs: [
    {
      type: "movie",
      id: CATALOG_ID,
      name: "FullPorn.to – nejnovější",
      extra: [{ name: "search", isRequired: false }]
    }
  ],
  behaviorHints: {
    adult: true
  }
};

function absoluteUrl(value, base = SITE_URL) {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isSiteUrl(value) {
  try {
    return new URL(value).hostname === new URL(SITE_URL).hostname;
  } catch {
    return false;
  }
}

function makeId(url) {
  return `fullporn:${Buffer.from(url, "utf8").toString("base64url")}`;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html,application/xhtml+xml"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    throw new Error("Zdroj nevrátil HTML.");
  }

  return await response.text();
}

function extractCards(html, pageUrl) {
  const $ = cheerio.load(html);
  const found = new Map();

  $("a[href]").each((_, element) => {
    const anchor = $(element);

    const href = absoluteUrl(anchor.attr("href"), pageUrl);

    if (!href || !isSiteUrl(href)) return;

    const image = anchor.find("img").first();

    const poster = absoluteUrl(
      image.attr("data-src") ||
      image.attr("data-original") ||
      image.attr("src") ||
      "",
      pageUrl
    );

    const title =
      (anchor.attr("title") || "").trim() ||
      (image.attr("alt") || "").trim() ||
      anchor.find("h1,h2,h3,h4").first().text().trim() ||
      anchor.text().replace(/\s+/g, " ").trim();

    if (!poster || !title || title.length < 3) return;

    if (href === SITE_URL || href === `${SITE_URL}/`) return;

    const path = new URL(href).pathname;

    if (/\.(jpg|jpeg|png|webp|gif|mp4|m3u8)$/i.test(path)) {
      return;
    }

    found.set(href, {
      id: makeId(href),
      type: "movie",
      name: title.slice(0, 180),
      poster,
      posterShape: "landscape",
      description: "Odkaz na stránku zdroje."
    });
  });

  return [...found.values()];
}

function pageUrlFromId(id) {
  const encoded = String(id || "").replace(/^fullporn:/, "");

  if (!encoded) return null;

  try {
    const decoded = Buffer
      .from(encoded, "base64url")
      .toString("utf8");

    const url = new URL(decoded);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      !isSiteUrl(url.href)
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

async function getCatalog(searchTerm = "") {
  const html = await fetchHtml(`${SITE_URL}/`);

  let items = extractCards(html, SITE_URL);

  if (searchTerm) {
    const needle = searchTerm.toLocaleLowerCase();

    items = items.filter(item =>
      item.name.toLocaleLowerCase().includes(needle)
    );
  }

  return items.slice(0, 100);
}

async function getMeta(id) {
  const pageUrl = pageUrlFromId(id);

  if (!pageUrl) return null;

  const html = await fetchHtml(pageUrl);
  const $ = cheerio.load(html);

  const getMeta = (...selectors) => {
    for (const selector of selectors) {
      const value = $(selector).attr("content");

      if (value) return value.trim();
    }

    return "";
  };

  const name =
    getMeta(
      'meta[property="og:title"]',
      'meta[name="twitter:title"]'
    ) ||
    $("h1").first().text().trim() ||
    $("title").text().trim();

  const poster = absoluteUrl(
    getMeta(
      'meta[property="og:image"]',
      'meta[name="twitter:image"]'
    ),
    pageUrl
  );

  const description =
    getMeta(
      'meta[property="og:description"]',
      'meta[name="description"]'
    ) ||
    $("p").first().text().trim();

  return {
    id,
    type: "movie",
    name: name || id,
    poster: poster || undefined,
    description: description || " ",
    website: pageUrl
  };
}

async function getStreams(id) {
  const pageUrl = pageUrlFromId(id);

  if (!pageUrl) return [];

  const html = await fetchHtml(pageUrl);
  const $ = cheerio.load(html);

  const candidates = new Set();

  $("video source[src], video[src]").each((_, element) => {
    const src = $(element).attr("src");
    const url = absoluteUrl(src, pageUrl);

    if (url && /\.(mp4|m3u8)(\?|$)/i.test(url)) {
      candidates.add(url);
    }
  });

  $(
    'meta[property="og:video"],' +
    'meta[property="og:video:url"],' +
    'meta[name="twitter:player:stream"]'
  ).each((_, element) => {
    const url = absoluteUrl(
      $(element).attr("content"),
      pageUrl
    );

    if (url && /\.(mp4|m3u8)(\?|$)/i.test(url)) {
      candidates.add(url);
    }
  });

  return [...candidates].map((url, index) => ({
    name: "FullPorn.to",
    title: `Přímý stream ${index + 1}`,
    url,
    behaviorHints: {
      notWebReady: false
    }
  }));
}

app.get("/manifest.json", (_req, res) => {
  res.json(manifest);
});

app.get(
  "/catalog/movie/:catalogId/:extra?.json",
  async (req, res) => {
    if (req.params.catalogId !== CATALOG_ID) {
      return res.json({ metas: [] });
    }

    try {
      const pathExtra = String(req.params.extra || "");

      const pathSearch = pathExtra.startsWith("search=")
        ? decodeURIComponent(pathExtra.slice(7))
        : "";

      const search = String(
        req.query.search || pathSearch || ""
      ).trim().slice(0, 100);

      const metas = await getCatalog(search);

      res.json({ metas });
    } catch (error) {
      console.error("Catalog error:", error.message);

      res.status(502).json({
        metas: [],
        error: "Katalog se nepodařilo načíst."
      });
    }
  }
);

app.get("/meta/movie/:id.json", async (req, res) => {
  try {
    const meta = await getMeta(req.params.id);

    res.json({ meta: meta || null });
  } catch (error) {
    console.error("Metadata error:", error.message);

    res.status(502).json({
      meta: null,
      error: "Detail se nepodařilo načíst."
    });
  }
});

app.get("/stream/movie/:id.json", async (req, res) => {
  try {
    const streams = await getStreams(req.params.id);

    res.json({ streams });
  } catch (error) {
    console.error("Stream error:", error.message);

    res.status(502).json({
      streams: [],
      error: "Stream se nepodařilo načíst."
    });
  }
});

app.get("/", (_req, res) => {
  res.type("text").send(
    "Nuvio addon běží. Manifest: /manifest.json"
  );
});

app.listen(PORT, () => {
  console.log(`Nuvio addon běží na portu ${PORT}`);
});
