/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-aeb6ecaf'], (function (workbox) { 'use strict';

  importScripts("/sw-push.js");
  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "sw-push.js",
    "revision": "625d4bdd50c1ee12b4775b53f2c6807d"
  }, {
    "url": "server.js",
    "revision": "a61eadedb64c422cec608f537299b528"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "18a96a3686502a7b088f62ffdcb70bb1"
  }, {
    "url": "pwa-512x512.png",
    "revision": "16ce2231c22516d369e9ad07e4bb0af4"
  }, {
    "url": "pwa-192x192.png",
    "revision": "d8932d488ddf381916241682ce45e480"
  }, {
    "url": "index.html",
    "revision": "c828a1874235a8976251f841573b7b1a"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "48d4d4a5885a99c61147a6e196c614ee"
  }, {
    "url": "apple-touch-icon-152x152.png",
    "revision": "f7effcaa27fedbd67142d881910bb930"
  }, {
    "url": "apple-touch-icon-120x120.png",
    "revision": "378e657a2dd4e37abd5d02e840dd8b58"
  }, {
    "url": "assets/workbox-window.prod.es5-BBnX5xw4.js",
    "revision": null
  }, {
    "url": "assets/web-jKODcTAp.js",
    "revision": null
  }, {
    "url": "assets/web-F04NBJNU.js",
    "revision": null
  }, {
    "url": "assets/web-E_muZC5T.js",
    "revision": null
  }, {
    "url": "assets/web-CWP3PoK2.js",
    "revision": null
  }, {
    "url": "assets/web-BYXwb01e.js",
    "revision": null
  }, {
    "url": "assets/web-7ug2hGi-.js",
    "revision": null
  }, {
    "url": "assets/index-aMN6TuB8.css",
    "revision": null
  }, {
    "url": "assets/index-Moz_hwev.js",
    "revision": null
  }, {
    "url": "assets/index-DvC5fRJH.css",
    "revision": null
  }, {
    "url": "assets/index-DrMnXqkc.js",
    "revision": null
  }, {
    "url": "assets/index-CxRQnOZF.js",
    "revision": null
  }, {
    "url": "assets/esm-k__iDZSD.js",
    "revision": null
  }, {
    "url": "assets/esm-DZVY0nqQ.js",
    "revision": null
  }, {
    "url": "assets/esm-CT5ILrxB.js",
    "revision": null
  }, {
    "url": "assets/esm-BmIEe5XS.js",
    "revision": null
  }, {
    "url": "assets/esm-BflA3Lxi.js",
    "revision": null
  }, {
    "url": "assets/esm-BaKwDXpl.js",
    "revision": null
  }, {
    "url": "assets/browserTelegramStream-vVejK0gv.js",
    "revision": null
  }, {
    "url": "assets/browserTelegramStream-CSAoNONr.js",
    "revision": null
  }, {
    "url": "assets/browserTelegramStream-3XIaZody.js",
    "revision": null
  }, {
    "url": "assets/icons/master_icon.png",
    "revision": null
  }, {
    "url": "apple-touch-icon-120x120.png",
    "revision": "378e657a2dd4e37abd5d02e840dd8b58"
  }, {
    "url": "apple-touch-icon-152x152.png",
    "revision": "f7effcaa27fedbd67142d881910bb930"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "48d4d4a5885a99c61147a6e196c614ee"
  }, {
    "url": "pwa-192x192.png",
    "revision": "d8932d488ddf381916241682ce45e480"
  }, {
    "url": "pwa-512x512.png",
    "revision": "16ce2231c22516d369e9ad07e4bb0af4"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "18a96a3686502a7b088f62ffdcb70bb1"
  }, {
    "url": "sw-push.js",
    "revision": "625d4bdd50c1ee12b4775b53f2c6807d"
  }, {
    "url": "assets/icons/master_icon.png",
    "revision": "5a841125919b42ac8ce83ac8abf86a86"
  }, {
    "url": "manifest.webmanifest",
    "revision": "04ee92bbb676755f301a365ccb129abf"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//]
  }));
  workbox.registerRoute(({
    url
  }) => url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/stream") && !url.pathname.startsWith("/api/telegram/stream") && !url.pathname.startsWith("/api/telegram/hls") && !url.pathname.startsWith("/api/video/"), new workbox.NetworkOnly(), 'GET');

}));
