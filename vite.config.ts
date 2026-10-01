import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// The root manifest.webmanifest is the single source of truth for the PWA manifest.
const manifest = JSON.parse(readFileSync(new URL('./manifest.webmanifest', import.meta.url), 'utf8'));

// Content Security Policy is injected only into production builds so Vite's dev
// server (HMR websocket, inline client) keeps working locally.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' https://celestrak.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'skytrace-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  server: {
    // Dev-only proxy, used as a fallback if the browser blocks the direct request.
    proxy: {
      '/celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/celestrak/, ''),
      },
    },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  plugins: [
    cspPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest,
      manifestFilename: 'manifest.webmanifest',
      includeAssets: ['icons/*.png', 'icons/icon.svg', 'favicon/*'],
      workbox: {
        // CACHE FIRST: app shell, JS, CSS, fonts, icons (precached + revisioned).
        globPatterns: ['**/*.{js,css,html,woff2,woff,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Orbital elements are deliberately NOT cached by the service worker: the app's own
        // IndexedDB cache is the network-first fallback, so data age is always reported truthfully.
        runtimeCaching: [
          {
            // Satellite catalogue metadata changes rarely.
            urlPattern: /^https:\/\/celestrak\.org\/satcat\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'satellite-metadata',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
