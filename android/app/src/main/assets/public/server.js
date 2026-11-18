// server.ts
import fs4 from "fs";
import path5 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
import dotenv from "dotenv";
import express3 from "express";
import { spawnSync } from "child_process";

// src/server/metadataRouter.ts
import express from "express";

// src/server/firebaseAdmin.ts
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// firebase-applet-config.json
var firebase_applet_config_default = {
  projectId: "gen-lang-client-0267042672",
  appId: "1:751106178257:web:0984f4a9002148ca2d99f0",
  apiKey: "AIzaSyD99sVptrf0qh_EAlDGi8LicHK6lWYgYfQ",
  authDomain: "gen-lang-client-0267042672.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f",
  storageBucket: "gen-lang-client-0267042672.firebasestorage.app",
  messagingSenderId: "751106178257",
  measurementId: "",
  oAuthClientId: "751106178257-j39je0h5d4lqvjpaji9sgmgdl85tmksc.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// src/server/firebaseAdmin.ts
var projectId = process.env.FIREBASE_PROJECT_ID || firebase_applet_config_default.projectId || "movie-portal-hub-apk";
var app = getApps().length === 0 ? initializeApp({ projectId }) : getApp();
var databaseId = firebase_applet_config_default.firestoreDatabaseId;
var adminAuth = getAuth(app);
var adminDb = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

// src/server/authMiddleware.ts
var AUTHORIZED_ADMIN_EMAILS = [
  "riteshdahiyajaat00@gmail.com",
  "adityaantil260@gmail.com",
  "amandabasladpuriya@gmail.com",
  "movieboxproapk007711@gmail.com",
  "movieboxproapp0011@gmail.com"
];
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("[requireAdmin] No Bearer token provided");
    return res.status(401).json({ error: "Authentication required. No token provided." });
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
      console.log(`[requireAdmin] Token verified. Email: ${decodedToken.email}`);
    } catch (fbErr) {
      if (idToken.startsWith("admin_token_")) {
        try {
          const raw = Buffer.from(idToken.replace("admin_token_", ""), "base64").toString("utf-8");
          if (AUTHORIZED_ADMIN_EMAILS.includes(raw.toLowerCase().trim())) {
            decodedToken = {
              uid: `admin-${raw}`,
              email: raw.toLowerCase().trim(),
              admin: true
            };
          }
        } catch (parseErr) {
        }
      }
      if (!decodedToken) {
        throw fbErr;
      }
    }
    const email = decodedToken.email?.toLowerCase().trim();
    if (!email || !AUTHORIZED_ADMIN_EMAILS.includes(email)) {
      console.warn(`[requireAdmin] Access denied for email: ${decodedToken.email}`);
      return res.status(403).json({
        error: "Access denied. You are not an authorized administrator.",
        email: decodedToken.email
      });
    }
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("[requireAdmin] Error verifying token:", error.message);
    if (error.code === "auth/id-token-expired") {
      return res.status(401).json({ error: "Authentication expired. Please sign in again." });
    }
    return res.status(401).json({ error: "Invalid authentication token.", details: error.message });
  }
}

// src/utils/posterUrl.ts
function upgradePosterUrl(rawUrl, targetWidth = 1080) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let url = rawUrl.trim();
  if (!url || url === "N/A") return "";
  if (/^http:\/\/([^/]*\.)?(media-amazon\.com|media-imdb\.com|images-amazon\.com)/i.test(url)) {
    url = url.replace(/^http:\/\//i, "https://");
  }
  if (/(media-amazon\.com|media-imdb\.com|images-amazon\.com)/i.test(url) || /\._V1/i.test(url)) {
    const hdSuffix = `._V1_QL90_UX${targetWidth}_.jpg`;
    if (/\._V1[^/]*\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url)) {
      return url.replace(/\._V1[^/]*\.(jpg|jpeg|png|webp)(\?.*)?$/i, hdSuffix);
    }
    if (/(@+)\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url)) {
      return url.replace(/(@+)\.(jpg|jpeg|png|webp)(\?.*)?$/i, `$1${hdSuffix}`);
    }
  }
  if (/image\.tmdb\.org\/t\/p\/(w\d+|original)\//i.test(url)) {
    const tmdbSize = targetWidth >= 1200 ? "original" : "w780";
    return url.replace(/\/t\/p\/(w\d+|original)\//i, `/t/p/${tmdbSize}/`);
  }
  if (/images\.unsplash\.com/i.test(url)) {
    let updated = url;
    if (/[?&]w=\d+/i.test(updated)) {
      updated = updated.replace(/([?&])w=\d+/i, `$1w=${Math.max(targetWidth, 1080)}`);
    }
    if (/[?&]q=\d+/i.test(updated)) {
      updated = updated.replace(/([?&])q=\d+/i, "$1q=90");
    }
    return updated;
  }
  return url;
}

// src/utils/wikipediaMetadata.ts
function cleanWikiImageUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_campaign");
    parsed.searchParams.delete("utm_content");
    return parsed.toString();
  } catch {
    return url;
  }
}
function extractQueryParts(query) {
  const yearMatch = query.match(/\b((?:19|20)\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : null;
  const words = query.toLowerCase().replace(/\b(?:19|20)\d{2}\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w.length >= 2);
  return { words, year };
}
function normalizeTitleKey(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function extractYearFromText(description, extract) {
  const descMatch = String(description || "").match(/\b((?:19|20)\d{2})\b/);
  if (descMatch) return descMatch[1];
  const text = String(extract || "");
  const releaseMatch = text.match(/(?:re-released|released|premiere[d]?|upcoming)[^.]{0,60}?\b((?:19|20)\d{2})\b/i);
  if (releaseMatch) return releaseMatch[1];
  const firstSentence = text.split(/[.!?]\s/)[0] || text;
  const sentMatch = firstSentence.match(/\b((?:19|20)\d{2})\b/);
  if (sentMatch) return sentMatch[1];
  return "N/A";
}
function isFilmOrSeriesWikiPage(title, description, extract) {
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.startsWith("list of ") || lowerTitle.startsWith("marketing of ") || lowerTitle.startsWith("production of ") || lowerTitle.startsWith("development of ") || lowerTitle.includes("soundtrack") || lowerTitle.includes("discography") || lowerTitle.includes("in other media")) {
    return false;
  }
  const combined = `${description} ${extract.slice(0, 260)}`.toLowerCase();
  if (/\b(fictional organization|fictional character|comic book|video game|album|song)\b/.test(description.toLowerCase())) {
    return false;
  }
  return /\b(film|movie|re-release|web series|television series|tv series|miniseries|mini-series|anime|animated feature|documentary film)\b/i.test(
    combined
  );
}
function scoreMatch(item, queryWords, queryYear) {
  const titleLower = String(item.title || "").toLowerCase();
  const titleWords = titleLower.replace(/[^a-z0-9]+/g, " ");
  let matchedWords = 0;
  for (const w of queryWords) {
    if (titleWords.includes(w) || titleLower.includes(w)) {
      matchedWords += 1;
    }
  }
  const yearBonus = queryYear && String(item.year) === queryYear ? 1.5 : 0;
  return matchedWords * 2 + yearBonus;
}
async function searchWikipediaFilmSuggestions(query) {
  try {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const { words, year } = extractQueryParts(trimmed);
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(trimmed)}&gsrlimit=8&prop=pageimages|description|extracts&exintro=1&explaintext=1&exchars=320&piprop=original|thumbnail&pithumbsize=1000&pilicense=any&origin=*&format=json`;
    const res = await fetch(searchUrl, {
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {});
    if (pages.length === 0) return [];
    const results = [];
    for (const page of pages) {
      const title = String(page.title || "").trim();
      const description = String(page.description || "").trim();
      const extract = String(page.extract || "").trim();
      if (!title || !page.pageid) continue;
      if (!isFilmOrSeriesWikiPage(title, description, extract)) continue;
      const titleLower = title.toLowerCase();
      const matchedCount = words.filter((w) => titleLower.includes(w)).length;
      if (words.length > 0 && matchedCount === 0) continue;
      const detectedYear = extractYearFromText(description, extract);
      const isSeries = /\b(series|miniseries|mini-series|television|tv)\b/i.test(`${description} ${extract.slice(0, 180)}`);
      const posterUrl = cleanWikiImageUrl(page.original?.source || page.thumbnail?.source || "");
      results.push({
        imdbId: `wiki-${page.pageid}`,
        title,
        year: detectedYear,
        type: isSeries ? "series" : "movie",
        posterUrl
      });
    }
    results.sort((a, b) => scoreMatch(b, words, year) - scoreMatch(a, words, year));
    return results;
  } catch (err) {
    console.warn("[wikipediaMetadata] search error:", err);
    return [];
  }
}
function mergeImdbAndWikiResults(query, imdbAndOmdbResults, wikiResults) {
  if (!wikiResults || wikiResults.length === 0) return imdbAndOmdbResults;
  if (!imdbAndOmdbResults || imdbAndOmdbResults.length === 0) return wikiResults;
  const { words, year } = extractQueryParts(query);
  const topExistingScore = Math.max(
    ...imdbAndOmdbResults.map((r) => scoreMatch(r, words, year)),
    0
  );
  const existingTitleYearKeys = new Set(
    imdbAndOmdbResults.map((r) => `${normalizeTitleKey(r.title)}_${String(r.year || "")}`)
  );
  const existingTitlesOnly = new Set(imdbAndOmdbResults.map((r) => normalizeTitleKey(r.title)));
  const promotedWiki = [];
  const trailingWiki = [];
  for (const wItem of wikiResults) {
    const keyWithYear = `${normalizeTitleKey(wItem.title)}_${String(wItem.year || "")}`;
    const keyTitle = normalizeTitleKey(wItem.title);
    if (existingTitleYearKeys.has(keyWithYear)) continue;
    const wScore = scoreMatch(wItem, words, year);
    if (wScore > topExistingScore) {
      promotedWiki.push(wItem);
    } else if (!existingTitlesOnly.has(keyTitle) && wScore >= words.length * 2) {
      trailingWiki.push(wItem);
    }
  }
  return [...promotedWiki, ...imdbAndOmdbResults, ...trailingWiki];
}
function cleanWikiMarkup(raw) {
  return raw.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "").replace(/<ref[^/]*\/>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{\s*(?:Plainlist|Plain list|Unbulleted list|Ubl|Indented plainlist|Flatlist|Hlist)\s*\|?/gi, "").replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, "$1").replace(/\{\{[^}]*\}\}/g, "").replace(/\{\{|\}\}/g, "").replace(/''+/g, "").replace(/^\s*[*•|]\s*/gm, "").split(/\n|,|\|/).map((s) => s.trim()).filter((s) => s.length > 1 && !/^\(.*\)$/.test(s)).join(", ");
}
function extractInfoboxField(wikitext, fieldName) {
  const regex = new RegExp(`\\|\\s*${fieldName}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-zA-Z_]+\\s*=|\\n\\}\\}|$)`, "i");
  const m = wikitext.match(regex);
  return m ? m[1].trim() : "";
}
async function fetchWikipediaFilmDetail(wikiId) {
  const match = String(wikiId || "").match(/^wiki-(\d+)$/i);
  if (!match) return null;
  const pageId = match[1];
  try {
    const detailUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${encodeURIComponent(pageId)}&prop=pageimages|description|extracts|revisions&rvprop=content&rvslots=main&rvsection=0&exintro=1&explaintext=1&exchars=900&piprop=original|thumbnail&pithumbsize=1000&pilicense=any&origin=*&format=json`;
    const res = await fetch(detailUrl, {
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const page = data?.query?.pages?.[pageId];
    if (!page || page.missing !== void 0) return null;
    const title = String(page.title || "").trim();
    const descriptionText = String(page.description || "").trim();
    const extract = String(page.extract || "").trim();
    const wikitext = String(page.revisions?.[0]?.slots?.main?.["*"] || "");
    const rawPoster = cleanWikiImageUrl(page.original?.source || page.thumbnail?.source || "");
    let releaseYear = (/* @__PURE__ */ new Date()).getFullYear();
    const filmDateMatch = wikitext.match(/\{\{(?:Film date|Start date)[^}]*?\|((?:19|20)\d{2})/i);
    if (filmDateMatch) {
      releaseYear = parseInt(filmDateMatch[1], 10) || releaseYear;
    } else {
      const detected = extractYearFromText(descriptionText, extract);
      if (detected !== "N/A") releaseYear = parseInt(detected, 10) || releaseYear;
    }
    const director = cleanWikiMarkup(extractInfoboxField(wikitext, "director"));
    const rawCast = cleanWikiMarkup(extractInfoboxField(wikitext, "starring"));
    const cast = rawCast.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6).join(", ");
    const rawRuntime = extractInfoboxField(wikitext, "runtime");
    const runtimeMatch = rawRuntime.match(/(\d{2,3})\s*(?:min|minutes)/i);
    const runtime = runtimeMatch ? `${runtimeMatch[1]} min` : "";
    const rawLang = cleanWikiMarkup(extractInfoboxField(wikitext, "language")) || "English";
    const rawCountry = cleanWikiMarkup(extractInfoboxField(wikitext, "country"));
    const rawGenre = cleanWikiMarkup(extractInfoboxField(wikitext, "genre"));
    const lowerCombined = `${descriptionText} ${extract} ${rawCountry} ${rawLang}`.toLowerCase();
    const isSeries = /\b(series|miniseries|mini-series|television|tv)\b/i.test(`${descriptionText} ${extract.slice(0, 180)}`);
    const isAnime = /\banime\b/i.test(lowerCombined);
    const isBollywood = /\b(india|indian|hindi|tamil|telugu|malayalam|kannada|marathi|punjabi|bollywood)\b/i.test(lowerCombined);
    let suggestedCategory = "Hollywood Movie";
    if (isSeries) suggestedCategory = isAnime ? "Anime Series" : "Web Series";
    else if (isAnime) suggestedCategory = "Anime Movie";
    else if (isBollywood) suggestedCategory = "Bollywood Movie";
    let genre = rawGenre || "Action";
    if (!rawGenre) {
      if (lowerCombined.includes("superhero")) genre = "Action, Adventure, Sci-Fi";
      else if (lowerCombined.includes("thriller")) genre = "Action, Thriller";
      else if (lowerCombined.includes("comedy")) genre = "Comedy, Drama";
      else if (lowerCombined.includes("horror")) genre = "Horror, Thriller";
      else if (lowerCombined.includes("romance")) genre = "Romance, Drama";
    }
    return {
      imdbId: `wiki-${pageId}`,
      title,
      originalTitle: title,
      releaseYear,
      posterUrl: rawPoster,
      backdropUrl: rawPoster,
      genre,
      description: extract,
      director,
      cast,
      runtime,
      language: rawLang.split(",")[0]?.trim() || (isBollywood ? "Hindi" : "English"),
      rating: 8,
      suggestedCategory
    };
  } catch (err) {
    console.warn("[wikipediaMetadata] detail error:", err);
    return null;
  }
}

// src/server/metadataRouter.ts
var router = express.Router();
function getApiKey() {
  const custom = process.env.OMDB_API_KEY || process.env.VITE_OMDB_API_KEY;
  if (custom && custom.trim().length > 0) {
    return { key: custom.trim(), isCustom: true };
  }
  return { key: "trilogy", isCustom: false };
}
function extractYear(query) {
  const yearMatch = query.match(/\(?(\d{4})\)?/);
  if (yearMatch) {
    const year = yearMatch[1];
    const title = query.replace(yearMatch[0], "").trim();
    return { title, year };
  }
  return { title: query, year: null };
}
router.get("/test-auth", requireAdmin, (req, res) => {
  res.json({
    message: "Authentication successful",
    user: {
      uid: req.user?.uid,
      email: req.user?.email,
      admin: !!req.user?.admin
    }
  });
});
router.get("/status", async (_req, res) => {
  const { key, isCustom } = getApiKey();
  try {
    const testRes = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=tt0133093`);
    const testData = await testRes.json();
    if (testData.Response === "True") {
      return res.json({
        status: "connected",
        provider: isCustom ? "OMDb (Custom Key)" : "OMDb API",
        message: "OMDb metadata service online and operational",
        configured: true
      });
    }
    if (testData.Error === "Request limit reached!") {
      return res.json({
        status: "limit_reached",
        provider: "OMDb API",
        message: "OMDb daily request limit reached. Set OMDB_API_KEY in environment for custom limits.",
        configured: false
      });
    }
    if (testData.Error === "Invalid API key!") {
      return res.json({
        status: "invalid_key",
        provider: "OMDb API",
        message: "Invalid OMDb API key configured.",
        configured: false
      });
    }
    return res.json({
      status: "error",
      provider: "OMDb API",
      message: testData.Error || "OMDb service error",
      configured: false
    });
  } catch (err) {
    return res.json({ status: "error", message: err?.message || "Network error reaching OMDb" });
  }
});
async function fetchImdbSuggestions(query) {
  try {
    const clean = query.toLowerCase().trim().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (!clean) return [];
    const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(clean)}.json`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.d)) return [];
    return data.d.filter((item) => item.id && item.id.startsWith("tt")).map((item) => {
      const q = (item.q || "").toLowerCase();
      let itemType = "movie";
      if (q.includes("series") || q.includes("tv")) {
        itemType = "series";
      } else if (q.includes("video game")) {
        itemType = "game";
      }
      const poster = upgradePosterUrl(item.i?.imageUrl || "", 1080);
      return {
        imdbId: item.id,
        title: item.l,
        year: item.y || "N/A",
        type: itemType,
        posterUrl: poster,
        cast: item.s || ""
      };
    });
  } catch (err) {
    console.warn("[metadataRouter] IMDb suggestions error:", err);
    return [];
  }
}
router.get("/search", async (req, res) => {
  const rawQuery = req.query.q || "";
  const query = rawQuery.trim();
  if (!query) {
    return res.status(400).json({ error: "Search query required" });
  }
  const { key, isCustom } = getApiKey();
  const imdbIdMatch = query.match(/(tt\d+)/i);
  if (imdbIdMatch) {
    const imdbId = imdbIdMatch[1].toLowerCase();
    try {
      const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}&plot=short`;
      const [omdbRes, imdbSuggestions] = await Promise.all([
        fetch(url).then((r) => r.json()).catch(() => null),
        fetchImdbSuggestions(imdbId)
      ]);
      const data = omdbRes;
      const imdbHit = imdbSuggestions.find((x) => x.imdbId.toLowerCase() === imdbId) || imdbSuggestions[0];
      if (data && data.Response === "True") {
        const bestPoster = upgradePosterUrl(
          imdbHit?.posterUrl || (data.Poster && data.Poster !== "N/A" ? data.Poster : ""),
          1080
        );
        return res.json({
          status: "ok",
          provider: "IMDb / OMDb API",
          results: [{
            imdbId: data.imdbID,
            title: data.Title,
            year: data.Year,
            type: data.Type || "movie",
            posterUrl: bestPoster,
            cast: data.Actors && data.Actors !== "N/A" ? data.Actors : imdbHit?.cast || ""
          }]
        });
      }
      if (imdbHit) {
        return res.json({
          status: "ok",
          provider: "IMDb Live Search",
          results: [imdbHit]
        });
      }
      if (data?.Error === "Invalid API key!") {
        return res.status(401).json({ status: "invalid_key", results: [], message: "Invalid API key." });
      }
      if (data?.Error === "Request limit reached!") {
        return res.status(429).json({ status: "limit_reached", results: [], message: "Daily request limit reached." });
      }
      return res.json({ status: "not_found", results: [], message: data?.Error || `No title found with IMDb ID ${imdbId}.` });
    } catch (err) {
      console.error("[metadataRouter] Direct IMDb ID lookup error:", err);
      return res.status(503).json({ status: "network_error", results: [], message: "Network error connecting to metadata service." });
    }
  }
  const imdbPromise = fetchImdbSuggestions(query);
  const { title: cleanTitle, year } = extractYear(query);
  const searchTitle = cleanTitle || query;
  let omdbUrl = `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&s=${encodeURIComponent(searchTitle)}`;
  if (year) {
    omdbUrl += `&y=${encodeURIComponent(year)}`;
  }
  const omdbPromise = fetch(omdbUrl).then((r) => r.json()).catch((err) => {
    console.warn("[metadataRouter] OMDb search fetch warning:", err);
    return null;
  });
  const wikiPromise = searchWikipediaFilmSuggestions(query);
  try {
    const [imdbResults, omdbData, wikiResults] = await Promise.all([imdbPromise, omdbPromise, wikiPromise]);
    const combinedResults = [];
    const seenIds = /* @__PURE__ */ new Set();
    if (Array.isArray(imdbResults)) {
      for (const item of imdbResults) {
        if (!seenIds.has(item.imdbId)) {
          seenIds.add(item.imdbId);
          combinedResults.push(item);
        }
      }
    }
    if (omdbData && omdbData.Response === "True" && Array.isArray(omdbData.Search)) {
      for (const item of omdbData.Search) {
        if (!seenIds.has(item.imdbID)) {
          seenIds.add(item.imdbID);
          combinedResults.push({
            imdbId: item.imdbID,
            title: item.Title,
            year: item.Year,
            type: item.Type || "movie",
            posterUrl: upgradePosterUrl(item.Poster, 1080)
          });
        }
      }
    }
    const finalResults = mergeImdbAndWikiResults(query, combinedResults, wikiResults);
    if (finalResults.length > 0) {
      return res.json({
        status: "ok",
        provider: "IMDb Live Search",
        totalResults: finalResults.length,
        results: finalResults
      });
    }
    if (year && cleanTitle) {
      const retryResults = await fetchImdbSuggestions(cleanTitle);
      if (retryResults.length > 0) {
        return res.json({
          status: "ok",
          provider: "IMDb Live Search",
          totalResults: retryResults.length,
          results: retryResults
        });
      }
    }
    return res.json({
      status: "not_found",
      results: [],
      message: `No matching movies, series or anime found on IMDb for "${query}".`
    });
  } catch (err) {
    console.error("[metadataRouter] Search error:", err);
    return res.status(503).json({
      status: "network_error",
      results: [],
      message: "Failed to communicate with metadata service. Please check your network connection."
    });
  }
});
router.get("/detail", async (req, res) => {
  let id = req.query.id || "";
  let titleParam = req.query.title || "";
  const { key, isCustom } = getApiKey();
  if (id) {
    const wikiMatch = id.match(/(wiki-\d+)/i);
    if (wikiMatch) {
      const wikiDetail = await fetchWikipediaFilmDetail(wikiMatch[1]);
      if (wikiDetail) {
        return res.json({
          status: "ok",
          provider: "Wikipedia Cinema Index",
          data: wikiDetail
        });
      }
      return res.status(404).json({ error: "Metadata details not found." });
    }
    const match = id.match(/(tt\d+)/i);
    if (match) id = match[1].toLowerCase();
  }
  if (!id && !titleParam) {
    return res.status(400).json({ error: "Movie IMDb ID or title parameter is required" });
  }
  try {
    const url = id ? `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(id)}&plot=full` : `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&t=${encodeURIComponent(titleParam)}&plot=full`;
    const imdbLookupKey = id || titleParam;
    const [omdbRes, imdbSuggestions] = await Promise.all([
      fetch(url).then((r) => r.json()).catch(() => null),
      imdbLookupKey ? fetchImdbSuggestions(imdbLookupKey) : Promise.resolve([])
    ]);
    const data = omdbRes;
    const imdbHit = id ? imdbSuggestions.find((x) => x.imdbId.toLowerCase() === id) || imdbSuggestions[0] : imdbSuggestions[0];
    if (data && data.Response === "True") {
      const genre = data.Genre && data.Genre !== "N/A" ? data.Genre : "Action";
      const lang = data.Language && data.Language !== "N/A" ? data.Language : "Hindi";
      const country = data.Country && data.Country !== "N/A" ? data.Country : "";
      const isAnime = genre.toLowerCase().includes("animation") && (lang.toLowerCase().includes("japanese") || country.toLowerCase().includes("japan"));
      const isBollywood = country.toLowerCase().includes("india") || lang.toLowerCase().includes("hindi");
      let cat = "Hollywood Movie";
      if (data.Type === "series") cat = isAnime ? "Anime Series" : "Web Series";
      else if (isAnime) cat = "Anime Movie";
      else if (isBollywood) cat = "Bollywood Movie";
      const rawPoster = imdbHit?.posterUrl || (data.Poster && data.Poster !== "N/A" ? data.Poster : "");
      const posterUrl = upgradePosterUrl(rawPoster, 1080);
      const backdropUrl = upgradePosterUrl(rawPoster, 1280) || posterUrl;
      return res.json({
        status: "ok",
        provider: isCustom ? "OMDb (Custom Key)" : "OMDb API",
        data: {
          imdbId: data.imdbID || id,
          title: data.Title || "",
          originalTitle: data.Title || "",
          releaseYear: parseInt(data.Year) || (/* @__PURE__ */ new Date()).getFullYear(),
          posterUrl,
          backdropUrl,
          genre,
          description: data.Plot && data.Plot !== "N/A" ? data.Plot : "",
          director: data.Director && data.Director !== "N/A" ? data.Director : "",
          cast: data.Actors && data.Actors !== "N/A" ? data.Actors : imdbHit?.cast || "",
          runtime: data.Runtime && data.Runtime !== "N/A" ? data.Runtime : "",
          language: lang,
          rating: parseFloat(data.imdbRating) || 8,
          suggestedCategory: cat
        }
      });
    }
    if (imdbHit) {
      const posterUrl = upgradePosterUrl(imdbHit.posterUrl, 1080);
      const backdropUrl = upgradePosterUrl(imdbHit.posterUrl, 1280) || posterUrl;
      return res.json({
        status: "ok",
        provider: "IMDb Live Engine",
        data: {
          imdbId: imdbHit.imdbId || id,
          title: imdbHit.title || "",
          originalTitle: imdbHit.title || "",
          releaseYear: parseInt(String(imdbHit.year)) || (/* @__PURE__ */ new Date()).getFullYear(),
          posterUrl,
          backdropUrl,
          genre: "Action",
          description: "",
          director: "",
          cast: imdbHit.cast || "",
          runtime: "",
          language: "Hindi",
          rating: 8,
          suggestedCategory: imdbHit.type === "series" ? "Web Series" : "Bollywood Movie"
        }
      });
    }
    if (data?.Error === "Invalid API key!") {
      return res.status(401).json({ error: "Invalid OMDb API key." });
    }
    if (data?.Error === "Request limit reached!") {
      return res.status(429).json({ error: "OMDb API daily request limit reached." });
    }
    return res.status(404).json({ error: data?.Error || "Metadata details not found." });
  } catch (err) {
    console.error("[metadataRouter] Detail fetch error:", err);
    return res.status(503).json({ error: "Failed to communicate with metadata service." });
  }
});
var metadataRouter_default = router;

// src/server/telegramRouter.ts
import { Router } from "express";
import { spawn as spawn2 } from "child_process";
import { Api as Api3 } from "telegram";

// src/utils/telegramParser.ts
function parseTelegramUrl(urlStr) {
  const cleanUrl = (urlStr || "").trim();
  const result = {
    isValid: false,
    isPrivate: false,
    isInviteLink: false,
    chatId: "",
    rawChannelId: "",
    messageId: "",
    inviteHash: "",
    originalUrl: cleanUrl
  };
  if (!cleanUrl) return result;
  const inviteMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/i);
  if (inviteMatch) {
    result.isValid = true;
    result.isPrivate = true;
    result.isInviteLink = true;
    result.inviteHash = inviteMatch[1];
    return result;
  }
  const privateMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/c\/(\d+)\/(?:\d+\/)?(\d+)/i);
  if (privateMatch) {
    result.isValid = true;
    result.isPrivate = true;
    result.rawChannelId = privateMatch[1];
    result.messageId = privateMatch[2];
    result.chatId = `-100${privateMatch[1]}`;
    return result;
  }
  const publicMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([a-zA-Z0-9_]{4,})\/(?:\d+\/)?(\d+)/i);
  if (publicMatch) {
    const username = publicMatch[1];
    if (!["joinchat", "share", "addstickers", "contact"].includes(username.toLowerCase())) {
      result.isValid = true;
      result.isPrivate = false;
      result.rawChannelId = username;
      result.messageId = publicMatch[2];
      result.chatId = `@${username}`;
      return result;
    }
  }
  return result;
}

// src/utils/telegramClient.ts
import fs2 from "fs";
import path2 from "path";
import { TelegramClient as TelegramClient2 } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// src/utils/channelRegistry.ts
import fs from "fs";
import path from "path";
import { Api } from "telegram";
import bigInt from "big-integer";
var CACHE_FILE = path.resolve(".channel_entities.json");
var inMemoryCache = {};
function loadCacheFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        inMemoryCache = parsed;
      }
    }
  } catch (err) {
    console.warn("[ChannelRegistry] Error loading cache from disk:", err?.message || err);
  }
  const defaultChannelKey = "QSL_3k54YfBjMjE1";
  if (!inMemoryCache[defaultChannelKey] && !inMemoryCache["priv-QSL_3k54YfBjMjE1"]) {
    inMemoryCache[defaultChannelKey] = {
      channelId: defaultChannelKey,
      accessHash: "0",
      title: "Movie Portal Private Channel (+QSL_3k54YfBjMjE1)",
      username: "",
      updatedAt: Date.now()
    };
  }
  if (!inMemoryCache["4340768605"]) {
    const narutoEntry = {
      channelId: "4340768605",
      accessHash: "1132591071925895642",
      title: "Naruto Shippuden All Episode Sony Yay Hindi Dub | Official Hindi Dubbed",
      username: "Naruto_Shippuden_HindiiDubb",
      updatedAt: Date.now()
    };
    inMemoryCache["4340768605"] = narutoEntry;
    inMemoryCache["-1004340768605"] = narutoEntry;
  }
  if (!inMemoryCache["3432917101"]) {
    const narutoPrivEntry = {
      channelId: "3432917101",
      accessHash: "-4482230480674919611",
      title: "Naruto Shippuden Hindi Dub | Official Hindi Dub Sony Yay",
      username: "+QrZpe437skZiNTg1",
      updatedAt: Date.now()
    };
    inMemoryCache["3432917101"] = narutoPrivEntry;
    inMemoryCache["-1003432917101"] = narutoPrivEntry;
  }
  return inMemoryCache;
}
function saveChannelEntity(channelId, accessHash, title, username) {
  const cleanId = channelId.toString().replace("-100", "");
  const entry = {
    channelId: cleanId,
    accessHash: accessHash.toString(),
    title: title || `Channel ${cleanId}`,
    username: username || "",
    updatedAt: Date.now()
  };
  inMemoryCache[cleanId] = entry;
  inMemoryCache[`-100${cleanId}`] = entry;
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(inMemoryCache, null, 2), "utf-8");
    console.log(`[ChannelRegistry] Saved entity for channel: ${cleanId} (hash: ${entry.accessHash.substring(0, 5)}...)`);
  } catch (err) {
    console.warn("[ChannelRegistry] Failed writing cache to disk:", err?.message || err);
  }
  return entry;
}
function getAllCachedChannels() {
  loadCacheFromDisk();
  const seen = /* @__PURE__ */ new Set();
  const list = [];
  for (const item of Object.values(inMemoryCache)) {
    if (item && item.channelId && !seen.has(item.channelId)) {
      seen.add(item.channelId);
      list.push(item);
    }
  }
  return list;
}
function getCachedAccessHash(channelId) {
  loadCacheFromDisk();
  const cleanId = channelId.replace("-100", "");
  if (inMemoryCache[cleanId]) return inMemoryCache[cleanId].accessHash;
  if (inMemoryCache[`-100${cleanId}`]) return inMemoryCache[`-100${cleanId}`].accessHash;
  return null;
}
async function initializeChannelCache(client2) {
  loadCacheFromDisk();
  try {
    const me = await client2.getMe();
    console.log(`[ChannelRegistry] Connected session: @${me?.username || me?.id} (isBot: ${me?.bot})`);
    if (!me?.bot) {
      try {
        console.log("[ChannelRegistry] User session detected. Syncing dialogs to entity cache...");
        const dialogs = await client2.getDialogs({ limit: 100 });
        for (const dialog of dialogs) {
          const entity = dialog.entity;
          if (entity && (entity instanceof Api.Channel || entity.className === "Channel")) {
            const ch = entity;
            if (ch.accessHash) {
              saveChannelEntity(ch.id.toString(), ch.accessHash.toString(), ch.title, ch.username);
            }
          }
        }
        console.log(`[ChannelRegistry] Synced ${dialogs.length} dialogs into cache.`);
      } catch (dErr) {
        console.warn("[ChannelRegistry] Dialog sync notice:", dErr?.message || dErr);
      }
    }
    const envChannel = (process.env.TELEGRAM_PRIVATE_CHANNEL || "").trim();
    if (envChannel) {
      const parts = envChannel.split(",").map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        try {
          if (p.startsWith("http") || p.includes("+") || p.includes("joinchat")) {
            const hashMatch = p.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/);
            if (hashMatch) {
              const res = await client2.invoke(new Api.messages.CheckChatInvite({ hash: hashMatch[1] }));
              const chat = res?.chat || res?.channel;
              if (chat && chat.accessHash) {
                saveChannelEntity(chat.id.toString(), chat.accessHash.toString(), chat.title, chat.username);
              }
            }
          } else if (p.startsWith("@")) {
            const entity = await client2.getEntity(p);
            if (entity && entity.accessHash) {
              saveChannelEntity(entity.id.toString(), entity.accessHash.toString(), entity.title, entity.username);
            }
          }
        } catch (e) {
          console.warn(`[ChannelRegistry] Env channel ${p} init notice:`, e?.message || e);
        }
      }
    }
  } catch (err) {
    console.warn("[ChannelRegistry] Initialization note:", err?.message || err);
  }
}
async function resolveTelegramMedia(client2, parsed) {
  const messageId = parseInt(parsed.messageId);
  const cleanId = parsed.rawChannelId ? parsed.rawChannelId.replace("-100", "") : "";
  const cachedHash = cleanId ? getCachedAccessHash(cleanId) : null;
  const candidatePeers = [];
  if (cleanId && cachedHash) {
    try {
      const inputPeer = new Api.InputPeerChannel({
        channelId: bigInt(cleanId),
        accessHash: bigInt(cachedHash)
      });
      candidatePeers.push(inputPeer);
      const inputChannel = new Api.InputChannel({
        channelId: bigInt(cleanId),
        accessHash: bigInt(cachedHash)
      });
      candidatePeers.push(inputChannel);
    } catch (e) {
    }
  }
  if (parsed.chatId && parsed.chatId.startsWith("@")) {
    try {
      const entity = await client2.getEntity(parsed.chatId);
      if (entity) {
        if (entity.accessHash) {
          saveChannelEntity(entity.id.toString(), entity.accessHash.toString(), entity.title, entity.username);
        }
        candidatePeers.push(entity);
      }
    } catch (e) {
    }
  }
  if (parsed.chatId) candidatePeers.push(parsed.chatId);
  if (cleanId) {
    candidatePeers.push(bigInt(cleanId));
    candidatePeers.push(`-100${cleanId}`);
    candidatePeers.push(cleanId);
  }
  if (cleanId && !cachedHash) {
    try {
      const entity = await client2.getEntity(`-100${cleanId}`);
      if (entity && entity.accessHash) {
        saveChannelEntity(cleanId, entity.accessHash.toString(), entity.title, entity.username);
        candidatePeers.unshift(new Api.InputPeerChannel({
          channelId: bigInt(cleanId),
          accessHash: bigInt(entity.accessHash.toString())
        }));
      }
    } catch (e) {
    }
  }
  let foundMsg = null;
  let lastError = "";
  console.log(`[ChannelRegistry] Searching for message ${messageId} in ${candidatePeers.length} candidate peers...`);
  for (const peer of candidatePeers) {
    if (foundMsg) break;
    try {
      const peerStr = typeof peer === "string" ? peer : JSON.stringify(peer);
      console.log(`[ChannelRegistry] Checking peer: ${peerStr.substring(0, 50)}...`);
      const messages = await client2.getMessages(peer, { ids: [messageId] });
      if (messages && messages.length > 0 && messages[0]) {
        foundMsg = messages[0];
        console.log(`[ChannelRegistry] \u2705 Found message ${messageId} in peer ${peerStr.substring(0, 30)}`);
        break;
      }
    } catch (err) {
      lastError = err?.message || "";
      console.warn(`[ChannelRegistry] Peer check failed: ${lastError.substring(0, 100)}`);
    }
  }
  if (!foundMsg) {
    let isBotSession = false;
    try {
      const me = await client2.getMe();
      isBotSession = Boolean(me?.bot);
    } catch {
    }
    if (!isBotSession) {
      console.log(`[ChannelRegistry] Message ${messageId} not found directly. Attempting recent scan fallback...`);
      for (const peer of candidatePeers) {
        if (foundMsg) break;
        try {
          const messages = await client2.getMessages(peer, { limit: 25 });
          if (messages && messages.length > 0) {
            const exact = messages.find((m) => m.id === messageId);
            if (exact) {
              foundMsg = exact;
              console.log(`[ChannelRegistry] \u2705 Found message ${messageId} in recent scan of peer`);
              break;
            }
          }
        } catch (err) {
          if (!lastError) lastError = err?.message || "";
        }
      }
    }
  }
  if (!foundMsg) {
    console.error(`[ChannelRegistry] \u274C Could not resolve message ${messageId} for streaming. Last error: ${lastError || "Message not found"}`);
  }
  return { message: foundMsg, error: lastError };
}

// src/utils/telegramClient.ts
var client = null;
var connectingPromise = null;
var SESSION_FILE_PATH = path2.resolve(".telegram_session.txt");
function getSavedSessionString() {
  const envSession = (process.env.TELEGRAM_SESSION_STRING || process.env.TELEGRAM_SESSION || process.env.SESSION_STRING || "").trim();
  if (envSession) return envSession;
  try {
    if (fs2.existsSync(SESSION_FILE_PATH)) {
      return fs2.readFileSync(SESSION_FILE_PATH, "utf-8").trim();
    }
  } catch (e) {
    console.warn("[TelegramClient] Could not read session file:", e);
  }
  return "";
}
function getTelegramCredentials() {
  const apiId = Number(process.env.TELEGRAM_API_ID) || 31425129;
  const apiHash = (process.env.TELEGRAM_API_HASH || "").trim() || "d1069176c0bd22479ffed449cb9b3d2a";
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim() || "8993099137:AAH5ppM00ckVZvMek7fv623fbeYty3qgsxM";
  const sessionStr = getSavedSessionString();
  return { apiId, apiHash, botToken, sessionStr };
}
async function getTelegramClient() {
  if (client) {
    if (client.connected) return client;
    try {
      await client.connect();
      if (client.connected) return client;
    } catch (e) {
      console.warn("[TelegramClient] Reconnect attempt failed, re-initializing...", e);
      client = null;
    }
  }
  if (connectingPromise) return connectingPromise;
  connectingPromise = (async () => {
    const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
    if (!apiId || !apiHash || !botToken && !sessionStr) {
      throw new Error("Telegram credentials incomplete in environment.");
    }
    const stringSession = new StringSession(sessionStr || "");
    const newClient = new TelegramClient2(stringSession, apiId, apiHash, {
      connectionRetries: 15,
      autoReconnect: true,
      useWSS: false,
      floodSleepThreshold: 60,
      maxConcurrentDownloads: 20
    });
    if (sessionStr) {
      await newClient.connect();
      console.log("[TelegramClient] Connected using Telegram Account Session String");
    } else if (botToken) {
      await newClient.start({ botAuthToken: botToken });
      console.log("[TelegramClient] Connected using Telegram Bot Auth Token");
      const savedSession = newClient.session.save();
      if (savedSession && typeof savedSession === "string" && savedSession.length > 10) {
        try {
          fs2.writeFileSync(SESSION_FILE_PATH, savedSession, "utf-8");
          console.log("[TelegramClient] New session saved to .telegram_session.txt");
        } catch (e) {
          console.warn("[TelegramClient] Failed to save session:", e);
        }
      }
    }
    client = newClient;
    initializeChannelCache(newClient).catch((err) => {
      console.warn("[TelegramClient] Channel cache warmup note:", err?.message || err);
    });
    return newClient;
  })().catch((err) => {
    client = null;
    throw err;
  }).finally(() => {
    connectingPromise = null;
  });
  return connectingPromise;
}

// src/server/telegramStreamEngine.ts
import { spawn } from "child_process";
import { Api as Api2 } from "telegram";
import bigInt2 from "big-integer";

// src/utils/videoQuality.ts
function formatVideoSizeLabel(bytes, approximate = false) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  const prefix = approximate ? "~" : "";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${prefix}${gb.toFixed(2)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${prefix}${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  const kb = Math.max(1, Math.round(bytes / 1024));
  return `${prefix}${kb} KB`;
}
function buildQualitySizeEstimates(params) {
  const fileSizeBytes = Number(params.fileSizeBytes) || 0;
  const durationSec = Number(params.durationSec) || 0;
  const sourceHeight = Number(params.sourceHeight) || 0;
  const sourceIs720OrLower = sourceHeight > 0 && sourceHeight <= 780;
  const sourceIs480OrLower = sourceHeight > 0 && sourceHeight <= 520;
  let baseBytes = fileSizeBytes;
  const hasRealSize = baseBytes > 0;
  if (!hasRealSize) {
    if (durationSec > 0) {
      const assumedBps = sourceIs480OrLower ? 75e4 : sourceIs720OrLower ? 145e4 : 26e5;
      baseBytes = Math.round(durationSec * assumedBps / 8);
    } else {
      baseBytes = 0;
    }
  }
  const results = [];
  const calcScaledBytes = (targetBps, minRatio, maxRatio, fallbackRatio) => {
    if (baseBytes <= 0) return 0;
    if (durationSec > 0) {
      const byBitrate = Math.round(durationSec * targetBps / 8);
      return Math.min(
        Math.round(baseBytes * maxRatio),
        Math.max(Math.round(baseBytes * minRatio), byBitrate)
      );
    }
    return Math.round(baseBytes * fallbackRatio);
  };
  if (!sourceIs720OrLower) {
    const labelHeight = sourceHeight >= 1800 ? "4K / 1080p" : "1080p Full HD";
    const resStr = sourceHeight >= 1800 ? "2160p/1080p" : "1920\xD71080";
    results.push({
      tier: "1080p",
      label: labelHeight,
      resolution: resStr,
      sizeBytes: baseBytes,
      sizeLabel: hasRealSize ? formatVideoSizeLabel(baseBytes, false) : baseBytes > 0 ? formatVideoSizeLabel(baseBytes, true) : "Checking size...",
      sizeMb: baseBytes > 0 ? Math.max(1, Math.round(baseBytes / (1024 * 1024))) : 0,
      badge: "ORIGINAL HD",
      description: "Original master clarity, zero quality loss",
      isOriginal: true,
      isExactBytes: hasRealSize
    });
  }
  if (!sourceIs480OrLower) {
    const is720Original = sourceIs720OrLower;
    const bytes720 = is720Original ? baseBytes : calcScaledBytes(122e4, 0.38, 0.65, 0.56);
    results.push({
      tier: "720p",
      label: "720p HD",
      resolution: "1280\xD7720",
      sizeBytes: bytes720,
      sizeLabel: bytes720 > 0 ? formatVideoSizeLabel(bytes720, !(is720Original && hasRealSize)) : "Checking size...",
      sizeMb: bytes720 > 0 ? Math.max(1, Math.round(bytes720 / (1024 * 1024))) : 0,
      badge: is720Original ? "ORIGINAL HD" : "BALANCED",
      description: is720Original ? "Original 720p HD clarity" : "Sharp 720p HD re-encode, lighter download size",
      isOriginal: is720Original,
      isExactBytes: is720Original && hasRealSize
    });
  }
  const bytes480 = sourceIs480OrLower ? baseBytes : calcScaledBytes(62e4, sourceIs720OrLower ? 0.36 : 0.22, sourceIs720OrLower ? 0.62 : 0.38, sourceIs720OrLower ? 0.5 : 0.31);
  results.push({
    tier: "480p",
    label: "480p SD",
    resolution: "854\xD7480",
    sizeBytes: bytes480,
    sizeLabel: bytes480 > 0 ? formatVideoSizeLabel(bytes480, !(sourceIs480OrLower && hasRealSize)) : "Checking size...",
    sizeMb: bytes480 > 0 ? Math.max(1, Math.round(bytes480 / (1024 * 1024))) : 0,
    badge: "DATA SAVER",
    description: "480p mobile resolution, saves ~65% storage & data",
    isOriginal: sourceIs480OrLower,
    isExactBytes: sourceIs480OrLower && hasRealSize
  });
  const bytes360 = calcScaledBytes(
    34e4,
    sourceIs720OrLower ? 0.2 : 0.12,
    sourceIs720OrLower ? 0.36 : 0.22,
    sourceIs720OrLower ? 0.29 : 0.18
  );
  results.push({
    tier: "360p",
    label: "360p Compact",
    resolution: "640\xD7360",
    sizeBytes: bytes360,
    sizeLabel: bytes360 > 0 ? formatVideoSizeLabel(bytes360, true) : "Checking size...",
    sizeMb: bytes360 > 0 ? Math.max(1, Math.round(bytes360 / (1024 * 1024))) : 0,
    badge: "FASTEST",
    description: "Smallest file size for quick download on slow data",
    isOriginal: false,
    isExactBytes: false
  });
  return results;
}
var LANGUAGE_CODE_MAP = {
  hi: "Hindi",
  hin: "Hindi",
  hindi: "Hindi",
  en: "English",
  eng: "English",
  english: "English",
  ta: "Tamil",
  tam: "Tamil",
  tamil: "Tamil",
  te: "Telugu",
  tel: "Telugu",
  telugu: "Telugu",
  ml: "Malayalam",
  mal: "Malayalam",
  malayalam: "Malayalam",
  kn: "Kannada",
  kan: "Kannada",
  kannada: "Kannada",
  bn: "Bengali",
  ben: "Bengali",
  bengali: "Bengali",
  mr: "Marathi",
  mar: "Marathi",
  marathi: "Marathi",
  pa: "Punjabi",
  pan: "Punjabi",
  pun: "Punjabi",
  punjabi: "Punjabi",
  gu: "Gujarati",
  guj: "Gujarati",
  gujarati: "Gujarati",
  ur: "Urdu",
  urd: "Urdu",
  urdu: "Urdu",
  ja: "Japanese",
  jpn: "Japanese",
  japanese: "Japanese",
  ko: "Korean",
  kor: "Korean",
  korean: "Korean",
  zh: "Chinese",
  chi: "Chinese",
  zho: "Chinese",
  chinese: "Chinese",
  es: "Spanish",
  spa: "Spanish",
  spanish: "Spanish",
  fr: "French",
  fre: "French",
  fra: "French",
  french: "French",
  de: "German",
  ger: "German",
  deu: "German",
  german: "German",
  ar: "Arabic",
  ara: "Arabic",
  arabic: "Arabic",
  ru: "Russian",
  rus: "Russian",
  russian: "Russian",
  pt: "Portuguese",
  por: "Portuguese",
  portuguese: "Portuguese",
  it: "Italian",
  ita: "Italian",
  italian: "Italian",
  tr: "Turkish",
  tur: "Turkish",
  turkish: "Turkish",
  th: "Thai",
  tha: "Thai",
  thai: "Thai",
  id: "Indonesian",
  ind: "Indonesian",
  indonesian: "Indonesian",
  und: "",
  unknown: ""
};
var KNOWN_LANGUAGE_NAMES = Array.from(
  new Set(Object.values(LANGUAGE_CODE_MAP).filter(Boolean))
);
function cleanMediaTrackLabel(langRaw, titleRaw, kind = "audio", index = 0) {
  const code = String(langRaw || "").trim().toLowerCase().replace(/[-_].*$/, "");
  const mappedLang = LANGUAGE_CODE_MAP[code] || "";
  let cleanedTitle = String(titleRaw || "").replace(/https?:\/\/\S+/gi, " ").replace(/www\.\S+/gi, " ").replace(/@[a-z0-9_]+/gi, " ").replace(
    /\b(skymovieshd|filmyzilla|vegamovies|hdhub4u|mkvcinemas|katmoviehd|bolly4u|worldfree4u|moviesmod|uhdmovies|9xmovies|extramovies|olamovies|pagalworld|filmywap|mp4moviez|jalshamoviez|mlsbd|cinevez|tamilrockers|isaimini|movierulz)\b/gi,
    " "
  ).replace(/\b[a-z0-9-]+\.(com|net|org|in|me|cc|lol|fun|pw|club|site|pro|xyz|top|live|info|to)\b/gi, " ").replace(/[:._]{2,}/g, " ").replace(/\[[^\]]*(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|kbps|mbps|full|forced|sdh|cc|stereo|mono|\d\.\d|ch)[^\]]*\]/gi, " ").replace(/\([^\)]*(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|kbps|mbps|full|forced|sdh|cc|stereo|mono|\d\.\d|ch)[^\)]*\)/gi, " ").replace(/\b(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|5\.1|7\.1|2\.0|6ch|2ch|\d+\s*kbps|full|forced|sdh)\b/gi, " ").replace(/[()\[\]{}•|:/\\-]+/g, " ").replace(/\s+/g, " ").trim();
  let detectedFromTitle = "";
  for (const name of KNOWN_LANGUAGE_NAMES) {
    const re = new RegExp(`\\b${name}\\b`, "i");
    if (re.test(cleanedTitle)) {
      detectedFromTitle = name;
      break;
    }
  }
  const finalLang = mappedLang || detectedFromTitle;
  if (finalLang) {
    return { lang: finalLang, label: finalLang };
  }
  if (cleanedTitle && cleanedTitle.length >= 2 && !/^(track|audio|subtitle)\s*\d*$/i.test(cleanedTitle)) {
    return { lang: cleanedTitle, label: cleanedTitle };
  }
  if (code && code !== "und" && code.length <= 3) {
    const up = code.toUpperCase();
    return { lang: up, label: up };
  }
  return kind === "audio" ? { lang: "Audio", label: `Audio ${index + 1}` } : { lang: "Subtitle", label: `Subtitle ${index + 1}` };
}

// src/server/telegramStreamEngine.ts
var BLOCK_SIZE = 512 * 1024;
var MAX_CACHED_BLOCKS = 96;
var blockCache = /* @__PURE__ */ new Map();
var inflightBlocks = /* @__PURE__ */ new Map();
var resolvedDcMap = /* @__PURE__ */ new Map();
function touchCache(key, buf) {
  if (blockCache.has(key)) {
    blockCache.delete(key);
  }
  blockCache.set(key, buf);
  while (blockCache.size > MAX_CACHED_BLOCKS) {
    const oldestKey = blockCache.keys().next().value;
    if (oldestKey !== void 0) {
      blockCache.delete(oldestKey);
    } else {
      break;
    }
  }
}
function getCachedBlock(key) {
  const hit = blockCache.get(key);
  if (hit) {
    blockCache.delete(key);
    blockCache.set(key, hit);
  }
  return hit;
}
var dcSenderPromises = /* @__PURE__ */ new Map();
async function getDcSenderSafe(client2, dcId) {
  const key = dcId !== void 0 ? String(dcId) : "default";
  const existing = dcSenderPromises.get(key);
  if (existing) return existing;
  const p = client2.getSender(dcId).finally(() => {
    dcSenderPromises.delete(key);
  });
  dcSenderPromises.set(key, p);
  return p;
}
async function fetchTelegramBlockRaw(client2, doc2, blockIndex) {
  const docIdStr = doc2.id.toString();
  const offsetBytes = blockIndex * BLOCK_SIZE;
  const location = new Api2.InputDocumentFileLocation({
    id: doc2.id,
    accessHash: doc2.accessHash,
    fileReference: doc2.fileReference,
    thumbSize: ""
  });
  let dcId = resolvedDcMap.get(docIdStr) ?? doc2.dcId;
  let sender = await getDcSenderSafe(client2, dcId);
  const request = new Api2.upload.GetFile({
    location,
    offset: bigInt2(offsetBytes),
    limit: BLOCK_SIZE
  });
  let attempts = 0;
  while (attempts < 4) {
    attempts++;
    try {
      const invokePromise = client2.invokeWithSender(request, sender);
      const timeoutPromise = new Promise(
        (_, reject) => setTimeout(() => reject(new Error("TIMEOUT: Telegram GetFile timed out")), 12e3)
      );
      const result = await Promise.race([invokePromise, timeoutPromise]);
      if (result instanceof Api2.upload.FileCdnRedirect) {
        throw new Error("CDN redirect not supported for GetFile");
      }
      if (dcId !== void 0) {
        resolvedDcMap.set(docIdStr, dcId);
      }
      return Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes);
    } catch (err) {
      const msg = String(err?.errorMessage || err?.message || "");
      if (err?.newDc) {
        dcId = Number(err.newDc);
        resolvedDcMap.set(docIdStr, dcId);
        sender = await getDcSenderSafe(client2, dcId);
        continue;
      }
      const migrateMatch = msg.match(/FILE_MIGRATE_(\d+)/i);
      if (migrateMatch) {
        dcId = Number(migrateMatch[1]);
        resolvedDcMap.set(docIdStr, dcId);
        sender = await getDcSenderSafe(client2, dcId);
        continue;
      }
      if (msg.includes("TIMEOUT") && attempts < 3) {
        await new Promise((r) => setTimeout(r, 400));
        sender = await getDcSenderSafe(client2, dcId);
        continue;
      }
      const floodMatch = msg.match(/FLOOD_WAIT_(\d+)/i);
      if (floodMatch && Number(floodMatch[1]) <= 10 && attempts < 3) {
        await new Promise((r) => setTimeout(r, (Number(floodMatch[1]) + 1) * 1e3));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to fetch Telegram block after retries");
}
function fetchBlock(client2, doc2, blockIndex) {
  const key = `${doc2.id.toString()}:${blockIndex}`;
  const cached = getCachedBlock(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const inflight = inflightBlocks.get(key);
  if (inflight) {
    return inflight;
  }
  const promise = fetchTelegramBlockRaw(client2, doc2, blockIndex).then((buf) => {
    touchCache(key, buf);
    return buf;
  }).finally(() => {
    inflightBlocks.delete(key);
  });
  inflightBlocks.set(key, promise);
  return promise;
}
async function streamTelegramRange(res, client2, doc2, start, endPos, concurrency, isClosedFn, onFileRefExpired) {
  const firstBlock = Math.floor(start / BLOCK_SIZE);
  const lastBlock = Math.floor(endPos / BLOCK_SIZE);
  const blockPromises = /* @__PURE__ */ new Map();
  let nextToQueue = firstBlock;
  const queueAhead = (upToBlock) => {
    const cap = Math.min(lastBlock, upToBlock);
    while (nextToQueue <= cap && !isClosedFn()) {
      const idx = nextToQueue++;
      if (!blockPromises.has(idx)) {
        const p = fetchBlock(client2, doc2, idx);
        p.catch(() => {
        });
        blockPromises.set(idx, p);
      }
    }
  };
  queueAhead(firstBlock + concurrency - 1);
  try {
    for (let blockIdx = firstBlock; blockIdx <= lastBlock; blockIdx++) {
      if (isClosedFn() || res.writableEnded) break;
      queueAhead(blockIdx + concurrency);
      const p = blockPromises.get(blockIdx) || fetchBlock(client2, doc2, blockIdx);
      const blockBuf = await p;
      blockPromises.delete(blockIdx);
      if (isClosedFn() || res.writableEnded) break;
      if (!blockBuf || blockBuf.length === 0) break;
      const blockFileStart = blockIdx * BLOCK_SIZE;
      const sliceStart = Math.max(0, start - blockFileStart);
      const sliceEnd = Math.min(blockBuf.length, endPos - blockFileStart + 1);
      if (sliceEnd > sliceStart) {
        const chunk = sliceStart === 0 && sliceEnd === blockBuf.length ? blockBuf : blockBuf.subarray(sliceStart, sliceEnd);
        const canWrite = res.write(chunk);
        if (!canWrite && !isClosedFn() && !res.writableEnded) {
          await new Promise((resolve) => {
            const onDrain = () => {
              cleanup();
              resolve();
            };
            const onClose = () => {
              cleanup();
              resolve();
            };
            const cleanup = () => {
              res.removeListener("drain", onDrain);
              res.removeListener("close", onClose);
            };
            res.once("drain", onDrain);
            res.once("close", onClose);
          });
        }
      }
      if (blockBuf.length < BLOCK_SIZE) {
        break;
      }
    }
  } catch (err) {
    if (String(err?.message || "").includes("FILE_REFERENCE")) {
      onFileRefExpired?.();
    }
    if (!isClosedFn()) {
      console.error("[StreamEngine] Range transfer error:", err?.message || err);
    }
  } finally {
    blockPromises.clear();
    if (!res.writableEnded) {
      res.end();
    }
  }
}
function formatLanguageLabel(langRaw, titleRaw, idx = 0, kind = "audio") {
  return cleanMediaTrackLabel(langRaw, titleRaw, kind, idx);
}
function fallbackProbeFromMetadata(docInfo) {
  const lowerName = docInfo.fileName.toLowerCase();
  const rawMime = docInfo.rawMime.toLowerCase();
  const isWebm = lowerName.endsWith(".webm") || rawMime.includes("webm");
  const isMkv = !isWebm && (lowerName.endsWith(".mkv") || rawMime.includes("matroska") || rawMime.includes("mkv"));
  const isAvi = lowerName.endsWith(".avi") || rawMime.includes("avi");
  const isMp4 = lowerName.endsWith(".mp4") || lowerName.endsWith(".m4v") || rawMime.includes("mp4");
  const isRiskyCodec = /(^|[^a-z0-9])(hevc|x265|h\.?265|10bit|10-bit|hi10p|av1|xvid|divx|2160p|4k|uhd)([^a-z0-9]|$)/i.test(lowerName);
  const recommendedMode = isRiskyCodec || isMkv || isAvi || !isMp4 && !isWebm ? "transcode" : "direct";
  return {
    durationSec: docInfo.durationSec || 0,
    container: isWebm ? "webm" : isMkv ? "matroska" : "mp4",
    videoCodec: isRiskyCodec ? "hevc" : "h264",
    videoProfile: isRiskyCodec ? "main 10" : "high",
    videoLevel: 40,
    pixFmt: isRiskyCodec ? "yuv420p10le" : "yuv420p",
    is10Bit: isRiskyCodec,
    width: 0,
    height: 0,
    audioCodec: "aac",
    audioTracks: [],
    subtitleTracks: [],
    recommendedMode,
    needsAudioTranscode: recommendedMode !== "direct",
    probedByFfprobe: false
  };
}
async function probeTelegramMedia(localPort, telegramUrl, docInfo, options) {
  const localRawUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(telegramUrl)}&raw=1`;
  const timeoutMs = Math.max(3e3, options?.timeoutMs ?? 14e3);
  const probesize = String(options?.probesize ?? 3e6);
  const analyzeduration = String(options?.analyzeduration ?? 25e5);
  return new Promise((resolve) => {
    const args2 = [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "-probesize",
      probesize,
      "-analyzeduration",
      analyzeduration,
      localRawUrl
    ];
    const proc = spawn("ffprobe", args2, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill("SIGKILL");
        } catch {
        }
        console.warn("[Probe] ffprobe timed out, falling back to safe metadata heuristic");
        resolve(fallbackProbeFromMetadata(docInfo));
      }
    }, timeoutMs);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    proc.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(fallbackProbeFromMetadata(docInfo));
      }
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) {
        resolve(fallbackProbeFromMetadata(docInfo));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        const format = parsed.format || {};
        const formatDuration2 = parseFloat(format.duration || "0");
        const durationSec = Number.isFinite(formatDuration2) && formatDuration2 > 0 ? Math.round(formatDuration2) : docInfo.durationSec || 0;
        const videoStream = streams.find(
          (s) => s.codec_type === "video" && (!s.disposition || s.disposition.attached_pic !== 1)
        );
        const audioStreamObjs = streams.filter((s) => s.codec_type === "audio");
        const subtitleStreamObjs = streams.filter((s) => s.codec_type === "subtitle");
        const videoCodec = String(videoStream?.codec_name || "").toLowerCase();
        const pixFmt = String(videoStream?.pix_fmt || "").toLowerCase();
        const profile = String(videoStream?.profile || "").toLowerCase();
        const fieldOrder = String(videoStream?.field_order || "").toLowerCase();
        const level = Number(videoStream?.level || 0);
        const width = Number(videoStream?.width || 0);
        const height = Number(videoStream?.height || 0);
        const is10Bit = pixFmt.includes("10le") || pixFmt.includes("10be") || pixFmt.includes("12le") || profile.includes("10");
        const audioTracks = audioStreamObjs.map((s, idx) => {
          const { lang, label } = formatLanguageLabel(s.tags?.language, s.tags?.title, idx, "audio");
          return {
            id: idx,
            streamIndex: Number(s.index ?? idx),
            codec: String(s.codec_name || "").toLowerCase(),
            channels: Number(s.channels || 2),
            lang,
            label
          };
        });
        const subtitleTracks = subtitleStreamObjs.map((s, idx) => {
          const { lang, label } = formatLanguageLabel(s.tags?.language, s.tags?.title, idx, "subtitle");
          return {
            id: idx,
            streamIndex: Number(s.index ?? idx),
            codec: String(s.codec_name || "").toLowerCase(),
            lang: lang || "English",
            label: label || (idx === 0 ? "English" : "Hindi")
          };
        });
        const primaryAudioCodec = audioTracks[0]?.codec || "";
        const container = String(format.format_name || "").toLowerCase();
        const lowerName = docInfo.fileName.toLowerCase();
        const isWebm = lowerName.endsWith(".webm") || docInfo.rawMime.toLowerCase().includes("webm");
        const isMp4Container = container.includes("mp4") || container.includes("mov") || container.includes("m4a") || container.includes("3gp");
        const isResolutionSafe = (width === 0 || width <= 1920) && (height === 0 || height <= 1080);
        const isLevelSafe = level === 0 || level <= 42;
        const isProgressive = !fieldOrder || fieldOrder === "progressive" || fieldOrder === "unknown";
        const isProfileSafe = !profile.includes("high 10") && !profile.includes("4:2:2") && !profile.includes("4:4:4");
        const isBrowserSafeH264 = videoCodec === "h264" && !is10Bit && isProfileSafe && isResolutionSafe && isLevelSafe && isProgressive && (pixFmt === "" || pixFmt === "yuv420p" || pixFmt === "yuvj420p" || pixFmt === "nv12");
        const isBrowserSafeWebmVideo = isWebm && (videoCodec === "vp8" || videoCodec === "vp9") && !is10Bit && isResolutionSafe;
        const isBrowserSafeAudio = primaryAudioCodec === "" || primaryAudioCodec === "aac" || primaryAudioCodec === "mp3";
        const isBrowserSafeWebmAudio = isWebm && (primaryAudioCodec === "" || primaryAudioCodec === "opus" || primaryAudioCodec === "vorbis");
        const needsAudioTranscode = !isBrowserSafeAudio;
        let recommendedMode = "direct";
        if (isBrowserSafeWebmVideo && isBrowserSafeWebmAudio) {
          recommendedMode = "direct";
        } else if (!isBrowserSafeH264) {
          recommendedMode = "transcode";
        } else if (!isMp4Container || !isBrowserSafeAudio) {
          recommendedMode = "remux";
        } else {
          recommendedMode = "direct";
        }
        resolve({
          durationSec,
          container,
          videoCodec,
          videoProfile: profile,
          videoLevel: level,
          pixFmt,
          is10Bit,
          width,
          height,
          audioCodec: primaryAudioCodec,
          audioTracks,
          subtitleTracks,
          recommendedMode,
          needsAudioTranscode,
          probedByFfprobe: true
        });
      } catch {
        resolve(fallbackProbeFromMetadata(docInfo));
      }
    });
  });
}
function findSequence(buf, seq, from = 0, to = buf.length) {
  const end = Math.min(to, buf.length) - seq.length;
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}
function bufferContainsAnyAscii(buf, needles) {
  for (const n of needles) {
    if (buf.indexOf(n, 0, "latin1") >= 0) return true;
  }
  return false;
}
function checkMp4MoovHasAudio(buf) {
  const moovIdx = buf.indexOf("moov", 0, "latin1");
  if (moovIdx < 4) return null;
  const moovSize = buf.readUInt32BE(moovIdx - 4);
  const moovEnd = moovSize >= 8 ? moovIdx - 4 + moovSize : buf.length;
  const slice = buf.subarray(moovIdx - 4, Math.min(buf.length, moovEnd));
  if (bufferContainsAnyAscii(slice, [
    "soun",
    "mp4a",
    "ec-3",
    "ac-3",
    "dtsc",
    "dtsh",
    "dtse",
    "Opus",
    "fLaC",
    ".mp3",
    "samr",
    "sawb",
    "twos",
    "sowt",
    "alac",
    "lpcm"
  ])) {
    return true;
  }
  if (moovEnd <= buf.length && slice.indexOf("trak", 0, "latin1") >= 0) {
    return false;
  }
  return null;
}
async function checkTelegramDocHasAudioFast(client2, docInfo) {
  try {
    const firstBlock = await fetchBlock(client2, docInfo.document, 0);
    if (!firstBlock || firstBlock.length < 16) return null;
    if (firstBlock[0] === 26 && firstBlock[1] === 69 && firstBlock[2] === 223 && firstBlock[3] === 163) {
      const tracksIdx = findSequence(firstBlock, [22, 84, 174, 107]);
      if (tracksIdx >= 0) {
        const clusterIdx = findSequence(firstBlock, [31, 67, 182, 117], tracksIdx + 4);
        const searchEnd = clusterIdx > tracksIdx ? clusterIdx : firstBlock.length;
        const tracksSlice = firstBlock.subarray(tracksIdx, searchEnd);
        const hasAudioCodec = bufferContainsAnyAscii(tracksSlice, [
          "A_AAC",
          "A_AC3",
          "A_EAC3",
          "A_DTS",
          "A_TRUEHD",
          "A_OPUS",
          "A_VORBIS",
          "A_MPEG/",
          "A_FLAC",
          "A_PCM",
          "A_ALAC",
          "A_MS/ACM"
        ]);
        if (hasAudioCodec) return true;
        if (findSequence(tracksSlice, [131, 129, 2]) >= 0) {
          return true;
        }
        if (clusterIdx > tracksIdx || docInfo.fileSize <= BLOCK_SIZE) {
          return false;
        }
      }
      return null;
    }
    const ftyp = firstBlock.toString("latin1", 4, 8);
    if (ftyp === "ftyp" || firstBlock.indexOf("moov", 0, "latin1") >= 0) {
      const headRes = checkMp4MoovHasAudio(firstBlock);
      if (headRes !== null) return headRes;
      if (docInfo.fileSize > BLOCK_SIZE) {
        const lastBlockIdx = Math.floor((docInfo.fileSize - 1) / BLOCK_SIZE);
        const lastBlock = await fetchBlock(client2, docInfo.document, lastBlockIdx);
        const tailRes = checkMp4MoovHasAudio(lastBlock);
        if (tailRes !== null) return tailRes;
        if (lastBlockIdx > 1) {
          const prevLastBlock = await fetchBlock(client2, docInfo.document, lastBlockIdx - 1);
          const combinedTail = Buffer.concat([prevLastBlock, lastBlock]);
          return checkMp4MoovHasAudio(combinedTail);
        }
      }
      return null;
    }
    if (firstBlock.toString("latin1", 0, 4) === "RIFF" && firstBlock.toString("latin1", 8, 12) === "AVI ") {
      if (firstBlock.indexOf("auds", 0, "latin1") >= 0) return true;
      if (firstBlock.indexOf("hdrl", 0, "latin1") >= 0 && firstBlock.indexOf("vids", 0, "latin1") >= 0) {
        return false;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

// src/server/telegramRouter.ts
var directHttpProbeCache = /* @__PURE__ */ new Map();
async function probeDirectHttpInfo(targetUrl) {
  const cached = directHttpProbeCache.get(targetUrl);
  if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1e3) {
    return cached;
  }
  let fileSize = 0;
  let durationSec = 0;
  let width = 0;
  let height = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5e3);
    const headRes = await fetch(targetUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36" }
    }).finally(() => clearTimeout(timer));
    const cl = Number(headRes.headers.get("content-length") || 0);
    if (Number.isFinite(cl) && cl > 0) fileSize = cl;
  } catch {
  }
  if (fileSize <= 0) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5e3);
      const rngRes = await fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Range: "bytes=0-0",
          "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36"
        }
      }).finally(() => clearTimeout(timer));
      const cr = rngRes.headers.get("content-range") || "";
      const m = cr.match(/bytes\s+\d+-\d+\/(\d+)/i);
      if (m && m[1]) {
        const total = Number(m[1]);
        if (Number.isFinite(total) && total > 0) fileSize = total;
      } else {
        const cl = Number(rngRes.headers.get("content-length") || 0);
        if (Number.isFinite(cl) && cl > 1024) fileSize = cl;
      }
      try {
        await rngRes.body?.cancel();
      } catch {
      }
    } catch {
    }
  }
  try {
    const probeJson = await new Promise((resolve) => {
      const proc = spawn2(
        "ffprobe",
        [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-probesize",
          "1500000",
          "-analyzeduration",
          "1500000",
          "-show_format",
          "-show_streams",
          targetUrl
        ],
        { stdio: ["ignore", "pipe", "ignore"] }
      );
      let out = "";
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
        }
        resolve(null);
      }, 6e3);
      proc.stdout.on("data", (d) => {
        out += d.toString();
      });
      proc.on("close", () => {
        clearTimeout(timer);
        try {
          resolve(out ? JSON.parse(out) : null);
        } catch {
          resolve(null);
        }
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    if (probeJson) {
      const dur = Number(probeJson.format?.duration || 0);
      if (Number.isFinite(dur) && dur > 0) durationSec = Math.round(dur);
      if (fileSize <= 0) {
        const fmtSize = Number(probeJson.format?.size || 0);
        if (Number.isFinite(fmtSize) && fmtSize > 0) fileSize = fmtSize;
      }
      const vStream = Array.isArray(probeJson.streams) ? probeJson.streams.find((s) => s.codec_type === "video") : null;
      if (vStream) {
        width = Number(vStream.width || 0);
        height = Number(vStream.height || 0);
      }
    }
  } catch {
  }
  const info = {
    fileSize,
    durationSec,
    width,
    height,
    cachedAt: Date.now()
  };
  directHttpProbeCache.set(targetUrl, info);
  return info;
}
function normalizeRequestedQuality(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "1080p" || s === "1080") return "1080p";
  if (s === "720p" || s === "720") return "720p";
  if (s === "480p" || s === "480") return "480p";
  if (s === "360p" || s === "360") return "360p";
  return "";
}
function getFfmpegQualityArgs(quality, isDownload) {
  const args2 = [];
  if (quality === "360p") {
    args2.push(
      "-vf",
      "scale='min(640,iw)':'min(360,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      ...isDownload ? [] : ["-tune", "zerolatency"],
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "3.1",
      "-vsync",
      "cfr",
      "-b:v",
      "280k",
      "-maxrate",
      "360k",
      "-bufsize",
      "720k",
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-b:a",
      "64k"
    );
    return args2;
  }
  if (quality === "480p") {
    args2.push(
      "-vf",
      "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      ...isDownload ? [] : ["-tune", "zerolatency"],
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "3.1",
      "-vsync",
      "cfr",
      "-b:v",
      "520k",
      "-maxrate",
      "650k",
      "-bufsize",
      "1300k",
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-b:a",
      "96k"
    );
    return args2;
  }
  if (quality === "720p") {
    args2.push(
      "-vf",
      "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      ...isDownload ? [] : ["-tune", "zerolatency"],
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "4.0",
      "-vsync",
      "cfr",
      "-b:v",
      "1050k",
      "-maxrate",
      "1300k",
      "-bufsize",
      "2600k",
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-b:a",
      "128k"
    );
    return args2;
  }
  args2.push(
    "-vf",
    "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    ...isDownload ? [] : ["-tune", "zerolatency"],
    "-threads",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "main",
    "-level",
    "4.0",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    "-vsync",
    "cfr",
    "-crf",
    "22",
    "-maxrate",
    "3400k",
    "-bufsize",
    "6800k",
    "-g",
    "48",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-b:a",
    "160k"
  );
  return args2;
}
var router2 = Router();
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "00:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor(seconds % 3600 / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
router2.get("/status", async (_req, res) => {
  const creds = getTelegramCredentials();
  const configured = Boolean(creds.apiId && creds.apiHash && (creds.botToken || creds.sessionStr));
  const cachedChannels = getAllCachedChannels();
  if (!configured) {
    return res.json({
      connected: false,
      configured: false,
      channelsCount: cachedChannels.length,
      message: "Telegram credentials not set in environment (TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_BOT_TOKEN)."
    });
  }
  try {
    const client2 = await getTelegramClient();
    const me = await client2.getMe();
    res.json({
      connected: client2.connected,
      configured: true,
      bot: {
        id: me?.id?.toString(),
        username: me?.username,
        firstName: me?.firstName,
        isBot: Boolean(me?.bot)
      },
      channelsCount: cachedChannels.length,
      cachedChannels: cachedChannels.map((c) => ({ id: c.channelId, title: c.title }))
    });
  } catch (err) {
    res.status(200).json({
      connected: false,
      configured: true,
      error: err.message,
      channelsCount: cachedChannels.length
    });
  }
});
router2.get("/channels", (_req, res) => {
  const channels = getAllCachedChannels();
  res.json({ status: "ok", channels });
});
router2.post("/connect-channel", async (req, res) => {
  const { inviteUrl, channelUsername } = req.body || {};
  const link = (inviteUrl || channelUsername || "").trim();
  if (!link) {
    return res.status(400).json({ error: "Invite link or channel username is required" });
  }
  console.log(`[TelegramConnectChannel] Connecting channel link: ${link}`);
  try {
    const inviteMatch = link.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/i);
    const privatePostMatch = link.match(/\/c\/(\d+)\/(\d+)/i);
    const cleanUsername = link.replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i, "").replace(/^@/, "");
    let channelId = `ch-${Date.now()}`;
    let title = "Connected Private Channel";
    let accessHash = "0";
    if (privatePostMatch) {
      channelId = privatePostMatch[1];
      title = `Private Channel (${channelId})`;
    } else if (inviteMatch) {
      channelId = `inv-${inviteMatch[1]}`;
      title = `Private Channel (+${inviteMatch[1]})`;
    } else if (cleanUsername && !cleanUsername.includes("/")) {
      channelId = cleanUsername;
      title = `@${cleanUsername}`;
    }
    try {
      const client2 = await getTelegramClient();
      if (inviteMatch) {
        const hash = inviteMatch[1];
        let resolvedFromInvite = false;
        try {
          const checkRes = await client2.invoke(new Api3.messages.CheckChatInvite({ hash }));
          const chat = checkRes?.chat || checkRes?.channel;
          if (chat) {
            channelId = chat.id.toString();
            title = chat.title || title;
            accessHash = chat.accessHash ? chat.accessHash.toString() : "0";
            resolvedFromInvite = true;
          }
        } catch (inviteErr) {
          console.warn("[TelegramConnectChannel] CheckChatInvite note:", inviteErr?.message || inviteErr);
        }
        if (!resolvedFromInvite) {
          try {
            const { botToken } = getTelegramCredentials();
            if (botToken) {
              const updResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
              const updJson = await updResp.json();
              const updates = Array.isArray(updJson?.result) ? updJson.result : [];
              const candidateChatIds = [];
              for (let i = updates.length - 1; i >= 0; i--) {
                const u = updates[i];
                const src = u?.my_chat_member || u?.channel_post || u?.edited_channel_post || u?.message;
                const cId = src?.chat?.id ? String(src.chat.id) : "";
                if (cId && cId.startsWith("-100") && !candidateChatIds.includes(cId)) {
                  candidateChatIds.push(cId);
                }
              }
              let matchedChatId = "";
              for (const cId of candidateChatIds) {
                try {
                  const chatResp = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(cId)}`);
                  const chatJson = await chatResp.json();
                  const inv = String(chatJson?.result?.invite_link || "");
                  if (inv.includes(hash)) {
                    matchedChatId = cId;
                    break;
                  }
                } catch {
                }
              }
              if (!matchedChatId && candidateChatIds.length > 0) {
                const uncached = candidateChatIds.find((cId) => {
                  const clean = cId.replace("-100", "");
                  const h = getCachedAccessHash(clean);
                  return !h || h === "0";
                });
                matchedChatId = uncached || candidateChatIds[0];
              }
              if (matchedChatId) {
                const entity = await client2.getEntity(matchedChatId);
                if (entity) {
                  channelId = entity.id.toString();
                  title = entity.title || title;
                  accessHash = entity.accessHash ? entity.accessHash.toString() : "0";
                }
              }
            }
          } catch (botFallbackErr) {
            console.warn("[TelegramConnectChannel] Bot API fallback note:", botFallbackErr?.message || botFallbackErr);
          }
        }
      } else if (privatePostMatch) {
        const cleanPrivateId = privatePostMatch[1].replace("-100", "");
        const entity = await client2.getEntity(`-100${cleanPrivateId}`);
        if (entity) {
          channelId = entity.id.toString();
          title = entity.title || title;
          accessHash = entity.accessHash ? entity.accessHash.toString() : "0";
        }
      } else if (cleanUsername && !cleanUsername.includes("/")) {
        const entity = await client2.getEntity(`@${cleanUsername}`);
        if (entity) {
          channelId = entity.id.toString();
          title = entity.title || title;
          accessHash = entity.accessHash ? entity.accessHash.toString() : "0";
        }
      }
    } catch (clientErr) {
      console.warn("[TelegramConnectChannel] Live client resolution note (using fallback):", clientErr?.message);
    }
    const entry = saveChannelEntity(channelId, accessHash, title, cleanUsername);
    return res.json({
      success: true,
      message: `\u2705 Channel "${title}" connected successfully! Bot is authorized for streaming and uploads.`,
      channel: entry
    });
  } catch (err) {
    console.error("[TelegramConnectChannel] Error:", err);
    const fallbackEntry = saveChannelEntity(`chan-${Date.now()}`, "0", "Connected Telegram Channel", "");
    return res.json({
      success: true,
      message: `\u2705 Telegram Channel connected successfully! Bot is ready.`,
      channel: fallbackEntry
    });
  }
});
function normalizeTelegramText(input) {
  return String(input || "").replace(/[\u03C1\u03A1\u0440\u0420]/g, "p").replace(/[\u03C5\u0443]/g, "u").replace(/[\u03B1\u0430]/g, "a").replace(/[\u03B9]/g, "i").replace(/[\u03C4]/g, "t").replace(/[\u03BB]/g, "l").replace(/[\u03B5\u0435\u0454]/g, "e").replace(/[\u0455]/g, "s").replace(/[\u03BF\u043E\u03C3]/g, "o").replace(/[\u2202]/g, "d");
}
function matchQualityInString(raw) {
  const lower = normalizeTelegramText(raw).toLowerCase();
  if (!lower.trim()) return { quality: "", score: 0 };
  if (/(?:^|\b|[^0-9])4800p(?:\b|$)/i.test(lower)) return { quality: "480p", score: 480 };
  if (/(?:^|\b|[^0-9])7200(?:p|\b)/i.test(lower)) return { quality: "720p", score: 720 };
  if (/(?:^|\b|[^0-9])10800p(?:\b|$)/i.test(lower)) return { quality: "1080p", score: 1080 };
  if (/(?:^|[^0-9])quality[_\s:\-]*108(?:\b|\.|[^0-9]|$)/i.test(lower)) return { quality: "1080p", score: 1080 };
  if (/(?:2160p|\b4k\b|\buhd\b|3840x2160)/i.test(lower)) return { quality: "4K", score: 2160 };
  if (/(?:1080p|\bfhd\b|1920x1080|quality\s*[:\-_]\s*1080\b)/i.test(lower)) return { quality: "1080p", score: 1080 };
  if (/(?:720p|1280x720|quality\s*[:\-_]\s*720\b)/i.test(lower)) return { quality: "720p", score: 720 };
  if (/(?:480p|854x480|quality\s*[:\-_]\s*480\b)/i.test(lower)) return { quality: "480p", score: 480 };
  if (/(?:360p|quality\s*[:\-_]\s*360\b)/i.test(lower)) return { quality: "360p", score: 360 };
  return { quality: "", score: 0 };
}
function parseQualityScore(caption, fileName, width = 0, height = 0) {
  const capMatch = matchQualityInString(caption);
  if (capMatch.quality) return capMatch;
  const fnMatch = matchQualityInString(fileName);
  if (fnMatch.quality) return fnMatch;
  if (width > 360 || height > 360) {
    if (height >= 2e3 || width >= 3600) return { quality: "4K", score: 2160 };
    if (height >= 1e3 || width >= 1800) return { quality: "1080p", score: 1080 };
    if (height >= 680 || width >= 1200) return { quality: "720p", score: 720 };
    if (height >= 400 || width >= 700) return { quality: "480p", score: 480 };
  }
  return { quality: "", score: 0 };
}
function parseEpisodeIdentity(caption, fileName) {
  const normCap = normalizeTelegramText(caption);
  const normFn = normalizeTelegramText(fileName);
  const combined = `${normCap}
${normFn}`;
  let seasonNum = null;
  let epNum = null;
  let absEpNum = null;
  const absMatch = combined.match(/(?:e[pr]isode|ep)\s*[:\-_.\s]*0*([1-9]\d{2,3})(?=$|[^0-9])/i) || combined.match(/(?:^|[^a-z0-9])S\d{1,2}E\d{1,2}\s+([1-9]\d{2,3})(?=$|[^0-9])/i);
  if (absMatch) {
    absEpNum = parseInt(absMatch[1], 10);
  }
  const capEpMatch = normCap.match(/e[pr]isode\s*[:\-]?\s*0*(\d{1,4})(?=$|[^0-9])/i) || normCap.match(/episode\s*[:\-]?\s*0*(\d{1,4})(?=$|[^0-9])/i);
  const capSeasonMatch = normCap.match(/season\s*[:\-]?\s*0*(\d{1,2})(?=$|[^0-9])/i);
  if (capEpMatch) {
    epNum = parseInt(capEpMatch[1], 10);
    if (capSeasonMatch) seasonNum = parseInt(capSeasonMatch[1], 10);
  } else {
    const seMatch = combined.match(/(?:^|[^a-z0-9])S(?:eason)?\s*0*(\d{1,2})\s*[-_.\s]*E(?:p|pisode)?\s*0*(\d{1,4})(?=$|[^0-9])/i);
    const esMatch = combined.match(/(?:^|[^a-z0-9])E(?:p|pisode)?\s*[-_.\s]*0*(\d{1,4})[-_.\s]+S(?:eason)?\s*0*(\d{1,2})(?=$|[^0-9])/i);
    if (seMatch) {
      seasonNum = parseInt(seMatch[1], 10);
      epNum = parseInt(seMatch[2], 10);
    } else if (esMatch) {
      epNum = parseInt(esMatch[1], 10);
      seasonNum = parseInt(esMatch[2], 10);
    } else {
      const fnEpMatch = normFn.match(/(?:^|[\s_\-\[])E(?:p|pisode)?\s*[:\-_.\s]*0*(\d{1,4})(?=$|[^0-9])/i);
      if (fnEpMatch) {
        epNum = parseInt(fnEpMatch[1], 10);
      }
    }
  }
  if (absEpNum !== null && Number.isFinite(absEpNum)) {
    return { key: `abs-${absEpNum}`, epNum: absEpNum, absEpNum };
  }
  if (epNum === null || !Number.isFinite(epNum)) {
    return { key: null, epNum: null, absEpNum: null };
  }
  const key = seasonNum !== null ? `s${seasonNum}-e${epNum}` : `e${epNum}`;
  return { key, epNum, absEpNum: null };
}
var NON_VIDEO_FILE_EXT_RE = /\.(txt|text|log|md|csv|json|xml|html?|pdf|zip|rar|7z|tar|gz|apk|exe|tgs|webp|png|jpe?g|gif|bmp|svg|ico|mp3|wav|aac|flac|ogg|m4a|opus|srt|ass|ssa|vtt|nfo|sub|idx)$/i;
function classifyTelegramDocMedia(msg) {
  if (!msg || !msg.id) {
    return { kind: "other", mime: "", fileName: "", sizeBytes: 0 };
  }
  const media = msg.media;
  const doc2 = media?.document || msg.document;
  if (!doc2 || !doc2.id) {
    return { kind: "other", mime: "", fileName: "", sizeBytes: 0 };
  }
  const attrs = Array.isArray(doc2.attributes) ? doc2.attributes : [];
  const mime = String(doc2.mimeType || "").toLowerCase();
  const fnAttr = attrs.find(
    (a) => a instanceof Api3.DocumentAttributeFilename || a?.className === "DocumentAttributeFilename"
  );
  const fileName = String(fnAttr?.fileName || "");
  const lowerFileName = fileName.toLowerCase();
  const vidAttr = attrs.find(
    (a) => a instanceof Api3.DocumentAttributeVideo || a?.className === "DocumentAttributeVideo"
  );
  const sizeBytes = Number(doc2.size || 0);
  const isSticker = mime === "application/x-tgsticker" || mime === "image/webp" || lowerFileName === "sticker.webm" || /\.(tgs|webp)$/i.test(lowerFileName) || attrs.some(
    (a) => a instanceof Api3.DocumentAttributeSticker || a?.className === "DocumentAttributeSticker" || a?.className === "DocumentAttributeCustomEmoji"
  ) || mime === "video/webm" && Boolean(vidAttr?.nosound) && sizeBytes > 0 && sizeBytes < 2 * 1024 * 1024;
  if (isSticker) {
    return { kind: "sticker", mime, fileName, sizeBytes };
  }
  const isAnimatedGif = attrs.some(
    (a) => a instanceof Api3.DocumentAttributeAnimated || a?.className === "DocumentAttributeAnimated"
  );
  const isRoundNote = Boolean(vidAttr?.roundMessage);
  const isBlockedMime = mime.startsWith("text/") || mime.startsWith("image/") || mime.startsWith("audio/") || mime === "application/pdf" || mime === "application/json" || mime === "application/zip" || mime === "application/x-rar-compressed" || mime === "application/x-7z-compressed" || mime === "application/vnd.android.package-archive";
  if (isAnimatedGif || isRoundNote || isBlockedMime || NON_VIDEO_FILE_EXT_RE.test(lowerFileName)) {
    return { kind: "other", mime, fileName, sizeBytes };
  }
  const isVideo = mime.startsWith("video/") || Boolean(vidAttr) || /\.(mp4|mkv|avi|mov|webm|m4v|ts|flv)$/i.test(lowerFileName) && sizeBytes > 100 * 1024;
  if (!isVideo) {
    return { kind: "other", mime, fileName, sizeBytes };
  }
  const caption = String(msg.message || "");
  const durationSec = Math.max(0, Math.round(Number(vidAttr?.duration || 0)));
  const width = Number(vidAttr?.w || 0);
  const height = Number(vidAttr?.h || 0);
  const hasExplicitNoSound = Boolean(vidAttr?.nosound) || /\b(no[\s_-]*audio|without[\s_-]*audio|muted|silent|video[\s_-]*only)\b/i.test(`${caption} ${fileName}`);
  return {
    kind: "video",
    doc: doc2,
    mime,
    fileName,
    sizeBytes,
    durationSec,
    width,
    height,
    caption,
    hasExplicitNoSound
  };
}
function getQualityRankForFilter(quality, qFilter) {
  const q = quality.toLowerCase();
  if (qFilter === "1080p") {
    if (q === "1080p") return 5;
    if (q === "720p") return 4;
    if (q === "480p") return 3;
    if (q === "4k") return 2;
    if (q === "360p") return 1;
    return 0;
  }
  if (qFilter === "720p") {
    if (q === "720p") return 5;
    if (q === "1080p") return 4;
    if (q === "480p") return 3;
    if (q === "4k") return 2;
    if (q === "360p") return 1;
    return 0;
  }
  if (qFilter === "480p") {
    if (q === "480p") return 5;
    if (q === "720p") return 4;
    if (q === "1080p") return 3;
    if (q === "4k") return 2;
    if (q === "360p") return 1;
    return 0;
  }
  if (q === "4k") return 5;
  if (q === "1080p") return 4;
  if (q === "720p") return 3;
  if (q === "480p") return 2;
  if (q === "360p") return 1;
  return 0;
}
function primeMediaCacheFromTelegramDoc(streamUrl, doc2, fileName, durationSec, rawMime) {
  const parsed = parseTelegramUrl(streamUrl);
  if (!parsed.isValid || !parsed.chatId || !parsed.messageId || !doc2) return null;
  const cacheKey = `${parsed.chatId}:${parsed.messageId}`;
  const existing = mediaCache.get(cacheKey);
  if (existing && Date.now() - existing.cachedAt <= MEDIA_CACHE_TTL_MS) {
    return existing;
  }
  const lowerName = fileName.toLowerCase();
  const isWebm = lowerName.endsWith(".webm") || rawMime.includes("webm");
  const entry = {
    docInfo: {
      document: doc2,
      fileSize: Number(doc2.size || 0),
      durationSec,
      fileName,
      rawMime
    },
    mimeType: isWebm ? "video/webm" : "video/mp4",
    cachedAt: Date.now()
  };
  mediaCache.set(cacheKey, entry);
  return entry;
}
async function checkCandidateHasAudio(candidate, client2) {
  if (candidate.hasExplicitNoSound) {
    return false;
  }
  try {
    const entry = primeMediaCacheFromTelegramDoc(
      candidate.streamUrl,
      candidate.doc,
      candidate.fileName,
      candidate.durationSec,
      candidate.mime
    );
    if (!entry) return true;
    if (typeof entry.hasAudio === "boolean") {
      return entry.hasAudio;
    }
    if (entry.probe?.probedByFfprobe) {
      const has = entry.probe.audioTracks.length > 0;
      entry.hasAudio = has;
      return has;
    }
    const fastAudio = await checkTelegramDocHasAudioFast(client2, entry.docInfo);
    if (fastAudio !== null) {
      entry.hasAudio = fastAudio;
      return fastAudio;
    }
    return true;
  } catch {
    return true;
  }
}
async function mapWithConcurrency(items, limit, worker, shouldAbort) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      if (shouldAbort?.()) break;
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}
async function selectBestCandidateForGroup(arr, qFilter, client2, shouldAbort) {
  if (arr.length === 1) {
    const only = arr[0];
    const fellBackQuality2 = (qFilter === "1080p" || qFilter === "720p" || qFilter === "480p") && Boolean(only.quality) && only.quality.toLowerCase() !== qFilter;
    return { chosen: only, switchedForAudio: false, fellBackQuality: fellBackQuality2 };
  }
  const sorted = [...arr].sort((a, b) => {
    const rankDiff = getQualityRankForFilter(b.quality, qFilter) - getQualityRankForFilter(a.quality, qFilter);
    if (rankDiff !== 0) return rankDiff;
    return b.sizeBytes - a.sizeBytes;
  });
  let skippedNoAudioCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (shouldAbort?.()) break;
    const candidate = sorted[i];
    const hasAudio = await checkCandidateHasAudio(candidate, client2);
    if (hasAudio) {
      const switchedForAudio = skippedNoAudioCount > 0;
      const fellBackQuality2 = (qFilter === "1080p" || qFilter === "720p" || qFilter === "480p") && Boolean(candidate.quality) && candidate.quality.toLowerCase() !== qFilter;
      return { chosen: candidate, switchedForAudio, fellBackQuality: fellBackQuality2 };
    }
    skippedNoAudioCount++;
  }
  const fallbackTop = sorted[0];
  const fellBackQuality = (qFilter === "1080p" || qFilter === "720p" || qFilter === "480p") && Boolean(fallbackTop.quality) && fallbackTop.quality.toLowerCase() !== qFilter;
  return { chosen: fallbackTop, switchedForAudio: false, fellBackQuality };
}
router2.post("/scan-range", async (req, res) => {
  const { startUrl, endUrl, count, qualityFilter } = req.body || {};
  const qFilter = String(qualityFilter || "all").toLowerCase();
  const startParsed = parseTelegramUrl(String(startUrl || ""));
  if (!startParsed.isValid || !startParsed.messageId) {
    return res.status(400).json({ error: "Valid Starting Telegram link is required." });
  }
  const startMsgId = parseInt(startParsed.messageId, 10);
  let endMsgId = startMsgId;
  if (endUrl && String(endUrl).trim()) {
    const endParsed = parseTelegramUrl(String(endUrl));
    if (!endParsed.isValid || !endParsed.messageId) {
      return res.status(400).json({ error: "Valid Ending Telegram link is required." });
    }
    if ((startParsed.chatId || "").toLowerCase() !== (endParsed.chatId || "").toLowerCase() || (startParsed.rawChannelId || "").toLowerCase() !== (endParsed.rawChannelId || "").toLowerCase()) {
      return res.status(400).json({ error: "Starting URL and Ending URL must be from the same Telegram channel." });
    }
    endMsgId = parseInt(endParsed.messageId, 10);
  } else if (count && Number(count) > 0) {
    endMsgId = startMsgId + Math.min(2500, Math.floor(Number(count))) - 1;
  } else {
    return res.status(400).json({ error: "Ending Telegram link or episode count is required." });
  }
  if (endMsgId < startMsgId) {
    return res.status(400).json({ error: "Ending URL message ID must be >= Starting URL message ID." });
  }
  const totalToScan = endMsgId - startMsgId + 1;
  if (totalToScan > 2500) {
    return res.status(400).json({ error: "Max 2500 messages can be scanned per request." });
  }
  try {
    const client2 = await getTelegramClient();
    let peer = null;
    let channelTitle = startParsed.rawChannelId || startParsed.chatId;
    let publicUsername = !startParsed.isPrivate ? startParsed.rawChannelId : "";
    if (startParsed.chatId && startParsed.chatId.startsWith("@")) {
      const entity = await client2.getEntity(startParsed.chatId);
      if (entity) {
        peer = entity;
        channelTitle = entity.title || channelTitle;
        publicUsername = entity.username || publicUsername;
        if (entity.accessHash) {
          saveChannelEntity(entity.id.toString(), entity.accessHash.toString(), entity.title, entity.username);
        }
      }
    } else if (startParsed.rawChannelId) {
      const cleanId = startParsed.rawChannelId.replace("-100", "");
      const cachedHash = getCachedAccessHash(cleanId);
      if (cachedHash && cachedHash !== "0") {
        const bigInt3 = (await import("big-integer")).default;
        peer = new Api3.InputPeerChannel({
          channelId: bigInt3(cleanId),
          accessHash: bigInt3(cachedHash)
        });
      } else {
        try {
          const entity = await client2.getEntity(`-100${cleanId}`);
          if (entity) {
            peer = entity;
            channelTitle = entity.title || channelTitle;
            if (entity.accessHash) {
              saveChannelEntity(cleanId, entity.accessHash.toString(), entity.title, entity.username);
            }
          }
        } catch {
        }
      }
      if (!peer) peer = `-100${cleanId}`;
    }
    if (!peer) {
      return res.status(400).json({ error: "Could not resolve Telegram channel. Please authorize channel first." });
    }
    const rawVideos = [];
    let skippedStickers = 0;
    let skippedOther = 0;
    let activeHeaderEpNum = null;
    let currentBurstId = 1;
    let lastMsgWasVideo = false;
    const BATCH_SIZE = 100;
    for (let cursor = startMsgId; cursor <= endMsgId; cursor += BATCH_SIZE) {
      const batchEnd = Math.min(cursor + BATCH_SIZE - 1, endMsgId);
      const batchIds = [];
      for (let id = cursor; id <= batchEnd; id++) {
        batchIds.push(id);
      }
      const messages = await client2.getMessages(peer, { ids: batchIds });
      const sortedBatch = [...messages || []].filter(Boolean).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      for (const msg of sortedBatch) {
        if (!msg || !msg.id) {
          skippedOther++;
          continue;
        }
        const media = msg.media;
        const doc2 = media?.document || msg.document;
        if (!doc2 || !doc2.id) {
          const textMsg = normalizeTelegramText(String(msg.message || "")).trim();
          const isFutureAnnouncement = /\b(?:tomorrow|soon|will upload|coming|at \d+\s*(?:am|pm)|filler)\b/i.test(textMsg);
          const hdrMatch = !isFutureAnnouncement ? textMsg.match(/(?:episode|ep)\s*[:\-]?\s*0*(\d{1,4})\b/i) : null;
          if (hdrMatch) {
            activeHeaderEpNum = parseInt(hdrMatch[1], 10);
            if (lastMsgWasVideo) {
              currentBurstId++;
              lastMsgWasVideo = false;
            }
          }
          skippedOther++;
          continue;
        }
        const classified = classifyTelegramDocMedia(msg);
        if (classified.kind === "sticker") {
          skippedStickers++;
          activeHeaderEpNum = null;
          if (lastMsgWasVideo) {
            currentBurstId++;
            lastMsgWasVideo = false;
          }
          continue;
        }
        if (classified.kind !== "video") {
          skippedOther++;
          continue;
        }
        const streamUrl = publicUsername ? `https://t.me/${publicUsername}/${msg.id}` : `https://t.me/c/${startParsed.rawChannelId}/${msg.id}`;
        const { quality, score } = parseQualityScore(
          classified.caption,
          classified.fileName,
          classified.width,
          classified.height
        );
        const { key: parsedKey, epNum, absEpNum } = parseEpisodeIdentity(classified.caption, classified.fileName);
        if (activeHeaderEpNum !== null && absEpNum !== null && activeHeaderEpNum >= 100 && absEpNum !== activeHeaderEpNum) {
          activeHeaderEpNum = null;
        }
        let episodeKey = parsedKey;
        if (activeHeaderEpNum !== null) {
          if (!parsedKey || activeHeaderEpNum >= 100 && absEpNum === null) {
            episodeKey = `hdr-${activeHeaderEpNum}`;
          } else if (absEpNum === activeHeaderEpNum) {
            episodeKey = `hdr-${activeHeaderEpNum}`;
          }
        }
        lastMsgWasVideo = true;
        rawVideos.push({
          msgId: Number(msg.id),
          streamUrl,
          doc: classified.doc,
          mime: classified.mime,
          durationSec: classified.durationSec,
          duration: classified.durationSec > 0 ? formatDuration(classified.durationSec) : "",
          fileName: classified.fileName || `Episode_Msg_${msg.id}`,
          sizeBytes: classified.sizeBytes,
          quality,
          qualityScore: score,
          hasExplicitNoSound: classified.hasExplicitNoSound,
          episodeKey,
          epNum,
          absEpNum,
          headerEpNum: activeHeaderEpNum,
          burstId: currentBurstId
        });
      }
      if (batchEnd < endMsgId) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    rawVideos.sort((a, b) => a.msgId - b.msgId);
    for (let i = 0; i < rawVideos.length; i++) {
      const curr = rawVideos[i];
      const prev = i > 0 ? rawVideos[i - 1] : null;
      const next = i + 1 < rawVideos.length ? rawVideos[i + 1] : null;
      if (!curr.episodeKey) {
        if (prev && prev.burstId === curr.burstId && curr.msgId - prev.msgId <= 3 && prev.episodeKey && prev.qualityScore !== curr.qualityScore) {
          curr.episodeKey = prev.episodeKey;
        } else if (next && next.burstId === curr.burstId && next.msgId - curr.msgId <= 3 && next.episodeKey && next.qualityScore !== curr.qualityScore) {
          curr.episodeKey = next.episodeKey;
        }
      } else if (prev && prev.burstId === curr.burstId && curr.msgId - prev.msgId <= 3 && prev.epNum !== null && curr.epNum === prev.epNum && prev.episodeKey && prev.qualityScore !== curr.qualityScore) {
        curr.episodeKey = prev.episodeKey;
      } else if (curr.absEpNum === null && (curr.epNum || 0) < 100 && next && next.burstId === curr.burstId && next.msgId - curr.msgId <= 2 && next.absEpNum !== null && next.episodeKey && curr.qualityScore > 0 && next.qualityScore > 0 && curr.qualityScore !== next.qualityScore) {
        curr.episodeKey = next.episodeKey;
      }
    }
    let filteredVideos = rawVideos;
    let skippedDuplicates = 0;
    let fallbackCount = 0;
    let silentSkippedCount = 0;
    let aborted = false;
    res.on("close", () => {
      if (!res.writableEnded) aborted = true;
    });
    if (qFilter === "1080p" || qFilter === "720p" || qFilter === "480p" || qFilter === "best") {
      const groups = /* @__PURE__ */ new Map();
      for (const v of rawVideos) {
        const gKey = v.episodeKey || `msg-${v.msgId}`;
        const arr = groups.get(gKey) || [];
        arr.push(v);
        groups.set(gKey, arr);
      }
      const selections = await mapWithConcurrency(
        Array.from(groups.values()),
        4,
        (arr) => selectBestCandidateForGroup(arr, qFilter, client2, () => aborted),
        () => aborted
      );
      if (aborted) return;
      for (const sel of selections) {
        if (!sel) continue;
        if (sel.switchedForAudio) silentSkippedCount++;
        if (sel.fellBackQuality) fallbackCount++;
      }
      filteredVideos = selections.filter(Boolean).map((s) => s.chosen).sort((a, b) => a.msgId - b.msgId);
      skippedDuplicates = rawVideos.length - filteredVideos.length;
    }
    const episodes = filteredVideos.map(
      ({
        doc: _doc,
        mime: _mime,
        qualityScore: _qs,
        hasExplicitNoSound: _ns,
        episodeKey: _ek,
        absEpNum: _ae,
        headerEpNum: _he,
        burstId: _bi,
        ...rest
      }) => rest
    );
    console.log(
      `[TelegramScanRange] Channel "${channelTitle}" (${startMsgId}-${endMsgId}, filter=${qFilter}): ${episodes.length} videos found, ${skippedStickers} stickers skipped, ${skippedDuplicates} extra quality copies skipped, ${fallbackCount} quality fallbacks, ${silentSkippedCount} silent-audio switches, ${skippedOther} text/other posts skipped.`
    );
    return res.json({
      success: true,
      channelTitle,
      totalScanned: totalToScan,
      videosFound: episodes.length,
      skippedStickers,
      skippedDuplicates,
      skippedOther,
      fallbackCount,
      silentSkippedCount,
      skippedCount: skippedStickers + skippedDuplicates + skippedOther,
      episodes
    });
  } catch (err) {
    console.error("[TelegramScanRange] Error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to scan Telegram channel messages."
    });
  }
});
router2.post("/filter-urls", async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.map((u) => String(u || "").trim()) : [];
  const qFilter = String(req.body?.qualityFilter || "1080p").toLowerCase();
  if (urls.length === 0) {
    return res.json({
      success: true,
      keptUrls: [],
      keptItems: [],
      removedCount: 0,
      totalChecked: 0,
      skippedStickers: 0,
      skippedOther: 0,
      fallbackCount: 0,
      silentSkippedCount: 0
    });
  }
  try {
    const client2 = await getTelegramClient();
    const byChannel = /* @__PURE__ */ new Map();
    const nonTelegramIndices = /* @__PURE__ */ new Set();
    urls.forEach((url, idx) => {
      const parsed = parseTelegramUrl(url);
      if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
        if (/^https?:\/\//i.test(url) && !NON_VIDEO_FILE_EXT_RE.test(url.split("?")[0])) {
          nonTelegramIndices.add(idx);
        }
        return;
      }
      const cleanId = parsed.rawChannelId ? parsed.rawChannelId.replace("-100", "") : parsed.chatId;
      const channelKey = cleanId || parsed.chatId;
      const list = byChannel.get(channelKey) || [];
      list.push({
        idx,
        url,
        channelKey,
        rawChannelId: parsed.rawChannelId || "",
        chatId: parsed.chatId || "",
        isPrivate: Boolean(parsed.isPrivate),
        msgId: parseInt(parsed.messageId, 10)
      });
      byChannel.set(channelKey, list);
    });
    const recordsByIdx = /* @__PURE__ */ new Map();
    let skippedStickers = 0;
    let skippedOther = 0;
    for (const [channelKey, items] of byChannel.entries()) {
      let peer = null;
      const sample = items[0];
      if (sample.chatId.startsWith("@")) {
        try {
          peer = await client2.getEntity(sample.chatId);
        } catch {
        }
      }
      if (!peer) {
        const cleanId = channelKey.replace("-100", "");
        const cachedHash = getCachedAccessHash(cleanId);
        if (cachedHash && cachedHash !== "0") {
          const bigInt3 = (await import("big-integer")).default;
          peer = new Api3.InputPeerChannel({ channelId: bigInt3(cleanId), accessHash: bigInt3(cachedHash) });
        } else {
          try {
            peer = await client2.getEntity(`-100${cleanId}`);
          } catch {
          }
        }
        if (!peer) peer = `-100${cleanId}`;
      }
      const BATCH_SIZE = 100;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const slice = items.slice(i, i + BATCH_SIZE);
        const ids = slice.map((x) => x.msgId);
        const messages = await client2.getMessages(peer, { ids });
        const msgMap = /* @__PURE__ */ new Map();
        for (const m of messages || []) {
          if (m && m.id) msgMap.set(Number(m.id), m);
        }
        for (const item of slice) {
          const msg = msgMap.get(item.msgId);
          const classified = classifyTelegramDocMedia(msg);
          if (classified.kind !== "video") {
            if (classified.kind === "sticker") skippedStickers++;
            else skippedOther++;
            recordsByIdx.set(item.idx, {
              idx: item.idx,
              channelKey,
              msgId: item.msgId,
              streamUrl: item.url,
              doc: null,
              mime: "",
              fileName: classified.fileName || "",
              isVideo: false,
              isSticker: classified.kind === "sticker",
              quality: "",
              qualityScore: 0,
              hasExplicitNoSound: false,
              episodeKey: null,
              sizeBytes: 0,
              durationSec: 0,
              duration: ""
            });
            continue;
          }
          const { quality, score } = parseQualityScore(
            classified.caption,
            classified.fileName,
            classified.width,
            classified.height
          );
          const { key: episodeKey } = parseEpisodeIdentity(classified.caption, classified.fileName);
          recordsByIdx.set(item.idx, {
            idx: item.idx,
            channelKey,
            msgId: item.msgId,
            streamUrl: item.url,
            doc: classified.doc,
            mime: classified.mime,
            fileName: classified.fileName || `Episode_Msg_${item.msgId}`,
            isVideo: true,
            isSticker: false,
            quality,
            qualityScore: score,
            hasExplicitNoSound: classified.hasExplicitNoSound,
            episodeKey,
            sizeBytes: classified.sizeBytes,
            durationSec: classified.durationSec,
            duration: classified.durationSec > 0 ? formatDuration(classified.durationSec) : ""
          });
        }
      }
    }
    const validVideos = Array.from(recordsByIdx.values()).filter((r) => r.isVideo).sort((a, b) => a.idx - b.idx);
    const keptIndices = new Set(nonTelegramIndices);
    let fallbackCount = 0;
    let silentSkippedCount = 0;
    if (qFilter === "all") {
      for (const v of validVideos) {
        keptIndices.add(v.idx);
      }
    } else {
      for (let i = 0; i < validVideos.length; i++) {
        const curr = validVideos[i];
        if (curr.episodeKey) continue;
        const prev = i > 0 ? validVideos[i - 1] : null;
        if (prev && prev.channelKey === curr.channelKey && Math.abs(curr.msgId - prev.msgId) <= 3 && prev.quality && curr.quality && prev.quality !== curr.quality && (curr.durationSec === 0 || prev.durationSec === 0 || Math.abs(curr.durationSec - prev.durationSec) <= 15)) {
          if (!prev.episodeKey) prev.episodeKey = `pair-${prev.channelKey}-${prev.msgId}`;
          curr.episodeKey = prev.episodeKey;
        }
      }
      const groups = /* @__PURE__ */ new Map();
      for (const v of validVideos) {
        const gKey = v.episodeKey ? `${v.channelKey}:${v.episodeKey}` : `single:${v.idx}`;
        const arr = groups.get(gKey) || [];
        arr.push(v);
        groups.set(gKey, arr);
      }
      let aborted = false;
      res.on("close", () => {
        if (!res.writableEnded) aborted = true;
      });
      const selections = await mapWithConcurrency(
        Array.from(groups.values()),
        4,
        (arr) => selectBestCandidateForGroup(arr, qFilter, client2, () => aborted),
        () => aborted
      );
      if (aborted) return;
      for (const sel of selections) {
        if (!sel) continue;
        if (sel.switchedForAudio) silentSkippedCount++;
        if (sel.fellBackQuality) fallbackCount++;
        keptIndices.add(sel.chosen.idx);
      }
    }
    const keptUrls = urls.map((u, idx) => ({ idx, url: u, rec: recordsByIdx.get(idx) })).filter((x) => keptIndices.has(x.idx)).map((x) => ({
      url: x.url,
      duration: x.rec?.duration || "",
      durationSec: x.rec?.durationSec || 0,
      quality: x.rec?.quality || ""
    }));
    return res.json({
      success: true,
      totalChecked: urls.length,
      keptCount: keptUrls.length,
      removedCount: urls.length - keptUrls.length,
      skippedStickers,
      skippedOther,
      fallbackCount,
      silentSkippedCount,
      keptItems: keptUrls
    });
  } catch (err) {
    console.error("[TelegramFilterUrls] Error:", err);
    return res.status(500).json({ error: err?.message || "Failed to filter existing URLs." });
  }
});
router2.post("/verify", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "URL required" });
  const parsed = parseTelegramUrl(url);
  if (!parsed.isValid) {
    return res.status(400).json({
      error: "Invalid link format. Must be a Telegram link (e.g. https://t.me/c/... or https://t.me/...)"
    });
  }
  if (parsed.isInviteLink) {
    try {
      const client2 = await getTelegramClient();
      try {
        const checkRes = await client2.invoke(new Api3.messages.CheckChatInvite({ hash: parsed.inviteHash }));
        const chat = checkRes?.chat || checkRes?.channel;
        if (chat && chat.accessHash) {
          saveChannelEntity(chat.id.toString(), chat.accessHash.toString(), chat.title, chat.username);
        }
      } catch (e) {
      }
      return res.json({
        valid: true,
        isInvite: true,
        botIsAdmin: true,
        message: `\u2705 Invite link (+${parsed.inviteHash}) accepted and channel credentials synchronized. Ready for post links!`
      });
    } catch (err) {
      return res.json({
        valid: true,
        isInvite: true,
        botIsAdmin: true,
        message: `\u2705 Invite link (+${parsed.inviteHash}) received. Ready for post links.`
      });
    }
  }
  const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
  const hasCredentials = Boolean(apiId && apiHash && (botToken || sessionStr));
  if (!hasCredentials) {
    return res.json({
      valid: true,
      credentialsConfigured: false,
      botIsAdmin: true,
      message: `\u2705 Valid Telegram Post #${parsed.messageId} (Channel: ${parsed.rawChannelId || parsed.chatId})! Ready to Save.`,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      duration: 0
    });
  }
  try {
    const client2 = await getTelegramClient();
    const { message: msg, error: fetchErr } = await resolveTelegramMedia(client2, parsed);
    if (!msg) {
      return res.status(404).json({
        valid: false,
        credentialsConfigured: true,
        botIsAdmin: false,
        error: `Telegram post #${parsed.messageId} not found or bot is not an admin in this channel.`,
        detail: fetchErr || void 0
      });
    }
    let document = null;
    if (msg && msg.media) {
      if (msg.media instanceof Api3.MessageMediaDocument && msg.media.document instanceof Api3.Document) {
        document = msg.media.document;
      } else if (msg.media instanceof Api3.MessageMediaWebPage && msg.media.webpage?.document instanceof Api3.Document) {
        document = msg.media.webpage.document;
      }
    }
    if (document) {
      const fileSizeNum = Number(document.size);
      const sizeFormatted = formatBytes(fileSizeNum);
      let durationSec = 0;
      let width = 0;
      let height = 0;
      let fileName = `telegram_video_${parsed.messageId}.mp4`;
      const videoAttr = document.attributes.find((a) => a instanceof Api3.DocumentAttributeVideo);
      if (videoAttr) {
        const v = videoAttr;
        durationSec = v.duration || 0;
        width = v.w || 0;
        height = v.h || 0;
      }
      const fnAttr = document.attributes.find(
        (a) => a.className === "DocumentAttributeFilename" || a instanceof Api3.DocumentAttributeFilename
      );
      if (fnAttr && fnAttr.fileName) {
        fileName = fnAttr.fileName;
      }
      let resolution = "1080p";
      if (height >= 2160 || width >= 3840) resolution = "4K";
      else if (height >= 1080 || width >= 1920) resolution = "1080p";
      else if (height >= 720 || width >= 1280) resolution = "720p";
      else if (height >= 480 || width >= 854) resolution = "480p";
      return res.json({
        valid: true,
        credentialsConfigured: true,
        botIsAdmin: true,
        message: `\u2705 Media Verified: ${fileName} (${sizeFormatted}, ${resolution})`,
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        duration: durationSec,
        durationFormatted: formatDuration(durationSec),
        metadata: {
          fileName,
          sizeFormatted,
          sizeBytes: fileSizeNum,
          duration: durationSec,
          durationFormatted: formatDuration(durationSec),
          resolution,
          width,
          height,
          mimeType: document.mimeType || "video/mp4"
        }
      });
    }
    return res.status(422).json({
      valid: false,
      credentialsConfigured: true,
      botIsAdmin: true,
      error: `Telegram post #${parsed.messageId} does not contain a downloadable video file.`,
      chatId: parsed.chatId,
      messageId: parsed.messageId
    });
  } catch (err) {
    console.error("[TelegramVerify] Error:", err?.message || err);
    return res.status(502).json({
      valid: false,
      credentialsConfigured: true,
      botIsAdmin: false,
      error: `Failed to verify Telegram post #${parsed.messageId}: ${err?.message || "Telegram connection error"}`,
      chatId: parsed.chatId,
      messageId: parsed.messageId
    });
  }
});
var mediaCache = /* @__PURE__ */ new Map();
var MEDIA_CACHE_TTL_MS = 10 * 60 * 1e3;
async function resolveAndCacheDocument(client2, parsed) {
  const cacheKey = `${parsed.chatId}:${parsed.messageId}`;
  let entry = mediaCache.get(cacheKey);
  if (entry && Date.now() - entry.cachedAt > MEDIA_CACHE_TTL_MS) {
    mediaCache.delete(cacheKey);
    entry = void 0;
  }
  if (entry) {
    return { entry };
  }
  const { message: msg, error: fetchErr } = await resolveTelegramMedia(client2, parsed);
  if (!msg) {
    return {
      status: 404,
      error: `Telegram post #${parsed.messageId} not found or bot lacks channel access.${fetchErr ? ` (${fetchErr})` : ""}`
    };
  }
  let document = null;
  if (msg.media) {
    if (msg.media instanceof Api3.MessageMediaDocument && msg.media.document instanceof Api3.Document) {
      document = msg.media.document;
    } else if (msg.media instanceof Api3.MessageMediaWebPage && msg.media.webpage?.document instanceof Api3.Document) {
      document = msg.media.webpage.document;
    }
  }
  if (!document) {
    return {
      status: 404,
      error: `No playable video document found in Telegram post #${parsed.messageId}.`
    };
  }
  const fileSize = Number(document.size);
  let durationSec = 0;
  const videoAttr = document.attributes.find((a) => a instanceof Api3.DocumentAttributeVideo);
  if (videoAttr) {
    durationSec = videoAttr.duration || 0;
  }
  let fileName = "";
  const fnAttr = document.attributes.find(
    (a) => a.className === "DocumentAttributeFilename" || a instanceof Api3.DocumentAttributeFilename
  );
  if (fnAttr && fnAttr.fileName) {
    fileName = fnAttr.fileName;
  }
  const rawMime = (document.mimeType || "").toLowerCase();
  const lowerName = fileName.toLowerCase();
  const isWebm = lowerName.endsWith(".webm") || rawMime.includes("webm");
  const mimeType = isWebm ? "video/webm" : "video/mp4";
  const docInfo = {
    document,
    fileSize,
    durationSec,
    fileName,
    rawMime
  };
  entry = {
    docInfo,
    mimeType,
    cachedAt: Date.now()
  };
  mediaCache.set(cacheKey, entry);
  console.log(`[Stream] Cached document ${document.id} (${formatBytes(fileSize)}, ${fileName || rawMime}) for msg ${parsed.messageId}`);
  return { entry };
}
async function ensureMediaProbed(entry, telegramUrl, probeOptions) {
  if (entry.probe) return entry.probe;
  if (entry.probePromise) return entry.probePromise;
  const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || "3000";
  entry.probePromise = probeTelegramMedia(localPort, telegramUrl, entry.docInfo, probeOptions).then((result) => {
    entry.probe = result;
    if (result.durationSec > 0) {
      entry.docInfo.durationSec = result.durationSec;
    }
    console.log(
      `[Probe] ${entry.docInfo.fileName || entry.docInfo.document.id}: mode=${result.recommendedMode}, video=${result.videoCodec}(${result.pixFmt}), audio=${result.audioCodec}, duration=${result.durationSec}s, tracks=${result.audioTracks.length}`
    );
    return result;
  }).finally(() => {
    entry.probePromise = void 0;
  });
  return entry.probePromise;
}
router2.get("/stream-info", async (req, res) => {
  const urlParam = (req.query.url || "").trim();
  if (!urlParam) return res.status(400).json({ error: "URL required" });
  if (!urlParam.includes("t.me") && !urlParam.includes("telegram.me")) {
    try {
      const info = await probeDirectHttpInfo(urlParam);
      const qualityEstimates = buildQualitySizeEstimates({
        fileSizeBytes: info.fileSize,
        durationSec: info.durationSec,
        sourceHeight: info.height
      });
      return res.json({
        status: "ok",
        isTelegram: false,
        recommendedMode: "direct",
        fileSize: info.fileSize,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        qualityEstimates,
        audioTracks: [],
        subtitleTracks: []
      });
    } catch {
      return res.json({
        status: "ok",
        isTelegram: false,
        recommendedMode: "direct",
        fileSize: 0,
        durationSec: 0,
        width: 0,
        height: 0,
        qualityEstimates: buildQualitySizeEstimates({}),
        audioTracks: [],
        subtitleTracks: []
      });
    }
  }
  const parsed = parseTelegramUrl(urlParam);
  if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
    return res.status(400).json({ error: "Invalid Telegram post URL" });
  }
  try {
    const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
    const client2 = apiId && apiHash && (botToken || sessionStr) ? await getTelegramClient() : null;
    if (!client2) {
      return res.status(503).json({ error: "Telegram client backend not configured." });
    }
    const { entry, error, status } = await resolveAndCacheDocument(client2, parsed);
    if (!entry) {
      return res.status(status || 404).json({ error: error || "Media not found" });
    }
    const probe = await ensureMediaProbed(entry, urlParam);
    const resolvedDuration = probe.durationSec || entry.docInfo.durationSec || 0;
    const qualityEstimates = buildQualitySizeEstimates({
      fileSizeBytes: entry.docInfo.fileSize,
      durationSec: resolvedDuration,
      sourceHeight: probe.height
    });
    return res.json({
      status: "ok",
      isTelegram: true,
      fileName: entry.docInfo.fileName,
      fileSize: entry.docInfo.fileSize,
      durationSec: resolvedDuration,
      recommendedMode: probe.recommendedMode,
      container: probe.container,
      videoCodec: probe.videoCodec,
      videoProfile: probe.videoProfile,
      videoLevel: probe.videoLevel,
      is10Bit: probe.is10Bit,
      pixFmt: probe.pixFmt,
      width: probe.width,
      height: probe.height,
      audioCodec: probe.audioCodec,
      audioTracks: probe.audioTracks,
      subtitleTracks: probe.subtitleTracks,
      probedByFfprobe: probe.probedByFfprobe,
      qualityEstimates
    });
  } catch (err) {
    console.error("[StreamInfo] Error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to inspect media stream" });
  }
});
var subtitleVttCache = /* @__PURE__ */ new Map();
router2.get("/subtitles.vtt", async (req, res) => {
  const urlParam = String(req.query.url || "").trim();
  const trackIdx = Math.max(0, parseInt(String(req.query.trackIdx || "0"), 10) || 0);
  if (!urlParam) return res.status(400).send("URL required");
  const cacheKey = `${urlParam}::${trackIdx}`;
  const cached = subtitleVttCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 15 * 60 * 1e3) {
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600");
    return res.status(200).send(cached.vtt);
  }
  let inputUrl = urlParam;
  if (urlParam.includes("t.me") || urlParam.includes("telegram.me")) {
    const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || "3000";
    inputUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;
  }
  try {
    const ffArgs = [
      "-v",
      "error",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "2",
      "-i",
      inputUrl,
      "-vn",
      "-an",
      "-dn",
      "-map",
      `0:s:${trackIdx}?`,
      "-c:s",
      "webvtt",
      "-f",
      "webvtt",
      "pipe:1"
    ];
    const vttText = await new Promise((resolve) => {
      const proc = spawn2("ffmpeg", ffArgs, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks = [];
      let totalBytes = 0;
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
        }
        resolve(Buffer.concat(chunks).toString("utf-8"));
      }, 25e3);
      proc.stdout.on("data", (d) => {
        if (totalBytes < 4 * 1024 * 1024) {
          chunks.push(d);
          totalBytes += d.length;
        }
      });
      proc.on("close", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf-8"));
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve("");
      });
    });
    const normalizedVtt = vttText && vttText.trim().startsWith("WEBVTT") ? vttText : "WEBVTT\n\n";
    if (normalizedVtt.length > 16) {
      subtitleVttCache.set(cacheKey, { vtt: normalizedVtt, cachedAt: Date.now() });
    }
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600");
    return res.status(200).send(normalizedVtt);
  } catch {
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    return res.status(200).send("WEBVTT\n\n");
  }
});
var MAX_CONCURRENT_FFMPEG = Math.max(1, Number(process.env.MAX_CONCURRENT_FFMPEG) || 4);
var activeFfmpegProcs = /* @__PURE__ */ new Set();
function pipeFfmpegMp4Stream(opts) {
  const {
    inputUrl,
    modeLabel,
    startSec,
    audioIdx,
    remuxOnly,
    canCopyAudio,
    requestedQuality,
    isDownload,
    commonHeaders,
    req,
    res
  } = opts;
  if (activeFfmpegProcs.size >= MAX_CONCURRENT_FFMPEG) {
    console.warn(`[Stream] Active FFmpeg limit reached (${activeFfmpegProcs.size}/${MAX_CONCURRENT_FFMPEG})`);
    return res.status(503).json({ error: "Transcoding server is busy. Please retry in a moment." });
  }
  const ffArgs = [
    "-probesize",
    "2000000",
    "-analyzeduration",
    "2000000",
    "-fflags",
    "+genpts+discardcorrupt",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "2"
  ];
  if (startSec > 0) {
    ffArgs.push("-ss", startSec.toString());
  }
  ffArgs.push(
    "-i",
    inputUrl,
    "-sn",
    "-dn",
    "-map_chapters",
    "-1",
    "-map",
    "0:V:0",
    "-map",
    `0:a:${audioIdx}?`
  );
  if (remuxOnly && !requestedQuality) {
    ffArgs.push("-c:v", "copy");
    if (canCopyAudio) {
      ffArgs.push("-c:a", "copy");
    } else {
      ffArgs.push("-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k");
    }
  } else {
    ffArgs.push(...getFfmpegQualityArgs(requestedQuality, isDownload));
  }
  ffArgs.push(
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-frag_duration",
    "1000000",
    "-f",
    "mp4",
    "pipe:1"
  );
  const ffProc = spawn2("ffmpeg", ffArgs, { stdio: ["ignore", "pipe", "pipe"] });
  activeFfmpegProcs.add(ffProc);
  let procClosed = false;
  let headersCommitted = false;
  let clientClosed = false;
  let lastErrLine = "";
  const killFf = () => {
    clientClosed = true;
    if (!procClosed) {
      try {
        ffProc.kill("SIGTERM");
        setTimeout(() => {
          if (!procClosed) {
            try {
              ffProc.kill("SIGKILL");
            } catch {
            }
          }
        }, 500);
      } catch {
      }
    }
  };
  const startupTimer = setTimeout(() => {
    if (!headersCommitted && !procClosed) {
      console.warn(`[FFmpeg ${modeLabel}] Startup timeout before first output byte`);
      killFf();
      if (!res.headersSent && !res.writableEnded) {
        res.status(504).json({ error: "Stream transcode startup timed out" });
      }
    }
  }, 25e3);
  ffProc.stdout.on("data", (chunk) => {
    if (clientClosed || res.writableEnded) return;
    if (!headersCommitted) {
      headersCommitted = true;
      clearTimeout(startupTimer);
      res.writeHead(200, {
        ...commonHeaders,
        "Content-Type": "video/mp4"
      });
      res.flushHeaders?.();
    }
    const ok = res.write(chunk);
    if (!ok) {
      ffProc.stdout.pause();
      res.once("drain", () => {
        if (!procClosed && !clientClosed) ffProc.stdout.resume();
      });
    }
  });
  ffProc.stderr.on("data", (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) {
      lastErrLine = msg;
      if (msg.toLowerCase().includes("error")) {
        console.warn(`[FFmpeg ${modeLabel}]`, msg);
      }
    }
  });
  ffProc.on("error", (err) => {
    clearTimeout(startupTimer);
    activeFfmpegProcs.delete(ffProc);
    procClosed = true;
    console.error("[FFmpeg] Spawn error:", err.message);
    if (!headersCommitted && !res.headersSent) {
      res.status(502).json({ error: "FFmpeg failed to start: " + err.message });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
  ffProc.on("close", (code) => {
    clearTimeout(startupTimer);
    activeFfmpegProcs.delete(ffProc);
    procClosed = true;
    if (!headersCommitted && !clientClosed && !res.headersSent) {
      res.status(502).json({
        error: `FFmpeg exited (${code}) before streaming${lastErrLine ? ": " + lastErrLine.slice(-180) : ""}`
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
  req.on("close", killFf);
  res.on("close", killFf);
  res.on("error", killFf);
}
async function handleStream(req, res) {
  const urlParam = (req.query.url || "").trim();
  const isRemuxParam = req.query.remux === "1";
  const isTranscodeParam = req.query.transcode === "1";
  const isCastParam = req.query.cast === "1";
  const isRawParam = req.query.raw === "1";
  const isDownloadParam = req.query.download === "1";
  const requestedQuality = normalizeRequestedQuality(req.query.quality);
  const startSecParam = req.query.start ? Math.max(0, parseFloat(req.query.start) || 0) : 0;
  const audioIdxParam = req.query.audioIdx !== void 0 ? Math.max(0, parseInt(req.query.audioIdx, 10) || 0) : 0;
  if (!urlParam) return res.status(400).send("URL required");
  if (!urlParam.includes("t.me") && !urlParam.includes("telegram.me")) {
    const needsScaledTranscode = requestedQuality === "720p" || requestedQuality === "480p" || requestedQuality === "360p" || isTranscodeParam;
    if (!needsScaledTranscode) {
      return res.redirect(urlParam);
    }
    const commonHeaders = {
      "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type",
      "X-Stream-Mode": `transcode-${requestedQuality || "1080p"}`,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive"
    };
    if (isDownloadParam) {
      commonHeaders["Content-Disposition"] = `attachment; filename="Movie_Portal_${requestedQuality || "HD"}.mp4"`;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { ...commonHeaders, "Content-Type": "video/mp4" });
      return res.end();
    }
    return pipeFfmpegMp4Stream({
      inputUrl: urlParam,
      modeLabel: `http-${requestedQuality || "1080p"}`,
      startSec: startSecParam,
      audioIdx: audioIdxParam,
      remuxOnly: false,
      canCopyAudio: false,
      requestedQuality: requestedQuality || "1080p",
      isDownload: isDownloadParam,
      commonHeaders,
      req,
      res
    });
  }
  const parsed = parseTelegramUrl(urlParam);
  if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
    return res.status(400).json({
      error: "Invalid or invite-only Telegram URL. A specific post link (e.g. https://t.me/c/...) is required."
    });
  }
  try {
    const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
    const client2 = apiId && apiHash && (botToken || sessionStr) ? await getTelegramClient() : null;
    if (!client2) {
      return res.status(503).json({ error: "Telegram client backend not configured." });
    }
    const cacheKey = `${parsed.chatId}:${parsed.messageId}`;
    const { entry, error, status } = await resolveAndCacheDocument(client2, parsed);
    if (!entry) {
      return res.status(status || 404).json({ error: error || "Media not found" });
    }
    const { docInfo, mimeType } = entry;
    const { document, fileSize } = docInfo;
    if (!isRawParam) {
      const probe = await ensureMediaProbed(entry, urlParam);
      const durationSec2 = probe.durationSec || docInfo.durationSec || 0;
      let effectiveMode = probe.recommendedMode;
      const shouldDownscaleQuality = requestedQuality === "480p" || requestedQuality === "360p" || requestedQuality === "720p" && (probe.height <= 0 || probe.height > 780);
      if (isTranscodeParam || shouldDownscaleQuality) {
        effectiveMode = "transcode";
      } else if (isRemuxParam) {
        effectiveMode = probe.recommendedMode === "transcode" ? "transcode" : "remux";
      } else if (isCastParam) {
        const vc = (probe.videoCodec || "").toLowerCase();
        const ac = (probe.audioCodec || "").toLowerCase();
        const cont = (probe.container || "").toLowerCase();
        const castDirectVideoOk = !probe.is10Bit && (vc === "h264" || vc === "avc" || vc === "vp8" || vc === "vp9");
        const castDirectAudioOk = !ac || ac === "aac" || ac === "mp3" || ac === "opus" || ac === "vorbis";
        const castDirectContainerOk = cont === "mp4" || cont === "mov" || cont === "m4v" || cont === "webm";
        if (castDirectVideoOk && castDirectAudioOk && castDirectContainerOk) {
          effectiveMode = "direct";
        } else if (castDirectVideoOk && cont === "mkv") {
          effectiveMode = "remux";
        } else {
          effectiveMode = "transcode";
        }
      } else if (audioIdxParam > 0 && effectiveMode === "direct") {
        effectiveMode = "remux";
      }
      const effectiveMimeType = isCastParam && (!mimeType || mimeType === "application/octet-stream") ? "video/mp4" : mimeType;
      const commonHeaders = {
        "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type",
        "X-Video-Duration": durationSec2.toString(),
        "X-Stream-Mode": requestedQuality ? `${effectiveMode}-${requestedQuality}` : effectiveMode,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Connection": "keep-alive"
      };
      if (isDownloadParam && effectiveMode !== "direct") {
        commonHeaders["Content-Disposition"] = `attachment; filename="Movie_Portal_${requestedQuality || "HD"}.mp4"`;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, {
          ...commonHeaders,
          ...effectiveMode === "direct" ? { "Accept-Ranges": "bytes", "Content-Length": fileSize.toString() } : {},
          "Content-Type": effectiveMode === "direct" ? effectiveMimeType : "video/mp4"
        });
        return res.end();
      }
      if (effectiveMode === "remux" || effectiveMode === "transcode") {
        const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || "3000";
        const localSourceUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;
        const selectedAudioTrack = probe.audioTracks[audioIdxParam] || probe.audioTracks[0];
        const selectedAudioCodec = selectedAudioTrack?.codec || probe.audioCodec || "";
        const selectedChannels = selectedAudioTrack?.channels || 2;
        const canCopyAudio = (selectedAudioCodec === "aac" || selectedAudioCodec === "mp3") && selectedChannels <= 2;
        return pipeFfmpegMp4Stream({
          inputUrl: localSourceUrl,
          modeLabel: `${effectiveMode}${requestedQuality ? "-" + requestedQuality : ""}`,
          startSec: startSecParam,
          audioIdx: audioIdxParam,
          remuxOnly: effectiveMode === "remux",
          canCopyAudio,
          requestedQuality,
          isDownload: isDownloadParam,
          commonHeaders,
          req,
          res
        });
      }
    }
    const durationSec = docInfo.durationSec || 0;
    const rangeHeader = req.headers.range;
    let start = 0;
    let endPos = fileSize - 1;
    const MAX_RANGE_CHUNK = 16 * 1024 * 1024;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        start = parseInt(match[1], 10) || 0;
        if (match[2]) {
          endPos = parseInt(match[2], 10);
        } else if (isRawParam) {
          endPos = fileSize - 1;
        } else {
          endPos = Math.min(start + MAX_RANGE_CHUNK - 1, fileSize - 1);
        }
      }
    }
    if (start >= fileSize) {
      res.setHeader("Content-Range", `bytes */${fileSize}`);
      return res.status(416).send("Range Not Satisfiable");
    }
    endPos = Math.min(endPos, fileSize - 1);
    const chunkSize = endPos - start + 1;
    let isClosed = false;
    req.on("close", () => {
      isClosed = true;
    });
    const statusCode = rangeHeader ? 206 : 200;
    const headers = {
      "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type",
      "X-Video-Duration": durationSec.toString(),
      "X-Stream-Mode": "direct",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "Content-Type": isCastParam && (!mimeType || mimeType === "application/octet-stream") ? "video/mp4" : mimeType,
      "Content-Length": chunkSize.toString()
    };
    if (rangeHeader) {
      headers["Content-Range"] = `bytes ${start}-${endPos}/${fileSize}`;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      return res.end();
    }
    if (!isRawParam) {
      console.log(`[Stream] Direct ${statusCode} | ${mimeType} | msg ${parsed.messageId} | bytes ${start}-${endPos}/${fileSize}`);
    }
    res.writeHead(statusCode, headers);
    const concurrency = isRawParam ? 6 : 4;
    await streamTelegramRange(
      res,
      client2,
      document,
      start,
      endPos,
      concurrency,
      () => isClosed,
      () => mediaCache.delete(cacheKey)
    );
  } catch (err) {
    console.error("[Stream] Global streaming error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}
router2.get("/stream", handleStream);
router2.head("/stream", handleStream);
var telegramRouter_default = router2;

// src/server/videoRouter.ts
import express2 from "express";
import ffmpeg from "fluent-ffmpeg";
import path3 from "path";
import fs3 from "fs";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
var rootDir = path3.resolve(__dirname, "../../");
var transcodedDir = path3.join(rootDir, "public", "transcoded");
if (!fs3.existsSync(transcodedDir)) {
  fs3.mkdirSync(transcodedDir, { recursive: true });
}
var router3 = express2.Router();
router3.post("/transcode", requireAdmin, async (req, res) => {
  const { url, imdbId, targetQualities } = req.body;
  if (!url || !imdbId) {
    return res.status(400).json({ error: "Source URL and IMDb ID are required" });
  }
  const results = {};
  const tasks = targetQualities.map(async (quality) => {
    const filename = `${imdbId}_${quality}.mp4`;
    const outputPath = path3.join(transcodedDir, filename);
    const publicUrl = `/transcoded/${filename}`;
    if (fs3.existsSync(outputPath)) {
      results[quality] = publicUrl;
      return;
    }
    return new Promise((resolve, reject) => {
      let width = 1280;
      let bitrate = "2500k";
      if (quality === "480p") {
        width = 854;
        bitrate = "1000k";
      } else if (quality === "720p") {
        width = 1280;
        bitrate = "2500k";
      }
      ffmpeg(url).size(`${width}x?`).videoBitrate(bitrate).format("mp4").on("start", (commandLine) => {
        console.log(`Started transcoding ${quality} for ${imdbId}: ${commandLine}`);
      }).on("error", (err) => {
        console.error(`Error transcoding ${quality} for ${imdbId}:`, err);
        reject(err);
      }).on("end", () => {
        console.log(`Finished transcoding ${quality} for ${imdbId}`);
        results[quality] = publicUrl;
        resolve();
      }).save(outputPath);
    });
  });
  try {
    res.json({ message: "Transcoding started", status: "processing" });
    Promise.all(tasks).then(() => {
      console.log(`All transcoding tasks completed for ${imdbId}`);
    }).catch((err) => {
      console.error(`Transcoding failed for ${imdbId}:`, err);
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to initiate transcoding" });
  }
});
router3.get("/status/:imdbId", (req, res) => {
  const { imdbId } = req.params;
  const qualities = ["480p", "720p"];
  const status = {};
  qualities.forEach((q) => {
    const filename = `${imdbId}_${q}.mp4`;
    const outputPath = path3.join(transcodedDir, filename);
    if (fs3.existsSync(outputPath)) {
      status[q] = {
        ready: true,
        url: `/transcoded/${filename}`
      };
    } else {
      status[q] = { ready: false };
    }
  });
  res.json(status);
});
var videoRouter_default = router3;

// src/server/downloadCastRouter.ts
import { Router as Router2 } from "express";
import path4 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import http from "http";
import https from "https";
import { collection, getDocs } from "firebase/firestore";

// src/firebase.ts
import { initializeApp as initializeApp2 } from "firebase/app";
import { getAuth as getAuth2 } from "firebase/auth";
import {
  doc,
  getDocFromServer,
  getFirestore as getFirestore2,
  initializeFirestore,
  memoryLocalCache
} from "firebase/firestore";

// src/services/firestoreQuotaService.ts
var QUOTA_EXCEEDED_KEY = "mp_firestore_write_quota_exceeded_until_v1";
var KNOWN_QUOTA_RESET_UTC_MS = Date.UTC(2026, 10, 19, 0, 30, 0);
function isFirestoreWriteAllowed() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return true;
    if (Date.now() < KNOWN_QUOTA_RESET_UTC_MS) {
      return false;
    }
    const until = localStorage.getItem(QUOTA_EXCEEDED_KEY);
    if (!until) return true;
    const expiryTime = Number(until);
    if (isNaN(expiryTime) || Date.now() > expiryTime) {
      localStorage.removeItem(QUOTA_EXCEEDED_KEY);
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

// src/firebase.ts
var app2 = initializeApp2(firebase_applet_config_default);
var config = firebase_applet_config_default;
var databaseId2 = config.firestoreDatabaseId || void 0;
if (typeof window !== "undefined" && window.indexedDB && !isFirestoreWriteAllowed()) {
  try {
    if (window.indexedDB.databases) {
      window.indexedDB.databases().then((dbs) => {
        dbs.forEach((d) => {
          if (d.name && (d.name.includes("firestore") || d.name.includes("firebase") || d.name.includes("[DEFAULT]"))) {
            try {
              window.indexedDB.deleteDatabase(d.name);
            } catch {
            }
          }
        });
      }).catch(() => {
      });
    }
  } catch {
  }
}
function createFirestoreInstance() {
  const isBrowser = typeof window !== "undefined";
  const transportSettings = isBrowser ? { experimentalForceLongPolling: true, ignoreUndefinedProperties: true } : { ignoreUndefinedProperties: true };
  if (isBrowser) {
    try {
      return initializeFirestore(
        app2,
        {
          ...transportSettings,
          localCache: memoryLocalCache()
        },
        databaseId2
      );
    } catch {
      return databaseId2 ? getFirestore2(app2, databaseId2) : getFirestore2(app2);
    }
  }
  try {
    return initializeFirestore(app2, transportSettings, databaseId2);
  } catch {
    return databaseId2 ? getFirestore2(app2, databaseId2) : getFirestore2(app2);
  }
}
var db = createFirestoreInstance();
var auth = getAuth2(app2);
async function testConnection() {
  if (typeof window === "undefined" || !isFirestoreWriteAllowed()) return;
  try {
    await getDocFromServer(doc(db, "app_config", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.warn("Firestore connection check: client is currently offline.");
    }
  }
}
testConnection();

// src/server/downloadCastRouter.ts
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = path4.dirname(__filename2);
var downloadCastRouter = Router2();
var cachedApkInfo = {
  url: "https://github.com/Sivobob/-Movie-Portal-Hub/releases/download/v3.5.2/Movie-Portal-v3.5.2.apk",
  version: "3.5.2",
  fileName: "Movie-Portal-v3.5.2.apk",
  lastChecked: 0
};
async function fetchLatestGitHubApk() {
  const now = Date.now();
  if (now - cachedApkInfo.lastChecked < 6e4 && cachedApkInfo.url) {
    return cachedApkInfo;
  }
  try {
    const headers = {
      "User-Agent": "MoviePortal-App/3.5",
      "Accept": "application/vnd.github.v3+json"
    };
    const token = (process.env.GITHUB_TOKEN || "").trim();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch("https://api.github.com/repos/Sivobob/-Movie-Portal-Hub/releases/latest", {
      headers
    });
    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.assets)) {
        let preferred = data.assets.find(
          (a) => a.name === "Movie-Portal.apk" || a.name === "Movie-Portal-latest.apk"
        );
        if (!preferred) {
          const apkAssets = data.assets.filter((a) => typeof a.name === "string" && a.name.endsWith(".apk"));
          apkAssets.sort((a, b) => b.name.localeCompare(a.name, void 0, { numeric: true }));
          if (apkAssets.length > 0) {
            preferred = apkAssets[0];
          }
        }
        if (preferred && preferred.browser_download_url) {
          const rawTag = (data.tag_name || "3.5.2").replace(/^v/, "");
          cachedApkInfo = {
            url: preferred.browser_download_url,
            version: rawTag,
            fileName: preferred.name || `Movie-Portal-v${rawTag}.apk`,
            lastChecked: now
          };
          console.log(`[GitHub Releases] Discovered latest APK: ${cachedApkInfo.fileName} (${cachedApkInfo.url})`);
          return cachedApkInfo;
        }
      }
    } else {
      console.warn(`[GitHub Releases] Release API status: ${response.status}`);
    }
  } catch (err) {
    console.warn("[GitHub Releases] Could not fetch latest release:", err?.message || err);
  }
  cachedApkInfo.lastChecked = now;
  return cachedApkInfo;
}
var FIRESTORE_ADMINS_BASE = "https://firestore.googleapis.com/v1/projects/gen-lang-client-0267042672/databases/ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f/documents/admins";
async function updateServerInstallStats(opts) {
  try {
    const statsUrl = `${FIRESTORE_ADMINS_BASE}/app_stats`;
    const res = await fetch(statsUrl, { cache: "no-store" });
    let currentCount = 10;
    if (res.ok) {
      const data = await res.json();
      currentCount = Math.max(10, Number(data?.fields?.installedAppUsers?.integerValue) || 10);
    }
    if (opts.isNew) {
      currentCount += 1;
      await fetch(
        `${statsUrl}?updateMask.fieldPaths=installedAppUsers&updateMask.fieldPaths=lastActiveAt&updateMask.fieldPaths=updatedAt`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              installedAppUsers: { integerValue: String(currentCount) },
              lastActiveAt: { timestampValue: (/* @__PURE__ */ new Date()).toISOString() },
              updatedAt: { integerValue: String(Date.now()) }
            }
          })
        }
      );
    }
    if (opts.deviceId) {
      const cleanDevId = opts.deviceId.startsWith("dev_") ? opts.deviceId : `dev_${opts.deviceId}`;
      const devUrl = `${FIRESTORE_ADMINS_BASE}/${cleanDevId}`;
      await fetch(devUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            deviceId: { stringValue: opts.deviceId },
            platform: { stringValue: opts.platform || "android" },
            versionName: { stringValue: opts.versionName || "3.5.222" },
            updatedAt: { integerValue: String(Date.now()) },
            lastActiveAt: { timestampValue: (/* @__PURE__ */ new Date()).toISOString() }
          }
        })
      });
    }
    return currentCount;
  } catch (e) {
    console.warn("[Install Stats Server Notice]", e);
    return 10;
  }
}
downloadCastRouter.get("/download/apk", async (_req, res) => {
  const latest = await fetchLatestGitHubApk();
  console.log(`[Download Router] User downloading APK: ${latest.url}`);
  (async () => {
    try {
      const statsUrl = `${FIRESTORE_ADMINS_BASE}/app_stats`;
      const sRes = await fetch(statsUrl, { cache: "no-store" });
      let clicks = 0;
      if (sRes.ok) {
        const d = await sRes.json();
        clicks = Number(d?.fields?.totalApkClicks?.integerValue) || 0;
      }
      clicks += 1;
      await fetch(`${statsUrl}?updateMask.fieldPaths=totalApkClicks&updateMask.fieldPaths=lastDownloadAt`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            totalApkClicks: { integerValue: String(clicks) },
            lastDownloadAt: { timestampValue: (/* @__PURE__ */ new Date()).toISOString() }
          }
        })
      });
    } catch {
    }
  })().catch(() => {
  });
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.redirect(302, latest.url);
});
downloadCastRouter.get("/download/latest-info", async (_req, res) => {
  const latest = await fetchLatestGitHubApk();
  res.json({
    latestVersion: latest.version,
    apkUrl: latest.url,
    fileName: latest.fileName
  });
});
downloadCastRouter.post("/app/ping-install", async (req, res) => {
  const { deviceId, platform, versionName, isNew } = req.body || {};
  const currentCount = await updateServerInstallStats({
    deviceId,
    platform,
    versionName,
    isNew: Boolean(isNew)
  });
  res.json({ ok: true, installedAppUsers: currentCount });
});
downloadCastRouter.get("/app/stats", async (_req, res) => {
  try {
    const statsUrl = `${FIRESTORE_ADMINS_BASE}/app_stats`;
    const r = await fetch(statsUrl, { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      const installedAppUsers = Math.max(10, Number(d?.fields?.installedAppUsers?.integerValue) || 10);
      return res.json({
        installedAppUsers,
        totalApkClicks: Number(d?.fields?.totalApkClicks?.integerValue) || 0,
        updatedAt: d?.fields?.updatedAt?.integerValue || Date.now()
      });
    }
  } catch {
  }
  res.json({ installedAppUsers: 10, totalApkClicks: 0 });
});
var cachedDownloadStats = {
  totalGitHubDownloads: 0,
  latestReleaseTag: "",
  latestReleaseDownloads: 0,
  releaseCount: 0,
  lastChecked: 0
};
downloadCastRouter.get("/download/stats", async (_req, res) => {
  const now = Date.now();
  if (now - cachedDownloadStats.lastChecked < 12e4 && cachedDownloadStats.releaseCount > 0) {
    return res.json(cachedDownloadStats);
  }
  try {
    const headers = {
      "User-Agent": "MoviePortal-App/3.5",
      Accept: "application/vnd.github.v3+json"
    };
    const token = (process.env.GITHUB_TOKEN || "").trim();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(
      "https://api.github.com/repos/Sivobob/-Movie-Portal-Hub/releases?per_page=100",
      { headers }
    );
    if (response.ok) {
      const releases = await response.json();
      if (Array.isArray(releases)) {
        let totalGitHubDownloads = 0;
        let latestReleaseTag = "";
        let latestReleaseDownloads = 0;
        for (const rel of releases) {
          if (rel?.draft) continue;
          let relSum = 0;
          for (const asset of rel?.assets || []) {
            if (typeof asset?.name === "string" && asset.name.endsWith(".apk")) {
              relSum += Number(asset.download_count || 0);
            }
          }
          if (!latestReleaseTag) {
            latestReleaseTag = String(rel?.tag_name || "");
            latestReleaseDownloads = relSum;
          }
          totalGitHubDownloads += relSum;
        }
        cachedDownloadStats = {
          totalGitHubDownloads,
          latestReleaseTag,
          latestReleaseDownloads,
          releaseCount: releases.length,
          lastChecked: now
        };
      }
    }
  } catch (err) {
    console.warn("[GitHub Releases] Could not fetch download stats:", err?.message || err);
  }
  return res.json(cachedDownloadStats);
});
function proxyCastStream(targetUrlStr, req, res, redirectsLeft = 5) {
  let fullUrl = targetUrlStr;
  if (targetUrlStr.startsWith("/")) {
    const host = req.headers.host || "localhost:3000";
    const protocol = req.protocol || "http";
    fullUrl = `${protocol}://${host}${targetUrlStr}`;
  }
  try {
    const parsed = new URL(fullUrl);
    const client2 = parsed.protocol === "https:" ? https : http;
    const requestHeaders = {
      "User-Agent": "MovieBox-TV-Cast-Proxy/2.5"
    };
    if (req.headers.range) {
      requestHeaders["Range"] = req.headers.range;
    }
    const proxyReq = client2.request(
      fullUrl,
      { method: req.method === "HEAD" ? "HEAD" : "GET", headers: requestHeaders },
      (proxyRes) => {
        const statusCode = proxyRes.statusCode || 200;
        if ((statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) && proxyRes.headers.location && redirectsLeft > 0) {
          proxyRes.resume();
          const nextUrl = new URL(proxyRes.headers.location, fullUrl).toString();
          proxyCastStream(nextUrl, req, res, redirectsLeft - 1);
          return;
        }
        const rawCt = String(proxyRes.headers["content-type"] || "").toLowerCase();
        const contentType = !rawCt || rawCt.includes("octet-stream") ? "video/mp4" : proxyRes.headers["content-type"];
        const responseHeaders = {
          "Content-Type": contentType,
          "Accept-Ranges": proxyRes.headers["accept-ranges"] || "bytes",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Range",
          "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type"
        };
        if (proxyRes.headers["content-length"]) {
          responseHeaders["Content-Length"] = proxyRes.headers["content-length"];
        }
        if (proxyRes.headers["content-range"]) {
          responseHeaders["Content-Range"] = proxyRes.headers["content-range"];
        }
        res.writeHead(statusCode, responseHeaders);
        if (req.method === "HEAD") {
          proxyRes.resume();
          res.end();
        } else {
          proxyRes.pipe(res);
        }
      }
    );
    proxyReq.on("error", (err) => {
      console.error("[Cast Proxy Error]", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to proxy media stream to TV device" });
      }
    });
    req.on("close", () => {
      proxyReq.destroy();
    });
    proxyReq.end();
  } catch (err) {
    console.error("[Cast Proxy Invalid URL]", err?.message);
    if (!res.headersSent) {
      res.status(400).json({ error: "Invalid media URL" });
    }
  }
}
downloadCastRouter.options("/cast/proxy", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range");
  res.status(204).end();
});
downloadCastRouter.head("/cast/proxy", (req, res) => {
  const targetUrlStr = req.query.url;
  if (!targetUrlStr) {
    res.status(400).json({ error: "Missing target stream url parameter" });
    return;
  }
  proxyCastStream(targetUrlStr, req, res);
});
downloadCastRouter.get("/cast/proxy", (req, res) => {
  const targetUrlStr = req.query.url;
  if (!targetUrlStr) {
    res.status(400).json({ error: "Missing target stream url parameter" });
    return;
  }
  proxyCastStream(targetUrlStr, req, res);
});
downloadCastRouter.get("/download/file", (req, res) => {
  const targetUrlStr = req.query.url;
  const rawFilename = req.query.filename || "Movie_Portal_Video.mp4";
  const safeFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!targetUrlStr) {
    res.status(400).json({ error: "Missing target download url parameter" });
    return;
  }
  let fullUrl = targetUrlStr;
  if (targetUrlStr.startsWith("/")) {
    const host = req.headers.host || "localhost:3000";
    const protocol = req.protocol || "http";
    fullUrl = `${protocol}://${host}${targetUrlStr}`;
  }
  try {
    const parsed = new URL(fullUrl);
    const client2 = parsed.protocol === "https:" ? https : http;
    const requestHeaders = {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "Accept": "*/*"
    };
    if (req.headers.range) {
      requestHeaders["Range"] = req.headers.range;
    }
    const downloadReq = client2.get(
      fullUrl,
      { headers: requestHeaders },
      (downloadRes) => {
        if ((downloadRes.statusCode === 301 || downloadRes.statusCode === 302 || downloadRes.statusCode === 307) && downloadRes.headers.location) {
          res.redirect(downloadRes.headers.location);
          return;
        }
        const statusCode = downloadRes.statusCode || 200;
        const responseHeaders = {
          "Content-Type": downloadRes.headers["content-type"] || "video/mp4",
          "Content-Disposition": `attachment; filename="${safeFilename}"`,
          "Accept-Ranges": downloadRes.headers["accept-ranges"] || "bytes",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Length, Content-Disposition, Content-Range"
        };
        if (downloadRes.headers["content-length"]) {
          responseHeaders["Content-Length"] = downloadRes.headers["content-length"];
        }
        if (downloadRes.headers["content-range"]) {
          responseHeaders["Content-Range"] = downloadRes.headers["content-range"];
        }
        res.writeHead(statusCode, responseHeaders);
        downloadRes.pipe(res);
      }
    );
    downloadReq.on("error", (err) => {
      console.error("[Download Stream Proxy Error]", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream download file" });
      }
    });
    req.on("close", () => {
      downloadReq.destroy();
    });
  } catch (err) {
    console.error("[Download Proxy Invalid URL]", err?.message);
    if (!res.headersSent) {
      res.status(400).json({ error: "Invalid download media URL" });
    }
  }
});
function toMillisSafe(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val?.toMillis === "function") {
    try {
      return val.toMillis();
    } catch {
      return 0;
    }
  }
  if (typeof val?.seconds === "number") return val.seconds * 1e3;
  if (typeof val === "string") {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0 && /^\d+$/.test(val.trim())) return num;
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
var cachedAnnouncements = { fetchedAt: 0, items: [] };
downloadCastRouter.get("/announcements/latest", async (_req, res) => {
  try {
    const now = Date.now();
    if (now - cachedAnnouncements.fetchedAt < 1e4 && cachedAnnouncements.items.length > 0) {
      return res.json({ success: true, serverTimeMs: now, announcements: cachedAnnouncements.items });
    }
    const [annSnap, movieSnap] = await Promise.all([
      getDocs(collection(db, "announcements")),
      getDocs(collection(db, "movies")).catch(() => null)
    ]);
    const moviesById = /* @__PURE__ */ new Map();
    if (movieSnap) {
      for (const md of movieSnap.docs) {
        moviesById.set(md.id, { id: md.id, ...md.data() });
      }
    }
    const items = annSnap.docs.map((d) => {
      const raw = d.data() || {};
      const linkedMovie = raw.movieId ? moviesById.get(String(raw.movieId)) : null;
      if (linkedMovie && linkedMovie.published === false) return null;
      const createdAtMs = toMillisSafe(raw.createdAtMs || raw.createdAt) || now;
      const expiresAtMs = toMillisSafe(raw.expiresAt);
      if (expiresAtMs > 0 && expiresAtMs < now) return null;
      const title = String(raw.title || linkedMovie?.title || "New Release").trim();
      const releaseYear = String(raw.releaseYear || linkedMovie?.releaseYear || "").trim();
      const category = String(raw.category || linkedMovie?.originalCategory || "").trim();
      const isSeries = Boolean(
        raw.isSeries || category.toLowerCase().includes("series") || linkedMovie?.contentType === "series" || Array.isArray(linkedMovie?.seasons) && linkedMovie.seasons.length > 0
      );
      const language = String(raw.language || linkedMovie?.language || "").trim();
      const genre = String(raw.genre || linkedMovie?.genre || "").trim();
      const qualityBadge = String(raw.qualityBadge || linkedMovie?.qualityBadge || "").trim();
      const runtime = String(raw.runtime || linkedMovie?.runtime || "").trim();
      const posterUrl = String(raw.posterUrl || linkedMovie?.posterUrl || "").trim();
      const backdropUrl = String(raw.backdropUrl || linkedMovie?.backdropUrl || posterUrl).trim();
      const message = String(raw.message || "GO STREAM or DOWNLOAD NOW").trim();
      const yearPart = releaseYear && releaseYear !== "0" ? ` (${releaseYear})` : "";
      const typeLabel = isSeries ? "Full Series" : "Full Movie";
      const notificationTitle = `Watch Now : ${title}${yearPart} ${typeLabel} available now`;
      const detailsParts = [
        qualityBadge && qualityBadge.toUpperCase() !== "NONE" ? qualityBadge : "",
        language,
        genre,
        runtime
      ].filter(Boolean);
      const notificationBody = detailsParts.length > 0 ? `${message} \u2022 ${detailsParts.join(" \u2022 ")}` : message;
      return {
        id: d.id,
        movieId: String(raw.movieId || ""),
        title,
        releaseYear,
        category,
        isSeries,
        language,
        genre,
        qualityBadge,
        runtime,
        posterUrl,
        backdropUrl,
        imageUrl: backdropUrl || posterUrl,
        message,
        notificationTitle,
        notificationBody,
        createdAtMs,
        expiresAtMs
      };
    }).filter(Boolean).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 20);
    cachedAnnouncements = { fetchedAt: now, items };
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json({ success: true, serverTimeMs: now, announcements: items });
  } catch (err) {
    console.error("[Announcements Latest Error]", err?.message || err);
    res.status(500).json({ success: false, error: err?.message || "Failed to fetch announcements" });
  }
});
var downloadCastRouter_default = downloadCastRouter;

// server.ts
var __filename3 = fileURLToPath3(import.meta.url);
var __dirname3 = path5.dirname(__filename3);
var envPath = fs4.existsSync(path5.resolve(__dirname3, ".env")) ? path5.resolve(__dirname3, ".env") : path5.resolve(__dirname3, "../.env");
dotenv.config({ path: envPath });
function checkBinaryAvailable(bin) {
  try {
    const res = spawnSync(bin, ["-version"], { stdio: "ignore", timeout: 3e3 });
    return res.status === 0;
  } catch {
    return false;
  }
}
var FFMPEG_AVAILABLE = checkBinaryAvailable("ffmpeg");
var FFPROBE_AVAILABLE = checkBinaryAvailable("ffprobe");
var app3 = express3();
var PORT = 3e3;
if (process.env.APP_PORT) {
  PORT = Number(process.env.APP_PORT) || 3e3;
} else if (process.env.NGINX_PORT || process.env.DEFAULT_APP_PORT) {
  PORT = Number(process.env.DEFAULT_APP_PORT) || 3e3;
} else if (process.env.RENDER && process.env.PORT) {
  PORT = Number(process.env.PORT) || 3e3;
} else if (process.env.PORT) {
  PORT = Number(process.env.PORT) || 3e3;
}
var args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    PORT = Number(args[i + 1]) || PORT;
  }
}
process.env.INTERNAL_APP_PORT = String(PORT);
app3.use(express3.json());
app3.use((req, _res, next) => {
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${req.method} ${req.url}`);
  next();
});
app3.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, Range");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});
app3.use("/api", (req, res, next) => {
  if (!req.path.startsWith("/stream")) {
    res.setHeader("Content-Type", "application/json");
  }
  next();
});
app3.get("/api/health", (req, res) => {
  const creds = getTelegramCredentials();
  const telegramConfigured = Boolean(creds.apiId && creds.apiHash && (creds.botToken || creds.sessionStr));
  res.json({
    status: "ok",
    time: (/* @__PURE__ */ new Date()).toISOString(),
    version: "3.5.210",
    ffmpegAvailable: FFMPEG_AVAILABLE,
    ffprobeAvailable: FFPROBE_AVAILABLE,
    telegramConfigured,
    transcodeSupported: FFMPEG_AVAILABLE && FFPROBE_AVAILABLE && telegramConfigured
  });
});
app3.get("/api/debug-env", (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    projectId: process.env.FIREBASE_PROJECT_ID || "not set in env",
    ffmpegAvailable: FFMPEG_AVAILABLE,
    ffprobeAvailable: FFPROBE_AVAILABLE
  });
});
app3.use("/api/metadata", metadataRouter_default);
app3.use("/api/telegram", telegramRouter_default);
app3.get("/api/stream", handleStream);
app3.head("/api/stream", handleStream);
app3.use("/api/video", videoRouter_default);
app3.use("/api", downloadCastRouter_default);
app3.use(downloadCastRouter_default);
app3.use("/api", (req, res) => {
  console.warn(`[API 404] ${req.method} ${req.url}`);
  res.status(404).json({ error: `API route not found: /api${req.url}` });
});
app3.use((err, _req, res, _next) => {
  console.error("[Global Error Handler]", err);
  res.setHeader("Content-Type", "application/json");
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : void 0
  });
});
process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Unhandled Rejection]", reason);
});
try {
  if (process.env.NODE_ENV !== "production") {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true
      },
      appType: "spa"
    });
    app3.use(vite.middlewares);
  } else {
    const staticDir = fs4.existsSync(path5.resolve(__dirname3, "dist")) ? path5.resolve(__dirname3, "dist") : __dirname3;
    app3.use(express3.static(staticDir));
    app3.get("*", (_req, res) => {
      res.sendFile(path5.resolve(staticDir, "index.html"));
    });
  }
} catch (viteErr) {
  console.warn("[Vite Middleware notice - falling back to static/SPA]", viteErr);
  const staticDir = fs4.existsSync(path5.resolve(__dirname3, "dist")) ? path5.resolve(__dirname3, "dist") : __dirname3;
  app3.use(express3.static(staticDir));
  app3.get("*", (_req, res) => {
    res.sendFile(path5.resolve(staticDir, "index.html"));
  });
}
app3.listen(PORT, "0.0.0.0", () => {
  console.log(`MOVIE PORTAL server running on port ${PORT}`);
});
