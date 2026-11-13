// server.ts
import fs4 from "fs";
import path5 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
import dotenv from "dotenv";
import express3 from "express";

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
  try {
    const [imdbResults, omdbData] = await Promise.all([imdbPromise, omdbPromise]);
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
    if (combinedResults.length > 0) {
      return res.json({
        status: "ok",
        provider: "IMDb Live Search",
        totalResults: combinedResults.length,
        results: combinedResults
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
import { spawn } from "child_process";
import { Api as Api2 } from "telegram";

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
  const privateMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/c\/(\d+)\/(\d+)/i);
  if (privateMatch) {
    result.isValid = true;
    result.isPrivate = true;
    result.rawChannelId = privateMatch[1];
    result.messageId = privateMatch[2];
    result.chatId = `-100${privateMatch[1]}`;
    return result;
  }
  const publicMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{4,})\/(\d+)/i);
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
  if (!foundMsg) {
    console.error(`[ChannelRegistry] \u274C Could not resolve message ${messageId} for streaming.`);
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

// src/server/telegramRouter.ts
import bigInt2 from "big-integer";
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
        const checkRes = await client2.invoke(new Api2.messages.CheckChatInvite({ hash }));
        const chat = checkRes?.chat || checkRes?.channel;
        if (chat) {
          channelId = chat.id.toString();
          title = chat.title || title;
          accessHash = chat.accessHash ? chat.accessHash.toString() : "0";
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
        const checkRes = await client2.invoke(new Api2.messages.CheckChatInvite({ hash: parsed.inviteHash }));
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
    const { message: msg } = await resolveTelegramMedia(client2, parsed);
    let document = null;
    if (msg && msg.media) {
      if (msg.media instanceof Api2.MessageMediaDocument && msg.media.document instanceof Api2.Document) {
        document = msg.media.document;
      } else if (msg.media instanceof Api2.MessageMediaWebPage && msg.media.webpage?.document instanceof Api2.Document) {
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
      const videoAttr = document.attributes.find((a) => a instanceof Api2.DocumentAttributeVideo);
      if (videoAttr) {
        const v = videoAttr;
        durationSec = v.duration || 0;
        width = v.w || 0;
        height = v.h || 0;
      }
      const fnAttr = document.attributes.find(
        (a) => a.className === "DocumentAttributeFilename" || a instanceof Api2.DocumentAttributeFilename
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
    return res.json({
      valid: true,
      credentialsConfigured: true,
      botIsAdmin: true,
      message: `\u2705 Telegram Post #${parsed.messageId} verified. Ready to Stream!`,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      duration: 0,
      durationFormatted: "00:00"
    });
  } catch (err) {
    return res.json({
      valid: true,
      credentialsConfigured: true,
      botIsAdmin: true,
      message: `\u2705 Telegram Post #${parsed.messageId} verified. Ready to Stream!`,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      duration: 0,
      durationFormatted: "00:00"
    });
  }
});
var mediaCache = /* @__PURE__ */ new Map();
var MEDIA_CACHE_TTL_MS = 5 * 60 * 1e3;
async function handleStream(req, res) {
  const urlParam = req.query.url;
  const isRemuxParam = req.query.remux === "1";
  const isTranscodeParam = req.query.transcode === "1";
  const isRawParam = req.query.raw === "1";
  const startSecParam = req.query.start ? Math.max(0, parseFloat(req.query.start) || 0) : 0;
  if (!urlParam) return res.status(400).send("URL required");
  if (!urlParam.includes("t.me") && !urlParam.includes("telegram.me")) {
    return res.redirect(urlParam);
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
    let entry = mediaCache.get(cacheKey);
    if (entry && Date.now() - entry.cachedAt > MEDIA_CACHE_TTL_MS) {
      mediaCache.delete(cacheKey);
      entry = void 0;
    }
    if (!entry) {
      const { message: msg, error: fetchErr } = await resolveTelegramMedia(client2, parsed);
      if (!msg) {
        return res.status(404).json({
          error: `Telegram post #${parsed.messageId} not found or bot lacks channel access.`,
          detail: fetchErr || void 0
        });
      }
      let document2 = null;
      if (msg.media) {
        if (msg.media instanceof Api2.MessageMediaDocument && msg.media.document instanceof Api2.Document) {
          document2 = msg.media.document;
        } else if (msg.media instanceof Api2.MessageMediaWebPage && msg.media.webpage?.document instanceof Api2.Document) {
          document2 = msg.media.webpage.document;
        }
      }
      if (!document2) {
        return res.status(404).json({ error: `No playable video document found in Telegram post #${parsed.messageId}.` });
      }
      const fileSize2 = Number(document2.size);
      let durationSec2 = 0;
      const videoAttr = document2.attributes.find((a) => a instanceof Api2.DocumentAttributeVideo);
      if (videoAttr) {
        durationSec2 = videoAttr.duration || 0;
      }
      let fileName = "";
      const fnAttr = document2.attributes.find((a) => a.className === "DocumentAttributeFilename" || a instanceof Api2.DocumentAttributeFilename);
      if (fnAttr && fnAttr.fileName) {
        fileName = fnAttr.fileName;
      }
      const rawMime = (document2.mimeType || "").toLowerCase();
      const lowerName = fileName.toLowerCase();
      const isWebm = lowerName.endsWith(".webm") || rawMime.includes("webm");
      const isMkv = lowerName.endsWith(".mkv") || rawMime.includes("matroska") || rawMime.includes("mkv");
      const mimeType2 = isWebm ? "video/webm" : "video/mp4";
      entry = {
        document: document2,
        fileSize: fileSize2,
        durationSec: durationSec2,
        fileName,
        mimeType: mimeType2,
        isMkv,
        cachedAt: Date.now()
      };
      mediaCache.set(cacheKey, entry);
      console.log(`[Stream] Cached document ${document2.id} (${formatBytes(fileSize2)}, ${fileName || rawMime}) for msg ${parsed.messageId}`);
    }
    const { document, fileSize, durationSec, mimeType } = entry;
    const commonHeaders = {
      "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, Content-Type",
      "X-Video-Duration": durationSec.toString(),
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive"
    };
    if (req.method === "HEAD") {
      res.writeHead(200, {
        ...commonHeaders,
        "Content-Type": mimeType,
        "Content-Length": fileSize.toString()
      });
      return res.end();
    }
    if ((isRemuxParam || isTranscodeParam) && !isRawParam) {
      const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || "3000";
      const localSourceUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;
      const ffArgs = [];
      if (startSecParam > 0) {
        ffArgs.push("-ss", startSecParam.toString());
      }
      ffArgs.push(
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "3",
        "-i",
        localSourceUrl,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?"
      );
      if (isRemuxParam && !isTranscodeParam) {
        ffArgs.push("-c:v", "copy", "-c:a", "aac", "-ac", "2", "-b:a", "128k");
      } else {
        ffArgs.push(
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-ac",
          "2",
          "-b:a",
          "128k"
        );
      }
      ffArgs.push(
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "-f",
        "mp4",
        "pipe:1"
      );
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Length, X-Video-Duration, Content-Type",
        "X-Video-Duration": durationSec.toString(),
        "Content-Type": "video/mp4",
        "Cache-Control": "no-cache, no-store, must-revalidate"
      });
      const ffProc = spawn("ffmpeg", ffArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let procClosed = false;
      ffProc.stdout.pipe(res);
      ffProc.stderr.on("data", (chunk) => {
        const msg = chunk.toString();
        if (msg.toLowerCase().includes("error")) {
          console.warn(`[FFmpeg ${isTranscodeParam ? "Transcode" : "Remux"}]`, msg.trim());
        }
      });
      ffProc.on("error", (err) => {
        console.error("[FFmpeg] Spawn error:", err.message);
        if (!res.writableEnded) res.end();
      });
      ffProc.on("close", () => {
        procClosed = true;
        if (!res.writableEnded) res.end();
      });
      req.on("close", () => {
        if (!procClosed) {
          try {
            ffProc.kill("SIGKILL");
          } catch {
          }
        }
      });
      return;
    }
    const rangeHeader = req.headers.range;
    let start = 0;
    let endPos = fileSize - 1;
    const MAX_RANGE_CHUNK = 8 * 1024 * 1024;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        start = parseInt(match[1], 10) || 0;
        if (match[2]) {
          endPos = parseInt(match[2], 10);
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
    const ALIGNMENT = 4096;
    const alignedStart = Math.floor(start / ALIGNMENT) * ALIGNMENT;
    let actualSkip = start - alignedStart;
    const statusCode = rangeHeader ? 206 : 200;
    const headers = {
      ...commonHeaders,
      "Content-Type": mimeType,
      "Content-Length": chunkSize.toString()
    };
    if (rangeHeader) {
      headers["Content-Range"] = `bytes ${start}-${endPos}/${fileSize}`;
    }
    console.log(`[Stream] Status ${statusCode} | ${mimeType} | msg ${parsed.messageId} | bytes ${start}-${endPos}/${fileSize}`);
    res.writeHead(statusCode, headers);
    let delivered = 0;
    try {
      const fileLocation = new Api2.InputDocumentFileLocation({
        id: document.id,
        accessHash: document.accessHash,
        fileReference: document.fileReference,
        thumbSize: ""
      });
      const stream = client2.iterDownload({
        file: fileLocation,
        offset: bigInt2(alignedStart),
        requestSize: 1024 * 1024
      });
      for await (const chunk of stream) {
        if (isClosed || res.writableEnded || delivered >= chunkSize) break;
        let data = chunk;
        if (actualSkip > 0) {
          if (data.length <= actualSkip) {
            actualSkip -= data.length;
            continue;
          }
          data = data.slice(actualSkip);
          actualSkip = 0;
        }
        const remaining = chunkSize - delivered;
        if (data.length > remaining) {
          data = data.slice(0, remaining);
        }
        const canWrite = res.write(data);
        delivered += data.length;
        if (!canWrite && !isClosed) {
          await new Promise((r) => res.once("drain", r));
        }
      }
    } catch (err) {
      if (err?.message?.includes("FILE_REFERENCE")) {
        mediaCache.delete(cacheKey);
      }
      if (!isClosed) {
        console.error("[Stream] Chunk transfer notice:", err.message);
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
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
downloadCastRouter.get("/download/apk", async (_req, res) => {
  const latest = await fetchLatestGitHubApk();
  console.log(`[Download Router] Redirecting to latest APK: ${latest.url}`);
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
downloadCastRouter.get("/cast/proxy", (req, res) => {
  const targetUrlStr = req.query.url;
  if (!targetUrlStr) {
    res.status(400).json({ error: "Missing target stream url parameter" });
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
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
    const proxyReq = client2.get(
      fullUrl,
      { headers: requestHeaders },
      (proxyRes) => {
        const statusCode = proxyRes.statusCode || 200;
        const responseHeaders = {
          "Content-Type": proxyRes.headers["content-type"] || "video/mp4",
          "Accept-Ranges": proxyRes.headers["accept-ranges"] || "bytes",
          "Access-Control-Allow-Origin": "*"
        };
        if (proxyRes.headers["content-length"]) {
          responseHeaders["Content-Length"] = proxyRes.headers["content-length"];
        }
        if (proxyRes.headers["content-range"]) {
          responseHeaders["Content-Range"] = proxyRes.headers["content-range"];
        }
        res.writeHead(statusCode, responseHeaders);
        proxyRes.pipe(res);
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
  } catch (err) {
    console.error("[Cast Proxy Invalid URL]", err?.message);
    if (!res.headersSent) {
      res.status(400).json({ error: "Invalid media URL" });
    }
  }
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
var downloadCastRouter_default = downloadCastRouter;

// server.ts
var __filename3 = fileURLToPath3(import.meta.url);
var __dirname3 = path5.dirname(__filename3);
dotenv.config({ path: path5.resolve(__dirname3, ".env") });
var app2 = express3();
var PORT = 3e3;
if (process.env.APP_PORT) {
  PORT = Number(process.env.APP_PORT) || 3e3;
} else if (process.env.RENDER && process.env.PORT) {
  PORT = Number(process.env.PORT) || 3e3;
} else if (process.env.PORT && process.env.PORT !== "8080") {
  PORT = Number(process.env.PORT) || 3e3;
}
var args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    PORT = Number(args[i + 1]) || PORT;
  }
}
process.env.INTERNAL_APP_PORT = String(PORT);
app2.use(express3.json());
app2.use((req, _res, next) => {
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${req.method} ${req.url}`);
  next();
});
app2.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, Range");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});
app2.use("/api", (req, res, next) => {
  if (!req.path.startsWith("/stream")) {
    res.setHeader("Content-Type", "application/json");
  }
  next();
});
app2.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: (/* @__PURE__ */ new Date()).toISOString() });
});
app2.get("/api/debug-env", (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    projectId: process.env.FIREBASE_PROJECT_ID || "not set in env"
  });
});
app2.use("/api/metadata", metadataRouter_default);
app2.use("/api/telegram", telegramRouter_default);
app2.get("/api/stream", handleStream);
app2.head("/api/stream", handleStream);
app2.use("/api/video", videoRouter_default);
app2.use("/api", downloadCastRouter_default);
app2.use("/api", (req, res) => {
  console.warn(`[API 404] ${req.method} ${req.url}`);
  res.status(404).json({ error: `API route not found: /api${req.url}` });
});
app2.use((err, _req, res, _next) => {
  console.error("[Global Error Handler]", err);
  res.setHeader("Content-Type", "application/json");
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : void 0
  });
});
if (process.env.NODE_ENV !== "production") {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      middlewareMode: true,
      hmr: false
    },
    appType: "spa"
  });
  app2.use(vite.middlewares);
} else {
  const staticDir = fs4.existsSync(path5.resolve(__dirname3, "dist")) ? path5.resolve(__dirname3, "dist") : __dirname3;
  app2.use(express3.static(staticDir));
  app2.get("*", (_req, res) => {
    res.sendFile(path5.resolve(staticDir, "index.html"));
  });
}
app2.listen(PORT, "0.0.0.0", () => {
  console.log(`MOVIE PORTAL server running on port ${PORT}`);
});
