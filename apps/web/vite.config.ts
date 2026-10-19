import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// API_PORT lets dev run next to other local servers (the API reads the same variable).
const api = `localhost:${process.env.API_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // xfwd forwards the real client IP/host (X-Forwarded-*) so the API can tell a LAN peer from
      // the host machine; without it the proxy (on loopback) makes every request look like localhost.
      '/api': { target: `http://${api}`, xfwd: true },
      '/collab': { target: `ws://${api}`, ws: true, xfwd: true },
    },
  },
});
