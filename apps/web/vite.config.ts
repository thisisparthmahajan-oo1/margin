import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Margin',
        short_name: 'Margin',
        description: 'Save articles and read them later, offline.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
        // Android "Share → Margin" lands on /add?url=…&text=…
        share_target: { action: '/add', method: 'GET', enctype: 'application/x-www-form-urlencoded', params: { url: 'url', text: 'text', title: 'title' } },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    proxy: { '/api': API },
  },
  preview: {
    host: true,
    proxy: { '/api': API },
  },
  test: {
    environment: 'jsdom',
  },
});
