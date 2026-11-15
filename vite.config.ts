import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const rootDir = import.meta.dirname || '.';
  return {
    plugins: [react(), tailwindcss()],
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
