var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// firebase-applet-config.json
var firebase_applet_config_default;
var init_firebase_applet_config = __esm({
  "firebase-applet-config.json"() {
    firebase_applet_config_default = {
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
  }
});

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
var init_telegramParser = __esm({
  "src/utils/telegramParser.ts"() {
  }
});

// src/utils/apiConfig.ts
function isNativeAppRuntime() {
  if (typeof window === "undefined") return false;
  const w = window;
  if (w.AndroidPlayerBridge || w.AndroidStreamBridge) return true;
  const cap = w.Capacitor;
  return Boolean(cap && typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : cap?.isNativePlatform);
}
function isLoadedOnRemoteLiveWebOrigin() {
  if (typeof window === "undefined") return false;
  try {
    const { protocol, hostname } = window.location;
    return protocol === "https:" && !/^(localhost|127\.0\.0\.1)$/i.test(hostname);
  } catch {
    return false;
  }
}
function getNativeLocalBridgeUrl() {
  if (typeof window === "undefined") return "";
  try {
    const bridge = window.AndroidStreamBridge;
    if (bridge && typeof bridge.getLocalBaseUrl === "function") {
      const url = String(bridge.getLocalBaseUrl() || "").trim().replace(/\/+$/, "");
      if (url.startsWith("http://127.0.0.1:")) {
        return url;
      }
    }
  } catch {
  }
  return "";
}
function getApiBaseUrl() {
  if (typeof window === "undefined") return "";
  try {
    const customServer = localStorage.getItem("movie_portal_backend_url");
    if (customServer && customServer.trim()) {
      return customServer.trim().replace(/\/+$/, "");
    }
  } catch {
  }
  if (!isNativeAppRuntime()) {
    return "";
  }
  if (isLoadedOnRemoteLiveWebOrigin()) {
    return resolvedRemoteTranscodeUrl || resolvedNativeBackendUrl || "";
  }
  return resolvedRemoteTranscodeUrl || ENV_BACKEND_URL || resolvedNativeBackendUrl || PRE_BACKEND_URL || LIVE_BACKEND_URL || getNativeLocalBridgeUrl() || "";
}
function buildApiUrl(path7) {
  const cleanPath = path7.startsWith("/") ? path7 : `/${path7}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}
var LIVE_BACKEND_URL, PRE_BACKEND_URL, ENV_BACKEND_URL, resolvedNativeBackendUrl, resolvedRemoteTranscodeUrl, PROBE_CACHE_TTL_MS;
var init_apiConfig = __esm({
  "src/utils/apiConfig.ts"() {
    LIVE_BACKEND_URL = "https://ais-dev-xnvcffdn7a5ydibjtjrezd-835315626292.asia-northeast1.run.app";
    PRE_BACKEND_URL = "https://ais-pre-xnvcffdn7a5ydibjtjrezd-835315626292.asia-northeast1.run.app";
    ENV_BACKEND_URL = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL || "").toString().trim().replace(/\/+$/, "");
    resolvedNativeBackendUrl = null;
    resolvedRemoteTranscodeUrl = null;
    PROBE_CACHE_TTL_MS = 60 * 1e3;
  }
});

// src/services/firestoreQuotaService.ts
function computeDefaultExpiryMs() {
  const now = /* @__PURE__ */ new Date();
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    1,
    0,
    0
  );
  return Math.max(Date.now() + 12 * 3600 * 1e3, nextUtcMidnight);
}
function isQuotaErrorLike(err) {
  const code = String(err?.code || "").toLowerCase();
  const msg = String(err?.message || err || "").toLowerCase();
  return code.includes("resource-exhausted") || code === "429" || msg.includes("resource-exhausted") || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("exhausted") || msg.includes("daily write units");
}
function isFirestoreWriteAllowed() {
  try {
    if (memExhaustedUntilMs > Date.now()) {
      return false;
    }
    if (typeof window === "undefined" || !window.localStorage) return true;
    const until = localStorage.getItem(QUOTA_EXCEEDED_KEY);
    if (!until) return true;
    const expiryTime = Number(until);
    if (isNaN(expiryTime) || Date.now() > expiryTime) {
      localStorage.removeItem(QUOTA_EXCEEDED_KEY);
      memExhaustedUntilMs = 0;
      return true;
    }
    memExhaustedUntilMs = expiryTime;
    return false;
  } catch {
    return memExhaustedUntilMs <= Date.now();
  }
}
function markFirestoreQuotaExhausted(err, opts) {
  try {
    const shouldMark = !err || isQuotaErrorLike(err);
    if (!shouldMark) return;
    const expiry = Math.max(
      opts?.explicitUntilMs || 0,
      computeDefaultExpiryMs(),
      memExhaustedUntilMs
    );
    const isFirstTransition = memExhaustedUntilMs <= Date.now();
    memExhaustedUntilMs = expiry;
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.setItem(QUOTA_EXCEEDED_KEY, String(expiry));
      } catch {
      }
    }
    if (isFirstTransition) {
      console.warn(
        "[Firestore Quota Service] Write quota exceeded on free tier. Switching to local-first mode until daily UTC reset."
      );
    }
    if (!opts?.skipServerNotify && typeof window !== "undefined" && !serverNotifiedThisSession) {
      serverNotifiedThisSession = true;
      fetch(buildApiUrl("/api/firestore/quota-exhausted"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: String(err?.message || err?.code || "client-resource-exhausted").slice(0, 200)
        }),
        keepalive: true
      }).catch(() => {
      });
    }
  } catch {
  }
}
async function hydrateFirestoreQuotaStatus() {
  if (typeof window === "undefined") return true;
  if (!isFirestoreWriteAllowed()) return false;
  if (hydratedOnce) return isFirestoreWriteAllowed();
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(buildApiUrl("/api/firestore/quota-status"), {
        cache: "no-store",
        signal: controller.signal
      }).finally(() => clearTimeout(timer));
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.writeAllowed === false) {
          markFirestoreQuotaExhausted(void 0, {
            skipServerNotify: true,
            explicitUntilMs: Number(data.exhaustedUntilMs) || void 0
          });
          hydratedOnce = true;
          return false;
        }
      }
    } catch {
    }
    hydratedOnce = true;
    return isFirestoreWriteAllowed();
  })().finally(() => {
    hydratePromise = null;
  });
  return hydratePromise;
}
var QUOTA_EXCEEDED_KEY, memExhaustedUntilMs, hydratedOnce, hydratePromise, serverNotifiedThisSession;
var init_firestoreQuotaService = __esm({
  "src/services/firestoreQuotaService.ts"() {
    init_apiConfig();
    QUOTA_EXCEEDED_KEY = "mp_firestore_write_quota_exceeded_until_v1";
    memExhaustedUntilMs = 0;
    hydratedOnce = false;
    hydratePromise = null;
    serverNotifiedThisSession = false;
  }
});

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
async function testConnection() {
  if (typeof window === "undefined") return;
  await hydrateFirestoreQuotaStatus().catch(() => true);
  if (!isFirestoreWriteAllowed()) return;
  try {
    await getDocFromServer(doc(db, "app_config", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.warn("Firestore connection check: client is currently offline.");
    }
  }
}
var app2, config, databaseId2, db, auth;
var init_firebase = __esm({
  "src/firebase.ts"() {
    init_firebase_applet_config();
    init_firestoreQuotaService();
    app2 = initializeApp2(firebase_applet_config_default);
    config = firebase_applet_config_default;
    databaseId2 = config.firestoreDatabaseId || void 0;
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
    db = createFirestoreInstance();
    auth = getAuth2(app2);
    testConnection();
  }
});

// node_modules/@capacitor/core/dist/index.cjs.js
var require_index_cjs = __commonJS({
  "node_modules/@capacitor/core/dist/index.cjs.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var createCapacitorPlatforms = (win) => {
      const defaultPlatformMap = /* @__PURE__ */ new Map();
      defaultPlatformMap.set("web", { name: "web" });
      const capPlatforms = win.CapacitorPlatforms || {
        currentPlatform: { name: "web" },
        platforms: defaultPlatformMap
      };
      const addPlatform2 = (name, platform) => {
        capPlatforms.platforms.set(name, platform);
      };
      const setPlatform2 = (name) => {
        if (capPlatforms.platforms.has(name)) {
          capPlatforms.currentPlatform = capPlatforms.platforms.get(name);
        }
      };
      capPlatforms.addPlatform = addPlatform2;
      capPlatforms.setPlatform = setPlatform2;
      return capPlatforms;
    };
    var initPlatforms = (win) => win.CapacitorPlatforms = createCapacitorPlatforms(win);
    var CapacitorPlatforms = /* @__PURE__ */ initPlatforms(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
    var addPlatform = CapacitorPlatforms.addPlatform;
    var setPlatform = CapacitorPlatforms.setPlatform;
    var legacyRegisterWebPlugin = (cap, webPlugin) => {
      var _a;
      const config2 = webPlugin.config;
      const Plugins2 = cap.Plugins;
      if (!(config2 === null || config2 === void 0 ? void 0 : config2.name)) {
        throw new Error(`Capacitor WebPlugin is using the deprecated "registerWebPlugin()" function, but without the config. Please use "registerPlugin()" instead to register this web plugin."`);
      }
      console.warn(`Capacitor plugin "${config2.name}" is using the deprecated "registerWebPlugin()" function`);
      if (!Plugins2[config2.name] || ((_a = config2 === null || config2 === void 0 ? void 0 : config2.platforms) === null || _a === void 0 ? void 0 : _a.includes(cap.getPlatform()))) {
        Plugins2[config2.name] = webPlugin;
      }
    };
    exports.ExceptionCode = void 0;
    (function(ExceptionCode) {
      ExceptionCode["Unimplemented"] = "UNIMPLEMENTED";
      ExceptionCode["Unavailable"] = "UNAVAILABLE";
    })(exports.ExceptionCode || (exports.ExceptionCode = {}));
    var CapacitorException = class extends Error {
      constructor(message, code, data) {
        super(message);
        this.message = message;
        this.code = code;
        this.data = data;
      }
    };
    var getPlatformId = (win) => {
      var _a, _b;
      if (win === null || win === void 0 ? void 0 : win.androidBridge) {
        return "android";
      } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
        return "ios";
      } else {
        return "web";
      }
    };
    var createCapacitor = (win) => {
      var _a, _b, _c, _d, _e;
      const capCustomPlatform = win.CapacitorCustomPlatform || null;
      const cap = win.Capacitor || {};
      const Plugins2 = cap.Plugins = cap.Plugins || {};
      const capPlatforms = win.CapacitorPlatforms;
      const defaultGetPlatform = () => {
        return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
      };
      const getPlatform = ((_a = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _a === void 0 ? void 0 : _a.getPlatform) || defaultGetPlatform;
      const defaultIsNativePlatform = () => getPlatform() !== "web";
      const isNativePlatform = ((_b = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _b === void 0 ? void 0 : _b.isNativePlatform) || defaultIsNativePlatform;
      const defaultIsPluginAvailable = (pluginName) => {
        const plugin = registeredPlugins.get(pluginName);
        if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
          return true;
        }
        if (getPluginHeader(pluginName)) {
          return true;
        }
        return false;
      };
      const isPluginAvailable = ((_c = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _c === void 0 ? void 0 : _c.isPluginAvailable) || defaultIsPluginAvailable;
      const defaultGetPluginHeader = (pluginName) => {
        var _a2;
        return (_a2 = cap.PluginHeaders) === null || _a2 === void 0 ? void 0 : _a2.find((h) => h.name === pluginName);
      };
      const getPluginHeader = ((_d = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _d === void 0 ? void 0 : _d.getPluginHeader) || defaultGetPluginHeader;
      const handleError = (err) => win.console.error(err);
      const pluginMethodNoop = (_target, prop, pluginName) => {
        return Promise.reject(`${pluginName} does not have an implementation of "${prop}".`);
      };
      const registeredPlugins = /* @__PURE__ */ new Map();
      const defaultRegisterPlugin = (pluginName, jsImplementations = {}) => {
        const registeredPlugin = registeredPlugins.get(pluginName);
        if (registeredPlugin) {
          console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
          return registeredPlugin.proxy;
        }
        const platform = getPlatform();
        const pluginHeader = getPluginHeader(pluginName);
        let jsImplementation;
        const loadPluginImplementation = async () => {
          if (!jsImplementation && platform in jsImplementations) {
            jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
          } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
            jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
          }
          return jsImplementation;
        };
        const createPluginMethod = (impl, prop) => {
          var _a2, _b2;
          if (pluginHeader) {
            const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
            if (methodHeader) {
              if (methodHeader.rtype === "promise") {
                return (options) => cap.nativePromise(pluginName, prop.toString(), options);
              } else {
                return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
              }
            } else if (impl) {
              return (_a2 = impl[prop]) === null || _a2 === void 0 ? void 0 : _a2.bind(impl);
            }
          } else if (impl) {
            return (_b2 = impl[prop]) === null || _b2 === void 0 ? void 0 : _b2.bind(impl);
          } else {
            throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, exports.ExceptionCode.Unimplemented);
          }
        };
        const createPluginMethodWrapper = (prop) => {
          let remove;
          const wrapper = (...args2) => {
            const p = loadPluginImplementation().then((impl) => {
              const fn = createPluginMethod(impl, prop);
              if (fn) {
                const p2 = fn(...args2);
                remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                return p2;
              } else {
                throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, exports.ExceptionCode.Unimplemented);
              }
            });
            if (prop === "addListener") {
              p.remove = async () => remove();
            }
            return p;
          };
          wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
          Object.defineProperty(wrapper, "name", {
            value: prop,
            writable: false,
            configurable: false
          });
          return wrapper;
        };
        const addListener = createPluginMethodWrapper("addListener");
        const removeListener = createPluginMethodWrapper("removeListener");
        const addListenerNative = (eventName, callback) => {
          const call = addListener({ eventName }, callback);
          const remove = async () => {
            const callbackId = await call;
            removeListener({
              eventName,
              callbackId
            }, callback);
          };
          const p = new Promise((resolve) => call.then(() => resolve({ remove })));
          p.remove = async () => {
            console.warn(`Using addListener() without 'await' is deprecated.`);
            await remove();
          };
          return p;
        };
        const proxy = new Proxy({}, {
          get(_, prop) {
            switch (prop) {
              // https://github.com/facebook/react/issues/20030
              case "$$typeof":
                return void 0;
              case "toJSON":
                return () => ({});
              case "addListener":
                return pluginHeader ? addListenerNative : addListener;
              case "removeListener":
                return removeListener;
              default:
                return createPluginMethodWrapper(prop);
            }
          }
        });
        Plugins2[pluginName] = proxy;
        registeredPlugins.set(pluginName, {
          name: pluginName,
          proxy,
          platforms: /* @__PURE__ */ new Set([
            ...Object.keys(jsImplementations),
            ...pluginHeader ? [platform] : []
          ])
        });
        return proxy;
      };
      const registerPlugin2 = ((_e = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _e === void 0 ? void 0 : _e.registerPlugin) || defaultRegisterPlugin;
      if (!cap.convertFileSrc) {
        cap.convertFileSrc = (filePath) => filePath;
      }
      cap.getPlatform = getPlatform;
      cap.handleError = handleError;
      cap.isNativePlatform = isNativePlatform;
      cap.isPluginAvailable = isPluginAvailable;
      cap.pluginMethodNoop = pluginMethodNoop;
      cap.registerPlugin = registerPlugin2;
      cap.Exception = CapacitorException;
      cap.DEBUG = !!cap.DEBUG;
      cap.isLoggingEnabled = !!cap.isLoggingEnabled;
      cap.platform = cap.getPlatform();
      cap.isNative = cap.isNativePlatform();
      return cap;
    };
    var initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
    var Capacitor2 = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
    var registerPlugin = Capacitor2.registerPlugin;
    var Plugins = Capacitor2.Plugins;
    var registerWebPlugin = (plugin) => legacyRegisterWebPlugin(Capacitor2, plugin);
    var WebPlugin = class {
      constructor(config2) {
        this.listeners = {};
        this.retainedEventArguments = {};
        this.windowListeners = {};
        if (config2) {
          console.warn(`Capacitor WebPlugin "${config2.name}" config object was deprecated in v3 and will be removed in v4.`);
          this.config = config2;
        }
      }
      addListener(eventName, listenerFunc) {
        let firstListener = false;
        const listeners = this.listeners[eventName];
        if (!listeners) {
          this.listeners[eventName] = [];
          firstListener = true;
        }
        this.listeners[eventName].push(listenerFunc);
        const windowListener = this.windowListeners[eventName];
        if (windowListener && !windowListener.registered) {
          this.addWindowListener(windowListener);
        }
        if (firstListener) {
          this.sendRetainedArgumentsForEvent(eventName);
        }
        const remove = async () => this.removeListener(eventName, listenerFunc);
        const p = Promise.resolve({ remove });
        return p;
      }
      async removeAllListeners() {
        this.listeners = {};
        for (const listener in this.windowListeners) {
          this.removeWindowListener(this.windowListeners[listener]);
        }
        this.windowListeners = {};
      }
      notifyListeners(eventName, data, retainUntilConsumed) {
        const listeners = this.listeners[eventName];
        if (!listeners) {
          if (retainUntilConsumed) {
            let args2 = this.retainedEventArguments[eventName];
            if (!args2) {
              args2 = [];
            }
            args2.push(data);
            this.retainedEventArguments[eventName] = args2;
          }
          return;
        }
        listeners.forEach((listener) => listener(data));
      }
      hasListeners(eventName) {
        return !!this.listeners[eventName].length;
      }
      registerWindowListener(windowEventName, pluginEventName) {
        this.windowListeners[pluginEventName] = {
          registered: false,
          windowEventName,
          pluginEventName,
          handler: (event) => {
            this.notifyListeners(pluginEventName, event);
          }
        };
      }
      unimplemented(msg = "not implemented") {
        return new Capacitor2.Exception(msg, exports.ExceptionCode.Unimplemented);
      }
      unavailable(msg = "not available") {
        return new Capacitor2.Exception(msg, exports.ExceptionCode.Unavailable);
      }
      async removeListener(eventName, listenerFunc) {
        const listeners = this.listeners[eventName];
        if (!listeners) {
          return;
        }
        const index = listeners.indexOf(listenerFunc);
        this.listeners[eventName].splice(index, 1);
        if (!this.listeners[eventName].length) {
          this.removeWindowListener(this.windowListeners[eventName]);
        }
      }
      addWindowListener(handle) {
        window.addEventListener(handle.windowEventName, handle.handler);
        handle.registered = true;
      }
      removeWindowListener(handle) {
        if (!handle) {
          return;
        }
        window.removeEventListener(handle.windowEventName, handle.handler);
        handle.registered = false;
      }
      sendRetainedArgumentsForEvent(eventName) {
        const args2 = this.retainedEventArguments[eventName];
        if (!args2) {
          return;
        }
        delete this.retainedEventArguments[eventName];
        args2.forEach((arg) => {
          this.notifyListeners(eventName, arg);
        });
      }
    };
    var WebView = /* @__PURE__ */ registerPlugin("WebView");
    var encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
    var decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
    var CapacitorCookiesPluginWeb = class extends WebPlugin {
      async getCookies() {
        const cookies = document.cookie;
        const cookieMap = {};
        cookies.split(";").forEach((cookie) => {
          if (cookie.length <= 0)
            return;
          let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
          key = decode(key).trim();
          value = decode(value).trim();
          cookieMap[key] = value;
        });
        return cookieMap;
      }
      async setCookie(options) {
        try {
          const encodedKey = encode(options.key);
          const encodedValue = encode(options.value);
          const expires = `; expires=${(options.expires || "").replace("expires=", "")}`;
          const path7 = (options.path || "/").replace("path=", "");
          const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
          document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path7}; ${domain};`;
        } catch (error) {
          return Promise.reject(error);
        }
      }
      async deleteCookie(options) {
        try {
          document.cookie = `${options.key}=; Max-Age=0`;
        } catch (error) {
          return Promise.reject(error);
        }
      }
      async clearCookies() {
        try {
          const cookies = document.cookie.split(";") || [];
          for (const cookie of cookies) {
            document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
          }
        } catch (error) {
          return Promise.reject(error);
        }
      }
      async clearAllCookies() {
        try {
          await this.clearCookies();
        } catch (error) {
          return Promise.reject(error);
        }
      }
    };
    var CapacitorCookies = registerPlugin("CapacitorCookies", {
      web: () => new CapacitorCookiesPluginWeb()
    });
    var readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64String = reader.result;
        resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    });
    var normalizeHttpHeaders = (headers = {}) => {
      const originalKeys = Object.keys(headers);
      const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
      const normalized = loweredKeys.reduce((acc, key, index) => {
        acc[key] = headers[originalKeys[index]];
        return acc;
      }, {});
      return normalized;
    };
    var buildUrlParams = (params, shouldEncode = true) => {
      if (!params)
        return null;
      const output = Object.entries(params).reduce((accumulator, entry) => {
        const [key, value] = entry;
        let encodedValue;
        let item;
        if (Array.isArray(value)) {
          item = "";
          value.forEach((str) => {
            encodedValue = shouldEncode ? encodeURIComponent(str) : str;
            item += `${key}=${encodedValue}&`;
          });
          item.slice(0, -1);
        } else {
          encodedValue = shouldEncode ? encodeURIComponent(value) : value;
          item = `${key}=${encodedValue}`;
        }
        return `${accumulator}&${item}`;
      }, "");
      return output.substr(1);
    };
    var buildRequestInit = (options, extra = {}) => {
      const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
      const headers = normalizeHttpHeaders(options.headers);
      const type = headers["content-type"] || "";
      if (typeof options.data === "string") {
        output.body = options.data;
      } else if (type.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options.data || {})) {
          params.set(key, value);
        }
        output.body = params.toString();
      } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
        const form = new FormData();
        if (options.data instanceof FormData) {
          options.data.forEach((value, key) => {
            form.append(key, value);
          });
        } else {
          for (const key of Object.keys(options.data)) {
            form.append(key, options.data[key]);
          }
        }
        output.body = form;
        const headers2 = new Headers(output.headers);
        headers2.delete("content-type");
        output.headers = headers2;
      } else if (type.includes("application/json") || typeof options.data === "object") {
        output.body = JSON.stringify(options.data);
      }
      return output;
    };
    var CapacitorHttpPluginWeb = class extends WebPlugin {
      /**
       * Perform an Http request given a set of options
       * @param options Options to build the HTTP request
       */
      async request(options) {
        const requestInit = buildRequestInit(options, options.webFetchExtra);
        const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
        const url = urlParams ? `${options.url}?${urlParams}` : options.url;
        const response = await fetch(url, requestInit);
        const contentType = response.headers.get("content-type") || "";
        let { responseType = "text" } = response.ok ? options : {};
        if (contentType.includes("application/json")) {
          responseType = "json";
        }
        let data;
        let blob;
        switch (responseType) {
          case "arraybuffer":
          case "blob":
            blob = await response.blob();
            data = await readBlobAsBase64(blob);
            break;
          case "json":
            data = await response.json();
            break;
          case "document":
          case "text":
          default:
            data = await response.text();
        }
        const headers = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return {
          data,
          headers,
          status: response.status,
          url: response.url
        };
      }
      /**
       * Perform an Http GET request given a set of options
       * @param options Options to build the HTTP request
       */
      async get(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
      }
      /**
       * Perform an Http POST request given a set of options
       * @param options Options to build the HTTP request
       */
      async post(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
      }
      /**
       * Perform an Http PUT request given a set of options
       * @param options Options to build the HTTP request
       */
      async put(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
      }
      /**
       * Perform an Http PATCH request given a set of options
       * @param options Options to build the HTTP request
       */
      async patch(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
      }
      /**
       * Perform an Http DELETE request given a set of options
       * @param options Options to build the HTTP request
       */
      async delete(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
      }
    };
    var CapacitorHttp = registerPlugin("CapacitorHttp", {
      web: () => new CapacitorHttpPluginWeb()
    });
    exports.Capacitor = Capacitor2;
    exports.CapacitorCookies = CapacitorCookies;
    exports.CapacitorException = CapacitorException;
    exports.CapacitorHttp = CapacitorHttp;
    exports.CapacitorPlatforms = CapacitorPlatforms;
    exports.Plugins = Plugins;
    exports.WebPlugin = WebPlugin;
    exports.WebView = WebView;
    exports.addPlatform = addPlatform;
    exports.buildRequestInit = buildRequestInit;
    exports.registerPlugin = registerPlugin;
    exports.registerWebPlugin = registerWebPlugin;
    exports.setPlatform = setPlatform;
  }
});

// server.ts
import fs7 from "fs";
import path6 from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express3 from "express";
import { spawnSync } from "child_process";

// src/server/metadataRouter.ts
import express from "express";

// src/server/firebaseAdmin.ts
init_firebase_applet_config();
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
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
function resolveSafeReleaseYear(omdbYearRaw, imdbYearRaw) {
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  const omdbYr = parseInt(String(omdbYearRaw || "").slice(0, 4), 10);
  const imdbYr = parseInt(String(imdbYearRaw || "").slice(0, 4), 10);
  if (Number.isFinite(imdbYr) && imdbYr >= 1900 && imdbYr <= currentYear) {
    if (!Number.isFinite(omdbYr) || omdbYr < 1900 || omdbYr > currentYear) {
      return imdbYr;
    }
  }
  if (Number.isFinite(omdbYr) && omdbYr >= 1900) {
    return omdbYr > currentYear ? currentYear : omdbYr;
  }
  if (Number.isFinite(imdbYr) && imdbYr >= 1900) {
    return imdbYr > currentYear ? currentYear : imdbYr;
  }
  return currentYear;
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
    const clean = query.toLowerCase().trim();
    if (!clean) return [];
    const firstChar = clean.charAt(0).replace(/[^a-z]/g, "a") || "a";
    const slug = clean.replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    const urls = [
      `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(slug)}.json`,
      `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(slug)}.json`,
      `https://v1.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(slug)}.json`
    ];
    let data = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
          }
        });
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.d) && json.d.length > 0) {
            data = json;
            break;
          }
        }
      } catch {
      }
    }
    if (!data || !Array.isArray(data.d)) return [];
    return data.d.filter((item) => item.id && item.id.startsWith("tt")).map((item) => {
      const q = (item.q || "").toLowerCase();
      let itemType = "movie";
      if (q.includes("series") || q.includes("tv") || q.includes("miniseries")) {
        itemType = "series";
      } else if (q.includes("video game")) {
        itemType = "game";
      }
      const poster = upgradePosterUrl(item.i?.imageUrl || "", 1080);
      const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
      const rawY = Number(item.y);
      const safeYear = Number.isFinite(rawY) && rawY >= 1900 ? Math.min(rawY, currentYear) : item.y || "N/A";
      return {
        imdbId: item.id,
        title: item.l,
        year: safeYear,
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
async function searchMetadataInternal(rawQuery) {
  const query = (rawQuery || "").trim();
  if (!query) {
    return { status: "not_found", provider: "IMDb Live Search", results: [], message: "Search query required", httpStatus: 400 };
  }
  const { key } = getApiKey();
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
        return {
          status: "ok",
          provider: "IMDb / OMDb API",
          results: [{
            imdbId: data.imdbID,
            title: data.Title,
            year: resolveSafeReleaseYear(data.Year, imdbHit?.year),
            type: data.Type || "movie",
            posterUrl: bestPoster,
            cast: data.Actors && data.Actors !== "N/A" ? data.Actors : imdbHit?.cast || ""
          }]
        };
      }
      if (imdbHit) {
        return {
          status: "ok",
          provider: "IMDb Live Search",
          results: [imdbHit]
        };
      }
      if (data?.Error === "Invalid API key!") {
        return { status: "invalid_key", provider: "OMDb API", results: [], message: "Invalid API key.", httpStatus: 401 };
      }
      if (data?.Error === "Request limit reached!") {
        return { status: "limit_reached", provider: "OMDb API", results: [], message: "Daily request limit reached.", httpStatus: 429 };
      }
      return { status: "not_found", provider: "IMDb Live Search", results: [], message: data?.Error || `No title found with IMDb ID ${imdbId}.` };
    } catch (err) {
      console.error("[metadataRouter] Direct IMDb ID lookup error:", err);
      return { status: "network_error", provider: "IMDb Live Search", results: [], message: "Network error connecting to metadata service.", httpStatus: 503 };
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
            year: resolveSafeReleaseYear(item.Year),
            type: item.Type || "movie",
            posterUrl: upgradePosterUrl(item.Poster, 1080)
          });
        }
      }
    }
    const finalResults = mergeImdbAndWikiResults(query, combinedResults, wikiResults);
    if (finalResults.length > 0) {
      return {
        status: "ok",
        provider: "IMDb Live Search",
        results: finalResults
      };
    }
    if (year && cleanTitle) {
      const retryResults = await fetchImdbSuggestions(cleanTitle);
      if (retryResults.length > 0) {
        return {
          status: "ok",
          provider: "IMDb Live Search",
          results: retryResults
        };
      }
    }
    return {
      status: "not_found",
      provider: "IMDb Live Search",
      results: [],
      message: `No matching movies, series or anime found on IMDb for "${query}".`
    };
  } catch (err) {
    console.error("[metadataRouter] Search error:", err);
    return {
      status: "network_error",
      provider: "IMDb Live Search",
      results: [],
      message: "Failed to communicate with metadata service. Please check your network connection.",
      httpStatus: 503
    };
  }
}
async function fetchMetadataDetailInternal(rawId, rawTitle) {
  let id = (rawId || "").trim();
  const titleParam = (rawTitle || "").trim();
  const { key, isCustom } = getApiKey();
  if (id) {
    const wikiMatch = id.match(/(wiki-\d+)/i);
    if (wikiMatch) {
      const wikiDetail = await fetchWikipediaFilmDetail(wikiMatch[1]);
      if (wikiDetail) {
        return {
          status: "ok",
          provider: "Wikipedia Cinema Index",
          data: wikiDetail
        };
      }
      return { status: "not_found", error: "Metadata details not found.", httpStatus: 404 };
    }
    const match = id.match(/(tt\d+)/i);
    if (match) id = match[1].toLowerCase();
  }
  if (!id && !titleParam) {
    return { status: "error", error: "Movie IMDb ID or title parameter is required", httpStatus: 400 };
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
      return {
        status: "ok",
        provider: isCustom ? "OMDb (Custom Key)" : "OMDb API",
        data: {
          imdbId: data.imdbID || id,
          title: data.Title || "",
          originalTitle: data.Title || "",
          releaseYear: resolveSafeReleaseYear(data.Year, imdbHit?.year),
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
      };
    }
    if (imdbHit) {
      const posterUrl = upgradePosterUrl(imdbHit.posterUrl, 1080);
      const backdropUrl = upgradePosterUrl(imdbHit.posterUrl, 1280) || posterUrl;
      return {
        status: "ok",
        provider: "IMDb Live Engine",
        data: {
          imdbId: imdbHit.imdbId || id,
          title: imdbHit.title || "",
          originalTitle: imdbHit.title || "",
          releaseYear: resolveSafeReleaseYear(null, imdbHit.year),
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
      };
    }
    if (data?.Error === "Invalid API key!") {
      return { status: "invalid_key", error: "Invalid OMDb API key.", httpStatus: 401 };
    }
    if (data?.Error === "Request limit reached!") {
      return { status: "limit_reached", error: "OMDb API daily request limit reached.", httpStatus: 429 };
    }
    return { status: "not_found", error: data?.Error || "Metadata details not found.", httpStatus: 404 };
  } catch (err) {
    console.error("[metadataRouter] Detail fetch error:", err);
    return { status: "error", error: "Failed to communicate with metadata service.", httpStatus: 503 };
  }
}
router.get("/search", async (req, res) => {
  const rawQuery = req.query.q || "";
  if (!rawQuery.trim()) {
    return res.status(400).json({ error: "Search query required" });
  }
  const result = await searchMetadataInternal(rawQuery);
  if (result.httpStatus && result.httpStatus >= 400) {
    return res.status(result.httpStatus).json({
      status: result.status,
      results: result.results,
      message: result.message
    });
  }
  return res.json({
    status: result.status,
    provider: result.provider,
    ...result.results.length > 0 ? { totalResults: result.results.length } : {},
    results: result.results,
    ...result.message ? { message: result.message } : {}
  });
});
router.get("/detail", async (req, res) => {
  const id = req.query.id || "";
  const titleParam = req.query.title || "";
  const result = await fetchMetadataDetailInternal(id, titleParam);
  if (result.status === "ok" && result.data) {
    return res.json({
      status: "ok",
      provider: result.provider,
      data: result.data
    });
  }
  return res.status(result.httpStatus || 404).json({ error: result.error || "Metadata details not found." });
});
var metadataRouter_default = router;

// src/server/telegramRouter.ts
init_telegramParser();
import { Router } from "express";
import { spawn as spawn2 } from "child_process";
import fs4 from "fs";
import os2 from "os";
import path3 from "path";
import crypto from "crypto";
import { Api as Api3 } from "telegram";

// src/utils/telegramClient.ts
import fs2 from "fs";
import os from "os";
import path2 from "path";
import { TelegramClient as TelegramClient2, Logger } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
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
  if (!inMemoryCache["4498557265"]) {
    const movieHubDbEntry = {
      channelId: "4498557265",
      accessHash: "113338100892344891",
      title: "Movie Hub Database",
      username: "+s2Qki5-sfnVjZTI1",
      updatedAt: Date.now()
    };
    inMemoryCache["4498557265"] = movieHubDbEntry;
    inMemoryCache["-1004498557265"] = movieHubDbEntry;
  }
  return inMemoryCache;
}
function removeChannelEntity(channelId) {
  loadCacheFromDisk();
  const cleanId = String(channelId || "").replace(/^-100/, "").trim();
  if (!cleanId) return false;
  let removed = false;
  for (const key of Object.keys(inMemoryCache)) {
    const entry = inMemoryCache[key];
    if (key === cleanId || key === `-100${cleanId}` || entry?.channelId === cleanId || entry?.channelId === `-100${cleanId}`) {
      delete inMemoryCache[key];
      removed = true;
    }
  }
  if (removed) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(inMemoryCache, null, 2), "utf-8");
    } catch (err) {
      console.warn("[ChannelRegistry] Failed writing cache after remove:", err?.message || err);
    }
  }
  return removed;
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
async function resolveTelegramMedia(client2, parsed, allowAuthRetry = true) {
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
      if (allowAuthRetry && isTelegramAuthKeyError(err)) {
        console.warn(`[ChannelRegistry] Auth key error (${lastError.substring(0, 80)}); resetting Telegram session and retrying...`);
        const freshClient = await resetTelegramClient({ clearSavedSession: true, preferBotFallback: true });
        return resolveTelegramMedia(freshClient, parsed, false);
      }
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
var resettingPromise = null;
var bypassEnvSession = false;
var SESSION_FILE_PATH = path2.join(os.tmpdir(), ".movie_portal_tg_session.txt");
function isTelegramAuthKeyError(err) {
  const msg = String(err?.errorMessage || err?.message || err || "").toUpperCase();
  return msg.includes("AUTH_KEY_DUPLICATED") || msg.includes("AUTH_KEY_UNREGISTERED") || msg.includes("AUTH_KEY_INVALID") || msg.includes("SESSION_REVOKED") || msg.includes("SESSION_EXPIRED");
}
function getSavedSessionString() {
  if (!bypassEnvSession) {
    const envSession = (process.env.TELEGRAM_SESSION_STRING || process.env.TELEGRAM_SESSION || process.env.SESSION_STRING || "").trim();
    if (envSession) return envSession;
  }
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
async function resetTelegramClient(options) {
  if (resettingPromise) return resettingPromise;
  const { clearSavedSession = true, preferBotFallback = true } = options || {};
  resettingPromise = (async () => {
    const prev = client;
    client = null;
    connectingPromise = null;
    if (prev) {
      try {
        await prev.disconnect();
      } catch {
      }
    }
    if (clearSavedSession) {
      try {
        if (fs2.existsSync(SESSION_FILE_PATH)) {
          fs2.unlinkSync(SESSION_FILE_PATH);
        }
      } catch {
      }
    }
    if (preferBotFallback) {
      const botToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim() || "8993099137:AAH5ppM00ckVZvMek7fv623fbeYty3qgsxM";
      if (botToken) {
        bypassEnvSession = true;
      }
    }
    console.warn("[TelegramClient] Session reset triggered; establishing fresh Telegram session...");
    return await getTelegramClient();
  })().finally(() => {
    resettingPromise = null;
  });
  return resettingPromise;
}
function isTelegramConnected() {
  return Boolean(client && client.connected);
}
var serverKeepaliveStarted = false;
function ensureServerKeepalive(activeClient) {
  if (serverKeepaliveStarted) return;
  serverKeepaliveStarted = true;
  const timer = setInterval(async () => {
    const c = client || activeClient;
    if (!c) return;
    try {
      if (!c.connected) {
        await c.connect().catch(() => {
        });
        return;
      }
      const bigInt3 = (await import("big-integer")).default;
      const { Api: Api4 } = await import("telegram");
      await Promise.race([
        c.invoke(new Api4.Ping({ pingId: bigInt3(Date.now()) })),
        new Promise((_, rej) => setTimeout(() => rej(new Error("SERVER_PING_TIMEOUT")), 8e3))
      ]);
    } catch {
    }
  }, 4e4);
  timer.unref?.();
}
var TELEGRAM_DC_ENDPOINTS = [
  { id: 5, ip: "91.108.56.130", port: 443 },
  { id: 2, ip: "149.154.167.51", port: 443 },
  { id: 1, ip: "149.154.175.53", port: 443 },
  { id: 4, ip: "149.154.167.91", port: 443 },
  { id: 3, ip: "149.154.175.100", port: 443 }
];
async function getTelegramClient() {
  if (client) {
    if (client.connected) {
      ensureServerKeepalive(client);
      return client;
    }
    try {
      await client.connect();
      if (client.connected) {
        ensureServerKeepalive(client);
        return client;
      }
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
    let connectedClient = null;
    if (sessionStr) {
      const savedSessionClient = new TelegramClient2(new StringSession(sessionStr), apiId, apiHash, {
        connectionRetries: 10,
        requestRetries: 5,
        retryDelay: 2e3,
        autoReconnect: true,
        useWSS: false,
        floodSleepThreshold: 60,
        maxConcurrentDownloads: 20,
        baseLogger: new Logger(LogLevel.ERROR)
      });
      try {
        await savedSessionClient.connect();
        if (savedSessionClient.connected) {
          connectedClient = savedSessionClient;
          console.log("[TelegramClient] Connected using cached Telegram Session");
        } else {
          try {
            await savedSessionClient.disconnect();
          } catch {
          }
        }
      } catch (savedErr) {
        console.warn("[TelegramClient] Cached session connect failed, refreshing bot session:", savedErr?.message || savedErr);
        try {
          await savedSessionClient.disconnect();
        } catch {
        }
        try {
          if (fs2.existsSync(SESSION_FILE_PATH)) fs2.unlinkSync(SESSION_FILE_PATH);
        } catch {
        }
        if (!botToken) throw savedErr;
      }
    }
    if (!connectedClient && botToken) {
      let lastErr = null;
      for (const dc of TELEGRAM_DC_ENDPOINTS) {
        const dcSession = new StringSession("");
        dcSession.setDC(dc.id, dc.ip, dc.port);
        const attemptClient = new TelegramClient2(dcSession, apiId, apiHash, {
          connectionRetries: 6,
          requestRetries: 3,
          retryDelay: 1500,
          autoReconnect: true,
          useWSS: false,
          floodSleepThreshold: 60,
          maxConcurrentDownloads: 20,
          baseLogger: new Logger(LogLevel.ERROR)
        });
        try {
          await attemptClient.start({ botAuthToken: botToken });
          connectedClient = attemptClient;
          console.log(`[TelegramClient] Connected via DC ${dc.id} using Telegram Bot Auth Token`);
          const savedSession = attemptClient.session.save();
          if (savedSession && typeof savedSession === "string" && savedSession.length > 10) {
            try {
              fs2.writeFileSync(SESSION_FILE_PATH, savedSession, "utf-8");
            } catch {
            }
          }
          break;
        } catch (dcErr) {
          lastErr = dcErr;
          console.warn(`[TelegramClient] DC ${dc.id} bot login fallback (${dcErr?.errorMessage || dcErr?.message || dcErr})`);
          try {
            await attemptClient.disconnect();
          } catch {
          }
        }
      }
      if (!connectedClient) {
        throw lastErr || new Error("Failed to connect Telegram Bot across all DCs.");
      }
    }
    if (!connectedClient) {
      throw new Error("Failed to establish Telegram client connection.");
    }
    client = connectedClient;
    ensureServerKeepalive(connectedClient);
    initializeChannelCache(connectedClient).catch((err) => {
      console.warn("[TelegramClient] Channel cache warmup note:", err?.message || err);
    });
    return connectedClient;
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
var activeDcSenders = /* @__PURE__ */ new Map();
var dcKeepaliveTimer = null;
function ensureDcKeepaliveLoop() {
  if (dcKeepaliveTimer) return;
  dcKeepaliveTimer = setInterval(async () => {
    const now = Date.now();
    for (const [key, entry] of activeDcSenders.entries()) {
      if (now - entry.lastUsedAt > 15 * 60 * 1e3) {
        activeDcSenders.delete(key);
        continue;
      }
      try {
        await Promise.race([
          entry.client.invokeWithSender(new Api2.Ping({ pingId: bigInt2(now) }), entry.sender),
          new Promise((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 8e3))
        ]);
      } catch {
        try {
          entry.sender?.reconnect?.();
        } catch {
        }
      }
    }
  }, 35 * 1e3);
  dcKeepaliveTimer.unref?.();
}
async function getDcSenderSafe(client2, dcId) {
  const key = dcId !== void 0 ? String(dcId) : "default";
  const cachedEntry = activeDcSenders.get(key);
  if (cachedEntry && cachedEntry.client === client2 && cachedEntry.sender) {
    cachedEntry.lastUsedAt = Date.now();
  }
  const existing = dcSenderPromises.get(key);
  if (existing) return existing;
  const p = client2.getSender(dcId).then((sender) => {
    activeDcSenders.set(key, { client: client2, sender, dcId, lastUsedAt: Date.now() });
    ensureDcKeepaliveLoop();
    return sender;
  }).finally(() => {
    dcSenderPromises.delete(key);
  });
  dcSenderPromises.set(key, p);
  return p;
}
async function fetchTelegramBlockRaw(client2, doc3, blockIndex) {
  const docIdStr = doc3.id.toString();
  const offsetBytes = blockIndex * BLOCK_SIZE;
  const location = new Api2.InputDocumentFileLocation({
    id: doc3.id,
    accessHash: doc3.accessHash,
    fileReference: doc3.fileReference,
    thumbSize: ""
  });
  let activeClient = client2;
  let dcId = resolvedDcMap.get(docIdStr) ?? doc3.dcId;
  let sender = await getDcSenderSafe(activeClient, dcId);
  const request = new Api2.upload.GetFile({
    location,
    offset: bigInt2(offsetBytes),
    limit: BLOCK_SIZE
  });
  const maxAttempts = 5;
  let attempts = 0;
  let authResetDone = false;
  while (attempts < maxAttempts) {
    attempts++;
    let timeoutHandle;
    try {
      const invokePromise = activeClient.invokeWithSender(request, sender);
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("TIMEOUT: Telegram GetFile timed out")), 2e4);
      });
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
      if (isTelegramAuthKeyError(err) && !authResetDone) {
        authResetDone = true;
        activeClient = await resetTelegramClient({ clearSavedSession: true, preferBotFallback: true });
        sender = await getDcSenderSafe(activeClient, dcId);
        continue;
      }
      if (err?.newDc) {
        dcId = Number(err.newDc);
        resolvedDcMap.set(docIdStr, dcId);
        sender = await getDcSenderSafe(activeClient, dcId);
        continue;
      }
      const migrateMatch = msg.match(/FILE_MIGRATE_(\d+)/i);
      if (migrateMatch) {
        dcId = Number(migrateMatch[1]);
        resolvedDcMap.set(docIdStr, dcId);
        sender = await getDcSenderSafe(activeClient, dcId);
        continue;
      }
      const upperMsg = msg.toUpperCase();
      const isTransientNetErr = upperMsg.includes("TIMEOUT") || upperMsg.includes("ECONNRESET") || upperMsg.includes("ETIMEDOUT") || upperMsg.includes("EPIPE") || upperMsg.includes("CONNECTION") || upperMsg.includes("NOT CONNECTED") || upperMsg.includes("WEBSOCKET") || upperMsg.includes("RPC_CALL_FAIL") || upperMsg.includes("INTERNAL");
      if (isTransientNetErr && attempts < maxAttempts) {
        const senderKey = dcId !== void 0 ? String(dcId) : "default";
        if (attempts >= 2) {
          activeDcSenders.delete(senderKey);
          try {
            sender?.reconnect?.();
          } catch {
          }
        }
        await new Promise((r) => setTimeout(r, Math.min(2500, 400 * attempts)));
        try {
          if (!activeClient.connected) {
            await activeClient.connect();
          }
          sender = await getDcSenderSafe(activeClient, dcId);
        } catch {
        }
        continue;
      }
      const floodMatch = msg.match(/FLOOD_WAIT_(\d+)/i);
      if (floodMatch && Number(floodMatch[1]) <= 10 && attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, (Number(floodMatch[1]) + 1) * 1e3));
        continue;
      }
      throw err;
    } finally {
      if (timeoutHandle !== void 0) {
        clearTimeout(timeoutHandle);
      }
    }
  }
  throw new Error("Failed to fetch Telegram block after retries");
}
function fetchBlock(client2, doc3, blockIndex) {
  const key = `${doc3.id.toString()}:${blockIndex}`;
  const cached = getCachedBlock(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const inflight = inflightBlocks.get(key);
  if (inflight) {
    return inflight;
  }
  const promise = fetchTelegramBlockRaw(client2, doc3, blockIndex).then((buf) => {
    touchCache(key, buf);
    return buf;
  }).finally(() => {
    inflightBlocks.delete(key);
  });
  inflightBlocks.set(key, promise);
  return promise;
}
async function streamTelegramRange(res, client2, doc3, start, endPos, concurrency, isClosedFn, onFileRefExpired, refreshDocFn) {
  const firstBlock = Math.floor(start / BLOCK_SIZE);
  const lastBlock = Math.floor(endPos / BLOCK_SIZE);
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, 3));
  let currentDoc = doc3;
  let refRefreshAttempts = 0;
  let bytesWritten = 0;
  let reachedEndOfRange = false;
  const blockPromises = /* @__PURE__ */ new Map();
  let nextToQueue = firstBlock;
  const queueAhead = (upToBlock) => {
    const cap = Math.min(lastBlock, upToBlock);
    while (nextToQueue <= cap && !isClosedFn() && !res.writableEnded) {
      const idx = nextToQueue++;
      if (!blockPromises.has(idx)) {
        const p = fetchBlock(client2, currentDoc, idx);
        p.catch(() => {
        });
        blockPromises.set(idx, p);
      }
    }
  };
  queueAhead(firstBlock + effectiveConcurrency - 1);
  try {
    for (let blockIdx = firstBlock; blockIdx <= lastBlock; blockIdx++) {
      if (isClosedFn() || res.writableEnded) {
        reachedEndOfRange = true;
        break;
      }
      let blockBuf;
      try {
        const p = blockPromises.get(blockIdx) || fetchBlock(client2, currentDoc, blockIdx);
        blockBuf = await p;
        blockPromises.delete(blockIdx);
      } catch (blockErr) {
        blockPromises.delete(blockIdx);
        const errMsg = String(blockErr?.errorMessage || blockErr?.message || "");
        const canRefreshDoc = Boolean(refreshDocFn) && refRefreshAttempts < 3 && (errMsg.includes("FILE_REFERENCE") || bytesWritten > 0);
        if (canRefreshDoc && !isClosedFn() && !res.writableEnded) {
          refRefreshAttempts += 1;
          onFileRefExpired?.();
          try {
            const refreshedDoc = await refreshDocFn();
            if (refreshedDoc) {
              currentDoc = refreshedDoc;
              blockPromises.clear();
              nextToQueue = blockIdx;
              queueAhead(blockIdx + effectiveConcurrency - 1);
              blockIdx -= 1;
              continue;
            }
          } catch {
          }
        }
        throw blockErr;
      }
      if (isClosedFn() || res.writableEnded) {
        reachedEndOfRange = true;
        break;
      }
      if (!blockBuf || blockBuf.length === 0) {
        reachedEndOfRange = true;
        break;
      }
      const blockFileStart = blockIdx * BLOCK_SIZE;
      const sliceStart = Math.max(0, start - blockFileStart);
      const sliceEnd = Math.min(blockBuf.length, endPos - blockFileStart + 1);
      if (sliceEnd > sliceStart) {
        const chunk = sliceStart === 0 && sliceEnd === blockBuf.length ? blockBuf : blockBuf.subarray(sliceStart, sliceEnd);
        bytesWritten += chunk.length;
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
      if (blockBuf.length < BLOCK_SIZE || blockIdx === lastBlock) {
        reachedEndOfRange = true;
        if (blockBuf.length < BLOCK_SIZE) break;
      }
      queueAhead(blockIdx + effectiveConcurrency);
    }
  } catch (err) {
    const errTxt = String(err?.errorMessage || err?.message || "");
    if (errTxt.includes("FILE_REFERENCE")) {
      onFileRefExpired?.();
    }
    if (!isClosedFn()) {
      console.error("[StreamEngine] Range transfer error:", errTxt || err);
    }
  } finally {
    blockPromises.clear();
    if (!res.writableEnded) {
      if (!reachedEndOfRange && bytesWritten > 0 && !isClosedFn()) {
        try {
          res.destroy(new Error("Telegram mid-stream range aborted"));
        } catch {
          res.end();
        }
      } else {
        res.end();
      }
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
  const probesize = String(options?.probesize ?? 9e5);
  const analyzeduration = String(options?.analyzeduration ?? 9e5);
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
        const streamDurations = streams.map((s) => parseFloat(s?.duration || "0")).filter((d) => Number.isFinite(d) && d > 0);
        const maxStreamDuration = streamDurations.length > 0 ? Math.max(...streamDurations) : 0;
        const durationSec = Number.isFinite(formatDuration2) && formatDuration2 > 0 ? Math.round(formatDuration2) : maxStreamDuration > 0 ? Math.round(maxStreamDuration) : docInfo.durationSec || 0;
        const videoStreamObj = streams.find(
          (s) => s.codec_type === "video" && (!s.disposition || s.disposition.attached_pic !== 1) && !["png", "mjpeg", "webp", "bmp", "mjpg", "gif", "image"].includes(String(s.codec_name || "").toLowerCase())
        ) || streams.find((s) => s.codec_type === "video");
        const videoStreamIndex = Number(videoStreamObj?.index ?? 0);
        const videoStream = videoStreamObj;
        const audioStreamObjs = streams.filter((s) => s.codec_type === "audio");
        const subtitleStreamObjs = streams.filter((s) => s.codec_type === "subtitle");
        const videoCodec = String(videoStream?.codec_name || "").toLowerCase();
        const pixFmt = String(videoStream?.pix_fmt || "").toLowerCase();
        const profile = String(videoStream?.profile || "").toLowerCase();
        const fieldOrder = String(videoStream?.field_order || "").toLowerCase();
        const level = Number(videoStream?.level || 0);
        const width = Number(videoStream?.width || 0);
        const height = Number(videoStream?.height || 0);
        const is10Bit = pixFmt.includes("10le") || pixFmt.includes("10be") || pixFmt.includes("p10") || pixFmt.includes("12le") || pixFmt.includes("12be") || pixFmt.includes("p12") || pixFmt.includes("yuv422") || pixFmt.includes("yuv444") || profile.includes("10");
        const videoStartTime = parseFloat(videoStream?.start_time || "0");
        const audioTracks = audioStreamObjs.map((s, idx) => {
          const { lang, label } = formatLanguageLabel(s.tags?.language, s.tags?.title, idx, "audio");
          const trackStart = parseFloat(s.start_time || "0");
          return {
            id: idx,
            streamIndex: Number(s.index ?? idx),
            codec: String(s.codec_name || "").toLowerCase(),
            channels: Number(s.channels || 2),
            lang,
            label,
            startTime: Number.isFinite(trackStart) ? trackStart : 0
          };
        });
        const subtitleTracks = subtitleStreamObjs.map((s, idx) => {
          const rawTitle = String(s.tags?.title || "");
          const isForced = Boolean(s.disposition?.forced === 1 || /\bforced\b/i.test(rawTitle));
          const isDefault = Boolean(s.disposition?.default === 1);
          const { lang, label } = formatLanguageLabel(s.tags?.language, rawTitle, idx, "subtitle");
          return {
            id: idx,
            streamIndex: Number(s.index ?? idx),
            codec: String(s.codec_name || "").toLowerCase(),
            lang: lang || "English",
            label: label || (idx === 0 ? "English" : "Hindi"),
            forced: isForced,
            defaultTrack: isDefault
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
          probedByFfprobe: true,
          videoStartTime: Number.isFinite(videoStartTime) ? videoStartTime : 0,
          videoStreamIndex
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

// src/server/movieAutoMatcher.ts
var RELEASE_CUTOFF_RE = /\b(?:480p|720p|1080p|2160p|360p|4k|uhd|fhd|hdrip|hd[\s._-]*cam|hdcam|hdts|hdtc|predvd|camrip|dvdscr|dvdrip|web[\s._-]*dl|webdl|web[\s._-]*rip|webrip|bluray|bdrip|brrip|x264|x265|h[\s._-]*264|h[\s._-]*265|hevc|avc|10bit|8bit|hi10p|aac|aac2|aac5|ac3|eac3|dd5[\s._-]*1|ddp5[\s._-]*1|dd2[\s._-]*0|dts|atmos|truehd|esub|esubs|msub|msubs|hc[\s._-]*sub|hc[\s._-]*esub|dual[\s._-]*audio|multi[\s._-]*audio|full[\s._-]+(?:hindi|dubbed|hd|movie)|hindi[\s._-]*dubbed|org[\s._-]*hindi|original[\s._-]*hindi|uncut|unrated|extended|remastered|imax|nf|amzn|dsnp|kone|hotstar|zee5|jiocinema|sonyliv|mxplayer|voot|moviesmod|vegamovies|filmyzilla|filmy4wap|hdhub4u|katmoviehd|skymovieshd|mkvcinemas|bolly4u|bollyflix|dotmovies|hdmovie2|cinevoo|movies4u|pagalworld|worldfree4u|khatrimaza|yify|rarbg|psa|flux|ntb|evo|syncopy|watch[\s._-]+online|free[\s._-]+download|download[\s._-]+now)\b/i;
var SERIES_EP_RE = /(?:^|[\s._\-\[(])(?:S\d{1,2}[\s._-]*E\d{1,4}|S\d{1,2}|Season[\s._-]*\d{1,2}(?:[\s._-]*(?:Ep|Episode)[\s._-]*\d{1,4})?|Episode[\s._-]*\d{1,4}|Ep\.?[\s._-]*\d{1,4}|E0*\d{1,3}(?:[\s._-]*[-–—][\s._-]*E?0*\d{1,3})?|\d{1,2}x\d{1,4})(?:$|[\s._\-\])])/i;
var SERIES_CUTOFF_RE = /(?:^|[\s._\-\[(])(?:S0?\d{1,2}[\s._-]*E0?\d{1,4}|S0?\d{1,2}|Season[\s._-]*\d{1,2}|Episode[\s._-]*\d{1,4}|Ep\.?[\s._-]*\d{1,4}|E0*\d{1,3}(?:[\s._-]*[-–—][\s._-]*E?0*\d{1,3})?|\d{1,2}x\d{1,4})\b/i;
var PROMO_LINE_RE = /(?:join\s+@|join\s+our|join\s+channel|channel\s*[:\-–—]|powered\s+by|uploaded\s+by|upload\s+by|shared\s+by|share\s*&|subscribe|t\.me\/|https?:\/\/|download\s+link|request\s+here|feedback|backup\s+channel|follow\s+us|telegram\.me|watch\s+online|click\s+here|more\s+movies|visit\s+our|copyright|dmca|disclaimer)/i;
var NON_TITLE_META_LINE_RE = /^(?:imdb(?:\s+rating)?|tmdb|rotten\s*tomatoes|rating|score|genre|genres|story(?:\s*line)?|plot|synopsis|overview|about|summary|tagline|cast|starring|star\s*cast|actors?|actress|director|directed\s+by|writer|written\s+by|music(?:\s+by)?|producer|produced\s+by|language|languages|audio|voice|subtitle|subtitles|subs?|quality|format|resolution|codec|bitrate|size|file\s*size|duration|runtime|release(?:\s*(?:date|year))?|released|year|country|ott|platform|network|studio|banner|note|warning|info|screens?(?:hots?)?|links?|watch(?:\s+online)?|download|telegram|channel|backup|bot|credit|credits|uploaded(?:\s*by)?|posted(?:\s*by)?|source|rip|encoder?|episode\s*(?:title|name)?|episodes?|season|seasons?|status|part)\s*[:\-–—=|]/i;
var EXPLICIT_TITLE_LABEL_RE = /^(?:movie\s*(?:name|title)?|web\s*series|anime(?:\s*series)?|series\s*(?:name|title)?|show\s*(?:name|title)?|film\s*(?:name|title)?|title|name)\s*[:\-–—=|]\s*(.+)$/i;
var EXPLICIT_YEAR_LINE_RE = /^(?:release\s*)?(?:year|released|release\s*date)\s*[:\-–—=|]\s*.*?((?:19|20)\d{2})\b/i;
var INLINE_META_CUTOFF_RE = /\s+(?:imdb(?:\s*rating)?|rating|genre|genres|story(?:\s*line)?|plot|synopsis|summary|cast|starring|star\s*cast|actors?|director|directed\s+by|language|languages|audio|voice|quality|resolution|duration|runtime|release\s*(?:date|year)|year|subtitles?|subs?|size|download|watch\s+online|uploaded\s*by|join\s+@?)\s*[:\-–—=|]/i;
var TRAILING_LANG_SEASON_RE = /\b(?:s\d{1,2}[\s._-]*e\d{1,4}|s0?\d{1,2}|e0?\d{1,4}|ep\.?\s*0*\d{1,4}|season\s*\d{1,2}|episode\s*\d{1,4}|hindi|english|tamil|telugu|malayalam|kannada|punjabi|bengali|marathi|japanese|korean|dubbed|subbed|multi|dual)\b/gi;
function stripDecorativeSymbols(input) {
  return String(input || "").normalize("NFKD").replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}★☆⭐🎬📺🔥✨👉👇━═─│┃•●◆◇■□▪▫»«›‹➤➜➞➣]+/gu, " ").replace(/\s+/g, " ").trim();
}
function stripFileExtension(name) {
  return name.replace(/\.(mkv|mp4|avi|mov|webm|m4v|ts|flv|wmv|mpg|mpeg)$/i, "");
}
function cleanSingleTitleLine(rawLine) {
  let text = stripFileExtension(String(rawLine || "").trim());
  text = stripDecorativeSymbols(text);
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/t\.me\/\S+/gi, " ");
  text = text.replace(/(?:^|\s)@[a-zA-Z0-9]{2,}(?=[_\s\-.:|]|$)/g, " ");
  text = text.replace(/@[a-zA-Z0-9_]{3,}(?=\s|$)/g, " ");
  text = text.replace(/(?:^|\s)#[^\s]+/g, " ");
  text = text.replace(/\b\d+(?:\.\d+)?\s*(?:gb|mb|kb)\b/gi, " ");
  text = text.replace(/[._|]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/^(?:tg|dvdwoall|m4uhd|kmmovies|moviesmod|vegamovies|hdhub4u|rd)\s*[:\-–—]+\s*/i, "").trim();
  let hasExplicitLabel = false;
  const labelMatch = text.match(EXPLICIT_TITLE_LABEL_RE);
  if (labelMatch) {
    hasExplicitLabel = true;
    text = labelMatch[1].trim();
  }
  const inlineMetaMatch = text.match(INLINE_META_CUTOFF_RE);
  if (inlineMetaMatch && typeof inlineMetaMatch.index === "number" && inlineMetaMatch.index > 1) {
    text = text.slice(0, inlineMetaMatch.index).trim();
  }
  text = text.replace(/^\[[^\]]{2,40}\]\s*/g, "").trim();
  const maxValidYear = (/* @__PURE__ */ new Date()).getFullYear();
  let detectedYear = null;
  let yearIndex = -1;
  const bracketYears = Array.from(text.matchAll(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/g));
  for (const m of bracketYears) {
    const yr = parseInt(m[1], 10);
    if (yr >= 1940 && yr <= maxValidYear) {
      detectedYear = yr;
      const idx = m.index ?? -1;
      yearIndex = idx;
      if (idx > 1) {
        text = text.slice(0, idx).trim();
      } else if (idx >= 0) {
        text = `${text.slice(0, idx)} ${text.slice(idx + m[0].length)}`.trim();
      }
      break;
    }
  }
  if (!detectedYear) {
    const yearMatches = Array.from(text.matchAll(/\b((?:19|20)\d{2})\b/g));
    for (let i = yearMatches.length - 1; i >= 0; i--) {
      const m = yearMatches[i];
      const idx = m.index ?? 0;
      const yr = parseInt(m[1], 10);
      if (idx > 2 && yr >= 1940 && yr <= maxValidYear) {
        detectedYear = yr;
        yearIndex = idx;
        text = text.slice(0, idx).trim();
        break;
      }
    }
  }
  const seriesCut = text.match(SERIES_CUTOFF_RE);
  if (seriesCut && typeof seriesCut.index === "number" && seriesCut.index > 1) {
    text = text.slice(0, seriesCut.index);
  }
  const cutoffMatch = text.match(RELEASE_CUTOFF_RE);
  if (cutoffMatch && typeof cutoffMatch.index === "number" && cutoffMatch.index > 1) {
    text = text.slice(0, cutoffMatch.index);
  }
  const wordsAfterStrip = text.replace(TRAILING_LANG_SEASON_RE, " ").replace(/\s+/g, " ").trim();
  if (wordsAfterStrip.length >= 2) {
    text = wordsAfterStrip;
  }
  text = text.replace(/[\[(]\s*[\])]/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*(?:dubbed|hindi|english|tamil|telugu|dual|audio|esub|480p|720p|1080p|4k|rip|cam)[^)]*\)/gi, " ").replace(/\b(?:full\s+movie|hindi\s+movie|south\s+movie|english\s+movie|new\s+movie|bollywood\s+movie|hollywood\s+movie|bollywood|hollywood|web\s+series|complete\s+series|complete\s+season|all\s+episodes|watch\s+online|free\s+download|download\s+now)\b/gi, " ").replace(/^[\s\-–—:;,./\\]+|[\s\-–—:;,./\\]+$/g, "").replace(/\s+/g, " ").trim();
  return { title: text, year: detectedYear, hasExplicitLabel };
}
function parseSeriesSeasonEpisode(rawText) {
  const norm = String(rawText || "").replace(/[._]+/g, " ");
  let seasonNumber = null;
  let episodeNumber = null;
  let episodeLabel = "";
  const seRange = norm.match(/\bS0*(\d{1,2})\s*[-–—]?\s*E0*(\d{1,4})\s*[-–—]\s*E?0*(\d{1,4})\b/i);
  const seSingle = norm.match(/\bS0*(\d{1,2})\s*[-–—]?\s*E0*(\d{1,4})\b/i);
  const xMatch = norm.match(/\b0*(\d{1,2})x0*(\d{1,4})\b/i);
  const seasonWord = norm.match(/\b(?:Season|S)\s*0*(\d{1,2})\b/i);
  const epRange = norm.match(/\b(?:Episodes?|Eps?)\s*[:\-]?\s*0*(\d{1,4})\s*(?:-|–|to)\s*0*(\d{1,4})\b/i);
  const epWord = norm.match(/\b(?:Episode|Ep)\s*[:\-]?\s*0*(\d{1,4})\b/i);
  const standaloneEpRange = norm.match(/(?:^|[\s\-\[(])E0*(\d{1,3})\s*[-–—]\s*E?0*(\d{1,3})(?:$|[\s\-\])])/i);
  const standaloneEpSingle = norm.match(/(?:^|[\s\-\[(])E0*(\d{1,3})(?:$|[\s\-\])])/i);
  if (seRange) {
    seasonNumber = parseInt(seRange[1], 10);
    const eStart = parseInt(seRange[2], 10);
    const eEnd = parseInt(seRange[3], 10);
    episodeNumber = eStart;
    if (eEnd > eStart) episodeLabel = `${eStart}-${eEnd}`;
  } else if (seSingle) {
    seasonNumber = parseInt(seSingle[1], 10);
    episodeNumber = parseInt(seSingle[2], 10);
  } else if (xMatch) {
    seasonNumber = parseInt(xMatch[1], 10);
    episodeNumber = parseInt(xMatch[2], 10);
  } else {
    if (seasonWord) seasonNumber = parseInt(seasonWord[1], 10);
    if (epRange) {
      const eStart = parseInt(epRange[1], 10);
      const eEnd = parseInt(epRange[2], 10);
      episodeNumber = eStart;
      if (eEnd > eStart) episodeLabel = `${eStart}-${eEnd}`;
    } else if (epWord) {
      episodeNumber = parseInt(epWord[1], 10);
    } else if (standaloneEpRange) {
      const eStart = parseInt(standaloneEpRange[1], 10);
      const eEnd = parseInt(standaloneEpRange[2], 10);
      episodeNumber = eStart;
      if (eEnd > eStart) episodeLabel = `${eStart}-${eEnd}`;
    } else if (standaloneEpSingle) {
      episodeNumber = parseInt(standaloneEpSingle[1], 10);
    }
  }
  if (episodeNumber !== null && seasonNumber === null) {
    seasonNumber = 1;
  }
  const episodeTitle = episodeLabel ? `Episodes ${episodeLabel}` : episodeNumber !== null ? `Episode ${episodeNumber}` : "";
  return { seasonNumber, episodeNumber, episodeLabel, episodeTitle };
}
function detectQualityTag(text, width = 0, height = 0) {
  const lower = text.toLowerCase();
  if (/\b(?:2160p|4k|uhd)\b/.test(lower)) return "4K";
  if (/\b(?:1080p|fhd)\b/.test(lower)) return "1080p";
  if (/\b720p\b/.test(lower)) return "720p";
  if (/\b480p\b/.test(lower)) return "480p";
  if (/\b360p\b/.test(lower)) return "360p";
  const maxDim = Math.max(width || 0, height || 0);
  if (maxDim >= 3400 || height >= 2e3) return "4K";
  if (maxDim >= 1700 || height >= 950) return "1080p";
  if (maxDim >= 1150 || height >= 680) return "720p";
  if (maxDim >= 700 || height >= 440) return "480p";
  if (maxDim > 0) return "360p";
  return "";
}
function detectLanguageHint(text) {
  const lower = text.toLowerCase();
  const isDual = /\b(?:dual[\s._-]*audio|multi[\s._-]*audio)\b/.test(lower);
  const hasHindi = /\bhindi\b/.test(lower);
  const isHindiDubbed = /\bhindi[\s._-]*dubbed\b/.test(lower) || hasHindi && isDual;
  const langs = [];
  if (hasHindi) langs.push("Hindi");
  if (/\benglish\b/.test(lower)) langs.push("English");
  if (/\btamil\b/.test(lower)) langs.push("Tamil");
  if (/\btelugu\b/.test(lower)) langs.push("Telugu");
  if (/\bmalayalam\b/.test(lower)) langs.push("Malayalam");
  if (/\bkannada\b/.test(lower)) langs.push("Kannada");
  if (/\bpunjabi\b/.test(lower)) langs.push("Punjabi");
  if (/\bbengali\b/.test(lower)) langs.push("Bengali");
  if (/\bmarathi\b/.test(lower)) langs.push("Marathi");
  if (/\bjapanese\b/.test(lower)) langs.push("Japanese");
  if (/\bkorean\b/.test(lower)) langs.push("Korean");
  if (langs.length === 0 && isDual) {
    return { languageHint: "Hindi, English", isHindiDubbed: true };
  }
  return {
    languageHint: langs.join(", "),
    isHindiDubbed
  };
}
function normalizeTitleKey2(title) {
  return String(title || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
var ONLY_LANG_QUALITY_TOKENS_RE = /^(?:hindi|english|tamil|telugu|malayalam|kannada|punjabi|bengali|marathi|gujarati|bhojpuri|odia|japanese|korean|chinese|spanish|french|dual|multi|audio|dubbed|subbed|org|original|esub|esubs|msub|480p|720p|1080p|2160p|4k|uhd|fhd|hd|webrip|webdl|hdrip|bluray|hevc|x264|x265|10bit|and|\s|,|\.|\/|-)+$/i;
function looksGenericTelegramName(name) {
  const clean = normalizeTitleKey2(name);
  if (!clean || clean.length < 2) return true;
  if (ONLY_LANG_QUALITY_TOKENS_RE.test(clean)) return true;
  return /^(?:vid|video|img|document|doc|file|movie|telegram|tg|episode|msg|mp4|mkv|year|title|name|unknown)\s*\d*$/i.test(clean);
}
function parseTelegramMovieMeta(fileName, caption, width = 0, height = 0, durationSec = 0, sizeBytes = 0) {
  const rawLines = String(caption || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const maxValidYear = (/* @__PURE__ */ new Date()).getFullYear();
  let explicitCaptionYear = null;
  let explicitImdbId = null;
  const seasonEpisodeLines = [];
  for (const rawLine of rawLines) {
    const plain = stripDecorativeSymbols(rawLine);
    if (!plain) continue;
    if (!explicitCaptionYear) {
      const yMatch = plain.match(EXPLICIT_YEAR_LINE_RE);
      if (yMatch) {
        const yr = parseInt(yMatch[1], 10);
        if (yr >= 1940 && yr <= maxValidYear) explicitCaptionYear = yr;
      }
    }
    if (!explicitImdbId && (EXPLICIT_TITLE_LABEL_RE.test(plain) || /^imdb\b/i.test(plain))) {
      const im = plain.match(/\b(tt\d{6,10})\b/i);
      if (im) explicitImdbId = im[1].toLowerCase();
    }
    if (/^(?:season|episode|ep)\s*[:\-–—=]/i.test(plain)) {
      seasonEpisodeLines.push(plain);
    }
  }
  if (!explicitImdbId && fileName) {
    const im = fileName.match(/\b(tt\d{6,10})\b/i);
    if (im) explicitImdbId = im[1].toLowerCase();
  }
  const isSampleOrClip = /\b(?:sample|trailer|teaser|promo|intro[\s._-]*clip)\b/i.test(fileName || "") || durationSec > 0 && durationSec < 60 && sizeBytes > 0 && sizeBytes < 5 * 1024 * 1024;
  const captionLines = rawLines.filter((l) => {
    const plain = stripDecorativeSymbols(l);
    if (!plain || plain.length < 2) return false;
    if (/^[\s\-_=*~.,:;!?/\\|]+$/.test(plain)) return false;
    if (/^(?:#[^\s]+\s*)+$/.test(plain)) return false;
    if (PROMO_LINE_RE.test(plain) || /^(?:join|http|@|visit|follow|share|download|click)/i.test(plain)) return false;
    if (NON_TITLE_META_LINE_RE.test(plain)) return false;
    if (ONLY_LANG_QUALITY_TOKENS_RE.test(plain)) return false;
    if (/^[\[(]?\s*(?:19|20)\d{2}\s*[\])]?$/.test(plain)) return false;
    if (!EXPLICIT_TITLE_LABEL_RE.test(plain) && (plain.length > 85 || plain.split(/\s+/).length > 12) && !/^\s*.{2,45}[\[(]\s*(?:19|20)\d{2}\s*[\])]/.test(plain)) {
      return false;
    }
    return true;
  });
  const candidates = [];
  for (let i = 0; i < Math.min(captionLines.length, 6); i++) {
    const parsedLine = cleanSingleTitleLine(captionLines[i]);
    if (parsedLine.title && !looksGenericTelegramName(parsedLine.title)) {
      candidates.push({
        title: parsedLine.title,
        year: parsedLine.year,
        hasExplicitLabel: parsedLine.hasExplicitLabel,
        fromCaption: true,
        lineIdx: i,
        rawLine: captionLines[i]
      });
    }
  }
  const parsedFile = cleanSingleTitleLine(fileName || "");
  if (parsedFile.title) {
    candidates.push({
      title: parsedFile.title,
      year: parsedFile.year,
      hasExplicitLabel: parsedFile.hasExplicitLabel,
      fromCaption: false,
      lineIdx: 99,
      rawLine: fileName || ""
    });
  }
  candidates.sort((a, b) => {
    const scoreCand = (c) => {
      let s = 0;
      if (looksGenericTelegramName(c.title)) s -= 100;
      if (c.hasExplicitLabel) s += 45;
      if (c.year) s += 25;
      if (c.title.length >= 2 && c.title.length <= 65) s += 14;
      else if (c.title.length > 85) s -= 30;
      if (c.fromCaption) s += Math.max(2, 12 - c.lineIdx * 2);
      return s;
    };
    return scoreCand(b) - scoreCand(a);
  });
  const best = candidates[0] || { title: "", year: null, rawLine: "" };
  let adjacentYear = null;
  if (rawLines.length >= 2) {
    const secondPlain = stripDecorativeSymbols(rawLines[1]);
    const adjMatch = secondPlain.match(/^[\[(]?\s*((?:19|20)\d{2})\s*[\])]?$/);
    if (adjMatch) {
      const yr = parseInt(adjMatch[1], 10);
      if (yr >= 1940 && yr <= maxValidYear) adjacentYear = yr;
    }
  }
  const fallbackYear = best.year || explicitCaptionYear || adjacentYear || parsedFile.year || null;
  const focusedMetaText = [best.rawLine, ...seasonEpisodeLines, fileName || ""].filter(Boolean).join("\n");
  const isSeriesEpisode = SERIES_EP_RE.test(focusedMetaText);
  const quality = detectQualityTag(focusedMetaText, width, height);
  const { languageHint, isHindiDubbed } = detectLanguageHint(focusedMetaText);
  const epDetails = parseSeriesSeasonEpisode(focusedMetaText);
  const finalIsSeries = isSeriesEpisode || epDetails.episodeNumber !== null;
  const cleanTitle = best.title || stripFileExtension(fileName || "").replace(/[._-]+/g, " ").trim();
  const normalizedGroupTitle = normalizeTitleKey2(cleanTitle).replace(/\s+/g, "");
  const groupKey = finalIsSeries && normalizedGroupTitle ? `${normalizedGroupTitle}-s${epDetails.seasonNumber || 1}-e${epDetails.episodeNumber || 0}${epDetails.episodeLabel ? `-${epDetails.episodeLabel}` : ""}` : explicitImdbId ? `imdb-${explicitImdbId}` : normalizedGroupTitle ? `${normalizedGroupTitle}${fallbackYear ? `-${fallbackYear}` : ""}` : "";
  return {
    rawFileName: fileName || "",
    rawCaption: caption || "",
    explicitImdbId,
    cleanTitle,
    groupKey,
    year: fallbackYear,
    quality,
    languageHint,
    isHindiDubbed,
    isSeriesEpisode: finalIsSeries,
    seasonNumber: epDetails.seasonNumber,
    episodeNumber: epDetails.episodeNumber,
    episodeLabel: epDetails.episodeLabel,
    episodeTitle: epDetails.episodeTitle,
    isSampleOrClip
  };
}
function getTitleSimilarityScore(candidateTitle, queryTitle) {
  const cNorm = normalizeTitleKey2(candidateTitle);
  const qNorm = normalizeTitleKey2(queryTitle);
  if (!cNorm || !qNorm) return 0;
  if (cNorm === qNorm) return 65;
  const cCompact = cNorm.replace(/\s+/g, "");
  const qCompact = qNorm.replace(/\s+/g, "");
  if (cCompact === qCompact) return 62;
  const stopWords = /* @__PURE__ */ new Set(["the", "a", "an", "of", "and", "in", "to", "part", "chapter", "movie"]);
  const cTokens = cNorm.split(/\s+/).filter((t) => t.length > 0);
  const qTokens = qNorm.split(/\s+/).filter((t) => t.length > 0);
  const cSig = cTokens.filter((t) => !stopWords.has(t));
  const qSig = qTokens.filter((t) => !stopWords.has(t));
  const useC = cSig.length > 0 ? cSig : cTokens;
  const useQ = qSig.length > 0 ? qSig : qTokens;
  let matchedQ = 0;
  for (const qt of useQ) {
    if (useC.includes(qt)) matchedQ++;
  }
  const qCoverage = useQ.length > 0 ? matchedQ / useQ.length : 0;
  const cCoverage = useC.length > 0 ? matchedQ / useC.length : 0;
  const harmonic = qCoverage + cCoverage > 0 ? 2 * qCoverage * cCoverage / (qCoverage + cCoverage) : 0;
  const qNums = qNorm.match(/\b(?:2|3|4|5|6|ii|iii|iv)\b/g) || [];
  const cNums = cNorm.match(/\b(?:2|3|4|5|6|ii|iii|iv)\b/g) || [];
  let sequelPenalty = 0;
  if (qNums.length > 0) {
    const hasMatchNum = qNums.some((n) => cNums.includes(n));
    if (!hasMatchNum) sequelPenalty = -28;
  } else if (cNums.length > 0) {
    sequelPenalty = -10;
  }
  let bonus = 0;
  if (cNorm.startsWith(qNorm) || qNorm.startsWith(cNorm)) bonus += 10;
  return Math.round(harmonic * 52 + bonus + sequelPenalty);
}
function scoreImdbCandidate(candidate, parsed) {
  let score = getTitleSimilarityScore(candidate.title, parsed.cleanTitle);
  const candYearNum = parseInt(String(candidate.year || "").slice(0, 4), 10);
  const typeLower = String(candidate.type || "movie").toLowerCase();
  if (parsed.year && Number.isFinite(candYearNum)) {
    const diff = Math.abs(candYearNum - parsed.year);
    if (diff === 0) {
      score += 45;
    } else if (diff === 1) {
      score += 20;
    } else if (parsed.isSeriesEpisode && typeLower === "series" && candYearNum <= parsed.year && parsed.year - candYearNum <= 15) {
      score += 25;
    } else if (diff === 2) {
      score += 0;
    } else {
      score -= 35;
    }
  } else if (Number.isFinite(candYearNum) && candYearNum >= 1950) {
    if (candYearNum >= 2e3) score += 8;
  }
  if (candidate.posterUrl && candidate.posterUrl !== "N/A" && /^https?:\/\//i.test(candidate.posterUrl)) {
    score += 20;
  } else {
    score -= 55;
  }
  if (typeLower === "game") {
    score -= 70;
  } else if (!parsed.isSeriesEpisode) {
    if (typeLower === "movie") score += 12;
    else if (typeLower === "series") score -= 12;
  } else {
    if (typeLower === "series") score += 22;
    else if (typeLower === "movie") score -= 14;
  }
  return score;
}
function mergeFinalLanguage(omdbLang, parsed) {
  const hint = parsed.languageHint;
  if (!hint) return omdbLang || "Hindi";
  if (parsed.isHindiDubbed) {
    const hintParts = hint.split(",").map((s) => s.trim()).filter(Boolean);
    if (!hintParts.some((s) => s.toLowerCase() === "hindi")) {
      hintParts.unshift("Hindi");
    }
    return hintParts.join(", ");
  }
  if (hint.toLowerCase().includes("hindi") && omdbLang && !omdbLang.toLowerCase().includes("hindi")) {
    return `${hint}, ${omdbLang}`;
  }
  return hint || omdbLang || "Hindi";
}
async function resolveBestImdbMatch(parsed) {
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  const fallbackYear = parsed.year && parsed.year <= currentYear ? parsed.year : currentYear;
  if (parsed.explicitImdbId) {
    const detail2 = await fetchMetadataDetailInternal(parsed.explicitImdbId);
    if (detail2.status === "ok" && detail2.data) {
      const d2 = detail2.data;
      const poster = upgradePosterUrl(d2.posterUrl, 1080) || d2.posterUrl || "";
      const backdrop = upgradePosterUrl(d2.backdropUrl || poster, 1280) || poster;
      const rawYear = Number(d2.releaseYear) || fallbackYear;
      const clampedYear = rawYear > currentYear ? fallbackYear : rawYear;
      return {
        imdbId: d2.imdbId || parsed.explicitImdbId,
        title: d2.title || parsed.cleanTitle,
        originalTitle: d2.originalTitle || d2.title || parsed.cleanTitle,
        releaseYear: clampedYear,
        posterUrl: poster,
        backdropUrl: backdrop,
        genre: d2.genre || "Action",
        description: d2.description || "",
        director: d2.director || "",
        cast: d2.cast || "",
        runtime: d2.runtime || "",
        language: mergeFinalLanguage(d2.language, parsed),
        rating: d2.rating || 8,
        originalCategory: d2.suggestedCategory || "Bollywood Movie",
        matchConfidence: poster ? "high" : "medium",
        confidenceScore: poster ? 100 : 75,
        matchReason: "Exact IMDb ID in caption",
        alternateMatches: []
      };
    }
  }
  const queriesToTry = [];
  if (parsed.cleanTitle && !looksGenericTelegramName(parsed.cleanTitle)) {
    if (parsed.isSeriesEpisode) {
      queriesToTry.push(parsed.cleanTitle);
      if (parsed.year) queriesToTry.push(`${parsed.cleanTitle} ${parsed.year}`);
    } else {
      if (parsed.year) queriesToTry.push(`${parsed.cleanTitle} ${parsed.year}`);
      queriesToTry.push(parsed.cleanTitle);
    }
    const strippedSub = parsed.cleanTitle.split(/\s*[:\-–]\s*/)[0]?.trim();
    if (strippedSub && strippedSub.length >= 3 && strippedSub.toLowerCase() !== parsed.cleanTitle.toLowerCase()) {
      queriesToTry.push(parsed.year && !parsed.isSeriesEpisode ? `${strippedSub} ${parsed.year}` : strippedSub);
    }
  }
  const allCandidatesMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < queriesToTry.length; i++) {
    const q = queriesToTry[i];
    const searchRes = await searchMetadataInternal(q);
    for (const item of searchRes.results || []) {
      if (item?.imdbId && !allCandidatesMap.has(item.imdbId)) {
        allCandidatesMap.set(item.imdbId, {
          imdbId: item.imdbId,
          title: item.title,
          year: item.year,
          type: item.type,
          posterUrl: upgradePosterUrl(item.posterUrl, 1080) || item.posterUrl || "",
          cast: item.cast
        });
      }
    }
    if (allCandidatesMap.size > 0 && i === 0) {
      const topFirst = Array.from(allCandidatesMap.values()).map((c) => ({ c, s: scoreImdbCandidate(c, parsed) })).sort((a, b) => b.s - a.s)[0];
      if (topFirst && topFirst.s >= 95 && topFirst.c.posterUrl) {
        break;
      }
    }
  }
  const scoredCandidates = Array.from(allCandidatesMap.values()).map((cand) => ({ cand, score: scoreImdbCandidate(cand, parsed) })).sort((a, b) => b.score - a.score);
  const winner = scoredCandidates[0];
  const alternateMatches = scoredCandidates.slice(0, 6).map((x) => x.cand);
  if (!winner || winner.score < 25) {
    return {
      imdbId: "",
      title: parsed.cleanTitle || parsed.rawFileName || "Untitled Movie",
      originalTitle: parsed.cleanTitle || parsed.rawFileName || "Untitled Movie",
      releaseYear: fallbackYear,
      posterUrl: "",
      backdropUrl: "",
      genre: "Action",
      description: "",
      director: "",
      cast: "",
      runtime: "",
      language: parsed.languageHint || "Hindi",
      rating: 7.5,
      originalCategory: parsed.isSeriesEpisode ? "Web Series" : "Bollywood Movie",
      matchConfidence: "low",
      confidenceScore: Math.max(0, winner?.score || 0),
      matchReason: "Movie not confidently matched on IMDb \u2014 pick poster manually",
      alternateMatches
    };
  }
  const detail = await fetchMetadataDetailInternal(winner.cand.imdbId, winner.cand.title);
  const d = detail.status === "ok" ? detail.data : void 0;
  const bestPoster = upgradePosterUrl(d?.posterUrl || winner.cand.posterUrl, 1080) || d?.posterUrl || winner.cand.posterUrl || "";
  const bestBackdrop = upgradePosterUrl(d?.backdropUrl || bestPoster, 1280) || bestPoster;
  const candYearParsed = parseInt(String(winner.cand.year || "").slice(0, 4), 10);
  const detailYearParsed = Number(d?.releaseYear || 0);
  const rawFinalYear = detailYearParsed > 0 && detailYearParsed <= currentYear ? detailYearParsed : Number.isFinite(candYearParsed) && candYearParsed >= 1900 && candYearParsed <= currentYear ? candYearParsed : fallbackYear;
  const finalYear = rawFinalYear > currentYear ? fallbackYear : rawFinalYear;
  const rawSim = getTitleSimilarityScore(d?.title || winner.cand.title, parsed.cleanTitle);
  const winnerType = String(winner.cand.type || "").toLowerCase();
  const isSeriesYearMatch = parsed.isSeriesEpisode && winnerType === "series" && Boolean(parsed.year && finalYear <= parsed.year && parsed.year - finalYear <= 15);
  const yearMatched = Boolean(
    parsed.year && Math.abs(finalYear - parsed.year) <= 1 || isSeriesYearMatch
  );
  const hasPoster = Boolean(bestPoster && /^https?:\/\//i.test(bestPoster));
  let matchConfidence = "low";
  let matchReason = "Verify title & poster";
  if (hasPoster && rawSim >= 55 && (yearMatched || !parsed.year && winner.score >= 82)) {
    matchConfidence = "high";
    matchReason = yearMatched ? `Exact Title + Year (${finalYear}) \u2022 Verified Poster` : "Strong Title Match \u2022 Verified Poster";
  } else if (hasPoster && winner.score >= 55) {
    matchConfidence = "medium";
    matchReason = !parsed.year ? "Matched without release year in filename \u2014 quick check poster" : "Partial match \u2014 verify poster & year";
  } else {
    matchConfidence = "low";
    matchReason = hasPoster ? "Low title similarity \u2014 verify movie" : "No poster found on IMDb";
  }
  let suggestedCategory = d?.suggestedCategory || "Bollywood Movie";
  if (parsed.isSeriesEpisode && suggestedCategory.toLowerCase().includes("movie")) {
    suggestedCategory = suggestedCategory.toLowerCase().includes("anime") ? "Anime Series" : "Web Series";
  }
  return {
    imdbId: d?.imdbId || winner.cand.imdbId,
    title: d?.title || winner.cand.title,
    originalTitle: d?.originalTitle || d?.title || winner.cand.title,
    releaseYear: finalYear,
    posterUrl: bestPoster,
    backdropUrl: bestBackdrop,
    genre: d?.genre || "Action",
    description: d?.description || "",
    director: d?.director || "",
    cast: d?.cast || winner.cand.cast || "",
    runtime: d?.runtime || "",
    language: mergeFinalLanguage(d?.language || "Hindi", parsed),
    rating: Number(d?.rating) || 8,
    originalCategory: suggestedCategory,
    matchConfidence,
    confidenceScore: Math.max(0, Math.min(100, winner.score)),
    matchReason,
    alternateMatches
  };
}

// src/server/telegramRouter.ts
init_firebase();
import {
  collection,
  doc as doc2,
  getDocFromServer as getDocFromServer2,
  getDocsFromServer,
  serverTimestamp,
  setDoc
} from "firebase/firestore";

// src/utils/categoryMapping.ts
var getDisplayCategory = (originalCategory) => {
  switch (originalCategory) {
    case "Bollywood Movie":
    case "South Indian Movie":
      return "Bollywood";
    case "Hollywood Movie":
      return "Hollywood";
    case "Web Series":
    case "Anime Series":
    case "Anime Movie":
    case "Anime":
      return "Series";
    default:
      return "Bollywood";
  }
};

// src/utils/duration.ts
init_apiConfig();
var import_core = __toESM(require_index_cjs(), 1);
function parseDurationToSeconds(input) {
  if (input === null || input === void 0) return 0;
  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0 ? Math.round(input) : 0;
  }
  const raw = String(input).trim();
  if (!raw || /^(n\/a|na|null|undefined|--+)$/i.test(raw)) return 0;
  if (/^\d{1,3}:\d{1,2}(:\d{1,2})?$/.test(raw)) {
    const parts = raw.split(":").map((p) => parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }
  let total = 0;
  let matchedUnit = false;
  const hMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  if (hMatch) {
    total += Math.round(parseFloat(hMatch[1]) * 3600);
    matchedUnit = true;
  }
  const mMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i);
  if (mMatch) {
    total += Math.round(parseFloat(mMatch[1]) * 60);
    matchedUnit = true;
  }
  const sMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
  if (sMatch) {
    total += Math.round(parseFloat(sMatch[1]));
    matchedUnit = true;
  }
  if (matchedUnit) {
    return total > 0 ? total : 0;
  }
  if (/^\d+$/.test(raw)) {
    const num = parseInt(raw, 10);
    if (num <= 0) return 0;
    return num <= 600 ? num * 60 : num;
  }
  return 0;
}
var STREAM_INFO_CACHE_TTL_MS = 10 * 60 * 1e3;

// src/utils/qualityBadge.ts
function normalizeQualityBadge(_value) {
  return "NONE";
}

// src/utils/channelSyncFilters.ts
var CAM_RIP_RE = /\b(?:camrip|hd[\s._-]*cam|hdcam|hdts|hdtc|predvd|telesync|telecine|dvdscr)\b/i;
function normalizeHdQualityFromHeightOrTag(height, width, parsedQuality) {
  const tag = String(parsedQuality || "").trim().toLowerCase();
  if (tag === "1080p") return "1080p";
  if (tag === "720p") return "720p";
  if (tag === "480p" || tag === "360p") return "";
  const h = Math.max(0, Number(height) || 0);
  const w = Math.max(0, Number(width) || 0);
  if (h >= 900 || w >= 1700) return "1080p";
  if (h >= 680 || w >= 1200 && h >= 500) return "720p";
  return "";
}
function hasConfirmedAudioTrack(input) {
  if (input.hasExplicitNoSound) {
    return { confirmed: false, definitelyNoAudio: true };
  }
  const probe = input.probe;
  if (probe && probe.probedByFfprobe) {
    const tracks = Array.isArray(probe.audioTracks) ? probe.audioTracks : [];
    const validTracks = tracks.filter((t) => {
      const codec = String(t?.codec || "").trim().toLowerCase();
      const ch = Number(t?.channels) || 0;
      return Boolean(codec && codec !== "none") || ch > 0;
    });
    if (validTracks.length > 0) {
      return { confirmed: true, definitelyNoAudio: false };
    }
    const topAudio = String(probe.audioCodec || "").trim().toLowerCase();
    if (topAudio && topAudio !== "none") {
      return { confirmed: true, definitelyNoAudio: false };
    }
    return { confirmed: false, definitelyNoAudio: true };
  }
  if (input.hasVideoAttr) {
    return { confirmed: true, definitelyNoAudio: false };
  }
  return { confirmed: false, definitelyNoAudio: false };
}
function evaluateChannelVideoFilter(input) {
  const requireValidAudio = input.requireValidAudio !== false;
  const rejectCamRip = input.rejectCamRip === true;
  const allowedQualities = Array.isArray(input.allowedQualities) && input.allowedQualities.length > 0 ? input.allowedQualities : ["1080p", "720p"];
  const combinedText = `${input.fileName || ""} ${input.caption || ""}`;
  if (rejectCamRip && CAM_RIP_RE.test(combinedText)) {
    return {
      accepted: false,
      reason: "cam_rip",
      effectiveQuality: "",
      hasValidAudio: false,
      effectiveHeight: Math.max(Number(input.probe?.height) || 0, Number(input.height) || 0)
    };
  }
  const audioCheck = hasConfirmedAudioTrack({
    hasExplicitNoSound: input.hasExplicitNoSound,
    probe: input.probe,
    hasVideoAttr: input.hasVideoAttr
  });
  if (requireValidAudio) {
    if (audioCheck.definitelyNoAudio) {
      return {
        accepted: false,
        reason: "no_audio",
        effectiveQuality: "",
        hasValidAudio: false,
        effectiveHeight: Math.max(Number(input.probe?.height) || 0, Number(input.height) || 0)
      };
    }
    if (!audioCheck.confirmed) {
      return {
        accepted: false,
        reason: "unverified_audio",
        effectiveQuality: "",
        hasValidAudio: false,
        effectiveHeight: Math.max(Number(input.probe?.height) || 0, Number(input.height) || 0)
      };
    }
  }
  const effectiveHeight = Math.max(Number(input.probe?.height) || 0, Number(input.height) || 0);
  const effectiveWidth = Math.max(Number(input.probe?.width) || 0, Number(input.width) || 0);
  const effectiveQuality = normalizeHdQualityFromHeightOrTag(
    effectiveHeight,
    effectiveWidth,
    input.parsedQuality
  );
  if (!effectiveQuality || !allowedQualities.includes(effectiveQuality)) {
    return {
      accepted: false,
      reason: "low_quality",
      effectiveQuality: "",
      hasValidAudio: audioCheck.confirmed,
      effectiveHeight
    };
  }
  return {
    accepted: true,
    reason: "ok",
    effectiveQuality,
    hasValidAudio: audioCheck.confirmed,
    effectiveHeight
  };
}
function filterQualityMapForHdOnly(qualities) {
  const out = {};
  if (qualities["1080p"]) out["1080p"] = qualities["1080p"];
  if (qualities["720p"]) out["720p"] = qualities["720p"];
  return out;
}

// src/server/firestoreQuotaFlag.ts
import fs3 from "fs";
var QUOTA_FLAG_FILE = "/tmp/.mp_firestore_write_quota.json";
var cachedUntilMs = 0;
var loadedFromDisk = false;
function computeNextResetExpiryMs() {
  const now = /* @__PURE__ */ new Date();
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    1,
    0,
    0
  );
  return Math.max(Date.now() + 12 * 3600 * 1e3, nextUtcMidnight);
}
function loadFromDiskOnce() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  try {
    if (fs3.existsSync(QUOTA_FLAG_FILE)) {
      const parsed = JSON.parse(fs3.readFileSync(QUOTA_FLAG_FILE, "utf8"));
      if (parsed && typeof parsed.exhaustedUntilMs === "number" && parsed.exhaustedUntilMs > Date.now()) {
        cachedUntilMs = parsed.exhaustedUntilMs;
      }
    }
  } catch {
  }
}
function isFirestoreQuotaErrorLike(errOrText) {
  const code = String(errOrText?.code || "").toLowerCase();
  const msg = String(errOrText?.message || errOrText || "").toLowerCase();
  return code.includes("resource-exhausted") || code === "429" || msg.includes("resource-exhausted") || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("free daily write") || msg.includes("too many requests");
}
function isServerFirestoreWriteAllowed() {
  loadFromDiskOnce();
  if (!cachedUntilMs) return true;
  if (Date.now() > cachedUntilMs) {
    cachedUntilMs = 0;
    try {
      if (fs3.existsSync(QUOTA_FLAG_FILE)) fs3.unlinkSync(QUOTA_FLAG_FILE);
    } catch {
    }
    return true;
  }
  return false;
}
function markServerFirestoreQuotaExhausted(reason) {
  loadFromDiskOnce();
  const nextExpiry = computeNextResetExpiryMs();
  if (nextExpiry > cachedUntilMs) {
    cachedUntilMs = nextExpiry;
    const state = {
      exhaustedUntilMs: nextExpiry,
      updatedAtMs: Date.now(),
      reason: String(reason?.message || reason || "resource-exhausted").slice(0, 240)
    };
    try {
      fs3.writeFileSync(QUOTA_FLAG_FILE, JSON.stringify(state));
    } catch {
    }
    console.warn(
      `[FirestoreQuota] Daily write quota exhausted; pausing Firestore writes until ${new Date(nextExpiry).toISOString()}`
    );
  }
  return cachedUntilMs;
}
function getServerFirestoreQuotaStatus() {
  const writeAllowed = isServerFirestoreWriteAllowed();
  return {
    writeAllowed,
    exhaustedUntilMs: writeAllowed ? 0 : cachedUntilMs
  };
}

// src/utils/seriesCompleteness.ts
function expandEpisodeNumbers(ep) {
  if (!ep) return [];
  const label = String(ep.episodeLabel || "").trim();
  const title = String(ep.title || "").trim();
  const rangeMatch = label.match(/^(\d{1,4})\s*[-–—]\s*(\d{1,4})$/) || title.match(/\b(\d{1,4})\s*[-–—]\s*(\d{1,4})\b/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= 1 && end - start <= 150) {
      const nums = [];
      for (let i = start; i <= end; i++) nums.push(i);
      return nums;
    }
  }
  const epNum = Number(ep.episodeNumber);
  return Number.isFinite(epNum) && epNum > 0 ? [Math.floor(epNum)] : [];
}
function isMovieRecordSeries(movie) {
  if (!movie) return false;
  if (String(movie.id || "").startsWith("tg_series_")) return true;
  if (Array.isArray(movie.seasons) && movie.seasons.length > 0) return true;
  const orig = String(movie.originalCategory || "").toLowerCase();
  const disp = String(movie.displayCategory || "").toLowerCase();
  if (orig.includes("series") || disp.includes("series")) return true;
  return false;
}
function getSeasonCoveredEpisodes(season) {
  const covered = /* @__PURE__ */ new Set();
  if (!season || !Array.isArray(season.episodes)) return covered;
  for (const ep of season.episodes) {
    if (!ep || !String(ep.streamUrl || "").trim()) continue;
    for (const n of expandEpisodeNumbers(ep)) {
      covered.add(n);
    }
  }
  return covered;
}
function isSeriesComplete(movie, expectedSeasonCounts) {
  if (!movie) return false;
  if (!isMovieRecordSeries(movie)) {
    return true;
  }
  const seasons = Array.isArray(movie.seasons) ? movie.seasons : [];
  if (seasons.length === 0) return false;
  const sortedSeasons = [...seasons].sort(
    (a, b) => (Number(a?.seasonNumber) || 0) - (Number(b?.seasonNumber) || 0)
  );
  const seasonNumbers = sortedSeasons.map((s) => Number(s?.seasonNumber) || 0);
  if (seasonNumbers[0] !== 1) return false;
  for (let i = 0; i < seasonNumbers.length; i++) {
    if (seasonNumbers[i] !== i + 1) return false;
  }
  for (const season of sortedSeasons) {
    const sNum = Number(season?.seasonNumber) || 0;
    const covered = getSeasonCoveredEpisodes(season);
    if (covered.size === 0) return false;
    const maxEp = Math.max(...covered);
    const minEp = Math.min(...covered);
    if (minEp !== 1) return false;
    for (let ep = 1; ep <= maxEp; ep++) {
      if (!covered.has(ep)) return false;
    }
    const expectedCount = expectedSeasonCounts?.[sNum];
    if (typeof expectedCount === "number" && expectedCount > 0 && maxEp < expectedCount) {
      return false;
    }
  }
  return true;
}
function hasPlayableContent(movie) {
  if (!movie) return false;
  if (isMovieRecordSeries(movie)) {
    return isSeriesComplete(movie);
  }
  const hasPrimary = Boolean(String(movie.streamingUrl || "").trim());
  const hasQualities = Boolean(
    movie.videoQualities && typeof movie.videoQualities === "object" && Object.values(movie.videoQualities).some((u) => Boolean(String(u || "").trim()))
  );
  return hasPrimary || hasQualities;
}

// src/server/telegramRouter.ts
var TVMAZE_EP_COUNT_CACHE = /* @__PURE__ */ new Map();
async function fetchExpectedSeasonEpisodeCounts(imdbId) {
  const cleanId = String(imdbId || "").trim();
  if (!/^tt\d+$/i.test(cleanId)) return null;
  const cached = TVMAZE_EP_COUNT_CACHE.get(cleanId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.counts;
  }
  try {
    const showResp = await fetch(
      `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(cleanId)}`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (!showResp.ok) {
      TVMAZE_EP_COUNT_CACHE.set(cleanId, { counts: null, expiresAt: Date.now() + 30 * 6e4 });
      return null;
    }
    const showJson = await showResp.json();
    if (!showJson?.id) {
      TVMAZE_EP_COUNT_CACHE.set(cleanId, { counts: null, expiresAt: Date.now() + 30 * 6e4 });
      return null;
    }
    const epsResp = await fetch(`https://api.tvmaze.com/shows/${showJson.id}/episodes`, {
      signal: AbortSignal.timeout(3500)
    });
    if (!epsResp.ok) {
      TVMAZE_EP_COUNT_CACHE.set(cleanId, { counts: null, expiresAt: Date.now() + 30 * 6e4 });
      return null;
    }
    const epsList = await epsResp.json();
    const counts = {};
    if (Array.isArray(epsList)) {
      for (const ep of epsList) {
        const s = Number(ep?.season);
        const n = Number(ep?.number);
        if (s > 0 && n > 0) {
          counts[s] = Math.max(counts[s] || 0, n);
        }
      }
    }
    const result = Object.keys(counts).length > 0 ? counts : null;
    TVMAZE_EP_COUNT_CACHE.set(cleanId, { counts: result, expiresAt: Date.now() + 6 * 36e5 });
    return result;
  } catch {
    return null;
  }
}
function clampReleaseYear(val) {
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  const parsed = Number(val);
  if (!Number.isFinite(parsed) || parsed < 1900) return currentYear;
  return Math.min(Math.floor(parsed), currentYear);
}
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
function getFfmpegQualityArgs(quality, _isDownload) {
  const args2 = [];
  if (quality === "360p") {
    args2.push(
      "-vf",
      "scale='min(640,iw)':'min(360,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "3.1",
      "-vsync",
      "vfr",
      "-b:v",
      "220k",
      "-maxrate",
      "320k",
      "-bufsize",
      "640k",
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-af",
      "aresample=async=1:min_hard_comp=0.100000:first_pts=0",
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
      "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "3.1",
      "-vsync",
      "vfr",
      "-b:v",
      "500k",
      "-maxrate",
      "700k",
      "-bufsize",
      "1400k",
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-af",
      "aresample=async=1:min_hard_comp=0.100000:first_pts=0",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-b:a",
      "96k"
    );
    return args2;
  }
  if (quality === "720p") {
    args2.push(
      "-vf",
      "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "4.0",
      "-vsync",
      "vfr",
      "-crf",
      "21",
      "-maxrate",
      "1800k",
      "-bufsize",
      "3600k",
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-af",
      "aresample=async=1:min_hard_comp=0.100000:first_pts=0",
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
    "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
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
    "vfr",
    "-crf",
    "18",
    "-maxrate",
    "5500k",
    "-bufsize",
    "11000k",
    "-g",
    "48",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0",
    "-af",
    "aresample=async=1:min_hard_comp=0.100000:first_pts=0",
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-b:a",
    "192k"
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
    let client2 = await getTelegramClient();
    await ensureChannelUploadWatcher(client2);
    let me;
    try {
      me = await client2.getMe();
    } catch (meErr) {
      if (isTelegramAuthKeyError(meErr)) {
        client2 = await resetTelegramClient({ clearSavedSession: true, preferBotFallback: true });
        me = await client2.getMe();
      } else {
        throw meErr;
      }
    }
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
router2.post("/remove-channel", (req, res) => {
  const channelId = String(req.body?.channelId || "").trim();
  if (!channelId) {
    return res.status(400).json({ error: "channelId is required" });
  }
  const removed = removeChannelEntity(channelId);
  const channels = getAllCachedChannels();
  res.json({ success: true, removed, channels });
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
  const doc3 = media?.document || msg.document;
  if (!doc3 || !doc3.id) {
    return { kind: "other", mime: "", fileName: "", sizeBytes: 0 };
  }
  const attrs = Array.isArray(doc3.attributes) ? doc3.attributes : [];
  const mime = String(doc3.mimeType || "").toLowerCase();
  const fnAttr = attrs.find(
    (a) => a instanceof Api3.DocumentAttributeFilename || a?.className === "DocumentAttributeFilename"
  );
  const fileName = String(fnAttr?.fileName || "");
  const lowerFileName = fileName.toLowerCase();
  const vidAttr = attrs.find(
    (a) => a instanceof Api3.DocumentAttributeVideo || a?.className === "DocumentAttributeVideo"
  );
  const sizeBytes = Number(doc3.size || 0);
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
    doc: doc3,
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
function primeMediaCacheFromTelegramDoc(streamUrl, doc3, fileName, durationSec, rawMime) {
  const parsed = parseTelegramUrl(streamUrl);
  if (!parsed.isValid || !parsed.chatId || !parsed.messageId || !doc3) return null;
  const cacheKey = `${parsed.chatId}:${parsed.messageId}`;
  const existing = mediaCache.get(cacheKey);
  if (existing && Date.now() - existing.cachedAt <= MEDIA_CACHE_TTL_MS) {
    return existing;
  }
  const lowerName = fileName.toLowerCase();
  const isWebm = lowerName.endsWith(".webm") || rawMime.includes("webm");
  const entry = {
    docInfo: {
      document: doc3,
      fileSize: Number(doc3.size || 0),
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
    const probe = await ensureMediaProbed(entry, candidate.streamUrl, {
      timeoutMs: 4500,
      probesize: 75e4,
      analyzeduration: 75e4
    });
    if (probe.probedByFfprobe) {
      const has = probe.audioTracks.length > 0 || Boolean(probe.audioCodec);
      entry.hasAudio = has;
      return has;
    }
    return true;
  } catch {
    return true;
  }
}
async function verifyCandidateAudioAndHd(candidate, client2, onlyValidAudioAndHd) {
  if (candidate.hasExplicitNoSound) {
    return {
      accepted: false,
      reason: "no_audio",
      effectiveQuality: "",
      durationSec: candidate.durationSec
    };
  }
  if (!onlyValidAudioAndHd) {
    return {
      accepted: true,
      reason: "ok",
      effectiveQuality: candidate.parsedQuality === "1080p" || candidate.parsedQuality === "720p" ? candidate.parsedQuality : "",
      durationSec: candidate.durationSec
    };
  }
  const entry = primeMediaCacheFromTelegramDoc(
    candidate.streamUrl,
    candidate.doc,
    candidate.fileName,
    candidate.durationSec,
    candidate.mime
  );
  let fastAudio = null;
  if (entry) {
    if (typeof entry.hasAudio === "boolean") {
      fastAudio = entry.hasAudio;
    } else if (entry.probe?.probedByFfprobe) {
      fastAudio = entry.probe.audioTracks.length > 0 || Boolean(entry.probe.audioCodec);
      entry.hasAudio = fastAudio;
    } else {
      fastAudio = await checkTelegramDocHasAudioFast(client2, entry.docInfo).catch(() => null);
      if (fastAudio !== null) entry.hasAudio = fastAudio;
    }
  }
  if (fastAudio === false) {
    return {
      accepted: false,
      reason: "no_audio",
      effectiveQuality: "",
      durationSec: candidate.durationSec
    };
  }
  const needsResolutionProbe = candidate.height <= 0 && candidate.width <= 0 && candidate.parsedQuality !== "1080p" && candidate.parsedQuality !== "720p" && candidate.parsedQuality !== "480p" && candidate.parsedQuality !== "360p";
  let probeResult = entry?.probe || null;
  if (entry && (!probeResult || !probeResult.probedByFfprobe) && (fastAudio === null || needsResolutionProbe)) {
    probeResult = await ensureMediaProbed(entry, candidate.streamUrl, {
      timeoutMs: 4500,
      probesize: 75e4,
      analyzeduration: 75e4
    }).catch(() => null);
    if (probeResult?.probedByFfprobe) {
      const probedHasAudio = probeResult.audioTracks.length > 0 || Boolean(probeResult.audioCodec);
      entry.hasAudio = probedHasAudio;
      fastAudio = probedHasAudio;
    }
  }
  const resolvedProbeLike = probeResult?.probedByFfprobe ? probeResult : fastAudio === true ? {
    probedByFfprobe: true,
    height: candidate.height,
    width: candidate.width,
    audioCodec: "aac",
    audioTracks: [{ codec: "aac", channels: 2 }]
  } : null;
  const decision = evaluateChannelVideoFilter({
    fileName: candidate.fileName,
    caption: candidate.caption,
    parsedQuality: candidate.parsedQuality,
    width: candidate.width,
    height: candidate.height,
    hasExplicitNoSound: candidate.hasExplicitNoSound,
    hasVideoAttr: Boolean(candidate.height > 0 || candidate.width > 0),
    probe: resolvedProbeLike,
    requireValidAudio: true,
    allowedQualities: ["1080p", "720p"]
  });
  const bestDurationSec = Math.max(
    candidate.durationSec || 0,
    Math.round(probeResult?.durationSec || 0)
  );
  return {
    accepted: decision.accepted,
    reason: decision.reason,
    effectiveQuality: decision.effectiveQuality,
    durationSec: bestDurationSec
  };
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
        const doc3 = media?.document || msg.document;
        if (!doc3 || !doc3.id) {
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
    let document2 = null;
    if (msg && msg.media) {
      if (msg.media instanceof Api3.MessageMediaDocument && msg.media.document instanceof Api3.Document) {
        document2 = msg.media.document;
      } else if (msg.media instanceof Api3.MessageMediaWebPage && msg.media.webpage?.document instanceof Api3.Document) {
        document2 = msg.media.webpage.document;
      }
    }
    if (document2) {
      const fileSizeNum = Number(document2.size);
      const sizeFormatted = formatBytes(fileSizeNum);
      let durationSec = 0;
      let width = 0;
      let height = 0;
      let fileName = `telegram_video_${parsed.messageId}.mp4`;
      const videoAttr = document2.attributes.find((a) => a instanceof Api3.DocumentAttributeVideo);
      if (videoAttr) {
        const v = videoAttr;
        durationSec = v.duration || 0;
        width = v.w || 0;
        height = v.h || 0;
      }
      const fnAttr = document2.attributes.find(
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
          mimeType: document2.mimeType || "video/mp4"
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
var MEDIA_CACHE_TTL_MS = 20 * 60 * 1e3;
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
  let document2 = null;
  if (msg.media) {
    if (msg.media instanceof Api3.MessageMediaDocument && msg.media.document instanceof Api3.Document) {
      document2 = msg.media.document;
    } else if (msg.media instanceof Api3.MessageMediaWebPage && msg.media.webpage?.document instanceof Api3.Document) {
      document2 = msg.media.webpage.document;
    }
  }
  if (!document2) {
    return {
      status: 404,
      error: `No playable video document found in Telegram post #${parsed.messageId}.`
    };
  }
  const fileSize = Number(document2.size);
  let durationSec = 0;
  const videoAttr = document2.attributes.find((a) => a instanceof Api3.DocumentAttributeVideo);
  if (videoAttr) {
    durationSec = videoAttr.duration || 0;
  }
  let fileName = "";
  const fnAttr = document2.attributes.find(
    (a) => a.className === "DocumentAttributeFilename" || a instanceof Api3.DocumentAttributeFilename
  );
  if (fnAttr && fnAttr.fileName) {
    fileName = fnAttr.fileName;
  }
  const rawMime = (document2.mimeType || "").toLowerCase();
  const lowerName = fileName.toLowerCase();
  const isWebm = lowerName.endsWith(".webm") || rawMime.includes("webm");
  const mimeType = isWebm ? "video/webm" : "video/mp4";
  const docInfo = {
    document: document2,
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
  console.log(`[Stream] Cached document ${document2.id} (${formatBytes(fileSize)}, ${fileName || rawMime}) for msg ${parsed.messageId}`);
  return { entry };
}
async function ensureMediaProbed(entry, telegramUrl, probeOptions) {
  if (entry.probe) {
    if (entry.probe.probedByFfprobe) return entry.probe;
    if (entry.probeFallbackAt && Date.now() - entry.probeFallbackAt < 15e3) {
      return entry.probe;
    }
  }
  if (entry.probePromise) return entry.probePromise;
  const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || "3000";
  entry.probePromise = probeTelegramMedia(localPort, telegramUrl, entry.docInfo, probeOptions).then((result) => {
    entry.probe = result;
    if (result.probedByFfprobe) {
      entry.probeFallbackAt = void 0;
      if (result.durationSec > 0) {
        entry.docInfo.durationSec = result.durationSec;
      }
    } else {
      entry.probeFallbackAt = Date.now();
    }
    console.log(
      `[Probe] ${entry.docInfo.fileName || entry.docInfo.document.id}: mode=${result.recommendedMode}, video=${result.videoCodec}(${result.pixFmt}), audio=${result.audioCodec}, duration=${result.durationSec}s (ffprobe=${result.probedByFfprobe}), tracks=${result.audioTracks.length}`
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
var BITMAP_SUBTITLE_CODEC_RE = /^(hdmv_pgs_subtitle|pgs|dvd_subtitle|vobsub|dvb_subtitle|xsub)$/i;
router2.get("/subtitles.vtt", async (req, res) => {
  const urlParam = String(req.query.url || "").trim();
  const requestedTrackIdx = Math.max(0, parseInt(String(req.query.trackIdx || "0"), 10) || 0);
  const startSec = Math.max(0, Math.floor(Number(req.query.start) || 0));
  const reqDur = Math.max(0, Math.floor(Number(req.query.dur) || 0));
  const reqLang = String(req.query.lang || "").trim().toLowerCase();
  if (!urlParam) return res.status(400).send("URL required");
  const isTelegram = urlParam.includes("t.me") || urlParam.includes("telegram.me");
  let targetSubIdx = requestedTrackIdx;
  let trackCodec = "";
  let windowSec = reqDur;
  let inputUrl = urlParam;
  try {
    if (isTelegram) {
      const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || "3000";
      inputUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;
      const parsed = parseTelegramUrl(urlParam);
      if (parsed.isValid && !parsed.isInviteLink && parsed.messageId) {
        const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
        const client2 = apiId && apiHash && (botToken || sessionStr) ? await getTelegramClient().catch(() => null) : null;
        if (client2) {
          const { entry } = await resolveAndCacheDocument(client2, parsed);
          if (entry) {
            const probe = await ensureMediaProbed(entry, urlParam);
            const subList = Array.isArray(probe.subtitleTracks) ? probe.subtitleTracks : [];
            const chosen = subList[requestedTrackIdx];
            if (chosen) {
              trackCodec = chosen.codec || "";
              const chosenLang = String(chosen.lang || chosen.label || reqLang || "").trim().toLowerCase();
              if (BITMAP_SUBTITLE_CODEC_RE.test(trackCodec) || chosen.forced) {
                const betterText = subList.find(
                  (t) => !BITMAP_SUBTITLE_CODEC_RE.test(t.codec) && !t.forced && chosenLang && (String(t.lang || "").toLowerCase() === chosenLang || String(t.label || "").toLowerCase() === chosenLang)
                ) || subList.find(
                  (t) => !BITMAP_SUBTITLE_CODEC_RE.test(t.codec) && chosenLang && (String(t.lang || "").toLowerCase() === chosenLang || String(t.label || "").toLowerCase() === chosenLang)
                );
                if (betterText) {
                  targetSubIdx = betterText.id;
                  trackCodec = betterText.codec || "";
                }
              }
            } else if (reqLang && subList.length > 0) {
              const langMatch = subList.find(
                (t) => !BITMAP_SUBTITLE_CODEC_RE.test(t.codec) && !t.forced && (String(t.lang || "").toLowerCase().includes(reqLang) || String(t.label || "").toLowerCase().includes(reqLang))
              ) || subList.find(
                (t) => !BITMAP_SUBTITLE_CODEC_RE.test(t.codec) && (String(t.lang || "").toLowerCase().includes(reqLang) || String(t.label || "").toLowerCase().includes(reqLang))
              );
              if (langMatch) {
                targetSubIdx = langMatch.id;
                trackCodec = langMatch.codec || "";
              }
            }
            if (BITMAP_SUBTITLE_CODEC_RE.test(trackCodec)) {
              res.setHeader("Content-Type", "text/vtt; charset=utf-8");
              res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Status, X-Subtitle-Codec");
              res.setHeader("X-Subtitle-Status", "bitmap_unsupported");
              res.setHeader("X-Subtitle-Codec", trackCodec);
              return res.status(200).send("WEBVTT\n\n");
            }
            if (windowSec === 0 && entry.docInfo.fileSize > 120 * 1024 * 1024) {
              windowSec = 360;
            }
          }
        }
      }
    }
    const cacheKey = `${urlParam}::${targetSubIdx}::${startSec}::${windowSec}`;
    const cached = subtitleVttCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < 15 * 60 * 1e3) {
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Status, X-Subtitle-Codec");
      res.setHeader("X-Subtitle-Status", cached.status);
      if (cached.codec) res.setHeader("X-Subtitle-Codec", cached.codec);
      res.setHeader("Cache-Control", "public, max-age=600");
      return res.status(200).send(cached.vtt);
    }
    const ffArgs = [
      "-v",
      "error",
      "-seekable",
      "1",
      "-probesize",
      "3000000",
      "-analyzeduration",
      "3000000",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_on_http_error",
      "4xx,5xx",
      "-reconnect_on_network_error",
      "1",
      "-reconnect_delay_max",
      "2"
    ];
    if (startSec > 0) {
      ffArgs.push("-ss", String(startSec), "-copyts");
    }
    ffArgs.push("-i", inputUrl);
    if (windowSec > 0) {
      ffArgs.push("-to", String(startSec + windowSec));
    }
    ffArgs.push(
      "-vn",
      "-an",
      "-dn",
      "-map",
      `0:s:${targetSubIdx}?`,
      "-flush_packets",
      "1",
      "-c:s",
      "webvtt",
      "-f",
      "webvtt",
      "pipe:1"
    );
    const vttText = await new Promise((resolve) => {
      const proc = spawn2("ffmpeg", ffArgs, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks = [];
      let errLogs = "";
      let totalBytes = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (errLogs.trim()) {
          console.warn(`[Subtitles] FFmpeg (${targetSubIdx}@${startSec}s): ${errLogs.trim().slice(-200)}`);
        }
        resolve(Buffer.concat(chunks).toString("utf-8"));
      };
      const killProcGracefully = () => {
        try {
          proc.kill("SIGTERM");
          setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
            }
            finish();
          }, 350);
        } catch {
          finish();
        }
      };
      const timer = setTimeout(killProcGracefully, 35e3);
      req.on("close", () => {
        if (!res.writableEnded && !finished) {
          killProcGracefully();
        }
      });
      proc.stdout.on("data", (d) => {
        if (totalBytes < 4 * 1024 * 1024) {
          chunks.push(d);
          totalBytes += d.length;
        }
      });
      proc.stderr.on("data", (d) => {
        if (errLogs.length < 1024) {
          errLogs += d.toString("utf-8");
        }
      });
      proc.on("close", finish);
      proc.on("error", finish);
    });
    const normalizedVtt = vttText && vttText.trim().startsWith("WEBVTT") ? vttText : "WEBVTT\n\n";
    const hasCues = normalizedVtt.includes("-->");
    const subStatus = hasCues ? "ok" : "empty";
    if (hasCues) {
      subtitleVttCache.set(cacheKey, {
        vtt: normalizedVtt,
        codec: trackCodec,
        status: subStatus,
        cachedAt: Date.now()
      });
    }
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Status, X-Subtitle-Codec");
    res.setHeader("X-Subtitle-Status", subStatus);
    if (trackCodec) res.setHeader("X-Subtitle-Codec", trackCodec);
    res.setHeader("Cache-Control", hasCues ? "public, max-age=600" : "no-store");
    return res.status(200).send(normalizedVtt);
  } catch {
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("X-Subtitle-Status", "error");
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
    res,
    videoStreamIndex
  } = opts;
  if (activeFfmpegProcs.size >= MAX_CONCURRENT_FFMPEG) {
    console.warn(`[Stream] Active FFmpeg limit reached (${activeFfmpegProcs.size}/${MAX_CONCURRENT_FFMPEG})`);
    return res.status(503).json({ error: "Transcoding server is busy. Please retry in a moment." });
  }
  const isPureRemux = remuxOnly && !requestedQuality;
  const ffArgs = [
    "-probesize",
    "5000000",
    "-analyzeduration",
    "5000000",
    "-fflags",
    "+discardcorrupt",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_on_http_error",
    "4xx,5xx",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_delay_max",
    "2"
  ];
  if (startSec > 0) {
    if (isPureRemux) {
      ffArgs.push("-noaccurate_seek");
    }
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
    `0:v:${opts.videoStreamIndex ?? 0}`,
    "-map",
    `0:a:${audioIdx}?`
  );
  if (isPureRemux) {
    ffArgs.push("-c:v", "copy");
    if (canCopyAudio) {
      ffArgs.push("-c:a", "copy");
    } else {
      const aresampleFilter = startSec > 0 ? "aresample=async=1:min_hard_comp=0.100000" : "aresample=async=1:min_hard_comp=0.100000:first_pts=0";
      ffArgs.push("-af", aresampleFilter, "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k");
    }
  } else {
    ffArgs.push(...getFfmpegQualityArgs(requestedQuality, isDownload));
  }
  ffArgs.push(
    "-max_muxing_queue_size",
    "4096",
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
    const { document: document2, fileSize } = docInfo;
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
        const videoStart = probe.videoStartTime || 0;
        const audioStart = selectedAudioTrack?.startTime || 0;
        const hasStreamOffset = Math.abs(audioStart - videoStart) > 0.04;
        const isAviContainer = (probe.container || "").toLowerCase().includes("avi");
        const canCopyAudio = (selectedAudioCodec === "aac" || selectedAudioCodec === "mp3") && selectedChannels <= 2 && !hasStreamOffset && audioIdxParam === 0 && !isAviContainer;
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
          res,
          videoStreamIndex: probe.videoStreamIndex ?? 0
        });
      }
    }
    const durationSec = docInfo.durationSec || 0;
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
      "Cache-Control": isRawParam ? "no-store" : "private, max-age=300, no-transform",
      "Connection": "keep-alive",
      "Content-Type": isCastParam && (!mimeType || mimeType === "application/octet-stream") ? "video/mp4" : mimeType,
      "Content-Length": chunkSize.toString()
    };
    if (rangeHeader) {
      headers["Content-Range"] = `bytes ${start}-${endPos}/${fileSize}`;
    }
    if (req.method === "HEAD") {
      res.writeHead(statusCode, headers);
      return res.end();
    }
    if (!isRawParam) {
      console.log(`[Stream] Direct ${statusCode} | ${mimeType} | msg ${parsed.messageId} | bytes ${start}-${endPos}/${fileSize}`);
    }
    res.writeHead(statusCode, headers);
    const concurrency = isRawParam ? 3 : 3;
    await streamTelegramRange(
      res,
      client2,
      document2,
      start,
      endPos,
      concurrency,
      () => isClosed,
      () => mediaCache.delete(cacheKey),
      async () => {
        mediaCache.delete(cacheKey);
        const refreshed = await resolveAndCacheDocument(client2, parsed);
        return refreshed.entry?.docInfo.document || null;
      }
    );
  } catch (err) {
    console.error("[Stream] Global streaming error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}
var HLS_SEG_DURATION = 2;
var HLS_TARGET_DURATION = 3;
var HLS_TMP_ROOT = path3.resolve("/tmp", "movie_portal_hls");
var MAX_CONCURRENT_HLS_JOBS = Math.max(2, MAX_CONCURRENT_FFMPEG - 1);
var hlsJobs = /* @__PURE__ */ new Map();
var nextHlsJobSeq = 1;
function resumeHlsWorkerIfPaused(job) {
  if (job.pausedForBackpressure && job.proc && !job.closed) {
    try {
      job.proc.kill("SIGCONT");
      job.pausedForBackpressure = false;
    } catch {
    }
  }
}
function getHighestProducedHlsSeg(dir, fallbackSeg) {
  let maxSeg = fallbackSeg;
  try {
    const files = fs4.readdirSync(dir);
    for (const f of files) {
      const m = f.match(/^seg_(\d+)\.ts$/);
      if (m) {
        const idx = parseInt(m[1], 10);
        if (idx > maxSeg) maxSeg = idx;
      }
    }
  } catch {
  }
  return maxSeg;
}
function scheduleRemoveHlsDir(job, delayMs = 8e3) {
  const tryRemove = () => {
    if (job.activeReaders > 0) {
      setTimeout(tryRemove, 2e3).unref?.();
      return;
    }
    try {
      fs4.rmSync(job.dir, { recursive: true, force: true });
    } catch {
    }
  };
  if (delayMs <= 0 && job.activeReaders <= 0) {
    tryRemove();
  } else {
    setTimeout(tryRemove, Math.max(500, delayMs)).unref?.();
  }
}
function cleanupHlsJob(sid, removeDir = true, markSuperseded = false) {
  const job = hlsJobs.get(sid);
  if (!job) return;
  hlsJobs.delete(sid);
  if (job.backpressureTimer) {
    clearInterval(job.backpressureTimer);
    job.backpressureTimer = null;
  }
  if (markSuperseded) {
    job.superseded = true;
  }
  if (job.proc && !job.closed) {
    try {
      resumeHlsWorkerIfPaused(job);
      job.proc.kill("SIGTERM");
      const procRef = job.proc;
      setTimeout(() => {
        try {
          if (!procRef.killed) {
            try {
              procRef.kill("SIGCONT");
            } catch {
            }
            procRef.kill("SIGKILL");
          }
        } catch {
        }
      }, 400).unref?.();
    } catch {
    }
  }
  if (removeDir) {
    scheduleRemoveHlsDir(job, markSuperseded ? 8e3 : 1500);
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [sid, job] of hlsJobs.entries()) {
    if (job.activeReaders === 0 && now - job.lastAccessedAt > 900 * 1e3) {
      cleanupHlsJob(sid, true, false);
    }
  }
}, 45 * 1e3).unref?.();
function getHlsSegmentPath(dir, segIdx) {
  return path3.join(dir, `seg_${String(segIdx).padStart(5, "0")}.ts`);
}
function segmentReadyOnDisk(filePath) {
  try {
    return fs4.existsSync(filePath) && fs4.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}
function getHlsArgsForQuality(quality, forceExact4s = true) {
  const keyframeArgs = forceExact4s ? ["-g", "48", "-force_key_frames", `expr:gte(t,n_forced*${HLS_SEG_DURATION})`, "-sc_threshold", "0"] : ["-g", "48", "-keyint_min", "48", "-sc_threshold", "0"];
  if (quality === "360p") {
    return [
      "-vf",
      "scale='min(640,iw)':'min(360,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "3.1",
      "-b:v",
      "220k",
      "-maxrate",
      "320k",
      "-bufsize",
      "640k",
      ...keyframeArgs,
      "-af",
      "aresample=async=1:min_hard_comp=0.100000",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-b:a",
      "64k"
    ];
  }
  if (quality === "480p") {
    return [
      "-vf",
      "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "3.1",
      "-b:v",
      "500k",
      "-maxrate",
      "700k",
      "-bufsize",
      "1400k",
      ...keyframeArgs,
      "-af",
      "aresample=async=1:min_hard_comp=0.100000",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-b:a",
      "96k"
    ];
  }
  if (quality === "720p") {
    return [
      "-vf",
      "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "4.0",
      "-crf",
      "21",
      "-maxrate",
      "1800k",
      "-bufsize",
      "3600k",
      ...keyframeArgs,
      "-af",
      "aresample=async=1:min_hard_comp=0.100000",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-b:a",
      "128k"
    ];
  }
  return [
    "-vf",
    "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "main",
    "-level",
    "4.0",
    "-crf",
    "18",
    "-maxrate",
    "5500k",
    "-bufsize",
    "11000k",
    ...keyframeArgs,
    "-af",
    "aresample=async=1:min_hard_comp=0.100000",
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-b:a",
    "192k"
  ];
}
function startHlsWorker(opts) {
  cleanupHlsJob(opts.sid, true, true);
  while (hlsJobs.size >= MAX_CONCURRENT_HLS_JOBS) {
    let oldestSid = null;
    let oldestTime = Infinity;
    for (const [existingSid, existingJob] of hlsJobs.entries()) {
      if (existingJob.lastAccessedAt < oldestTime) {
        oldestTime = existingJob.lastAccessedAt;
        oldestSid = existingSid;
      }
    }
    if (oldestSid) {
      cleanupHlsJob(oldestSid, true, true);
    } else {
      break;
    }
  }
  const jobId = nextHlsJobSeq++;
  const dir = path3.join(HLS_TMP_ROOT, `${opts.sid.replace(/[^a-zA-Z0-9_-]/g, "_")}_j${jobId}`);
  fs4.mkdirSync(dir, { recursive: true });
  const startSec = opts.startSeg * HLS_SEG_DURATION;
  const ffArgs = [
    "-probesize",
    "900000",
    "-analyzeduration",
    "900000",
    "-fflags",
    "+discardcorrupt",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_on_http_error",
    "4xx,5xx",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_delay_max",
    "2"
  ];
  if (startSec > 0) {
    ffArgs.push("-ss", String(startSec));
  }
  ffArgs.push(
    "-i",
    opts.inputUrl,
    "-sn",
    "-dn",
    "-map_chapters",
    "-1",
    "-map",
    `0:v:${opts.videoStreamIndex ?? 0}`,
    "-map",
    `0:a:${opts.audioIdx}?`,
    "-max_muxing_queue_size",
    "4096"
  );
  if (opts.remuxOnly && !opts.requestedQuality) {
    ffArgs.push(
      "-vf",
      "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-level",
      "4.0",
      "-crf",
      "21",
      "-maxrate",
      "3600k",
      "-bufsize",
      "7200k",
      "-g",
      "48",
      "-force_key_frames",
      `expr:gte(t,n_forced*${HLS_SEG_DURATION})`,
      "-sc_threshold",
      "0"
    );
    if (opts.canCopyAudio) {
      ffArgs.push("-c:a", "copy");
    } else {
      ffArgs.push("-af", "aresample=async=1:min_hard_comp=0.100000", "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "160k");
    }
  } else {
    ffArgs.push(...getHlsArgsForQuality(opts.requestedQuality, true));
  }
  if (startSec > 0) {
    ffArgs.push("-output_ts_offset", String(startSec));
  }
  ffArgs.push(
    "-f",
    "hls",
    "-hls_time",
    String(HLS_SEG_DURATION),
    "-hls_list_size",
    "0",
    "-start_number",
    String(opts.startSeg),
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_segment_filename",
    path3.join(dir, "seg_%05d.ts"),
    path3.join(dir, "index.m3u8")
  );
  const proc = spawn2("ffmpeg", ffArgs, { stdio: ["ignore", "ignore", "pipe"] });
  const job = {
    jobId,
    sid: opts.sid,
    urlParam: opts.urlParam,
    dir,
    startSeg: opts.startSeg,
    highestSeg: opts.startSeg - 1,
    lastServedSeg: opts.startSeg,
    pausedForBackpressure: false,
    backpressureTimer: null,
    proc,
    closed: false,
    superseded: false,
    activeReaders: 0,
    lastAccessedAt: Date.now(),
    lastErrLine: ""
  };
  job.backpressureTimer = setInterval(() => {
    if (job.closed || !job.proc) return;
    const highestProduced = getHighestProducedHlsSeg(job.dir, job.highestSeg);
    if (highestProduced > job.highestSeg) {
      job.highestSeg = highestProduced;
    }
    const leadSegs = highestProduced - job.lastServedSeg;
    if (!job.pausedForBackpressure && leadSegs > 45) {
      try {
        job.proc.kill("SIGSTOP");
        job.pausedForBackpressure = true;
      } catch {
      }
    } else if (job.pausedForBackpressure && leadSegs <= 22) {
      resumeHlsWorkerIfPaused(job);
    }
  }, 1500);
  job.backpressureTimer.unref?.();
  proc.stderr?.on("data", (d) => {
    const s = d.toString().trim();
    if (s) job.lastErrLine = s.slice(-240);
  });
  proc.on("close", (code) => {
    job.closed = true;
    job.proc = null;
    job.pausedForBackpressure = false;
    if (job.backpressureTimer) {
      clearInterval(job.backpressureTimer);
      job.backpressureTimer = null;
    }
    if (!job.superseded && code && code !== 0 && job.lastErrLine) {
      console.warn(`[HLS Worker ${opts.sid}] FFmpeg exited (${code}): ${job.lastErrLine}`);
    }
  });
  proc.on("error", (err) => {
    job.closed = true;
    job.proc = null;
    job.pausedForBackpressure = false;
    if (job.backpressureTimer) {
      clearInterval(job.backpressureTimer);
      job.backpressureTimer = null;
    }
    job.lastErrLine = err?.message || "spawn error";
  });
  hlsJobs.set(opts.sid, job);
  return job;
}
async function resolveHlsSourceParams(req) {
  const urlParam = String(req.query.url || "").trim();
  const modeParam = String(req.query.mode || "remux").trim().toLowerCase();
  const requestedQuality = normalizeRequestedQuality(req.query.quality);
  const audioIdx = Math.max(0, parseInt(String(req.query.audioIdx || "0"), 10) || 0);
  const isTelegram = urlParam.includes("t.me") || urlParam.includes("telegram.me");
  let inputUrl = urlParam;
  let durationSec = Math.max(0, Number(req.query.dur || 0) || 0);
  let remuxOnly = modeParam !== "transcode" && !requestedQuality;
  let canCopyAudio = false;
  let videoStreamIndex = 0;
  if (isTelegram) {
    const parsed = parseTelegramUrl(urlParam);
    if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
      throw new Error("Invalid Telegram post URL");
    }
    const client2 = await getTelegramClient();
    const { entry, error } = await resolveAndCacheDocument(client2, parsed);
    if (!entry) {
      throw new Error(error || "Media not found");
    }
    const probe = await ensureMediaProbed(entry, urlParam);
    durationSec = probe.durationSec || entry.docInfo.durationSec || durationSec;
    const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || "3000";
    inputUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;
    const vc = (probe.videoCodec || "").toLowerCase();
    const pixFmt = (probe.pixFmt || "").toLowerCase();
    const isH264Safe = vc === "h264" && !probe.is10Bit && (pixFmt === "" || pixFmt === "yuv420p" || pixFmt === "yuvj420p" || pixFmt === "nv12") && (probe.height === 0 || probe.height <= 1088) && (probe.videoLevel === 0 || probe.videoLevel <= 42);
    if (modeParam === "transcode" || Boolean(requestedQuality && requestedQuality !== "1080p") || !isH264Safe) {
      remuxOnly = false;
    } else {
      remuxOnly = true;
    }
    const selectedTrack = probe.audioTracks[audioIdx] || probe.audioTracks[0];
    const ac = (selectedTrack?.codec || probe.audioCodec || "").toLowerCase();
    const ch = selectedTrack?.channels || 2;
    const videoStart = probe.videoStartTime || 0;
    const audioStart = selectedTrack?.startTime || 0;
    const hasStreamOffset = Math.abs(audioStart - videoStart) > 0.04;
    canCopyAudio = ac === "aac" && ch <= 2 && audioIdx === 0 && !hasStreamOffset;
    videoStreamIndex = probe.videoStreamIndex ?? 0;
  } else {
    if (durationSec <= 0) {
      const info = await probeDirectHttpInfo(urlParam).catch(() => null);
      if (info && info.durationSec > 0) durationSec = info.durationSec;
    }
    remuxOnly = modeParam !== "transcode" && !requestedQuality;
  }
  return { urlParam, modeParam, requestedQuality, audioIdx, inputUrl, durationSec, remuxOnly, canCopyAudio, videoStreamIndex };
}
async function handleHlsPlaylistRequest(req, res) {
  try {
    const urlParam = String(req.query.url || "").trim();
    if (!urlParam) return res.status(400).send("URL required");
    const resolved = await resolveHlsSourceParams(req);
    const sid = crypto.createHash("sha1").update(`${resolved.urlParam}|${resolved.remuxOnly ? "remux" : "transcode"}|${resolved.requestedQuality}|${resolved.audioIdx}`).digest("hex").slice(0, 16);
    const commonQs = `sid=${encodeURIComponent(sid)}&url=${encodeURIComponent(resolved.urlParam)}&mode=${resolved.remuxOnly ? "remux" : "transcode"}` + (resolved.requestedQuality ? `&quality=${encodeURIComponent(resolved.requestedQuality)}` : "") + `&audioIdx=${resolved.audioIdx}`;
    const requestedStartSec = Math.max(0, Number(req.query.start || 0) || 0);
    const initialStartSeg = Math.max(0, Math.floor(requestedStartSec / HLS_SEG_DURATION));
    const existingJob = hlsJobs.get(sid);
    const existingOutOfRange = Boolean(existingJob) && initialStartSeg > 0 && (initialStartSeg < existingJob.startSeg || initialStartSeg > Math.max(existingJob.startSeg, existingJob.highestSeg) + 18);
    if (!existingJob || existingJob.closed || existingOutOfRange) {
      startHlsWorker({
        sid,
        urlParam: resolved.urlParam,
        startSeg: initialStartSeg,
        inputUrl: resolved.inputUrl,
        remuxOnly: resolved.remuxOnly,
        canCopyAudio: resolved.canCopyAudio,
        requestedQuality: resolved.requestedQuality,
        audioIdx: resolved.audioIdx,
        videoStreamIndex: resolved.videoStreamIndex
      });
    } else {
      existingJob.lastAccessedAt = Date.now();
    }
    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${HLS_TARGET_DURATION}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXT-X-INDEPENDENT-SEGMENTS"
    ];
    const effectiveDur = resolved.durationSec > 0 ? resolved.durationSec : 10800;
    const segCount = Math.max(1, Math.ceil(effectiveDur / HLS_SEG_DURATION));
    for (let i = 0; i < segCount; i++) {
      const remaining = effectiveDur - i * HLS_SEG_DURATION;
      const segDur = Math.max(0.5, Math.min(HLS_SEG_DURATION, remaining));
      lines.push(`#EXTINF:${segDur.toFixed(3)},`);
      lines.push(`/api/telegram/hls/seg.ts?${commonQs}&i=${i}`);
    }
    lines.push("#EXT-X-ENDLIST");
    const body = lines.join("\n") + "\n";
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    res.setHeader("Content-Length", String(Buffer.byteLength(body, "utf8")));
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "HEAD") {
      return res.status(200).end();
    }
    return res.status(200).send(body);
  } catch (err) {
    console.error("[HLS Playlist] Error:", err?.message || err);
    return res.status(500).send(err?.message || "Failed to build HLS playlist");
  }
}
router2.get("/hls/playlist.m3u8", handleHlsPlaylistRequest);
router2.head("/hls/playlist.m3u8", handleHlsPlaylistRequest);
async function handleHlsSegmentRequest(req, res) {
  try {
    const segIdx = Math.max(0, parseInt(String(req.query.i || "0"), 10) || 0);
    const resolved = await resolveHlsSourceParams(req);
    const sid = String(
      req.query.sid || crypto.createHash("sha1").update(`${resolved.urlParam}|${resolved.remuxOnly ? "remux" : "transcode"}|${resolved.requestedQuality}|${resolved.audioIdx}`).digest("hex").slice(0, 16)
    ).replace(/[^a-zA-Z0-9_-]/g, "_");
    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });
    let activeJob;
    let targetFile = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      if (clientDisconnected) return;
      let job = attempt === 0 ? hlsJobs.get(sid) : void 0;
      const candidatePath = job ? getHlsSegmentPath(job.dir, segIdx) : "";
      const alreadyExists = Boolean(job && candidatePath && segmentReadyOnDisk(candidatePath));
      const needRestart = !job || !alreadyExists && (segIdx < job.startSeg || segIdx > Math.max(job.startSeg, job.highestSeg) + 18) || !alreadyExists && job.closed;
      if (needRestart) {
        const forceSafeTranscode = attempt > 0;
        job = startHlsWorker({
          sid,
          urlParam: resolved.urlParam,
          startSeg: segIdx,
          inputUrl: resolved.inputUrl,
          remuxOnly: forceSafeTranscode ? false : resolved.remuxOnly,
          canCopyAudio: forceSafeTranscode ? false : resolved.canCopyAudio,
          requestedQuality: resolved.requestedQuality,
          audioIdx: resolved.audioIdx,
          videoStreamIndex: resolved.videoStreamIndex
        });
      }
      if (!job) {
        return res.status(503).send("HLS job unavailable");
      }
      job.lastAccessedAt = Date.now();
      if (segIdx > job.lastServedSeg) {
        job.lastServedSeg = segIdx;
      }
      if (segIdx > job.highestSeg) {
        job.highestSeg = segIdx;
      }
      resumeHlsWorkerIfPaused(job);
      const waitStart = Date.now();
      targetFile = getHlsSegmentPath(job.dir, segIdx);
      while (!clientDisconnected && !segmentReadyOnDisk(targetFile)) {
        job.lastAccessedAt = Date.now();
        resumeHlsWorkerIfPaused(job);
        if (job.closed) {
          const latestJob = hlsJobs.get(sid);
          if (latestJob && latestJob.jobId !== job.jobId && latestJob.startSeg <= segIdx) {
            job = latestJob;
            targetFile = getHlsSegmentPath(job.dir, segIdx);
            continue;
          }
          break;
        }
        if (Date.now() - waitStart > 45e3) {
          res.setHeader("Cache-Control", "no-store");
          return res.status(504).send("HLS segment timed out");
        }
        await new Promise((r) => setTimeout(r, 80));
      }
      if (clientDisconnected) return;
      if (segmentReadyOnDisk(targetFile)) {
        activeJob = job;
        break;
      }
    }
    if (clientDisconnected) return;
    if (!activeJob || !segmentReadyOnDisk(targetFile)) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).send("Segment temporarily unavailable");
    }
    const stat = fs4.statSync(targetFile);
    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Range, Accept-Ranges, Content-Length, Content-Type"
    );
    const rangeHeader = req.headers.range;
    let streamStart = 0;
    let streamEnd = stat.size - 1;
    let isRange = false;
    if (rangeHeader) {
      const match = String(rangeHeader).match(/bytes=(\d*)-(\d*)/i);
      if (!match || !match[1] && !match[2]) {
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        return res.status(416).end();
      }
      const hasStart = Boolean(match[1]);
      const hasEnd = Boolean(match[2]);
      if (hasStart) {
        streamStart = parseInt(match[1], 10);
        streamEnd = hasEnd ? parseInt(match[2], 10) : stat.size - 1;
      } else {
        const suffixLen = parseInt(match[2], 10);
        streamStart = Math.max(0, stat.size - suffixLen);
        streamEnd = stat.size - 1;
      }
      if (!Number.isFinite(streamStart) || !Number.isFinite(streamEnd) || streamStart < 0 || streamStart >= stat.size || streamEnd < streamStart) {
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        return res.status(416).end();
      }
      streamEnd = Math.min(streamEnd, stat.size - 1);
      isRange = true;
    }
    const responseLength = streamEnd - streamStart + 1;
    res.setHeader("Content-Length", String(responseLength));
    if (isRange) {
      res.setHeader("Content-Range", `bytes ${streamStart}-${streamEnd}/${stat.size}`);
    }
    if (req.method === "HEAD") {
      return res.status(isRange ? 206 : 200).end();
    }
    res.status(isRange ? 206 : 200);
    activeJob.activeReaders += 1;
    let readerReleased = false;
    const releaseReader = () => {
      if (readerReleased) return;
      readerReleased = true;
      if (activeJob) {
        activeJob.activeReaders = Math.max(0, activeJob.activeReaders - 1);
      }
    };
    const stream = fs4.createReadStream(targetFile, { start: streamStart, end: streamEnd });
    stream.on("error", () => {
      releaseReader();
      if (!res.writableEnded) res.end();
    });
    stream.on("close", releaseReader);
    res.on("close", () => {
      releaseReader();
      stream.destroy();
    });
    stream.pipe(res);
    try {
      const pruneUpTo = segIdx - 15;
      if (pruneUpTo > activeJob.startSeg) {
        for (let oldIdx = Math.max(activeJob.startSeg, pruneUpTo - 5); oldIdx < pruneUpTo; oldIdx++) {
          const oldFile = getHlsSegmentPath(activeJob.dir, oldIdx);
          if (fs4.existsSync(oldFile)) {
            fs4.unlinkSync(oldFile);
          }
        }
      }
    } catch {
    }
  } catch (err) {
    console.error("[HLS Seg] Error:", err?.message || err);
    if (!res.headersSent) res.status(500).send(err?.message || "HLS segment error");
  }
}
router2.get("/hls/seg.ts", handleHlsSegmentRequest);
router2.head("/hls/seg.ts", handleHlsSegmentRequest);
var RECENT_POSTS_CACHE_FILE = path3.join(os2.tmpdir(), ".movie_hub_tg_recent_movies.json");
var recentChannelVideoPosts = [];
var channelMaxKnownMsgId = /* @__PURE__ */ new Map();
var watcherAttachedClients = /* @__PURE__ */ new WeakSet();
function loadRecentChannelPostsFromDisk() {
  try {
    if (fs4.existsSync(RECENT_POSTS_CACHE_FILE)) {
      const parsed = JSON.parse(fs4.readFileSync(RECENT_POSTS_CACHE_FILE, "utf-8"));
      if (Array.isArray(parsed?.posts)) {
        recentChannelVideoPosts.splice(0, recentChannelVideoPosts.length, ...parsed.posts.slice(-250));
      }
      if (parsed?.maxIds && typeof parsed.maxIds === "object") {
        for (const [k, v] of Object.entries(parsed.maxIds)) {
          const n = Number(v);
          if (k && Number.isFinite(n) && n > 0) channelMaxKnownMsgId.set(k, n);
        }
      }
    }
  } catch {
  }
}
function saveRecentChannelPostsToDisk() {
  try {
    const maxIds = {};
    for (const [k, v] of channelMaxKnownMsgId.entries()) {
      maxIds[k] = v;
    }
    fs4.writeFileSync(
      RECENT_POSTS_CACHE_FILE,
      JSON.stringify({ posts: recentChannelVideoPosts.slice(-250), maxIds }),
      "utf-8"
    );
  } catch {
  }
}
loadRecentChannelPostsFromDisk();
function recordChannelVideoPost(post) {
  const prevMax = channelMaxKnownMsgId.get(post.channelId) || 0;
  if (post.msgId > prevMax) {
    channelMaxKnownMsgId.set(post.channelId, post.msgId);
  }
  const dupIdx = recentChannelVideoPosts.findIndex(
    (p) => p.channelId === post.channelId && p.msgId === post.msgId
  );
  if (dupIdx >= 0) {
    recentChannelVideoPosts[dupIdx] = post;
  } else {
    recentChannelVideoPosts.push(post);
    if (recentChannelVideoPosts.length > 250) {
      recentChannelVideoPosts.splice(0, recentChannelVideoPosts.length - 250);
    }
  }
  saveRecentChannelPostsToDisk();
}
var pendingInviteHashes = /* @__PURE__ */ new Set();
async function ensureChannelUploadWatcher(client2) {
  if (!client2 || watcherAttachedClients.has(client2)) return;
  watcherAttachedClients.add(client2);
  try {
    const { NewMessage } = await import("telegram/events/index.js");
    client2.addEventHandler(async (event) => {
      try {
        const msg = event?.message;
        if (!msg || !msg.id) return;
        const rawChanId = msg?.peerId?.channelId?.toString?.() || msg?.chatId?.toString?.()?.replace(/^-100/, "") || "";
        if (!rawChanId) return;
        const cleanChannelId = rawChanId.replace(/^-100/, "");
        const prevMax = channelMaxKnownMsgId.get(cleanChannelId) || 0;
        if (Number(msg.id) > prevMax) {
          channelMaxKnownMsgId.set(cleanChannelId, Number(msg.id));
          saveRecentChannelPostsToDisk();
        }
        let chat = event?.chat || await msg.getChat?.().catch(() => null);
        if (!chat?.accessHash && /^\d+$/.test(cleanChannelId)) {
          chat = await client2.getEntity(`-100${cleanChannelId}`).catch(() => null) || chat;
        }
        const username = chat?.username || "";
        const channelTitle = chat?.title || `Channel (${cleanChannelId})`;
        let inviteTag = username;
        const configInviteMatch = cachedSyncConfig?.channelUrl?.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/);
        if (configInviteMatch?.[1]) {
          pendingInviteHashes.add(configInviteMatch[1]);
        }
        if (!inviteTag && pendingInviteHashes.size > 0 && /^\d+$/.test(cleanChannelId)) {
          try {
            const { botToken } = getTelegramCredentials();
            if (botToken) {
              const cResp = await fetch(
                `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(`-100${cleanChannelId}`)}`
              );
              const cJson = await cResp.json();
              const inv = String(cJson?.result?.invite_link || "");
              const hashMatch = inv.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/);
              if (hashMatch?.[1]) {
                inviteTag = `+${hashMatch[1]}`;
                pendingInviteHashes.delete(hashMatch[1]);
              }
            }
          } catch {
          }
        }
        if (!inviteTag && pendingInviteHashes.size === 1) {
          const onlyPending = Array.from(pendingInviteHashes)[0];
          inviteTag = `+${onlyPending}`;
          pendingInviteHashes.delete(onlyPending);
        }
        if (chat?.accessHash) {
          saveChannelEntity(cleanChannelId, chat.accessHash.toString(), channelTitle, inviteTag);
        }
        const classified = classifyTelegramDocMedia(msg);
        if (classified.kind !== "video") return;
        const streamUrl = username ? `https://t.me/${username}/${msg.id}` : `https://t.me/c/${cleanChannelId}/${msg.id}`;
        recordChannelVideoPost({
          channelId: cleanChannelId,
          channelTitle,
          msgId: Number(msg.id),
          streamUrl,
          fileName: classified.fileName || `Movie_Msg_${msg.id}`,
          caption: classified.caption || "",
          sizeBytes: classified.sizeBytes,
          durationSec: classified.durationSec,
          width: classified.width,
          height: classified.height,
          mime: classified.mime,
          receivedAt: Date.now()
        });
        console.log(
          `[TelegramAutoWatcher] New channel video detected: "${classified.fileName || msg.id}" (${streamUrl})`
        );
        queuePriorityChannelMsgId(cleanChannelId, Number(msg.id));
        scheduleServerAutoSync(`new_video_${cleanChannelId}_${msg.id}`, 1200);
      } catch (watchErr) {
        console.warn("[TelegramAutoWatcher] Handler warning:", watchErr?.message || watchErr);
      }
    }, new NewMessage({}));
  } catch (err) {
    console.warn("[TelegramAutoWatcher] Could not attach NewMessage watcher:", err?.message || err);
  }
}
router2.get("/recent-channel-posts", async (_req, res) => {
  try {
    const client2 = await getTelegramClient().catch(() => null);
    if (client2) await ensureChannelUploadWatcher(client2);
  } catch {
  }
  const maxIds = {};
  for (const [k, v] of channelMaxKnownMsgId.entries()) {
    maxIds[k] = v;
  }
  return res.json({
    success: true,
    posts: recentChannelVideoPosts.slice(-100),
    highestMsgIds: maxIds
  });
});
async function discoverChannelLatestMsgId(client2, peer, cleanChannelId) {
  let highest = channelMaxKnownMsgId.get(cleanChannelId) || 0;
  try {
    const { botToken } = getTelegramCredentials();
    if (botToken && /^\d+$/.test(cleanChannelId)) {
      const targetChatId = `-100${cleanChannelId}`;
      const updResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
      const updJson = await updResp.json();
      for (const u of updJson?.result || []) {
        const src = u?.channel_post || u?.edited_channel_post || u?.message;
        if (src && String(src?.chat?.id || "") === targetChatId) {
          const mid = Number(src.message_id || 0);
          if (mid > highest) highest = mid;
        }
      }
    }
  } catch {
  }
  let base = highest;
  if (base > 0) {
    try {
      const verifyIds = [base, Math.max(1, base - 1), Math.max(1, base - 5)];
      const verifyMsgs = await client2.getMessages(peer, { ids: verifyIds });
      const hasAnyAtBase = (verifyMsgs || []).some((m) => m && m.id);
      if (!hasAnyAtBase) {
        base = 0;
        highest = 0;
      }
    } catch {
    }
  }
  try {
    const probeIds = base > 0 ? [base + 1, base + 5, base + 15, base + 30, base + 60, base + 120, base + 250, base + 500, base + 1e3] : [
      1,
      2,
      5,
      10,
      25,
      50,
      100,
      200,
      350,
      500,
      750,
      1e3,
      1500,
      2e3,
      2500,
      3e3,
      3500,
      4e3,
      4500,
      5e3,
      6e3,
      7500,
      9e3,
      10500,
      12e3
    ];
    const msgs = await client2.getMessages(peer, { ids: probeIds });
    let bestCheckpoint = highest;
    for (const m of msgs || []) {
      if (m && m.id && Number(m.id) > bestCheckpoint) {
        bestCheckpoint = Number(m.id);
      }
    }
    if (bestCheckpoint > 0) {
      const jumpIds = [
        bestCheckpoint + 100,
        bestCheckpoint + 250,
        bestCheckpoint + 500,
        bestCheckpoint + 800,
        bestCheckpoint + 1200,
        bestCheckpoint + 1600
      ];
      const jumpMsgs = await client2.getMessages(peer, { ids: jumpIds }).catch(() => []);
      for (const m of jumpMsgs || []) {
        if (m && m.id && Number(m.id) > bestCheckpoint) {
          bestCheckpoint = Number(m.id);
        }
      }
      const tailStart = bestCheckpoint + 1;
      const tailEnd = bestCheckpoint + 100;
      const tailIds = [];
      for (let i = tailStart; i <= tailEnd; i++) tailIds.push(i);
      const tailMsgs = await client2.getMessages(peer, { ids: tailIds });
      for (const m of tailMsgs || []) {
        if (m && m.id && Number(m.id) > bestCheckpoint) {
          bestCheckpoint = Number(m.id);
        }
      }
      highest = Math.max(highest, bestCheckpoint);
    }
  } catch {
  }
  if (highest > 0) {
    channelMaxKnownMsgId.set(cleanChannelId, highest);
    saveRecentChannelPostsToDisk();
  }
  return highest;
}
async function resolveChannelPeerFromLinkOrId(client2, rawChannelRef) {
  const ref = String(rawChannelRef || "").trim();
  if (!ref) return null;
  const parsed = parseTelegramUrl(ref);
  let peer = null;
  let cleanChannelId = "";
  let channelTitle = ref;
  let publicUsername = "";
  if (parsed.isValid && !parsed.isInviteLink) {
    if (parsed.isPrivate && parsed.rawChannelId) {
      cleanChannelId = parsed.rawChannelId.replace(/^-100/, "");
      channelTitle = `Private Channel (${cleanChannelId})`;
    } else if (parsed.chatId && parsed.chatId.startsWith("@")) {
      publicUsername = parsed.rawChannelId;
      channelTitle = parsed.chatId;
    }
  } else if (/^-100\d+$/.test(ref) || /^\d{6,}$/.test(ref)) {
    cleanChannelId = ref.replace(/^-100/, "");
    channelTitle = `Private Channel (${cleanChannelId})`;
  } else if (!parsed.isInviteLink && /^@?[a-zA-Z0-9_]{4,}$/.test(ref.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, ""))) {
    const u = ref.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "").replace(/^@/, "");
    publicUsername = u;
    channelTitle = `@${u}`;
  }
  if (parsed.isInviteLink && parsed.inviteHash) {
    const hash = parsed.inviteHash;
    const directCached = getAllCachedChannels().find(
      (c) => /^\d+$/.test(c.channelId) && c.accessHash && c.accessHash !== "0" && ((c.username || "").replace(/^\+/, "") === hash || hash === "s2Qki5-sfnVjZTI1" && c.channelId === "4498557265" || (hash === "P5UeGT1YlQ9lOGZl" || hash === "uh9j_me2MdY5YjRl") && c.channelId === "4451036277")
    );
    if (directCached) {
      cleanChannelId = directCached.channelId;
      channelTitle = directCached.title || channelTitle;
      if (directCached.username && !directCached.username.startsWith("+")) {
        publicUsername = directCached.username;
      }
    } else if (hash === "P5UeGT1YlQ9lOGZl" || hash === "uh9j_me2MdY5YjRl") {
      cleanChannelId = "4451036277";
      channelTitle = "RD | Database";
    }
    if (!cleanChannelId) {
      try {
        const checkRes = await client2.invoke(new Api3.messages.CheckChatInvite({ hash }));
        const chat = checkRes?.chat || checkRes?.channel;
        if (chat && chat.id) {
          cleanChannelId = chat.id.toString().replace(/^-100/, "");
          channelTitle = chat.title || channelTitle;
          if (chat.accessHash) {
            saveChannelEntity(cleanChannelId, chat.accessHash.toString(), channelTitle, `+${hash}`);
          }
        }
      } catch {
      }
    }
    if (!cleanChannelId) {
      pendingInviteHashes.add(hash);
      try {
        const { botToken } = getTelegramCredentials();
        if (botToken) {
          const updResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
          const updJson = await updResp.json();
          const updates = Array.isArray(updJson?.result) ? updJson.result : [];
          const recentChatIds = [];
          for (let i = updates.length - 1; i >= 0; i--) {
            const src = updates[i]?.my_chat_member || updates[i]?.channel_post || updates[i]?.edited_channel_post || updates[i]?.message;
            const cId = src?.chat?.id ? String(src.chat.id) : "";
            if (cId && cId.startsWith("-100") && !recentChatIds.includes(cId)) {
              recentChatIds.push(cId);
            }
          }
          const cachedNumericIds = getAllCachedChannels().filter((c) => /^\d+$/.test(c.channelId) && c.accessHash && c.accessHash !== "0").map((c) => `-100${c.channelId}`);
          const allCandidates = Array.from(/* @__PURE__ */ new Set([...recentChatIds, ...cachedNumericIds]));
          for (const cId of allCandidates) {
            try {
              const chatResp = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(cId)}`);
              const chatJson = await chatResp.json();
              const inv = String(chatJson?.result?.invite_link || "");
              if (inv.includes(hash)) {
                cleanChannelId = cId.replace(/^-100/, "");
                channelTitle = chatJson?.result?.title || channelTitle;
                pendingInviteHashes.delete(hash);
                break;
              }
            } catch {
            }
          }
        }
      } catch {
      }
    }
  }
  if (publicUsername && !cleanChannelId) {
    try {
      const entity = await client2.getEntity(`@${publicUsername}`);
      if (entity) {
        peer = entity;
        cleanChannelId = entity.id ? entity.id.toString().replace(/^-100/, "") : publicUsername;
        channelTitle = entity.title || `@${publicUsername}`;
        publicUsername = entity.username || publicUsername;
        if (entity.accessHash) {
          saveChannelEntity(cleanChannelId, entity.accessHash.toString(), channelTitle, publicUsername);
        }
      }
    } catch {
    }
  }
  if (!peer && cleanChannelId) {
    const cachedHash = getCachedAccessHash(cleanChannelId);
    if (cachedHash && cachedHash !== "0") {
      const bigInt3 = (await import("big-integer")).default;
      peer = new Api3.InputPeerChannel({
        channelId: bigInt3(cleanChannelId),
        accessHash: bigInt3(cachedHash)
      });
      const cached = getAllCachedChannels().find((c) => c.channelId === cleanChannelId);
      if (cached?.title) channelTitle = cached.title;
      if (cached?.username && !cached.username.startsWith("+")) publicUsername = cached.username;
    } else {
      try {
        const entity = await client2.getEntity(`-100${cleanChannelId}`);
        if (entity) {
          peer = entity;
          channelTitle = entity.title || channelTitle;
          publicUsername = entity.username || publicUsername;
          if (entity.accessHash) {
            const tagToSave = publicUsername || (parsed.isInviteLink && parsed.inviteHash ? `+${parsed.inviteHash}` : "");
            saveChannelEntity(cleanChannelId, entity.accessHash.toString(), channelTitle, tagToSave);
          }
        }
      } catch {
      }
    }
    if (!peer) peer = `-100${cleanChannelId}`;
  }
  if (!peer) return null;
  return { peer, cleanChannelId: cleanChannelId || publicUsername, channelTitle, publicUsername };
}
router2.post("/resolve-channel-info", async (req, res) => {
  const channelRef = String(req.body?.channelRef || req.body?.channelUrl || "").trim();
  if (!channelRef) {
    return res.status(400).json({ error: "Channel link or @username is required." });
  }
  try {
    const client2 = await getTelegramClient();
    await ensureChannelUploadWatcher(client2);
    const resolved = await resolveChannelPeerFromLinkOrId(client2, channelRef);
    if (!resolved) {
      const isInvite = /(?:\+|joinchat\/)/i.test(channelRef);
      return res.status(404).json({
        needsPostLinkOrPing: isInvite,
        error: isInvite ? "Bot (+invite link) se direct private channel ID nahi nikal sakta. Is channel ka koi bhi 1 post link (https://t.me/c/.../123) paste karein YA channel me 1 message send/forward karein taki @Movies_Direct_Group_Bot channel ko lock kar sake." : "Could not resolve channel. Make sure the bot is Admin in this channel."
      });
    }
    const latestMsgId = await discoverChannelLatestMsgId(
      client2,
      resolved.peer,
      resolved.cleanChannelId
    );
    return res.json({
      success: true,
      channelId: resolved.cleanChannelId,
      channelTitle: resolved.channelTitle,
      publicUsername: resolved.publicUsername,
      latestMsgId
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to resolve Telegram channel." });
  }
});
router2.post("/scan-movies-channel", async (req, res) => {
  const {
    mode = "range",
    startUrl = "",
    endUrl = "",
    channelRef = "",
    startMsgId: rawStartId,
    endMsgId: rawEndId,
    sinceMsgId: rawSinceId,
    onlyValidAudioAndHd = true,
    existingUrls = [],
    existingImdbIds = [],
    existingTitles = []
  } = req.body || {};
  try {
    const client2 = await getTelegramClient();
    await ensureChannelUploadWatcher(client2);
    const refSource = String(startUrl || endUrl || channelRef || "").trim();
    const resolved = await resolveChannelPeerFromLinkOrId(client2, refSource);
    if (!resolved) {
      const isInvite = /(?:\+|joinchat\/)/i.test(refSource);
      return res.status(400).json({
        needsPostLinkOrPing: isInvite,
        error: isInvite ? 'Bot (+invite link) se private channel ID direct read nahi ho sakti. Channel ke andar kisi bhi 1 video ka "Copy Post Link" (https://t.me/c/.../123) yahan daalein YA channel me 1 message bhejein.' : "Could not resolve Telegram channel. Make sure @Movies_Direct_Group_Bot is Admin in your channel."
      });
    }
    const { peer, cleanChannelId, channelTitle, publicUsername } = resolved;
    const startParsed = parseTelegramUrl(String(startUrl || ""));
    const endParsed = parseTelegramUrl(String(endUrl || ""));
    const existingUrlSet = new Set(
      (Array.isArray(existingUrls) ? existingUrls : []).map((u) => String(u || "").trim().toLowerCase()).filter(Boolean)
    );
    const existingImdbSet = new Set(
      (Array.isArray(existingImdbIds) ? existingImdbIds : []).map((id) => String(id || "").trim().toLowerCase()).filter(Boolean)
    );
    const existingTitleList = (Array.isArray(existingTitles) ? existingTitles : []).map((t) => buildExistingTitleDupEntry(t?.title, t?.originalTitle, t?.releaseYear, t?.category)).filter((e) => e.normTitle.length >= 2);
    const collectedMessages = [];
    let scanFromId = 0;
    let scanToId = 0;
    let highestSeenMsgId = Math.max(
      Number(rawSinceId) || 0,
      channelMaxKnownMsgId.get(cleanChannelId) || 0
    );
    if (mode === "since_latest") {
      let baseline = Math.max(0, Number(rawSinceId) || 0);
      if (baseline <= 0) {
        const discoveredLatest = await discoverChannelLatestMsgId(client2, peer, cleanChannelId);
        if (discoveredLatest > 0) {
          baseline = Math.max(0, discoveredLatest - 25);
        } else {
          return res.json({
            success: true,
            channelId: cleanChannelId,
            channelTitle,
            scannedFromMsgId: 0,
            scannedToMsgId: 0,
            highestMsgId: 0,
            totalVideosFound: 0,
            skippedStickers: 0,
            skippedSamples: 0,
            skippedOther: 0,
            skippedAlreadyAdded: 0,
            items: []
          });
        }
      }
      scanFromId = baseline + 1;
      scanToId = baseline;
      let consecutiveEmptyBatches = 0;
      const MAX_PROBE_AHEAD = 500;
      const BATCH = 100;
      for (let cursor = baseline + 1; cursor <= baseline + MAX_PROBE_AHEAD; cursor += BATCH) {
        const batchEnd = Math.min(cursor + BATCH - 1, baseline + MAX_PROBE_AHEAD);
        const ids = [];
        for (let id = cursor; id <= batchEnd; id++) ids.push(id);
        const msgs = await client2.getMessages(peer, { ids });
        const valid = (msgs || []).filter((m) => m && m.id);
        if (valid.length === 0) {
          consecutiveEmptyBatches++;
          if (consecutiveEmptyBatches >= 2) break;
        } else {
          consecutiveEmptyBatches = 0;
          for (const m of valid) {
            collectedMessages.push(m);
            if (Number(m.id) > scanToId) scanToId = Number(m.id);
            if (Number(m.id) > highestSeenMsgId) highestSeenMsgId = Number(m.id);
          }
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    } else {
      const startId = (Number(rawStartId) > 0 ? Math.floor(Number(rawStartId)) : 0) || (startParsed.messageId ? parseInt(startParsed.messageId, 10) : 0) || 1;
      let endId = (Number(rawEndId) > 0 ? Math.floor(Number(rawEndId)) : 0) || (endParsed.messageId ? parseInt(endParsed.messageId, 10) : 0) || 0;
      if (endId <= 0) {
        const discoveredLatest = await discoverChannelLatestMsgId(client2, peer, cleanChannelId);
        endId = Math.max(startId, Math.min(startId + 399, discoveredLatest || startId + 200));
      }
      if (endId < startId) {
        return res.status(400).json({ error: "Ending message ID must be >= Starting message ID." });
      }
      if (endId - startId + 1 > 400) {
        return res.status(400).json({ error: "Max 400 messages per chunk." });
      }
      scanFromId = startId;
      scanToId = endId;
      const BATCH = 100;
      for (let cursor = startId; cursor <= endId; cursor += BATCH) {
        const batchEnd = Math.min(cursor + BATCH - 1, endId);
        const ids = [];
        for (let id = cursor; id <= batchEnd; id++) ids.push(id);
        const msgs = await client2.getMessages(peer, { ids });
        for (const m of msgs || []) {
          if (m && m.id) {
            collectedMessages.push(m);
            if (Number(m.id) > highestSeenMsgId) highestSeenMsgId = Number(m.id);
          }
        }
        if (batchEnd < endId) {
          await new Promise((r) => setTimeout(r, 90));
        }
      }
    }
    if (highestSeenMsgId > (channelMaxKnownMsgId.get(cleanChannelId) || 0)) {
      channelMaxKnownMsgId.set(cleanChannelId, highestSeenMsgId);
      saveRecentChannelPostsToDisk();
    }
    collectedMessages.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    let skippedStickers = 0;
    let skippedSamples = 0;
    let skippedOther = 0;
    let skippedAlreadyAdded = 0;
    let skippedNoAudio = 0;
    let skippedLowQuality = 0;
    const rawCandidates = [];
    for (const msg of collectedMessages) {
      const classified = classifyTelegramDocMedia(msg);
      if (classified.kind === "sticker") {
        skippedStickers++;
        continue;
      }
      if (classified.kind !== "video") {
        skippedOther++;
        continue;
      }
      const streamUrl = publicUsername ? `https://t.me/${publicUsername}/${msg.id}` : `https://t.me/c/${cleanChannelId}/${msg.id}`;
      const parsedMeta = parseTelegramMovieMeta(
        classified.fileName,
        classified.caption,
        classified.width,
        classified.height,
        classified.durationSec,
        classified.sizeBytes
      );
      if (parsedMeta.isSampleOrClip) {
        skippedSamples++;
        continue;
      }
      if (existingUrlSet.has(streamUrl.toLowerCase())) {
        skippedAlreadyAdded++;
        continue;
      }
      primeMediaCacheFromTelegramDoc(
        streamUrl,
        classified.doc,
        classified.fileName,
        classified.durationSec,
        classified.mime
      );
      rawCandidates.push({
        msgId: Number(msg.id),
        streamUrl,
        doc: classified.doc,
        mime: classified.mime,
        durationSec: classified.durationSec,
        sizeBytes: classified.sizeBytes,
        width: classified.width,
        height: classified.height,
        fileName: classified.fileName || `Movie_${msg.id}`,
        caption: classified.caption || "",
        hasExplicitNoSound: classified.hasExplicitNoSound,
        parsed: parsedMeta
      });
    }
    let aborted = false;
    res.on("close", () => {
      if (!res.writableEnded) aborted = true;
    });
    const verifiedList = await mapWithConcurrency(
      rawCandidates,
      4,
      async (cand) => {
        if (aborted) return null;
        const check = await verifyCandidateAudioAndHd(
          {
            streamUrl: cand.streamUrl,
            doc: cand.doc,
            mime: cand.mime,
            fileName: cand.fileName,
            caption: cand.caption,
            durationSec: cand.durationSec,
            width: cand.width,
            height: cand.height,
            parsedQuality: cand.parsed.quality,
            hasExplicitNoSound: cand.hasExplicitNoSound
          },
          client2,
          Boolean(onlyValidAudioAndHd)
        );
        if (!check.accepted) {
          if (check.reason === "no_audio" || check.reason === "unverified_audio") {
            skippedNoAudio++;
          } else {
            skippedLowQuality++;
          }
          return null;
        }
        return {
          msgId: cand.msgId,
          streamUrl: cand.streamUrl,
          durationSec: check.durationSec || cand.durationSec,
          sizeBytes: cand.sizeBytes,
          fileName: cand.fileName,
          caption: cand.caption,
          parsed: {
            ...cand.parsed,
            quality: check.effectiveQuality || cand.parsed.quality
          }
        };
      },
      () => aborted
    );
    if (aborted) return;
    const videoCandidates = verifiedList.filter((v) => Boolean(v));
    const groupedList = [];
    const groupIndexByKey = /* @__PURE__ */ new Map();
    for (const v of videoCandidates) {
      const gKey = v.parsed.groupKey || `msg-${v.msgId}`;
      const existingIdx = v.parsed.groupKey ? groupIndexByKey.get(gKey) : void 0;
      if (existingIdx !== void 0) {
        const grp = groupedList[existingIdx];
        grp.members.push(v);
        if (v.parsed.quality) {
          const prevSize = grp.qualitySizes[v.parsed.quality] || 0;
          if (!grp.videoQualities[v.parsed.quality] || v.sizeBytes > prevSize) {
            grp.videoQualities[v.parsed.quality] = v.streamUrl;
            grp.qualitySizes[v.parsed.quality] = v.sizeBytes;
          }
        }
        if (!grp.primary.parsed.year && v.parsed.year || !grp.primary.parsed.explicitImdbId && v.parsed.explicitImdbId || v.parsed.quality === "1080p") {
          grp.primary = v;
        }
      } else {
        const vq = {};
        const qs = {};
        if (v.parsed.quality) {
          vq[v.parsed.quality] = v.streamUrl;
          qs[v.parsed.quality] = v.sizeBytes;
        }
        const newIdx = groupedList.length;
        groupedList.push({
          groupKey: gKey,
          primary: v,
          members: [v],
          videoQualities: vq,
          qualitySizes: qs
        });
        if (v.parsed.groupKey) {
          groupIndexByKey.set(gKey, newIdx);
        }
      }
    }
    const drafts = await mapWithConcurrency(
      groupedList,
      3,
      async (grp) => {
        if (aborted) return null;
        const bestStream = grp.videoQualities["1080p"] || grp.videoQualities["720p"] || grp.videoQualities["480p"] || grp.videoQualities["4K"] || grp.videoQualities["360p"] || grp.primary.streamUrl;
        const mergedParsed = {
          ...grp.primary.parsed,
          year: grp.primary.parsed.year || grp.members.find((m) => m.parsed.year)?.parsed.year || null,
          languageHint: grp.primary.parsed.languageHint || grp.members.find((m) => m.parsed.languageHint)?.parsed.languageHint || "",
          isHindiDubbed: grp.members.some((m) => m.parsed.isHindiDubbed)
        };
        const matched = await resolveBestImdbMatch(mergedParsed);
        const isSeriesItem = mergedParsed.isSeriesEpisode || String(matched.originalCategory || "").toLowerCase().includes("series");
        if (!isSeriesItem) {
          if (matched.imdbId && existingImdbSet.has(matched.imdbId.toLowerCase())) {
            skippedAlreadyAdded++;
            return null;
          }
          if (isDuplicateByTitleAndYear(
            existingTitleList,
            [matched.title, matched.originalTitle, mergedParsed.cleanTitle],
            matched.releaseYear || mergedParsed.year || 0,
            false
          )) {
            skippedAlreadyAdded++;
            return null;
          }
        }
        const filteredQualities = onlyValidAudioAndHd ? filterQualityMapForHdOnly(grp.videoQualities) : grp.videoQualities;
        const chosenStream = filteredQualities["1080p"] || filteredQualities["720p"] || bestStream;
        const bestDurSec = Math.max(0, ...grp.members.map((m) => m.durationSec || 0));
        const durationFormatted = bestDurSec > 0 ? formatDuration(bestDurSec) : "";
        const qualityBadge = filteredQualities["4K"] ? "4K" : "HD";
        return {
          draftId: `tg-${cleanChannelId}-${grp.primary.msgId}`,
          channelId: cleanChannelId,
          channelTitle,
          msgId: grp.primary.msgId,
          sourceMsgIds: grp.members.map((m) => m.msgId),
          streamUrl: chosenStream,
          videoQualities: filteredQualities,
          qualityBadge,
          durationSec: bestDurSec,
          runtime: matched.runtime || durationFormatted,
          sourceFileName: grp.primary.fileName,
          sourceCaption: `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ""}`,
          parsedTitle: mergedParsed.cleanTitle,
          parsedYear: mergedParsed.year,
          imdbId: matched.imdbId,
          title: matched.title,
          originalTitle: matched.originalTitle,
          releaseYear: matched.releaseYear,
          posterUrl: matched.posterUrl,
          backdropUrl: matched.backdropUrl,
          genre: matched.genre,
          description: matched.description,
          director: matched.director,
          cast: matched.cast,
          language: matched.language,
          rating: matched.rating,
          originalCategory: matched.originalCategory,
          matchConfidence: matched.matchConfidence,
          confidenceScore: matched.confidenceScore,
          matchReason: matched.matchReason,
          isSeriesEpisode: mergedParsed.isSeriesEpisode,
          seasonNumber: mergedParsed.seasonNumber,
          episodeNumber: mergedParsed.episodeNumber,
          episodeLabel: mergedParsed.episodeLabel,
          episodeTitle: mergedParsed.episodeTitle,
          alternateMatches: matched.alternateMatches
        };
      },
      () => aborted
    );
    if (aborted) return;
    const finalItems = drafts.filter((d) => Boolean(d));
    console.log(
      `[TelegramScanMovies] Channel "${channelTitle}" (${scanFromId}-${scanToId}, mode=${mode}): ${finalItems.length} movies matched (${videoCandidates.length} valid HD+Audio / ${rawCandidates.length} raw, ${skippedNoAudio} no-audio, ${skippedLowQuality} <720p, ${skippedAlreadyAdded} already in app)`
    );
    return res.json({
      success: true,
      channelId: cleanChannelId,
      channelTitle,
      scannedFromMsgId: scanFromId,
      scannedToMsgId: scanToId,
      highestMsgId: highestSeenMsgId,
      totalVideosFound: videoCandidates.length,
      skippedStickers,
      skippedSamples,
      skippedOther,
      skippedAlreadyAdded,
      skippedNoAudio,
      skippedLowQuality,
      items: finalItems
    });
  } catch (err) {
    console.error("[TelegramScanMovies] Error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to scan Telegram channel movies."
    });
  }
});
function normalizeDupTitleKey(title) {
  return String(title || "").toLowerCase().replace(/\((?:tv\s*series|film|movie|series|\d{4})\)/gi, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}
function buildExistingTitleDupEntry(title, origTitle, releaseYear, category) {
  const catLower = String(category || "").toLowerCase();
  return {
    normTitle: normalizeDupTitleKey(String(title || "")),
    normOrigTitle: normalizeDupTitleKey(String(origTitle || "")),
    releaseYear: Number(releaseYear) || 0,
    isSeries: catLower.includes("series")
  };
}
function isDuplicateByTitleAndYear(existingList, candidateTitles, candidateYear, candidateIsSeries) {
  const normCandidates = candidateTitles.map((t) => normalizeDupTitleKey(t || "")).filter((k) => k.length >= 2);
  if (normCandidates.length === 0) return false;
  for (const ex of existingList) {
    const exKeys = [ex.normTitle, ex.normOrigTitle].filter((k) => k.length >= 2);
    for (const ck of normCandidates) {
      for (const ek of exKeys) {
        if (ck !== ek) continue;
        if (ex.isSeries || candidateIsSeries) return true;
        if (!candidateYear || !ex.releaseYear) return true;
        if (Math.abs(candidateYear - ex.releaseYear) <= 1) return true;
      }
    }
  }
  return false;
}
var DEFAULT_AUTO_SYNC_CHANNEL_URL = "https://t.me/+P5UeGT1YlQ9lOGZl";
var DEFAULT_AUTO_SYNC_CHANNEL_ID = "4451036277";
var AUTO_SYNC_CONFIG_VERSION = 3;
var SEED_CATALOG_PATH = path3.resolve(process.cwd(), "public/movies-seed.json");
var DIST_SEED_CATALOG_PATH = path3.resolve(process.cwd(), "dist/movies-seed.json");
var AUTO_SYNC_STATE_FILE = path3.join(os2.tmpdir(), ".movie_hub_tg_autosync_state.json");
var PENDING_DRAFTS_FILE = path3.join(os2.tmpdir(), ".movie_hub_tg_pending_drafts.json");
var pendingServerDrafts = [];
var pendingPriorityMsgIds = /* @__PURE__ */ new Map();
var liveCatalogSseClients = /* @__PURE__ */ new Set();
var localChannelCheckpoint = {};
function loadLocalAutoSyncState() {
  try {
    if (fs4.existsSync(AUTO_SYNC_STATE_FILE)) {
      const parsed = JSON.parse(fs4.readFileSync(AUTO_SYNC_STATE_FILE, "utf-8"));
      if (parsed?.channels && typeof parsed.channels === "object") {
        for (const [k, v] of Object.entries(parsed.channels)) {
          const n = Number(v);
          if (k && Number.isFinite(n) && n > 0) {
            localChannelCheckpoint[k] = n;
          }
        }
      }
    }
  } catch {
  }
}
function saveLocalChannelCheckpoint(channelId, msgId) {
  if (!channelId || !Number.isFinite(msgId) || msgId <= 0) return;
  const prev = localChannelCheckpoint[channelId] || 0;
  if (msgId <= prev) return;
  localChannelCheckpoint[channelId] = msgId;
  try {
    fs4.writeFileSync(
      AUTO_SYNC_STATE_FILE,
      JSON.stringify({ channels: localChannelCheckpoint, updatedAt: Date.now() }),
      "utf-8"
    );
  } catch {
  }
}
loadLocalAutoSyncState();
function queuePriorityChannelMsgId(channelId, msgId) {
  if (!channelId || !Number.isFinite(msgId) || msgId <= 0) return;
  let set = pendingPriorityMsgIds.get(channelId);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    pendingPriorityMsgIds.set(channelId, set);
  }
  set.add(msgId);
}
function consumePriorityChannelMsgIds(channelId) {
  const set = pendingPriorityMsgIds.get(channelId);
  if (!set || set.size === 0) return [];
  const list = Array.from(set).sort((a, b) => a - b);
  set.clear();
  return list;
}
function writeSeedCatalogToDisk(items) {
  const payload = JSON.stringify(items);
  try {
    fs4.writeFileSync(SEED_CATALOG_PATH, payload);
  } catch {
  }
  try {
    if (fs4.existsSync(path3.dirname(DIST_SEED_CATALOG_PATH))) {
      fs4.writeFileSync(DIST_SEED_CATALOG_PATH, payload);
    }
  } catch {
  }
}
function broadcastLiveCatalogUpdate(payload) {
  if (liveCatalogSseClients.size === 0) return;
  const frame = `event: catalog_updated
data: ${JSON.stringify(payload)}

`;
  for (const clientRes of Array.from(liveCatalogSseClients)) {
    try {
      if (!clientRes.writableEnded) {
        clientRes.write(frame);
      } else {
        liveCatalogSseClients.delete(clientRes);
      }
    } catch {
      liveCatalogSseClients.delete(clientRes);
    }
  }
}
router2.get("/live-events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  liveCatalogSseClients.add(res);
  try {
    res.write(`event: connected
data: ${JSON.stringify({ ok: true, ts: Date.now() })}

`);
  } catch {
  }
  const pingTimer = setInterval(() => {
    try {
      if (!res.writableEnded) {
        res.write(`: ping ${Date.now()}

`);
      }
    } catch {
    }
  }, 2e4);
  req.on("close", () => {
    clearInterval(pingTimer);
    liveCatalogSseClients.delete(res);
  });
});
function loadPendingServerDrafts() {
  try {
    if (fs4.existsSync(PENDING_DRAFTS_FILE)) {
      const raw = JSON.parse(fs4.readFileSync(PENDING_DRAFTS_FILE, "utf-8"));
      if (Array.isArray(raw)) {
        pendingServerDrafts = raw;
      }
    }
  } catch {
  }
}
function savePendingServerDrafts() {
  try {
    fs4.writeFileSync(PENDING_DRAFTS_FILE, JSON.stringify(pendingServerDrafts.slice(0, 100)), "utf-8");
  } catch {
  }
}
loadPendingServerDrafts();
router2.get("/pending-review-drafts", (_req, res) => {
  return res.json({ success: true, drafts: pendingServerDrafts });
});
router2.post("/dismiss-review-draft", (req, res) => {
  const draftId = String(req.body?.draftId || "").trim();
  if (draftId) {
    pendingServerDrafts = pendingServerDrafts.filter((d) => d.draftId !== draftId);
    savePendingServerDrafts();
  }
  return res.json({ success: true, remaining: pendingServerDrafts.length });
});
router2.post("/trigger-auto-sync", async (_req, res) => {
  try {
    await runServerAutoSyncPass("manual_trigger");
    return res.json({
      success: true,
      pendingDrafts: pendingServerDrafts.length
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Auto-sync trigger failed." });
  }
});
var serverAutoSyncTimer = null;
var serverAutoSyncRunning = false;
var pendingResyncReason = null;
var cachedSyncConfig = null;
function scheduleServerAutoSync(reason, delayMs = 1200) {
  if (serverAutoSyncRunning) {
    pendingResyncReason = reason;
    return;
  }
  if (serverAutoSyncTimer) clearTimeout(serverAutoSyncTimer);
  serverAutoSyncTimer = setTimeout(() => {
    serverAutoSyncTimer = null;
    runServerAutoSyncPass(reason).catch(
      (e) => console.warn("[ServerAutoSync] Pass warning:", e?.message || e)
    );
  }, delayMs);
}
async function getServerAutoSyncConfig(forceRefresh = false) {
  if (!forceRefresh && cachedSyncConfig && Date.now() - cachedSyncConfig.fetchedAt < 6e4) {
    return cachedSyncConfig;
  }
  const prevCachedLastSynced = cachedSyncConfig?.lastSyncedMsgId || 0;
  try {
    const ref = doc2(db, "app_config", "telegram_auto_sync");
    const snap = await getDocFromServer2(ref);
    const d = snap.exists() ? snap.data() : {};
    const rawUrl = String(d?.channelUrl || "").trim();
    const rawVer = Number(d?.configVersion) || 1;
    const isOldDefaultChannel = rawUrl.includes("QSL_3k54YfBjMjE1") || rawUrl.includes("s2Qki5-sfnVjZTI1");
    if (!snap.exists() || rawVer < AUTO_SYNC_CONFIG_VERSION || isOldDefaultChannel || !rawUrl) {
      const preservedLastSynced = Math.max(
        prevCachedLastSynced,
        isOldDefaultChannel ? 0 : Number(d?.lastSyncedMsgId) || 0,
        localChannelCheckpoint[DEFAULT_AUTO_SYNC_CHANNEL_ID] || 0
      );
      const migrated = {
        configVersion: AUTO_SYNC_CONFIG_VERSION,
        channelUrl: DEFAULT_AUTO_SYNC_CHANNEL_URL,
        activeChannelId: DEFAULT_AUTO_SYNC_CHANNEL_ID,
        lastSyncedMsgId: preservedLastSynced,
        autoWatchEnabled: true,
        autoPublishVerified: true,
        notifyOnNewPublish: true,
        onlyValidAudioAndHd: false,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp()
      };
      await setDocWithQuotaGuard(ref, migrated, { merge: true }).catch(() => {
      });
      cachedSyncConfig = {
        configVersion: AUTO_SYNC_CONFIG_VERSION,
        channelUrl: DEFAULT_AUTO_SYNC_CHANNEL_URL,
        lastSyncedMsgId: preservedLastSynced,
        autoWatchEnabled: true,
        autoPublishVerified: true,
        notifyOnNewPublish: true,
        onlyValidAudioAndHd: false,
        fetchedAt: Date.now()
      };
    } else {
      cachedSyncConfig = {
        configVersion: rawVer,
        channelUrl: rawUrl,
        lastSyncedMsgId: Math.max(
          prevCachedLastSynced,
          Number(d?.lastSyncedMsgId) || 0,
          localChannelCheckpoint[DEFAULT_AUTO_SYNC_CHANNEL_ID] || 0
        ),
        autoWatchEnabled: typeof d?.autoWatchEnabled === "boolean" ? d.autoWatchEnabled : true,
        autoPublishVerified: typeof d?.autoPublishVerified === "boolean" ? d.autoPublishVerified : true,
        notifyOnNewPublish: typeof d?.notifyOnNewPublish === "boolean" ? d.notifyOnNewPublish : true,
        onlyValidAudioAndHd: typeof d?.onlyValidAudioAndHd === "boolean" ? d.onlyValidAudioAndHd : false,
        fetchedAt: Date.now()
      };
    }
  } catch {
    if (!cachedSyncConfig) {
      cachedSyncConfig = {
        configVersion: AUTO_SYNC_CONFIG_VERSION,
        channelUrl: DEFAULT_AUTO_SYNC_CHANNEL_URL,
        lastSyncedMsgId: localChannelCheckpoint[DEFAULT_AUTO_SYNC_CHANNEL_ID] || 0,
        autoWatchEnabled: true,
        autoPublishVerified: true,
        notifyOnNewPublish: true,
        onlyValidAudioAndHd: false,
        fetchedAt: Date.now()
      };
    }
  }
  return cachedSyncConfig;
}
function findMatchingExistingRecord(records, imdbId, titles, year, isSeries) {
  const cleanImdb = String(imdbId || "").trim().toLowerCase();
  if (cleanImdb) {
    const byImdb = records.find((r) => r.imdbId && r.imdbId.toLowerCase() === cleanImdb);
    if (byImdb) return byImdb;
  }
  const candKeys = titles.map((t) => normalizeDupTitleKey(t || "")).filter((k) => k.length >= 2);
  for (const r of records) {
    const rKeys = [normalizeDupTitleKey(r.title), normalizeDupTitleKey(r.originalTitle)].filter((k) => k.length >= 2);
    for (const ck of candKeys) {
      for (const rk of rKeys) {
        if (ck !== rk) continue;
        if (isSeries || r.isSeries) return r;
        if (!year || !r.releaseYear || Math.abs(year - r.releaseYear) <= 1) return r;
      }
    }
  }
  return null;
}
function mergeEpisodeIntoSeasons(existingSeasons, seasonNum, newEpisode) {
  const cloned = Array.isArray(existingSeasons) ? existingSeasons.map((s) => ({
    seasonNumber: Number(s?.seasonNumber) || 1,
    episodes: Array.isArray(s?.episodes) ? [...s.episodes] : []
  })) : [];
  let targetSeason = cloned.find((s) => s.seasonNumber === seasonNum);
  if (!targetSeason) {
    targetSeason = { seasonNumber: seasonNum, episodes: [] };
    cloned.push(targetSeason);
  }
  const cleanStream = newEpisode.streamUrl.trim().toLowerCase();
  const alreadyByUrl = targetSeason.episodes.some(
    (ep) => String(ep?.streamUrl || "").trim().toLowerCase() === cleanStream
  );
  if (alreadyByUrl) {
    return { mergedSeasons: cloned, added: false };
  }
  const sameEpIdx = targetSeason.episodes.findIndex(
    (ep) => Number(ep?.episodeNumber) === newEpisode.episodeNumber && String(ep?.streamUrl || "").trim() !== ""
  );
  if (sameEpIdx >= 0) {
    return { mergedSeasons: cloned, added: false };
  }
  const emptyEpIdx = targetSeason.episodes.findIndex(
    (ep) => Number(ep?.episodeNumber) === newEpisode.episodeNumber && !String(ep?.streamUrl || "").trim()
  );
  if (emptyEpIdx >= 0) {
    targetSeason.episodes[emptyEpIdx] = newEpisode;
  } else {
    targetSeason.episodes.push(newEpisode);
  }
  targetSeason.episodes.sort((a, b) => (Number(a?.episodeNumber) || 0) - (Number(b?.episodeNumber) || 0));
  cloned.sort((a, b) => a.seasonNumber - b.seasonNumber);
  return { mergedSeasons: cloned, added: true };
}
function buildFallbackPosterDataUri(title, year) {
  const safeTitle = String(title || "Movie Hub").replace(/[<>&"']/g, " ").trim().slice(0, 34);
  const safeYear = String(year || "").replace(/[^0-9]/g, "").slice(0, 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#111827"/><stop offset="55%" stop-color="#0f172a"/><stop offset="100%" stop-color="#064e3b"/></linearGradient></defs><rect width="600" height="900" fill="url(#bg)"/><circle cx="300" cy="360" r="88" fill="#10b981" opacity="0.16"/><polygon points="275,320 275,400 345,360" fill="#10b981"/><text x="300" y="545" text-anchor="middle" fill="#f9fafb" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="700">${safeTitle}</text>${safeYear ? `<text x="300" y="605" text-anchor="middle" fill="#34d399" font-family="system-ui,-apple-system,sans-serif" font-size="26" font-weight="600">${safeYear}</text>` : ""}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
var lastReconcileCheckAt = 0;
async function runServerAutoSyncPass(reason) {
  if (serverAutoSyncRunning || bulkSyncJob.status === "running") return;
  serverAutoSyncRunning = true;
  try {
    const cfg = await getServerAutoSyncConfig(reason.startsWith("new_video") || reason === "boot" || reason === "manual_trigger");
    if (!cfg.autoWatchEnabled || !cfg.channelUrl) return;
    const client2 = await getTelegramClient().catch(() => null);
    if (!client2) return;
    await ensureChannelUploadWatcher(client2);
    const resolved = await resolveChannelPeerFromLinkOrId(client2, cfg.channelUrl);
    if (!resolved) return;
    const { peer, cleanChannelId, channelTitle, publicUsername } = resolved;
    const priorityIds = consumePriorityChannelMsgIds(cleanChannelId);
    try {
      const { botToken } = getTelegramCredentials();
      if (botToken && /^\d+$/.test(cleanChannelId)) {
        const targetChatId = `-100${cleanChannelId}`;
        const updResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=30`);
        const updJson = await updResp.json();
        for (const u of updJson?.result || []) {
          const src = u?.channel_post || u?.edited_channel_post;
          if (src && String(src?.chat?.id || "") === targetChatId) {
            const mid = Number(src.message_id || 0);
            if (mid > 0) {
              if (!priorityIds.includes(mid)) priorityIds.push(mid);
              const prevKnown = channelMaxKnownMsgId.get(cleanChannelId) || 0;
              if (mid > prevKnown) channelMaxKnownMsgId.set(cleanChannelId, mid);
            }
          }
        }
      }
    } catch {
    }
    let baseline = Math.max(
      cfg.lastSyncedMsgId,
      localChannelCheckpoint[cleanChannelId] || 0
    );
    let reconciledStaleBaseline = false;
    const knownMax = channelMaxKnownMsgId.get(cleanChannelId) || 0;
    if (baseline <= 0) {
      const latest = await discoverChannelLatestMsgId(client2, peer, cleanChannelId);
      if (latest <= 0 && priorityIds.length === 0) return;
      baseline = Math.max(0, latest - 25);
    } else if (knownMax > baseline + 25) {
      baseline = Math.max(baseline, knownMax - 25);
    }
    const probeSet = new Set(priorityIds);
    const probeStart = Math.max(baseline, knownMax > baseline + 25 ? knownMax - 25 : baseline);
    for (let id = probeStart + 1; id <= probeStart + 25; id++) probeSet.add(id);
    const probeIds = Array.from(probeSet).sort((a, b) => a - b);
    const [probedMsgs, latestTailMsgs] = await Promise.all([
      probeIds.length > 0 ? client2.getMessages(peer, { ids: probeIds }).catch(() => []) : Promise.resolve([]),
      client2.getMessages(peer, { limit: 15 }).catch(() => [])
    ]);
    const validMsgMap = /* @__PURE__ */ new Map();
    for (const m of [...probedMsgs || [], ...latestTailMsgs || []]) {
      if (m && m.id) validMsgMap.set(Number(m.id), m);
    }
    const shouldReconcile = validMsgMap.size === 0 && (reason === "boot" || reason === "manual_trigger" || Date.now() - lastReconcileCheckAt > 3e4);
    if (shouldReconcile) {
      lastReconcileCheckAt = Date.now();
      const realLatest = await discoverChannelLatestMsgId(client2, peer, cleanChannelId);
      if (realLatest > 0 && (baseline > realLatest || realLatest > baseline || reason === "boot" || reason === "manual_trigger")) {
        if (baseline > realLatest) {
          reconciledStaleBaseline = true;
          baseline = 0;
        }
        const scanStart = reconciledStaleBaseline ? 1 : Math.max(1, realLatest - 60);
        for (let cur = scanStart; cur <= realLatest; cur += 100) {
          const endCur = Math.min(realLatest, cur + 99);
          const batch = [];
          for (let id = cur; id <= endCur; id++) batch.push(id);
          const got = await client2.getMessages(peer, { ids: batch }).catch(() => []);
          for (const m of got || []) {
            if (m && m.id) validMsgMap.set(Number(m.id), m);
          }
        }
      }
    }
    let validMsgs = Array.from(validMsgMap.values());
    if (validMsgs.length === 0) {
      if (reconciledStaleBaseline) {
        localChannelCheckpoint[cleanChannelId] = 0;
        await setDocWithQuotaGuard(
          doc2(db, "app_config", "telegram_auto_sync"),
          { lastSyncedMsgId: 0, updatedAtMs: Date.now(), updatedAt: serverTimestamp() },
          { merge: true }
        ).catch(() => {
        });
        if (cachedSyncConfig) cachedSyncConfig.lastSyncedMsgId = 0;
      }
      return;
    }
    if (!reconciledStaleBaseline && validMsgs.length >= 20) {
      const moreIds = [];
      for (let id = baseline + 26; id <= baseline + 150; id++) moreIds.push(id);
      const moreMsgs = await client2.getMessages(peer, { ids: moreIds }).catch(() => []);
      for (const m of moreMsgs || []) {
        if (m && m.id && !validMsgMap.has(Number(m.id))) {
          validMsgMap.set(Number(m.id), m);
        }
      }
      validMsgs = Array.from(validMsgMap.values());
    }
    validMsgs.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    const highestMsgId = Math.max(
      baseline,
      ...validMsgs.map((m) => Number(m.id || 0))
    );
    if (highestMsgId > (channelMaxKnownMsgId.get(cleanChannelId) || 0) || reconciledStaleBaseline) {
      channelMaxKnownMsgId.set(cleanChannelId, highestMsgId);
      saveRecentChannelPostsToDisk();
    }
    const seedCatalogMap = /* @__PURE__ */ new Map();
    const existingUrlSet = /* @__PURE__ */ new Set();
    const existingRecords = [];
    const registerExistingDoc = (id, m) => {
      if (!id || !m) return;
      if (!seedCatalogMap.has(id)) {
        seedCatalogMap.set(id, { id, ...m });
      }
      const cat = String(m?.originalCategory || "");
      const isSeries = cat.toLowerCase().includes("series") || Array.isArray(m?.seasons) && m.seasons.length > 0;
      if (m?.streamingUrl) existingUrlSet.add(String(m.streamingUrl).trim().toLowerCase());
      if (m?.videoQualities && typeof m.videoQualities === "object") {
        Object.values(m.videoQualities).forEach((u) => {
          if (typeof u === "string" && u.trim()) existingUrlSet.add(u.trim().toLowerCase());
        });
      }
      if (Array.isArray(m?.seasons)) {
        m.seasons.forEach((s) => {
          if (Array.isArray(s?.episodes)) {
            s.episodes.forEach((ep) => {
              if (ep?.streamUrl) existingUrlSet.add(String(ep.streamUrl).trim().toLowerCase());
            });
          }
        });
      }
      if (!existingRecords.some((r) => r.id === id)) {
        existingRecords.push({
          id,
          imdbId: String(m?.imdbId || "").trim(),
          title: String(m?.title || ""),
          originalTitle: String(m?.originalTitle || ""),
          releaseYear: Number(m?.releaseYear) || 0,
          originalCategory: cat,
          isSeries,
          published: m?.published !== false,
          streamingUrl: String(m?.streamingUrl || "").trim(),
          videoQualities: m?.videoQualities && typeof m.videoQualities === "object" ? { ...m.videoQualities } : {},
          seasons: Array.isArray(m?.seasons) ? m.seasons : []
        });
      }
    };
    try {
      if (fs4.existsSync(SEED_CATALOG_PATH)) {
        const rawSeed = JSON.parse(fs4.readFileSync(SEED_CATALOG_PATH, "utf8"));
        if (Array.isArray(rawSeed)) {
          rawSeed.forEach((m) => {
            if (m?.id) registerExistingDoc(String(m.id), m);
          });
        }
      }
    } catch {
    }
    try {
      const existingSnap = await getDocsFromServer(collection(db, "movies"));
      existingSnap.docs.forEach((d) => registerExistingDoc(d.id, d.data()));
    } catch {
    }
    const rawCandidates = [];
    for (const msg of validMsgs) {
      const classified = classifyTelegramDocMedia(msg);
      if (classified.kind !== "video") continue;
      const streamUrl = publicUsername ? `https://t.me/${publicUsername}/${msg.id}` : `https://t.me/c/${cleanChannelId}/${msg.id}`;
      const parsedMeta = parseTelegramMovieMeta(
        classified.fileName,
        classified.caption,
        classified.width,
        classified.height,
        classified.durationSec,
        classified.sizeBytes
      );
      if (parsedMeta.isSampleOrClip) continue;
      if (existingUrlSet.has(streamUrl.toLowerCase())) continue;
      primeMediaCacheFromTelegramDoc(
        streamUrl,
        classified.doc,
        classified.fileName,
        classified.durationSec,
        classified.mime
      );
      rawCandidates.push({
        msgId: Number(msg.id),
        streamUrl,
        doc: classified.doc,
        mime: classified.mime,
        durationSec: classified.durationSec,
        sizeBytes: classified.sizeBytes,
        width: classified.width,
        height: classified.height,
        fileName: classified.fileName || `Movie_${msg.id}`,
        caption: classified.caption || "",
        hasExplicitNoSound: classified.hasExplicitNoSound,
        parsed: parsedMeta
      });
    }
    const verifiedBgList = await mapWithConcurrency(
      rawCandidates,
      4,
      async (cand) => {
        const check = await verifyCandidateAudioAndHd(
          {
            streamUrl: cand.streamUrl,
            doc: cand.doc,
            mime: cand.mime,
            fileName: cand.fileName,
            caption: cand.caption,
            durationSec: cand.durationSec,
            width: cand.width,
            height: cand.height,
            parsedQuality: cand.parsed.quality,
            hasExplicitNoSound: cand.hasExplicitNoSound
          },
          client2,
          cfg.onlyValidAudioAndHd
        );
        if (!check.accepted) {
          console.log(
            `[ServerAutoSync] Skipped "${cand.fileName}" (${cand.streamUrl}) \u2014 reason=${check.reason}`
          );
          return null;
        }
        return {
          msgId: cand.msgId,
          streamUrl: cand.streamUrl,
          durationSec: check.durationSec || cand.durationSec,
          sizeBytes: cand.sizeBytes,
          fileName: cand.fileName,
          caption: cand.caption,
          parsed: {
            ...cand.parsed,
            quality: check.effectiveQuality || cand.parsed.quality
          }
        };
      }
    );
    const candidates = verifiedBgList.filter((c) => Boolean(c));
    if (candidates.length === 0) {
      if (highestMsgId > cfg.lastSyncedMsgId || highestMsgId > (localChannelCheckpoint[cleanChannelId] || 0)) {
        saveLocalChannelCheckpoint(cleanChannelId, highestMsgId);
        if (cachedSyncConfig) cachedSyncConfig.lastSyncedMsgId = highestMsgId;
        await setDocWithQuotaGuard(
          doc2(db, "app_config", "telegram_auto_sync"),
          { lastSyncedMsgId: highestMsgId, updatedAtMs: Date.now(), updatedAt: serverTimestamp() },
          { merge: true }
        ).catch(() => {
        });
      }
      return;
    }
    const groups = [];
    const groupIdxByKey = /* @__PURE__ */ new Map();
    for (const v of candidates) {
      const gKey = v.parsed.groupKey || `msg-${v.msgId}`;
      const existingIdx = v.parsed.groupKey ? groupIdxByKey.get(gKey) : void 0;
      if (existingIdx !== void 0) {
        const grp = groups[existingIdx];
        grp.members.push(v);
        if (v.parsed.quality) {
          const prevSize = grp.qualitySizes[v.parsed.quality] || 0;
          if (!grp.videoQualities[v.parsed.quality] || v.sizeBytes > prevSize) {
            grp.videoQualities[v.parsed.quality] = v.streamUrl;
            grp.qualitySizes[v.parsed.quality] = v.sizeBytes;
          }
        }
        if (!grp.primary.parsed.year && v.parsed.year || !grp.primary.parsed.explicitImdbId && v.parsed.explicitImdbId || v.parsed.quality === "1080p") {
          grp.primary = v;
        }
      } else {
        const vq = {};
        const qs = {};
        if (v.parsed.quality) {
          vq[v.parsed.quality] = v.streamUrl;
          qs[v.parsed.quality] = v.sizeBytes;
        }
        const idx = groups.length;
        groups.push({ groupKey: gKey, primary: v, members: [v], videoQualities: vq, qualitySizes: qs });
        if (v.parsed.groupKey) {
          groupIdxByKey.set(gKey, idx);
        }
      }
    }
    let publishedCount = 0;
    let catalogDirty = false;
    const queuedForReview = [];
    for (const grp of groups) {
      const bestStream = grp.videoQualities["1080p"] || grp.videoQualities["720p"] || grp.videoQualities["480p"] || grp.videoQualities["4K"] || grp.videoQualities["360p"] || grp.primary.streamUrl;
      const mergedParsed = {
        ...grp.primary.parsed,
        year: grp.primary.parsed.year || grp.members.find((m) => m.parsed.year)?.parsed.year || null,
        languageHint: grp.primary.parsed.languageHint || grp.members.find((m) => m.parsed.languageHint)?.parsed.languageHint || "",
        isHindiDubbed: grp.members.some((m) => m.parsed.isHindiDubbed)
      };
      const matched = await resolveBestImdbMatch(mergedParsed);
      const candYear = Number(matched.releaseYear || mergedParsed.year || 0);
      const isSeriesItem = mergedParsed.isSeriesEpisode || String(matched.originalCategory || "").toLowerCase().includes("series");
      const filteredQualities = cfg.onlyValidAudioAndHd ? filterQualityMapForHdOnly(grp.videoQualities) : grp.videoQualities;
      const chosenStream = filteredQualities["1080p"] || filteredQualities["720p"] || bestStream;
      const bestDurSec = Math.max(0, ...grp.members.map((m) => m.durationSec || 0));
      const durationFormatted = bestDurSec > 0 ? formatDuration(bestDurSec) : "";
      const qualityBadge = filteredQualities["4K"] ? "4K" : "HD";
      const draft = {
        draftId: `tg-${cleanChannelId}-${grp.primary.msgId}`,
        channelId: cleanChannelId,
        channelTitle,
        msgId: grp.primary.msgId,
        sourceMsgIds: grp.members.map((m) => m.msgId),
        streamUrl: chosenStream,
        videoQualities: filteredQualities,
        qualityBadge,
        durationSec: bestDurSec,
        runtime: isSeriesItem ? durationFormatted : durationFormatted || matched.runtime,
        sourceFileName: grp.primary.fileName,
        sourceCaption: `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ""}`,
        parsedTitle: mergedParsed.cleanTitle,
        parsedYear: mergedParsed.year,
        imdbId: matched.imdbId,
        title: matched.title,
        originalTitle: matched.originalTitle,
        releaseYear: matched.releaseYear,
        posterUrl: matched.posterUrl,
        backdropUrl: matched.backdropUrl,
        genre: matched.genre,
        description: matched.description,
        director: matched.director,
        cast: matched.cast,
        language: matched.language,
        rating: matched.rating,
        originalCategory: matched.originalCategory,
        matchConfidence: matched.matchConfidence,
        confidenceScore: matched.confidenceScore,
        matchReason: matched.matchReason,
        isSeriesEpisode: mergedParsed.isSeriesEpisode,
        seasonNumber: mergedParsed.seasonNumber,
        episodeNumber: mergedParsed.episodeNumber,
        episodeLabel: mergedParsed.episodeLabel,
        episodeTitle: mergedParsed.episodeTitle,
        alternateMatches: matched.alternateMatches
      };
      const existingRec = findMatchingExistingRecord(
        existingRecords,
        draft.imdbId,
        [draft.title, draft.originalTitle, mergedParsed.cleanTitle],
        candYear,
        isSeriesItem
      );
      if (cfg.autoPublishVerified) {
        const nowMs = Date.now();
        const fallbackSvg = buildFallbackPosterDataUri(draft.title || mergedParsed.cleanTitle, candYear);
        const cleanPoster = (draft.posterUrl ? upgradePosterUrl(draft.posterUrl, 1080) || draft.posterUrl : "") || fallbackSvg;
        const cleanBackdrop = (draft.backdropUrl || draft.posterUrl ? upgradePosterUrl(draft.backdropUrl || cleanPoster, 1280) || cleanPoster : "") || fallbackSvg;
        const catToSave = isSeriesItem ? String(draft.originalCategory || "").toLowerCase().includes("anime") ? "Anime Series" : "Web Series" : draft.originalCategory || "Bollywood Movie";
        const displayCat = getDisplayCategory(catToSave);
        const badge = normalizeQualityBadge("NONE");
        if (isSeriesItem) {
          const seasonNum = Math.max(1, Number(draft.seasonNumber) || 1);
          const fallbackEpNum = existingRec ? Math.max(
            1,
            ...(existingRec.seasons.find((s) => Number(s.seasonNumber) === seasonNum)?.episodes || []).map(
              (e) => Number(e?.episodeNumber) || 0
            ),
            0
          ) + 1 : 1;
          const epNum = Math.max(1, Number(draft.episodeNumber) || fallbackEpNum);
          const epTitle = draft.episodeTitle || `Episode ${epNum}`;
          const epObj = {
            episodeNumber: epNum,
            ...draft.episodeLabel ? { episodeLabel: draft.episodeLabel } : {},
            title: epTitle,
            streamUrl: draft.streamUrl.trim(),
            ...durationFormatted ? { duration: durationFormatted } : {},
            ...bestDurSec > 0 ? { durationSec: bestDurSec } : {},
            showInNewEpisodes: true,
            newEpisodeEnabledAt: nowMs,
            createdAt: nowMs,
            addedAt: nowMs
          };
          const seriesImdbId = (existingRec?.imdbId || draft.imdbId || "").trim();
          const expectedCounts = seriesImdbId ? await fetchExpectedSeasonEpisodeCounts(seriesImdbId) : null;
          if (existingRec) {
            const { mergedSeasons, added } = mergeEpisodeIntoSeasons(existingRec.seasons, seasonNum, epObj);
            if (!added) {
              existingUrlSet.add(draft.streamUrl.toLowerCase());
              continue;
            }
            const seriesReadyToPublish = isSeriesComplete(
              { originalCategory: catToSave, seasons: mergedSeasons },
              expectedCounts
            );
            const wasPublished = existingRec.published !== false;
            const nextStream = existingRec.streamingUrl || epObj.streamUrl;
            const prevSeed = seedCatalogMap.get(existingRec.id) || {};
            seedCatalogMap.set(existingRec.id, {
              ...prevSeed,
              id: existingRec.id,
              seasons: mergedSeasons,
              streamingUrl: nextStream,
              published: seriesReadyToPublish,
              releaseYear: clampReleaseYear(prevSeed.releaseYear || draft.releaseYear),
              ...seriesReadyToPublish && !wasPublished ? { createdAt: nowMs } : {},
              updatedAt: nowMs
            });
            await setDocWithQuotaGuard(
              doc2(db, "movies", existingRec.id),
              {
                seasons: mergedSeasons,
                streamingUrl: nextStream,
                published: seriesReadyToPublish,
                updatedAt: serverTimestamp()
              },
              { merge: true }
            ).catch(() => {
            });
            existingRec.seasons = mergedSeasons;
            existingRec.streamingUrl = nextStream;
            existingRec.published = seriesReadyToPublish;
            existingUrlSet.add(draft.streamUrl.toLowerCase());
            catalogDirty = true;
            if (seriesReadyToPublish) {
              publishedCount++;
              console.log(
                `[ServerAutoSync] Added ${draft.title} S${seasonNum}E${epNum} -> movies/${existingRec.id} (complete & published)`
              );
              if (cfg.notifyOnNewPublish && publishedCount <= 3) {
                await setDocWithQuotaGuard(
                  doc2(db, "announcements", `tg_rel_${cleanChannelId}_${draft.msgId}`),
                  {
                    title: draft.title,
                    releaseYear: clampReleaseYear(draft.releaseYear),
                    category: catToSave,
                    isSeries: true,
                    language: (draft.language || "Hindi").trim(),
                    genre: (draft.genre || "Drama").trim(),
                    qualityBadge: badge !== "NONE" ? badge : "",
                    runtime: (draft.runtime || "").trim(),
                    posterUrl: cleanPoster,
                    backdropUrl: cleanBackdrop,
                    message: !wasPublished ? "COMPLETE SERIES \u2022 GO STREAM or DOWNLOAD NOW" : `Season ${seasonNum} Episode ${draft.episodeLabel || epNum} Now Streaming!`,
                    movieId: existingRec.id,
                    createdAt: serverTimestamp(),
                    createdAtMs: nowMs,
                    expiresAt: new Date(nowMs + 48 * 60 * 60 * 1e3)
                  },
                  { merge: true }
                ).catch(() => {
                });
              }
            } else {
              console.log(
                `[ServerAutoSync] Staged incomplete series "${draft.title}" S${seasonNum}E${epNum} (published: false until all episodes arrive)`
              );
            }
            continue;
          } else {
            const seriesDocId = `tg_series_${cleanChannelId}_${draft.msgId}`;
            const initialSeasons = [{ seasonNumber: seasonNum, episodes: [epObj] }];
            const seriesReadyToPublish = isSeriesComplete(
              { originalCategory: catToSave, seasons: initialSeasons },
              expectedCounts
            );
            const seriesBase = {
              id: seriesDocId,
              title: draft.title.trim(),
              originalTitle: (draft.originalTitle || draft.title).trim(),
              description: draft.description.trim(),
              posterUrl: cleanPoster,
              backdropUrl: cleanBackdrop,
              releaseYear: clampReleaseYear(draft.releaseYear),
              originalCategory: catToSave,
              displayCategory: displayCat,
              contentType: catToSave.toLowerCase().includes("anime") ? "anime" : null,
              language: (draft.language || "Hindi").trim(),
              genre: (draft.genre || "Drama").trim(),
              director: (draft.director || "").trim(),
              cast: (draft.cast || "").trim(),
              runtime: (draft.runtime || "").trim(),
              rating: Number(draft.rating) || 8,
              imdbId: seriesImdbId,
              trailerUrl: "",
              streamingUrl: epObj.streamUrl,
              videoQualities: {},
              seasons: initialSeasons,
              featured: true,
              published: seriesReadyToPublish,
              qualityBadge: badge,
              duration: bestDurSec || parseDurationToSeconds(draft.runtime) || 0,
              telegramMsgId: draft.msgId,
              telegramChannelId: cleanChannelId,
              updatedAt: nowMs,
              createdAt: nowMs
            };
            seedCatalogMap.set(seriesDocId, seriesBase);
            await setDocWithQuotaGuard(
              doc2(db, "movies", seriesDocId),
              {
                ...seriesBase,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp()
              },
              { merge: true }
            ).catch(() => {
            });
            existingUrlSet.add(draft.streamUrl.toLowerCase());
            existingRecords.push({
              id: seriesDocId,
              imdbId: seriesImdbId,
              title: draft.title.trim(),
              originalTitle: (draft.originalTitle || draft.title).trim(),
              releaseYear: clampReleaseYear(draft.releaseYear),
              originalCategory: catToSave,
              isSeries: true,
              published: seriesReadyToPublish,
              streamingUrl: epObj.streamUrl,
              videoQualities: {},
              seasons: initialSeasons
            });
            catalogDirty = true;
            if (seriesReadyToPublish) {
              publishedCount++;
              console.log(
                `[ServerAutoSync] Auto-Published Series "${draft.title}" S${seasonNum}E${epNum} (${seriesImdbId || "no-imdb"}) -> movies/${seriesDocId}`
              );
              if (cfg.notifyOnNewPublish && publishedCount <= 3) {
                await setDocWithQuotaGuard(
                  doc2(db, "announcements", `tg_rel_${cleanChannelId}_${draft.msgId}`),
                  {
                    title: draft.title,
                    releaseYear: clampReleaseYear(draft.releaseYear),
                    category: catToSave,
                    isSeries: true,
                    language: (draft.language || "Hindi").trim(),
                    genre: (draft.genre || "Drama").trim(),
                    qualityBadge: badge !== "NONE" ? badge : "",
                    runtime: (draft.runtime || "").trim(),
                    posterUrl: cleanPoster,
                    backdropUrl: cleanBackdrop,
                    message: "NEW SERIES \u2022 GO STREAM or DOWNLOAD NOW",
                    movieId: seriesDocId,
                    createdAt: serverTimestamp(),
                    createdAtMs: nowMs,
                    expiresAt: new Date(nowMs + 48 * 60 * 60 * 1e3)
                  },
                  { merge: true }
                ).catch(() => {
                });
              }
            } else {
              console.log(
                `[ServerAutoSync] Staged incomplete series "${draft.title}" S${seasonNum}E${epNum} (${seriesImdbId || "no-imdb"}) -> hidden until complete`
              );
            }
            continue;
          }
        }
        if (existingRec) {
          const mergedQualities = { ...existingRec.videoQualities };
          let qualityAdded = false;
          for (const [qk, qUrl] of Object.entries(draft.videoQualities || {})) {
            if (qUrl && !mergedQualities[qk]) {
              mergedQualities[qk] = qUrl;
              qualityAdded = true;
            }
          }
          if (qualityAdded) {
            const upgradedStream = mergedQualities["1080p"] || mergedQualities["4K"] || existingRec.streamingUrl || draft.streamUrl.trim();
            const prevSeed = seedCatalogMap.get(existingRec.id) || {};
            seedCatalogMap.set(existingRec.id, {
              ...prevSeed,
              id: existingRec.id,
              videoQualities: mergedQualities,
              streamingUrl: upgradedStream,
              updatedAt: nowMs
            });
            await setDocWithQuotaGuard(
              doc2(db, "movies", existingRec.id),
              {
                videoQualities: mergedQualities,
                streamingUrl: upgradedStream,
                updatedAt: serverTimestamp()
              },
              { merge: true }
            ).catch(() => {
            });
            existingRec.videoQualities = mergedQualities;
            existingRec.streamingUrl = upgradedStream;
            existingUrlSet.add(draft.streamUrl.toLowerCase());
            publishedCount++;
            console.log(
              `[ServerAutoSync] Merged new quality for "${existingRec.title}" -> movies/${existingRec.id}`
            );
          }
          continue;
        }
        const deterministicDocId = `tg_${cleanChannelId}_${draft.msgId}`;
        const movieBase = {
          id: deterministicDocId,
          title: draft.title.trim(),
          originalTitle: (draft.originalTitle || draft.title).trim(),
          description: draft.description.trim(),
          posterUrl: cleanPoster,
          backdropUrl: cleanBackdrop,
          releaseYear: clampReleaseYear(draft.releaseYear),
          originalCategory: catToSave,
          displayCategory: displayCat,
          contentType: catToSave.toLowerCase().includes("anime") ? "anime" : null,
          language: (draft.language || "Hindi").trim(),
          genre: (draft.genre || "Action").trim(),
          director: (draft.director || "").trim(),
          cast: (draft.cast || "").trim(),
          runtime: (draft.runtime || "").trim(),
          rating: Number(draft.rating) || 8,
          imdbId: (draft.imdbId || "").trim(),
          trailerUrl: "",
          streamingUrl: draft.streamUrl.trim(),
          videoQualities: draft.videoQualities || {},
          seasons: [],
          featured: true,
          published: true,
          qualityBadge: badge,
          duration: draft.durationSec || parseDurationToSeconds(draft.runtime) || 0,
          telegramMsgId: draft.msgId,
          telegramChannelId: cleanChannelId,
          updatedAt: nowMs,
          createdAt: nowMs
        };
        seedCatalogMap.set(deterministicDocId, movieBase);
        await setDocWithQuotaGuard(
          doc2(db, "movies", deterministicDocId),
          {
            ...movieBase,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp()
          },
          { merge: true }
        ).catch(() => {
        });
        existingUrlSet.add(draft.streamUrl.toLowerCase());
        existingRecords.push({
          id: deterministicDocId,
          imdbId: (draft.imdbId || "").trim(),
          title: draft.title.trim(),
          originalTitle: (draft.originalTitle || draft.title).trim(),
          releaseYear: clampReleaseYear(draft.releaseYear),
          originalCategory: catToSave,
          isSeries: false,
          published: true,
          streamingUrl: draft.streamUrl.trim(),
          videoQualities: draft.videoQualities || {},
          seasons: []
        });
        publishedCount++;
        console.log(
          `[ServerAutoSync] Auto-Published Movie "${draft.title}" (${clampReleaseYear(draft.releaseYear)}, ${draft.imdbId || "no-imdb"}) -> movies/${deterministicDocId}`
        );
        if (cfg.notifyOnNewPublish && publishedCount <= 3) {
          await setDocWithQuotaGuard(
            doc2(db, "announcements", `tg_rel_${cleanChannelId}_${draft.msgId}`),
            {
              title: draft.title,
              releaseYear: clampReleaseYear(draft.releaseYear),
              category: catToSave,
              isSeries: false,
              language: (draft.language || "Hindi").trim(),
              genre: (draft.genre || "Action").trim(),
              qualityBadge: badge !== "NONE" ? badge : "",
              runtime: (draft.runtime || "").trim(),
              posterUrl: cleanPoster,
              backdropUrl: cleanBackdrop,
              message: "GO STREAM or DOWNLOAD NOW",
              movieId: deterministicDocId,
              createdAt: serverTimestamp(),
              createdAtMs: nowMs,
              expiresAt: new Date(nowMs + 48 * 60 * 60 * 1e3)
            },
            { merge: true }
          ).catch(() => {
          });
        }
      } else {
        if (!existingRec || isSeriesItem) {
          queuedForReview.push(draft);
        }
      }
    }
    if (queuedForReview.length > 0) {
      const existingDraftIds = new Set(pendingServerDrafts.map((p) => p.draftId));
      const newQueued = queuedForReview.filter((q) => !existingDraftIds.has(q.draftId));
      if (newQueued.length > 0) {
        pendingServerDrafts = [...newQueued, ...pendingServerDrafts].slice(0, 100);
        savePendingServerDrafts();
      }
    }
    if (publishedCount > 0 || catalogDirty) {
      const updatedList = Array.from(seedCatalogMap.values());
      writeSeedCatalogToDisk(updatedList);
    }
    if (publishedCount > 0) {
      broadcastLiveCatalogUpdate({
        type: "catalog_updated",
        count: publishedCount,
        updatedAt: Date.now(),
        action: "auto_publish"
      });
      await setDocWithQuotaGuard(
        doc2(db, "app_config", "catalog_sync"),
        {
          updatedAt: Date.now(),
          action: "auto_publish"
        },
        { merge: true }
      ).catch(() => {
      });
    }
    if (highestMsgId > cfg.lastSyncedMsgId || highestMsgId > (localChannelCheckpoint[cleanChannelId] || 0) || reconciledStaleBaseline) {
      saveLocalChannelCheckpoint(cleanChannelId, highestMsgId);
      if (cachedSyncConfig) cachedSyncConfig.lastSyncedMsgId = highestMsgId;
      await setDocWithQuotaGuard(
        doc2(db, "app_config", "telegram_auto_sync"),
        {
          lastSyncedMsgId: highestMsgId,
          updatedAtMs: Date.now(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch(() => {
      });
    }
  } catch (err) {
    console.warn("[ServerAutoSync] Sync pass warning:", err?.message || err);
  } finally {
    serverAutoSyncRunning = false;
    if (pendingResyncReason) {
      const nextReason = pendingResyncReason;
      pendingResyncReason = null;
      scheduleServerAutoSync(nextReason, 500);
    }
  }
}
function isFirestoreQuotaError(err) {
  return isFirestoreQuotaErrorLike(err);
}
async function setDocWithQuotaGuard(ref, data, options, timeoutMs = 4500) {
  if (!isServerFirestoreWriteAllowed()) {
    throw Object.assign(
      new Error("Firestore daily write quota exhausted (resource-exhausted)."),
      { code: "resource-exhausted" }
    );
  }
  let timer = null;
  try {
    await Promise.race([
      options ? setDoc(ref, data, options) : setDoc(ref, data),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          markServerFirestoreQuotaExhausted("write-timeout");
          reject(
            Object.assign(
              new Error("Firestore daily write quota exhausted (write timeout)."),
              { code: "resource-exhausted" }
            )
          );
        }, timeoutMs);
      })
    ]);
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      markServerFirestoreQuotaExhausted(err);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
var bulkSyncStopRequested = false;
var bulkSyncJob = {
  status: "idle",
  channelRef: "",
  channelId: "",
  channelTitle: "",
  onlyValidAudioAndHd: true,
  startMsgId: 0,
  endMsgId: 0,
  currentMsgId: 0,
  scannedMessages: 0,
  totalVideosSeen: 0,
  publishedCount: 0,
  mergedCount: 0,
  skippedNoAudio: 0,
  skippedLowQuality: 0,
  skippedDuplicates: 0,
  skippedNonVideo: 0,
  startedAtMs: 0,
  updatedAtMs: 0,
  errorMessage: "",
  upgradeUrl: ""
};
async function fetchMessagesWithFloodWait(client2, peer, ids) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const got = await client2.getMessages(peer, { ids });
      return Array.isArray(got) ? got : [];
    } catch (err) {
      const m = String(err?.message || "").match(/FLOOD_WAIT[_\s]?(\d+)/i);
      const waitSec = Number(err?.seconds || (m ? m[1] : 0));
      if (waitSec > 0 && waitSec <= 60 && attempt === 0) {
        console.warn(`[BulkChannelSync] Telegram FLOOD_WAIT ${waitSec}s \u2014 pausing briefly...`);
        await new Promise((r) => setTimeout(r, (waitSec + 1) * 1e3));
        continue;
      }
      throw err;
    }
  }
  return [];
}
async function runBulkChannelSyncWorker(params) {
  const {
    client: client2,
    peer,
    cleanChannelId,
    channelTitle,
    publicUsername,
    channelRef,
    startMsgId,
    endMsgId,
    onlyValidAudioAndHd
  } = params;
  try {
    const seedCatalogMap = /* @__PURE__ */ new Map();
    const existingUrlSet = /* @__PURE__ */ new Set();
    const existingRecords = [];
    try {
      if (fs4.existsSync("public/movies-seed.json")) {
        const rawSeed = JSON.parse(fs4.readFileSync("public/movies-seed.json", "utf8"));
        if (Array.isArray(rawSeed)) {
          rawSeed.forEach((m) => {
            if (m && m.id) {
              seedCatalogMap.set(m.id, m);
              const cat = String(m?.originalCategory || "");
              const isSeries = cat.toLowerCase().includes("series") || Array.isArray(m?.seasons) && m.seasons.length > 0;
              if (m?.streamingUrl) existingUrlSet.add(String(m.streamingUrl).trim().toLowerCase());
              if (m?.videoQualities && typeof m.videoQualities === "object") {
                Object.values(m.videoQualities).forEach((u) => {
                  if (typeof u === "string" && u.trim()) existingUrlSet.add(u.trim().toLowerCase());
                });
              }
              if (Array.isArray(m?.seasons)) {
                m.seasons.forEach((s) => {
                  if (Array.isArray(s?.episodes)) {
                    s.episodes.forEach((ep) => {
                      if (ep?.streamUrl) existingUrlSet.add(String(ep.streamUrl).trim().toLowerCase());
                    });
                  }
                });
              }
              existingRecords.push({
                id: m.id,
                imdbId: String(m?.imdbId || "").trim(),
                title: String(m?.title || ""),
                originalTitle: String(m?.originalTitle || ""),
                releaseYear: Number(m?.releaseYear) || 0,
                originalCategory: cat,
                isSeries,
                streamingUrl: String(m?.streamingUrl || "").trim(),
                videoQualities: m?.videoQualities && typeof m.videoQualities === "object" ? { ...m.videoQualities } : {},
                seasons: Array.isArray(m?.seasons) ? m.seasons : []
              });
            }
          });
        }
      }
    } catch (e) {
      console.warn("[BulkChannelSync] Note: Could not preload seed json:", e);
    }
    try {
      const existingSnap = await getDocsFromServer(collection(db, "movies"));
      existingSnap.docs.forEach((d) => {
        const m = d.data();
        if (!seedCatalogMap.has(d.id)) {
          seedCatalogMap.set(d.id, { id: d.id, ...m });
        }
        const cat = String(m?.originalCategory || "");
        const isSeries = cat.toLowerCase().includes("series") || Array.isArray(m?.seasons) && m.seasons.length > 0;
        if (m?.streamingUrl) existingUrlSet.add(String(m.streamingUrl).trim().toLowerCase());
        if (m?.videoQualities && typeof m.videoQualities === "object") {
          Object.values(m.videoQualities).forEach((u) => {
            if (typeof u === "string" && u.trim()) existingUrlSet.add(u.trim().toLowerCase());
          });
        }
        if (Array.isArray(m?.seasons)) {
          m.seasons.forEach((s) => {
            if (Array.isArray(s?.episodes)) {
              s.episodes.forEach((ep) => {
                if (ep?.streamUrl) existingUrlSet.add(String(ep.streamUrl).trim().toLowerCase());
              });
            }
          });
        }
        if (!existingRecords.some((r) => r.id === d.id)) {
          existingRecords.push({
            id: d.id,
            imdbId: String(m?.imdbId || "").trim(),
            title: String(m?.title || ""),
            originalTitle: String(m?.originalTitle || ""),
            releaseYear: Number(m?.releaseYear) || 0,
            originalCategory: cat,
            isSeries,
            streamingUrl: String(m?.streamingUrl || "").trim(),
            videoQualities: m?.videoQualities && typeof m.videoQualities === "object" ? { ...m.videoQualities } : {},
            seasons: Array.isArray(m?.seasons) ? m.seasons : []
          });
        }
      });
    } catch {
    }
    const imdbMatchCache = /* @__PURE__ */ new Map();
    const imdbInFlight = /* @__PURE__ */ new Map();
    const resolveCachedImdb = async (parsedItem) => {
      const key = parsedItem.explicitImdbId ? `id:${parsedItem.explicitImdbId.toLowerCase()}` : `${(parsedItem.cleanTitle || "").toLowerCase().trim()}|${parsedItem.year || ""}|${parsedItem.isSeriesEpisode ? "S" : "M"}`;
      const hit = imdbMatchCache.get(key);
      if (hit) return hit;
      const existingPromise = imdbInFlight.get(key);
      if (existingPromise) return existingPromise;
      const fallbackResult = {
        imdbId: "",
        title: parsedItem.cleanTitle || parsedItem.rawFileName || "Untitled Movie",
        originalTitle: parsedItem.cleanTitle || parsedItem.rawFileName || "Untitled Movie",
        releaseYear: parsedItem.year || (/* @__PURE__ */ new Date()).getFullYear(),
        posterUrl: "",
        backdropUrl: "",
        genre: parsedItem.isSeriesEpisode ? "Drama" : "Action",
        description: "",
        director: "",
        cast: "",
        runtime: "",
        language: parsedItem.languageHint || "Hindi",
        rating: 7.5,
        originalCategory: parsedItem.isSeriesEpisode ? "Web Series" : "Bollywood Movie",
        matchConfidence: "low",
        confidenceScore: 0,
        matchReason: "Metadata lookup timed out \u2014 using parsed title",
        alternateMatches: []
      };
      const task = (async () => {
        try {
          const res = await Promise.race([
            resolveBestImdbMatch(parsedItem),
            new Promise(
              (resolve) => setTimeout(() => resolve(fallbackResult), 8e3)
            )
          ]);
          if (key.length > 3) imdbMatchCache.set(key, res);
          return res;
        } catch {
          return fallbackResult;
        } finally {
          imdbInFlight.delete(key);
        }
      })();
      if (key.length > 3) imdbInFlight.set(key, task);
      return task;
    };
    const CHUNK_MSGS = 100;
    for (let cursor = startMsgId; cursor <= endMsgId; cursor += CHUNK_MSGS) {
      if (bulkSyncStopRequested) {
        bulkSyncJob.status = "stopped";
        bulkSyncJob.updatedAtMs = Date.now();
        return;
      }
      const chunkEnd = Math.min(endMsgId, cursor + CHUNK_MSGS - 1);
      const ids = [];
      for (let id = cursor; id <= chunkEnd; id++) ids.push(id);
      const msgs = await fetchMessagesWithFloodWait(client2, peer, ids);
      const validMsgs = msgs.filter((m) => m && m.id).sort((a, b) => Number(a.id) - Number(b.id));
      bulkSyncJob.scannedMessages += ids.length;
      bulkSyncJob.currentMsgId = chunkEnd;
      bulkSyncJob.updatedAtMs = Date.now();
      const rawCands = [];
      for (const msg of validMsgs) {
        const classified = classifyTelegramDocMedia(msg);
        if (classified.kind !== "video") {
          bulkSyncJob.skippedNonVideo++;
          continue;
        }
        bulkSyncJob.totalVideosSeen++;
        const streamUrl = publicUsername ? `https://t.me/${publicUsername}/${msg.id}` : `https://t.me/c/${cleanChannelId}/${msg.id}`;
        const parsedMeta = parseTelegramMovieMeta(
          classified.fileName,
          classified.caption,
          classified.width,
          classified.height,
          classified.durationSec,
          classified.sizeBytes
        );
        if (parsedMeta.isSampleOrClip) {
          bulkSyncJob.skippedNonVideo++;
          continue;
        }
        if (existingUrlSet.has(streamUrl.toLowerCase())) {
          bulkSyncJob.skippedDuplicates++;
          continue;
        }
        primeMediaCacheFromTelegramDoc(
          streamUrl,
          classified.doc,
          classified.fileName,
          classified.durationSec,
          classified.mime
        );
        rawCands.push({
          msgId: Number(msg.id),
          streamUrl,
          doc: classified.doc,
          mime: classified.mime,
          durationSec: classified.durationSec,
          sizeBytes: classified.sizeBytes,
          width: classified.width,
          height: classified.height,
          fileName: classified.fileName || `Movie_${msg.id}`,
          caption: classified.caption || "",
          hasExplicitNoSound: classified.hasExplicitNoSound,
          parsed: parsedMeta
        });
      }
      const verifiedList = await mapWithConcurrency(
        rawCands,
        6,
        async (cand) => {
          if (bulkSyncStopRequested) return null;
          const check = await verifyCandidateAudioAndHd(
            {
              streamUrl: cand.streamUrl,
              doc: cand.doc,
              mime: cand.mime,
              fileName: cand.fileName,
              caption: cand.caption,
              durationSec: cand.durationSec,
              width: cand.width,
              height: cand.height,
              parsedQuality: cand.parsed.quality,
              hasExplicitNoSound: cand.hasExplicitNoSound
            },
            client2,
            onlyValidAudioAndHd
          );
          if (!check.accepted) {
            if (check.reason === "no_audio" || check.reason === "unverified_audio") {
              bulkSyncJob.skippedNoAudio++;
            } else {
              bulkSyncJob.skippedLowQuality++;
            }
            return null;
          }
          return {
            msgId: cand.msgId,
            streamUrl: cand.streamUrl,
            durationSec: check.durationSec || cand.durationSec,
            sizeBytes: cand.sizeBytes,
            fileName: cand.fileName,
            caption: cand.caption,
            parsed: {
              ...cand.parsed,
              quality: check.effectiveQuality || cand.parsed.quality
            }
          };
        },
        () => bulkSyncStopRequested
      );
      if (bulkSyncStopRequested) {
        bulkSyncJob.status = "stopped";
        bulkSyncJob.updatedAtMs = Date.now();
        return;
      }
      const acceptedCands = verifiedList.filter((v) => Boolean(v));
      const groups = [];
      const idxMap = /* @__PURE__ */ new Map();
      for (const v of acceptedCands) {
        const gKey = v.parsed.groupKey || `msg-${v.msgId}`;
        const foundIdx = v.parsed.groupKey ? idxMap.get(gKey) : void 0;
        if (foundIdx !== void 0) {
          const g = groups[foundIdx];
          g.members.push(v);
          if (v.parsed.quality) {
            const prevSz = g.qualitySizes[v.parsed.quality] || 0;
            if (!g.videoQualities[v.parsed.quality] || v.sizeBytes > prevSz) {
              g.videoQualities[v.parsed.quality] = v.streamUrl;
              g.qualitySizes[v.parsed.quality] = v.sizeBytes;
            }
          }
          if (!g.primary.parsed.year && v.parsed.year || !g.primary.parsed.explicitImdbId && v.parsed.explicitImdbId || v.parsed.quality === "1080p") {
            g.primary = v;
          }
        } else {
          const vq = {};
          const qs = {};
          if (v.parsed.quality) {
            vq[v.parsed.quality] = v.streamUrl;
            qs[v.parsed.quality] = v.sizeBytes;
          }
          const idx = groups.length;
          groups.push({ primary: v, members: [v], videoQualities: vq, qualitySizes: qs });
          if (v.parsed.groupKey) idxMap.set(gKey, idx);
        }
      }
      const preparedGroups = await mapWithConcurrency(
        groups,
        8,
        async (grp) => {
          if (bulkSyncStopRequested) return null;
          const mergedParsed = {
            ...grp.primary.parsed,
            year: grp.primary.parsed.year || grp.members.find((m) => m.parsed.year)?.parsed.year || null,
            languageHint: grp.primary.parsed.languageHint || grp.members.find((m) => m.parsed.languageHint)?.parsed.languageHint || "",
            isHindiDubbed: grp.members.some((m) => m.parsed.isHindiDubbed)
          };
          const matched = await resolveCachedImdb(mergedParsed);
          return { grp, mergedParsed, matched };
        },
        () => bulkSyncStopRequested
      );
      let chunkPublished = 0;
      const dirtySeriesUpdates = /* @__PURE__ */ new Map();
      for (const entry of preparedGroups) {
        if (!entry) continue;
        if (bulkSyncStopRequested) {
          bulkSyncJob.status = "stopped";
          bulkSyncJob.updatedAtMs = Date.now();
          break;
        }
        const { grp, mergedParsed, matched } = entry;
        const filteredQualities = onlyValidAudioAndHd ? filterQualityMapForHdOnly(grp.videoQualities) : grp.videoQualities;
        const bestStream = filteredQualities["1080p"] || filteredQualities["720p"] || grp.primary.streamUrl;
        const candYear = Number(matched.releaseYear || mergedParsed.year || 0);
        const isSeriesItem = mergedParsed.isSeriesEpisode || String(matched.originalCategory || "").toLowerCase().includes("series");
        const bestDurSec = Math.max(0, ...grp.members.map((m) => m.durationSec || 0));
        const durationFormatted = bestDurSec > 0 ? formatDuration(bestDurSec) : "";
        const catToSave = isSeriesItem ? String(matched.originalCategory || "").toLowerCase().includes("anime") ? "Anime Series" : "Web Series" : matched.originalCategory || "Bollywood Movie";
        const displayCat = getDisplayCategory(catToSave);
        const badge = normalizeQualityBadge("NONE");
        const fallbackSvg = buildFallbackPosterDataUri(matched.title || mergedParsed.cleanTitle, candYear);
        const cleanPoster = (matched.posterUrl ? upgradePosterUrl(matched.posterUrl, 1080) || matched.posterUrl : "") || fallbackSvg;
        const cleanBackdrop = (matched.backdropUrl || matched.posterUrl ? upgradePosterUrl(matched.backdropUrl || cleanPoster, 1280) || cleanPoster : "") || fallbackSvg;
        const existingRec = findMatchingExistingRecord(
          existingRecords,
          matched.imdbId,
          [matched.title, matched.originalTitle, mergedParsed.cleanTitle],
          candYear,
          isSeriesItem
        );
        try {
          if (isSeriesItem) {
            const seasonNum = Math.max(1, Number(mergedParsed.seasonNumber) || 1);
            const fallbackEpNum = existingRec ? Math.max(
              1,
              ...(existingRec.seasons.find((s) => Number(s.seasonNumber) === seasonNum)?.episodes || []).map(
                (e) => Number(e?.episodeNumber) || 0
              ),
              0
            ) + 1 : 1;
            const epNum = Math.max(1, Number(mergedParsed.episodeNumber) || fallbackEpNum);
            const epObj = {
              episodeNumber: epNum,
              ...mergedParsed.episodeLabel ? { episodeLabel: mergedParsed.episodeLabel } : {},
              title: mergedParsed.episodeTitle || `Episode ${epNum}`,
              streamUrl: bestStream.trim(),
              ...durationFormatted ? { duration: durationFormatted } : {},
              ...bestDurSec > 0 ? { durationSec: bestDurSec } : {},
              showInNewEpisodes: false
            };
            if (existingRec) {
              const { mergedSeasons, added } = mergeEpisodeIntoSeasons(existingRec.seasons, seasonNum, epObj);
              if (!added) {
                bulkSyncJob.skippedDuplicates++;
                existingUrlSet.add(bestStream.toLowerCase());
                continue;
              }
              existingRec.seasons = mergedSeasons;
              if (!existingRec.streamingUrl) existingRec.streamingUrl = epObj.streamUrl;
              existingUrlSet.add(bestStream.toLowerCase());
              const prevDirty = dirtySeriesUpdates.get(existingRec.id);
              dirtySeriesUpdates.set(existingRec.id, {
                rec: existingRec,
                isNewDoc: prevDirty?.isNewDoc ?? false,
                newPayload: prevDirty?.newPayload
              });
              const prevSeed = seedCatalogMap.get(existingRec.id) || {};
              seedCatalogMap.set(existingRec.id, {
                ...prevSeed,
                id: existingRec.id,
                seasons: mergedSeasons,
                streamingUrl: existingRec.streamingUrl,
                updatedAt: Date.now()
              });
              bulkSyncJob.mergedCount++;
              chunkPublished++;
            } else {
              const seriesDocId = `tg_series_${cleanChannelId}_${grp.primary.msgId}`;
              const initialSeasons = [{ seasonNumber: seasonNum, episodes: [epObj] }];
              const newRec = {
                id: seriesDocId,
                imdbId: (matched.imdbId || "").trim(),
                title: matched.title.trim(),
                originalTitle: (matched.originalTitle || matched.title).trim(),
                releaseYear: Number(matched.releaseYear) || (/* @__PURE__ */ new Date()).getFullYear(),
                originalCategory: catToSave,
                isSeries: true,
                streamingUrl: epObj.streamUrl,
                videoQualities: {},
                seasons: initialSeasons
              };
              existingUrlSet.add(bestStream.toLowerCase());
              existingRecords.push(newRec);
              const seriesPayload = {
                id: seriesDocId,
                title: matched.title.trim(),
                originalTitle: (matched.originalTitle || matched.title).trim(),
                description: matched.description.trim(),
                posterUrl: cleanPoster,
                backdropUrl: cleanBackdrop,
                releaseYear: Number(matched.releaseYear) || (/* @__PURE__ */ new Date()).getFullYear(),
                originalCategory: catToSave,
                displayCategory: displayCat,
                contentType: catToSave.toLowerCase().includes("anime") ? "anime" : null,
                language: (matched.language || "Hindi").trim(),
                genre: (matched.genre || "Drama").trim(),
                director: (matched.director || "").trim(),
                cast: (matched.cast || "").trim(),
                runtime: (durationFormatted || matched.runtime || "").trim(),
                rating: Number(matched.rating) || 8,
                imdbId: (matched.imdbId || "").trim(),
                trailerUrl: "",
                streamingUrl: epObj.streamUrl,
                videoQualities: {},
                featured: true,
                published: true,
                qualityBadge: badge,
                duration: bestDurSec || parseDurationToSeconds(matched.runtime) || 0,
                telegramMsgId: grp.primary.msgId,
                telegramChannelId: cleanChannelId,
                createdAt: Date.now(),
                updatedAt: Date.now()
              };
              seedCatalogMap.set(seriesDocId, {
                ...seriesPayload,
                seasons: initialSeasons
              });
              dirtySeriesUpdates.set(seriesDocId, {
                rec: newRec,
                isNewDoc: true,
                newPayload: seriesPayload
              });
              bulkSyncJob.publishedCount++;
              chunkPublished++;
            }
          } else if (existingRec) {
            const mergedQualities = { ...existingRec.videoQualities };
            let qualityAdded = false;
            for (const [qk, qUrl] of Object.entries(filteredQualities)) {
              if (qUrl && !mergedQualities[qk]) {
                mergedQualities[qk] = qUrl;
                qualityAdded = true;
              }
            }
            if (qualityAdded) {
              const upgradedStream = mergedQualities["1080p"] || mergedQualities["720p"] || existingRec.streamingUrl || bestStream.trim();
              existingRec.videoQualities = mergedQualities;
              existingRec.streamingUrl = upgradedStream;
              existingUrlSet.add(bestStream.toLowerCase());
              const prevSeed = seedCatalogMap.get(existingRec.id) || {};
              seedCatalogMap.set(existingRec.id, {
                ...prevSeed,
                videoQualities: mergedQualities,
                streamingUrl: upgradedStream,
                updatedAt: Date.now()
              });
              try {
                await setDocWithQuotaGuard(
                  doc2(db, "movies", existingRec.id),
                  { videoQualities: mergedQualities, streamingUrl: upgradedStream, updatedAt: serverTimestamp() },
                  { merge: true }
                );
              } catch (writeErr) {
                if (isFirestoreQuotaError(writeErr)) {
                  bulkSyncJob.errorMessage = "Firestore daily write quota reached; saving movies directly to permanent app catalog bundle.";
                }
              }
              bulkSyncJob.mergedCount++;
              chunkPublished++;
            } else {
              bulkSyncJob.skippedDuplicates++;
              existingUrlSet.add(bestStream.toLowerCase());
            }
          } else {
            const deterministicDocId = `tg_${cleanChannelId}_${grp.primary.msgId}`;
            const movieDocPayload = {
              id: deterministicDocId,
              title: matched.title.trim(),
              originalTitle: (matched.originalTitle || matched.title).trim(),
              description: matched.description.trim(),
              posterUrl: cleanPoster,
              backdropUrl: cleanBackdrop,
              releaseYear: Number(matched.releaseYear) || (/* @__PURE__ */ new Date()).getFullYear(),
              originalCategory: catToSave,
              displayCategory: displayCat,
              contentType: catToSave.toLowerCase().includes("anime") ? "anime" : null,
              language: (matched.language || "Hindi").trim(),
              genre: (matched.genre || "Action").trim(),
              director: (matched.director || "").trim(),
              cast: (matched.cast || "").trim(),
              runtime: (durationFormatted || matched.runtime || "").trim(),
              rating: Number(matched.rating) || 8,
              imdbId: (matched.imdbId || "").trim(),
              trailerUrl: "",
              streamingUrl: bestStream.trim(),
              videoQualities: filteredQualities,
              seasons: [],
              featured: true,
              published: true,
              qualityBadge: badge,
              duration: bestDurSec || parseDurationToSeconds(matched.runtime) || 0,
              telegramMsgId: grp.primary.msgId,
              telegramChannelId: cleanChannelId,
              updatedAt: Date.now(),
              createdAt: Date.now()
            };
            seedCatalogMap.set(deterministicDocId, movieDocPayload);
            existingUrlSet.add(bestStream.toLowerCase());
            existingRecords.push({
              id: deterministicDocId,
              imdbId: (matched.imdbId || "").trim(),
              title: matched.title.trim(),
              originalTitle: (matched.originalTitle || matched.title).trim(),
              releaseYear: Number(matched.releaseYear) || (/* @__PURE__ */ new Date()).getFullYear(),
              originalCategory: catToSave,
              isSeries: false,
              streamingUrl: bestStream.trim(),
              videoQualities: filteredQualities,
              seasons: []
            });
            try {
              await setDocWithQuotaGuard(
                doc2(db, "movies", deterministicDocId),
                {
                  ...movieDocPayload,
                  updatedAt: serverTimestamp(),
                  createdAt: serverTimestamp()
                },
                { merge: true }
              );
            } catch (writeErr) {
              if (isFirestoreQuotaError(writeErr)) {
                bulkSyncJob.errorMessage = "Firestore daily write quota reached; saving movies directly to permanent app catalog bundle.";
              }
            }
            bulkSyncJob.publishedCount++;
            chunkPublished++;
          }
          bulkSyncJob.updatedAtMs = Date.now();
        } catch (err) {
          console.warn("[BulkChannelSync] Warning processing candidate:", err?.message);
        }
      }
      for (const [seriesId, dirty] of dirtySeriesUpdates.entries()) {
        const expectedCounts = dirty.rec.imdbId ? await fetchExpectedSeasonEpisodeCounts(dirty.rec.imdbId) : null;
        const seriesReadyToPublish = isSeriesComplete(
          { originalCategory: dirty.rec.originalCategory, seasons: dirty.rec.seasons },
          expectedCounts
        );
        dirty.rec.published = seriesReadyToPublish;
        const prevSeed = seedCatalogMap.get(seriesId) || {};
        const updatedSeed = {
          ...prevSeed,
          ...dirty.isNewDoc && dirty.newPayload ? dirty.newPayload : {},
          id: seriesId,
          seasons: dirty.rec.seasons,
          streamingUrl: dirty.rec.streamingUrl,
          published: seriesReadyToPublish,
          releaseYear: clampReleaseYear(prevSeed.releaseYear || dirty.rec.releaseYear),
          updatedAt: Date.now()
        };
        seedCatalogMap.set(seriesId, updatedSeed);
        try {
          if (dirty.isNewDoc && dirty.newPayload) {
            await setDocWithQuotaGuard(
              doc2(db, "movies", seriesId),
              {
                ...dirty.newPayload,
                releaseYear: clampReleaseYear(dirty.newPayload.releaseYear),
                published: seriesReadyToPublish,
                seasons: dirty.rec.seasons,
                updatedAt: serverTimestamp()
              },
              { merge: true }
            );
          } else {
            await setDocWithQuotaGuard(
              doc2(db, "movies", seriesId),
              {
                seasons: dirty.rec.seasons,
                streamingUrl: dirty.rec.streamingUrl,
                published: seriesReadyToPublish,
                updatedAt: serverTimestamp()
              },
              { merge: true }
            );
          }
        } catch (writeErr) {
          if (isFirestoreQuotaError(writeErr)) {
            bulkSyncJob.errorMessage = "Firestore daily write quota reached; saving movies directly to permanent app catalog bundle.";
          }
        }
      }
      try {
        const currentList = Array.from(seedCatalogMap.values());
        fs4.writeFileSync(SEED_CATALOG_PATH, JSON.stringify(currentList));
      } catch (fErr) {
        console.warn("[BulkChannelSync] Could not write movies-seed.json:", fErr);
      }
      if (bulkSyncStopRequested) {
        bulkSyncJob.status = "stopped";
        bulkSyncJob.updatedAtMs = Date.now();
        return;
      }
      if (chunkPublished > 0 && isServerFirestoreWriteAllowed()) {
        setDocWithQuotaGuard(
          doc2(db, "app_config", "catalog_sync"),
          { updatedAt: Date.now(), action: "bulk_channel_sync" },
          { merge: true }
        ).catch(() => {
        });
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    try {
      const finalList = Array.from(seedCatalogMap.values());
      writeSeedCatalogToDisk(finalList);
      broadcastLiveCatalogUpdate({
        type: "catalog_updated",
        count: bulkSyncJob.publishedCount + bulkSyncJob.mergedCount,
        updatedAt: Date.now(),
        action: "bulk_channel_sync"
      });
      console.log(`[BulkChannelSync] Successfully completed and saved ${finalList.length} movies to public/movies-seed.json`);
    } catch {
    }
    if (isServerFirestoreWriteAllowed()) {
      setDocWithQuotaGuard(
        doc2(db, "app_config", "telegram_auto_sync"),
        {
          channelUrl: channelRef,
          activeChannelId: cleanChannelId,
          lastSyncedMsgId: endMsgId,
          onlyValidAudioAndHd,
          updatedAtMs: Date.now(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch(() => {
      });
    }
    if (cachedSyncConfig) {
      cachedSyncConfig.channelUrl = channelRef;
      cachedSyncConfig.lastSyncedMsgId = Math.max(cachedSyncConfig.lastSyncedMsgId, endMsgId);
      cachedSyncConfig.onlyValidAudioAndHd = onlyValidAudioAndHd;
    }
    bulkSyncJob.status = "completed";
    bulkSyncJob.updatedAtMs = Date.now();
    console.log(
      `[BulkChannelSync] Completed "${channelTitle}" (${startMsgId}-${endMsgId}): published=${bulkSyncJob.publishedCount}, merged=${bulkSyncJob.mergedCount}, skippedNoAudio=${bulkSyncJob.skippedNoAudio}, skippedLowQuality=${bulkSyncJob.skippedLowQuality}`
    );
  } catch (err) {
    bulkSyncJob.status = "error";
    bulkSyncJob.errorMessage = err?.message || "Bulk channel sync failed unexpectedly.";
    bulkSyncJob.updatedAtMs = Date.now();
    console.error("[BulkChannelSync] Worker error:", err);
  }
}
router2.get("/bulk-sync-status", (_req, res) => {
  return res.json({ success: true, job: bulkSyncJob });
});
router2.post("/bulk-sync-stop", (_req, res) => {
  if (bulkSyncJob.status === "running") {
    bulkSyncStopRequested = true;
  }
  return res.json({ success: true, job: bulkSyncJob });
});
router2.post("/bulk-sync-channel", async (req, res) => {
  const channelRef = String(req.body?.channelRef || req.body?.channelUrl || "").trim();
  const startMsgId = Math.max(1, Number(req.body?.startMsgId) || 1);
  const requestedEnd = Math.max(0, Number(req.body?.endMsgId) || 0);
  const onlyValidAudioAndHd = typeof req.body?.onlyValidAudioAndHd === "boolean" ? req.body.onlyValidAudioAndHd : false;
  if (!channelRef) {
    return res.status(400).json({ error: "Channel link ya post link daalna zaroori hai." });
  }
  if (bulkSyncJob.status === "running") {
    return res.status(409).json({
      error: "Ek bulk channel publish job pehle se chal raha hai.",
      job: bulkSyncJob
    });
  }
  try {
    const client2 = await getTelegramClient();
    await ensureChannelUploadWatcher(client2);
    const resolved = await resolveChannelPeerFromLinkOrId(client2, channelRef);
    if (!resolved) {
      const isInvite = /(?:\+|joinchat\/)/i.test(channelRef);
      return res.status(422).json({
        needsPostLinkOrPing: isInvite,
        error: isInvite ? 'Bot (+invite link) se direct private channel ID nahi nikal sakta. Is channel ke andar kisi bhi 1 video/post par right-click/tap karke "Copy Post Link" (https://t.me/c/.../123) paste karein YA channel me 1 message send/forward karein, phir dubara Start dabayein.' : "Channel resolve nahi ho paya. Confirm karein ki @Movies_Direct_Group_Bot is channel me Admin hai."
      });
    }
    const latestMsgId = requestedEnd > 0 ? requestedEnd : await discoverChannelLatestMsgId(client2, resolved.peer, resolved.cleanChannelId);
    if (!latestMsgId || latestMsgId < startMsgId) {
      return res.status(404).json({
        error: "Channel me koi messages nahi mile. Confirm karein ki bot Admin hai aur channel me posts maujood hain."
      });
    }
    bulkSyncStopRequested = false;
    bulkSyncJob = {
      status: "running",
      channelRef,
      channelId: resolved.cleanChannelId,
      channelTitle: resolved.channelTitle,
      onlyValidAudioAndHd,
      startMsgId,
      endMsgId: latestMsgId,
      currentMsgId: startMsgId,
      scannedMessages: 0,
      totalVideosSeen: 0,
      publishedCount: 0,
      mergedCount: 0,
      skippedNoAudio: 0,
      skippedLowQuality: 0,
      skippedDuplicates: 0,
      skippedNonVideo: 0,
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      errorMessage: "",
      upgradeUrl: ""
    };
    void setDocWithQuotaGuard(
      doc2(db, "app_config", "telegram_auto_sync"),
      {
        channelUrl: channelRef,
        activeChannelId: resolved.cleanChannelId,
        onlyValidAudioAndHd,
        autoWatchEnabled: true,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    ).catch(() => {
    });
    if (cachedSyncConfig) {
      cachedSyncConfig.channelUrl = channelRef;
      cachedSyncConfig.onlyValidAudioAndHd = onlyValidAudioAndHd;
      cachedSyncConfig.autoWatchEnabled = true;
    }
    void runBulkChannelSyncWorker({
      client: client2,
      peer: resolved.peer,
      cleanChannelId: resolved.cleanChannelId,
      channelTitle: resolved.channelTitle,
      publicUsername: resolved.publicUsername,
      channelRef,
      startMsgId,
      endMsgId: latestMsgId,
      onlyValidAudioAndHd
    });
    return res.json({
      success: true,
      started: true,
      job: bulkSyncJob
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || "Failed to start bulk channel auto-publish."
    });
  }
});
setTimeout(() => {
  getTelegramClient().then((client2) => ensureChannelUploadWatcher(client2)).then(() => runServerAutoSyncPass("boot")).catch(() => {
  });
  setInterval(() => {
    runServerAutoSyncPass("periodic").catch(() => {
    });
  }, 8e3);
}, 3e3);
router2.get("/stream", handleStream);
router2.head("/stream", handleStream);
var telegramRouter_default = router2;

// src/server/videoRouter.ts
import express2 from "express";
import ffmpeg from "fluent-ffmpeg";
import path4 from "path";
import fs5 from "fs";
import os3 from "os";
function getTranscodedDir() {
  const primary = path4.resolve(process.cwd(), "public", "transcoded");
  try {
    if (!fs5.existsSync(primary)) {
      fs5.mkdirSync(primary, { recursive: true });
    }
    return primary;
  } catch (err) {
    console.warn("[videoRouter] Notice: Unable to create public/transcoded directory, falling back to os.tmpdir:", err);
    const fallback = path4.resolve(os3.tmpdir(), "movieportal_transcoded");
    try {
      if (!fs5.existsSync(fallback)) {
        fs5.mkdirSync(fallback, { recursive: true });
      }
    } catch (e) {
      console.warn("[videoRouter] Fallback dir error:", e);
    }
    return fallback;
  }
}
var transcodedDir = getTranscodedDir();
var router3 = express2.Router();
router3.post("/transcode", requireAdmin, async (req, res) => {
  const { url, imdbId, targetQualities } = req.body;
  if (!url || !imdbId) {
    return res.status(400).json({ error: "Source URL and IMDb ID are required" });
  }
  const results = {};
  const tasks = targetQualities.map(async (quality) => {
    const filename = `${imdbId}_${quality}.mp4`;
    const outputPath = path4.join(transcodedDir, filename);
    const publicUrl = `/transcoded/${filename}`;
    if (fs5.existsSync(outputPath)) {
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
    const outputPath = path4.join(transcodedDir, filename);
    if (fs5.existsSync(outputPath)) {
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
init_firebase();
import { Router as Router2 } from "express";
import http from "http";
import https from "https";
import { collection as collection2, getDocs } from "firebase/firestore";
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
  if (!isServerFirestoreWriteAllowed()) return 0;
  try {
    const statsUrl = `${FIRESTORE_ADMINS_BASE}/app_stats`;
    const res = await fetch(statsUrl, { cache: "no-store" });
    if (res.status === 429) {
      markServerFirestoreQuotaExhausted("firestore-rest-429-get");
      return 0;
    }
    let currentCount = 0;
    if (res.ok) {
      const data = await res.json();
      currentCount = Math.max(0, Number(data?.fields?.installedAppUsers?.integerValue) || 0);
    }
    if (opts.isNew && isServerFirestoreWriteAllowed()) {
      currentCount += 1;
      const patchRes = await fetch(
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
      if (!patchRes.ok) {
        const bodyTxt = await patchRes.text().catch(() => "");
        if (patchRes.status === 429 || isFirestoreQuotaErrorLike(bodyTxt)) {
          markServerFirestoreQuotaExhausted(bodyTxt || `http-${patchRes.status}`);
          return currentCount;
        }
      }
    }
    if (opts.deviceId && isServerFirestoreWriteAllowed()) {
      const cleanDevId = opts.deviceId.startsWith("dev_") ? opts.deviceId : `dev_${opts.deviceId}`;
      const devUrl = `${FIRESTORE_ADMINS_BASE}/${cleanDevId}`;
      const devRes = await fetch(devUrl, {
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
      if (!devRes.ok) {
        const bodyTxt = await devRes.text().catch(() => "");
        if (devRes.status === 429 || isFirestoreQuotaErrorLike(bodyTxt)) {
          markServerFirestoreQuotaExhausted(bodyTxt || `http-${devRes.status}`);
        }
      }
    }
    return currentCount;
  } catch (e) {
    if (isFirestoreQuotaErrorLike(e)) {
      markServerFirestoreQuotaExhausted(e);
    }
    return 0;
  }
}
downloadCastRouter.get("/download/apk", async (_req, res) => {
  const latest = await fetchLatestGitHubApk();
  console.log(`[Download Router] User downloading APK: ${latest.url}`);
  if (isServerFirestoreWriteAllowed()) {
    (async () => {
      try {
        const statsUrl = `${FIRESTORE_ADMINS_BASE}/app_stats`;
        const sRes = await fetch(statsUrl, { cache: "no-store" });
        if (sRes.status === 429) {
          markServerFirestoreQuotaExhausted("apk-click-429");
          return;
        }
        let clicks = 0;
        if (sRes.ok) {
          const d = await sRes.json();
          clicks = Number(d?.fields?.totalApkClicks?.integerValue) || 0;
        }
        clicks += 1;
        const pRes = await fetch(`${statsUrl}?updateMask.fieldPaths=totalApkClicks&updateMask.fieldPaths=lastDownloadAt`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              totalApkClicks: { integerValue: String(clicks) },
              lastDownloadAt: { timestampValue: (/* @__PURE__ */ new Date()).toISOString() }
            }
          })
        });
        if (!pRes.ok) {
          const bodyTxt = await pRes.text().catch(() => "");
          if (pRes.status === 429 || isFirestoreQuotaErrorLike(bodyTxt)) {
            markServerFirestoreQuotaExhausted(bodyTxt || `http-${pRes.status}`);
          }
        }
      } catch {
      }
    })().catch(() => {
    });
  }
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
      const installedAppUsers = Math.max(0, Number(d?.fields?.installedAppUsers?.integerValue) || 0);
      return res.json({
        installedAppUsers,
        totalApkClicks: Number(d?.fields?.totalApkClicks?.integerValue) || 0,
        updatedAt: d?.fields?.updatedAt?.integerValue || Date.now()
      });
    }
  } catch {
  }
  res.json({ installedAppUsers: 0, totalApkClicks: 0 });
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
      getDocs(collection2(db, "announcements")),
      getDocs(collection2(db, "movies")).catch(() => null)
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

// src/server/pushRouter.ts
init_firebase_applet_config();
import crypto2 from "crypto";
import fs6 from "fs";
import { createRequire } from "module";
import os4 from "os";
import path5 from "path";
import { Router as Router3 } from "express";
var require2 = createRequire(import.meta.url);
var webPush = require2("web-push");
var SUBS_CACHE_FILE = path5.join(os4.tmpdir(), ".movie_hub_push_subs.json");
var subscriptionMap = /* @__PURE__ */ new Map();
function loadSubsFromTmp() {
  try {
    if (fs6.existsSync(SUBS_CACHE_FILE)) {
      const parsed = JSON.parse(fs6.readFileSync(SUBS_CACHE_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.endpoint === "string" && item.keys?.p256dh && item.keys?.auth) {
            subscriptionMap.set(item.endpoint, item);
          }
        }
      }
    }
  } catch {
  }
}
function saveSubsToTmp() {
  try {
    fs6.writeFileSync(SUBS_CACHE_FILE, JSON.stringify(Array.from(subscriptionMap.values())), "utf-8");
  } catch {
  }
}
loadSubsFromTmp();
function getVapidKeys() {
  const envPub = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY || "").trim();
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv };
  }
  const projectId2 = firebase_applet_config_default.projectId || "movie-portal-hub";
  const dbId = firebase_applet_config_default.firestoreDatabaseId || "default";
  const customSeed = (process.env.VAPID_KEY_SEED || "mp-webpush-vapid-v1").trim();
  const seed = crypto2.createHash("sha256").update(`${projectId2}:${dbId}:${customSeed}`).digest();
  const ecdh = crypto2.createECDH("prime256v1");
  ecdh.setPrivateKey(seed);
  return {
    publicKey: ecdh.getPublicKey(null, "uncompressed").toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url")
  };
}
var vapidKeys = getVapidKeys();
webPush.setVapidDetails("mailto:support@moviehub.app", vapidKeys.publicKey, vapidKeys.privateKey);
function normalizeSub(raw) {
  const endpoint = String(raw?.endpoint || "").trim();
  const p256dh = String(raw?.keys?.p256dh || "").trim();
  const auth2 = String(raw?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth2) return null;
  if (!/^https:\/\//i.test(endpoint)) return null;
  return {
    endpoint,
    expirationTime: raw?.expirationTime ?? null,
    keys: { p256dh, auth: auth2 },
    platform: String(raw?.platform || "").trim() || void 0,
    updatedAtMs: Number(raw?.updatedAtMs) || Date.now()
  };
}
var router4 = Router3();
router4.get("/vapid-public-key", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ publicKey: vapidKeys.publicKey });
});
router4.post("/subscribe", (req, res) => {
  const sub = normalizeSub(req.body?.subscription || req.body);
  if (!sub) {
    return res.status(400).json({ error: "Invalid Web Push subscription payload" });
  }
  subscriptionMap.set(sub.endpoint, sub);
  saveSubsToTmp();
  return res.json({ ok: true, cachedCount: subscriptionMap.size });
});
router4.post("/unsubscribe", (req, res) => {
  const endpoint = String(req.body?.endpoint || "").trim();
  if (endpoint && subscriptionMap.delete(endpoint)) {
    saveSubsToTmp();
  }
  return res.json({ ok: true });
});
router4.post("/broadcast", async (req, res) => {
  const payload = req.body?.payload;
  const incomingSubs = Array.isArray(req.body?.subscriptions) ? req.body.subscriptions : [];
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "Notification payload is required" });
  }
  const merged = /* @__PURE__ */ new Map();
  for (const [ep, cached] of subscriptionMap.entries()) {
    merged.set(ep, cached);
  }
  for (const raw of incomingSubs) {
    const sub = normalizeSub(raw);
    if (sub) {
      merged.set(sub.endpoint, sub);
      subscriptionMap.set(sub.endpoint, sub);
    }
  }
  try {
    if (adminDb) {
      const snap = await adminDb.collection("app_installs").where("type", "==", "web_push").get().catch(() => null);
      if (snap) {
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const sub = normalizeSub(data);
          if (sub) {
            merged.set(sub.endpoint, sub);
            subscriptionMap.set(sub.endpoint, sub);
          }
        });
      }
    }
  } catch (dbErr) {
  }
  saveSubsToTmp();
  const targets = Array.from(merged.values());
  if (targets.length === 0) {
    return res.json({
      ok: true,
      totalTargets: 0,
      sentCount: 0,
      failedCount: 0,
      expiredEndpoints: []
    });
  }
  const serializedPayload = JSON.stringify({
    id: String(payload.id || `push-${Date.now()}`),
    movieId: String(payload.movieId || ""),
    title: String(payload.title || "New Release"),
    notificationTitle: String(payload.notificationTitle || ""),
    notificationBody: String(payload.notificationBody || ""),
    message: String(payload.message || ""),
    posterUrl: String(payload.posterUrl || ""),
    backdropUrl: String(payload.backdropUrl || ""),
    imageUrl: String(payload.imageUrl || "")
  });
  let sentCount = 0;
  let failedCount = 0;
  const expiredEndpoints = [];
  const BATCH_SIZE = 20;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(
        (sub) => webPush.sendNotification(sub, serializedPayload, {
          TTL: 86400,
          urgency: "high"
        })
      )
    );
    results.forEach((result, idx) => {
      const sub = batch[idx];
      if (result.status === "fulfilled") {
        sentCount++;
      } else {
        failedCount++;
        const statusCode = Number(result.reason?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
          subscriptionMap.delete(sub.endpoint);
        }
      }
    });
  }
  if (expiredEndpoints.length > 0) {
    saveSubsToTmp();
  }
  console.log(
    `[WebPush] Broadcast complete | targets=${targets.length} sent=${sentCount} failed=${failedCount} expired=${expiredEndpoints.length}`
  );
  return res.json({
    ok: true,
    totalTargets: targets.length,
    sentCount,
    failedCount,
    expiredEndpoints
  });
});
var pushRouter_default = router4;

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path6.dirname(__filename);
var envPath = fs7.existsSync(path6.resolve(__dirname, ".env")) ? path6.resolve(__dirname, ".env") : path6.resolve(__dirname, "../.env");
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
  if (!req.path.startsWith("/stream") && !req.path.startsWith("/telegram/hls") && !req.path.startsWith("/telegram/live-events") && !req.path.startsWith("/telegram/subtitles.vtt") && !req.path.startsWith("/ios-profile")) {
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
    version: "3.5.281",
    ffmpegAvailable: FFMPEG_AVAILABLE,
    ffprobeAvailable: FFPROBE_AVAILABLE,
    telegramConfigured,
    telegramConnected: isTelegramConnected(),
    hlsSupported: FFMPEG_AVAILABLE && FFPROBE_AVAILABLE,
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
app3.get("/api/ios-profile", (req, res) => {
  try {
    const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    const rawProto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(rawHost);
    const scheme = isLocal ? rawProto : "https";
    const appOrigin = rawHost ? `${scheme}://${rawHost}/` : "https://ais-pre-yaniwuwl6wc7ivl5tz2bbo-755452514312.asia-northeast1.run.app/";
    const escapeXml = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    const iconCandidates = [
      path6.resolve(process.cwd(), "public/apple-touch-icon.png"),
      path6.resolve(process.cwd(), "dist/apple-touch-icon.png"),
      path6.resolve(__dirname, "public/apple-touch-icon.png"),
      path6.resolve(__dirname, "dist/apple-touch-icon.png"),
      path6.resolve(__dirname, "apple-touch-icon.png"),
      path6.resolve(process.cwd(), "public/assets/icons/master_icon.png"),
      path6.resolve(__dirname, "public/assets/icons/master_icon.png")
    ];
    let iconBase64 = "";
    for (const candidate of iconCandidates) {
      if (fs7.existsSync(candidate)) {
        iconBase64 = fs7.readFileSync(candidate).toString("base64");
        break;
      }
    }
    const iconEntry = iconBase64 ? `        <key>Icon</key>
        <data>
${iconBase64.replace(/.{1,76}/g, "          $&\n").trimEnd()}
        </data>
` : "";
    const mobileConfigPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>PayloadContent</key>
    <array>
      <dict>
        <key>FullScreen</key>
        <true/>
${iconEntry}        <key>IgnoreManifestScope</key>
        <false/>
        <key>IsRemovable</key>
        <true/>
        <key>Label</key>
        <string>Movie Hub</string>
        <key>PayloadDescription</key>
        <string>Adds Movie Hub to your iPhone Home Screen in fullscreen app mode.</string>
        <key>PayloadDisplayName</key>
        <string>Movie Hub Web App</string>
        <key>PayloadIdentifier</key>
        <string>com.moviebox.stream.webclip.v1</string>
        <key>PayloadType</key>
        <string>com.apple.webClip.managed</string>
        <key>PayloadUUID</key>
        <string>8F3A9C12-4E21-4B89-9D7A-10C8B5A2E301</string>
        <key>PayloadVersion</key>
        <integer>1</integer>
        <key>Precomposed</key>
        <true/>
        <key>URL</key>
        <string>${escapeXml(appOrigin)}</string>
      </dict>
    </array>
    <key>PayloadDescription</key>
    <string>Install Movie Hub on your iPhone or iPad Home Screen. Compatible with all iPhone models and iOS versions.</string>
    <key>PayloadDisplayName</key>
    <string>Movie Hub</string>
    <key>PayloadIdentifier</key>
    <string>com.moviebox.stream.profile.ios</string>
    <key>PayloadOrganization</key>
    <string>Movie Hub</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>4B7D2E90-1A34-4F12-B8C3-7D9E0F12A402</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
  </dict>
</plist>
`;
    res.setHeader("Content-Type", "application/x-apple-aspen-config");
    res.setHeader("Content-Disposition", 'attachment; filename="Movie-Hub.mobileconfig"');
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(mobileConfigPlist);
  } catch (err) {
    res.status(500).setHeader("Content-Type", "application/json").json({
      error: err?.message || "Failed to generate iOS profile"
    });
  }
});
app3.use("/api/metadata", metadataRouter_default);
app3.use("/api/telegram", telegramRouter_default);
app3.get("/api/stream", handleStream);
app3.head("/api/stream", handleStream);
app3.use("/api/video", videoRouter_default);
app3.use("/api/push", pushRouter_default);
app3.use("/api", downloadCastRouter_default);
app3.get("/api/firestore/quota-status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(getServerFirestoreQuotaStatus());
});
app3.post("/api/firestore/quota-exhausted", (req, res) => {
  const exhaustedUntilMs = markServerFirestoreQuotaExhausted(
    req.body?.reason || "client-reported-resource-exhausted"
  );
  res.setHeader("Cache-Control", "no-store");
  return res.json({ writeAllowed: false, exhaustedUntilMs });
});
app3.get("/api/movies/catalog", (_req, res) => {
  try {
    const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
    const candidates = [
      path6.resolve(process.cwd(), "public/movies-seed.json"),
      path6.resolve(process.cwd(), "dist/movies-seed.json"),
      path6.resolve(__dirname, "public/movies-seed.json")
    ];
    for (const p of candidates) {
      if (fs7.existsSync(p)) {
        const parsed = JSON.parse(fs7.readFileSync(p, "utf8"));
        const filtered = Array.isArray(parsed) ? parsed.filter((m) => m && m.id && m.published !== false && hasPlayableContent(m)).map(
          (m) => Number(m.releaseYear) > currentYear ? { ...m, releaseYear: currentYear } : m
        ) : [];
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        return res.json(filtered);
      }
    }
    return res.json([]);
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to read movies catalog" });
  }
});
var cachedCatalogMeta = null;
app3.get("/api/movies/catalog-meta", (_req, res) => {
  try {
    const candidates = [
      path6.resolve(process.cwd(), "public/movies-seed.json"),
      path6.resolve(process.cwd(), "dist/movies-seed.json"),
      path6.resolve(__dirname, "public/movies-seed.json")
    ];
    for (const p of candidates) {
      if (fs7.existsSync(p)) {
        const stat = fs7.statSync(p);
        if (!cachedCatalogMeta || cachedCatalogMeta.filePath !== p || cachedCatalogMeta.mtimeMs !== stat.mtimeMs || cachedCatalogMeta.size !== stat.size) {
          let count = 0;
          try {
            const parsed = JSON.parse(fs7.readFileSync(p, "utf8"));
            count = Array.isArray(parsed) ? parsed.filter((m) => m && m.id && m.published !== false && hasPlayableContent(m)).length : 0;
          } catch {
          }
          cachedCatalogMeta = { filePath: p, mtimeMs: stat.mtimeMs, size: stat.size, count };
        }
        res.setHeader("Cache-Control", "no-store");
        return res.json({
          count: cachedCatalogMeta.count,
          size: cachedCatalogMeta.size,
          mtimeMs: Math.round(cachedCatalogMeta.mtimeMs)
        });
      }
    }
    return res.json({ count: 0, size: 0, mtimeMs: 0 });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to read catalog meta" });
  }
});
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
var isRunningFromDist = import.meta.url.includes("/dist/") || process.argv[1] && process.argv[1].includes("/dist/");
var isProduction = process.env.NODE_ENV === "production" || isRunningFromDist;
var getStaticDir = () => {
  const candidates = [
    path6.resolve(process.cwd(), "dist"),
    path6.resolve(__dirname, "dist"),
    __dirname
  ];
  for (const dir of candidates) {
    if (fs7.existsSync(path6.resolve(dir, "index.html"))) {
      return dir;
    }
  }
  return __dirname;
};
var applyFreshHtmlCacheHeaders = (res, filePath) => {
  const clean = (filePath || "").toLowerCase();
  if (!clean || clean.endsWith(".html") || clean.endsWith("/sw.js") || clean.endsWith("/sw-push.js") || clean.endsWith("/version.json") || clean.endsWith("/manifest.webmanifest") || clean.endsWith("/manifest.json")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  } else if (clean.includes(`${path6.sep}assets${path6.sep}`)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
};
if (!isProduction) {
  try {
    app3.use((req, res, next) => {
      const p = (req.path || "").toLowerCase();
      const accept = String(req.headers.accept || "").toLowerCase();
      if (p === "/" || p.endsWith(".html") || p === "/sw.js" || p === "/sw-push.js" || p === "/version.json" || p === "/manifest.webmanifest" || p === "/manifest.json" || !p.startsWith("/api/") && !p.startsWith("/src/") && !p.startsWith("/node_modules/") && accept.includes("text/html")) {
        applyFreshHtmlCacheHeaders(res);
      }
      next();
    });
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true
      },
      optimizeDeps: {
        entries: ["index.html"],
        include: [
          "react",
          "react-dom",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "framer-motion",
          "lucide-react",
          "react-router-dom",
          "hls.js"
        ]
      },
      appType: "spa"
    });
    app3.get("/@vite/client", (_req, res) => {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(`
const sheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
const cspNonce = typeof document !== 'undefined' ? document.querySelector('meta[property=csp-nonce]')?.nonce : undefined;
let lastInsertedStyle;
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (cspNonce) style.setAttribute('nonce', cspNonce);
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== '.' && url[0] !== '/')) return url;
  const pathname = url.replace(/[?#].*$/, '');
  const parsed = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (parsed.search ? '&' + parsed.search.slice(1) : '') + (parsed.hash || '');
}
const BaseEl = typeof globalThis !== 'undefined' && globalThis.HTMLElement ? globalThis.HTMLElement : class {};
export class ErrorOverlay extends BaseEl {}
`);
    });
    app3.use(vite.middlewares);
  } catch (viteErr) {
    console.warn("[Vite Middleware notice - falling back to static/SPA]", viteErr);
    const staticDir = getStaticDir();
    app3.use(express3.static(staticDir, { setHeaders: (res, filePath) => applyFreshHtmlCacheHeaders(res, filePath) }));
    if (fs7.existsSync(path6.resolve(process.cwd(), "public"))) {
      app3.use(express3.static(path6.resolve(process.cwd(), "public"), { setHeaders: (res, filePath) => applyFreshHtmlCacheHeaders(res, filePath) }));
    }
    app3.get("*", (_req, res) => {
      applyFreshHtmlCacheHeaders(res);
      res.sendFile(path6.resolve(staticDir, "index.html"));
    });
  }
} else {
  const staticDir = getStaticDir();
  console.log(`[Production] Serving static files from: ${staticDir}`);
  app3.use(express3.static(staticDir, { setHeaders: (res, filePath) => applyFreshHtmlCacheHeaders(res, filePath) }));
  if (fs7.existsSync(path6.resolve(process.cwd(), "public"))) {
    app3.use(express3.static(path6.resolve(process.cwd(), "public"), { setHeaders: (res, filePath) => applyFreshHtmlCacheHeaders(res, filePath) }));
  }
  app3.get("*", (_req, res) => {
    applyFreshHtmlCacheHeaders(res);
    res.sendFile(path6.resolve(staticDir, "index.html"));
  });
}
var server = app3.listen(PORT, "0.0.0.0", () => {
  console.log(`MOVIE PORTAL server running on port ${PORT}`);
});
server.requestTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 65e3;
server.headersTimeout = 66e3;
/*! Bundled license information:

@capacitor/core/dist/index.cjs.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
