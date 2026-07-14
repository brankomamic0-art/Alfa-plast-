import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Alfa Plast — Praćenje poslova',
        short_name: 'Alfa Plast',
        description: 'Praćenje poslova i zadataka — Alfa Plast',
        lang: 'hr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ECEEE9',
        theme_color: '#1A2226',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/.*/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^\/uploads\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'uploads-cache' },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
});
