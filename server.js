
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();

const PORT = process.env.PORT || 7000;
const BASE_URL = "https://fullporn.to";

const DEFAULT_POSTER =
  "https://upload.wikimedia.org/wikipedia/commons/e/e1/Adult_content_icon.svg";

app.use(cors());
app.use(express.json());

const CATEGORIES = [
  { id: "latest", name: "Nejnovější", path: "/" },
  { id: "popular", name: "Populární", path: "/popular/" },
  { id: "top-rated", name: "Nejlépe hodnocené", path: "/top-rated/" },
  { id: "anal", name: "Anal", path: "/category/anal/" },
  { id: "milf", name: "MILF", path: "/category/milf/" },
  { id: "asian", name: "Asian", path: "/category/asian/" },
  { id: "amateur", name: "Amateur", path: "/category/amateur/" },
  { id: "latina", name: "Latina", path: "/category/latina/" },
  { id: "ebony", name: "Ebony", path: "/category/ebony/" },
  { id: "japanese", name: "Japanese", path: "/category/japanese/" },
  { id: "lesbian", name: "Lesbian", path: "/category/lesbian/" },
  { id: "vr", name: "VR", path: "/category/vr-porn/" }
];

const http = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml"
  },
  maxRedirects: 5
});

const manifest = {
  id: "org.fullporn.oci.v9",
  version: "9.0.0",
  name: "FullPorn.to",
  description: "FullPorn.to catalog addon",
  logo: DEFAULT_POSTER,
  resources: ["catalog", "meta"],
  types: ["movie"],
  idPrefixes: ["fp:"],
  catalogs: CATEGORIES.map(category => ({
    type: "movie",
    id: category.id,
    name: category.name,
    extra: [
      { name: "search", isRequired: false },
      { name: "skip", isRequired: false }
    ]
  })),
  behaviorHints: {
    adult: true
  }
};

function encodeId(path) {
  return Buffer.from(path).toString("base64url");
}

function decodeId(id) {
  try {
    const path = Buffer.from(id, "base64url").toString("utf8");

    if (!path.startsWith("/video/")) return null;
    if (path.includes("..")) return null;

    return path;
  } catch {
    return null;
  }
}

function absoluteUrl(url) {
  if (!url) return DEFAULT_POSTER;

  try {
    return new URL(url, BASE_URL).href;
  } catch {
    return DEFAULT_POSTER;
  }
}

function parseExtra(value) {
  const result = {};

  if (!value) return result;

  const params = new URLSearchParams(
    value.replace(/\.json$/, "")
  );

  for (const [key, val] of params.entries()) {
    result[key] = val;
  }

  return result;
}

async function fetchPage(url) {
  const response = await http.get(url);

  if (typeof response.data !== "string") {
    throw new Error("Server nevrátil HTML.");
  }

  return response.data;
}

function extractVideos(html) {
  const $ = cheerio.load(html);
  const videos = new Map();

  // Vyhledávání odkazů na jednotlivá videa.
  $('a[href*="/video/"]').each((_, element) => {
    const link = $(element);
    const href = link.attr("href");

    if (!href) return;

    let parsed;

    try {
      parsed = new URL(href, BASE_URL);
    } catch {
      return;
    }

    if (!parsed.pathname.startsWith("/video/")) return;

    const image = link.find("img").first();

    const title =
      link.attr("title") ||
      image.attr("alt") ||
      link.text().trim();

    if (!title) return;

    const poster =
      image.attr("data-src") ||
      image.attr("data-original") ||
      image.attr("src") ||
      "";

    const path = parsed.pathname;

    videos.set(path, {
      id: `fp:${encodeId(path)}`,
      type: "movie",
      name: title.replace(/\s+/g, " ").trim(),
      poster: absoluteUrl(poster),
      description: "Zdroj: FullPorn.to"
    });
  });

  return [...videos.values()];
}

app.get("/", (req, res) => {
  res.json({
    name: "FullPorn Nuvio Addon",
    version: "9.0.0",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime()
  });
});

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

app.get(
  ["/catalog/:type/:id.json", "/catalog/:type/:id/:extra.json"],
  async (req, res) => {
    const { type, id } = req.params;
    const extra = parseExtra(req.params.extra);

    if (type !== "movie") {
      return res.json({ metas: [] });
    }

    const category = CATEGORIES.find(c => c.id === id);

    if (!category) {
      return res.json({ metas: [] });
    }

    const skip = Math.max(0, parseInt(extra.skip || "0", 10) || 0);
    const page = Math.floor(skip / 20) + 1;

    let targetUrl;

    if (extra.search) {
      targetUrl =
        `${BASE_URL}/search/${encodeURIComponent(extra.search)}/`;
    } else {
      targetUrl = `${BASE_URL}${category.path}`;

      if (page > 1) {
        targetUrl += `page/${page}/`;
      }
    }

    try {
      console.log("[CATALOG]", targetUrl);

      const html = await fetchPage(targetUrl);
      const metas = extractVideos(html);

      console.log("[CATALOG] Nalezeno videí:", metas.length);

      return res.json({
        metas: metas.slice(0, 20)
      });

    } catch (error) {
      console.error("[CATALOG ERROR]", error.message);

      return res.status(502).json({
        metas: []
      });
    }
  }
);

app.get("/meta/:type/:id.json", (req, res) => {
  const id = req.params.id.replace(/^fp:/, "");
  const path = decodeId(id);

  if (!path) {
    return res.status(400).json({
      meta: null
    });
  }

  return res.json({
    meta: {
      id: `fp:${id}`,
      type: "movie",
      name: "FullPorn video",
      poster: DEFAULT_POSTER,
      background: DEFAULT_POSTER,
      description: `Zdroj: ${BASE_URL}${path}`
    }
  });
});

app.use((err, req, res, next) => {
  console.error("[SERVER ERROR]", err.message);

  res.status(500).json({
    error: "Internal server error"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("--------------------------------");
  console.log("FullPorn Nuvio Addon v9.0.0");
  console.log(`Port: ${PORT}`);
  console.log("--------------------------------");
});
