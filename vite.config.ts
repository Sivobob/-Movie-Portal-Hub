import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  const rootDir = import.meta.dirname || '.';
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifestFilename: 'manifest.webmanifest',
        devOptions: {
          enabled: false,
        },
        includeAssets: [
          'sw-push.js',
          'apple-touch-icon.png',
          'apple-touch-icon-152x152.png',
          'apple-touch-icon-120x120.png',
          'assets/icons/master_icon.png',
        ],
        workbox: {
          importScripts: ['/sw-push.js'],
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          globPatterns: ['**/*.{js,css,ico,png,svg,webp,woff2}'],
          globIgnores: [
            '**/index.html',
            '**/version.json',
            '**/downloads/**',
            '**/transcoded/**',
            '**/*.apk',
            '**/*.mp4',
            '**/*.mkv',
            '**/aistudio/**',
          ],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallback: null,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-navigation-cache',
                networkTimeoutSeconds: 3,
                expiration: {
                  maxEntries: 5,
                  maxAgeSeconds: 60 * 60,
                },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.pathname === '/version.json' ||
                url.pathname === '/manifest.webmanifest' ||
                url.pathname === '/manifest.json' ||
                url.pathname === '/sw-push.js',
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/api/') &&
                !url.pathname.startsWith('/api/stream') &&
                !url.pathname.startsWith('/api/telegram/stream') &&
                !url.pathname.startsWith('/api/telegram/hls') &&
                !url.pathname.startsWith('/api/video/'),
              handler: 'NetworkOnly',
            },
          ],
        },
        manifest: {
          id: '/',
          name: 'Movie Hub',
          short_name: 'Movie Hub',
          description: 'Stream unlimited movies and series in HD quality with offline downloads.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#000000',
          theme_color: '#000000',
          categories: ['entertainment', 'movies', 'video'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
        crypto: path.resolve(rootDir, 'src/utils/shims/cryptoShim.ts'),
        websocket: path.resolve(rootDir, 'src/utils/shims/websocketShim.ts'),
        path: 'path-browserify',
        util: path.resolve(rootDir, 'src/utils/shims/nodeStubs.ts'),
        fs: path.resolve(rootDir, 'src/utils/shims/nodeStubs.ts'),
        net: path.resolve(rootDir, 'src/utils/shims/nodeStubs.ts'),
        os: path.resolve(rootDir, 'src/utils/shims/nodeStubs.ts'),
        socks: path.resolve(rootDir, 'src/utils/shims/nodeStubs.ts'),
        'node-localstorage': path.resolve(rootDir, 'src/utils/shims/nodeStubs.ts'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
