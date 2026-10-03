import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// API_PORT lets dev run next to other local servers (the API reads the same variable).
const api = `localhost:${process.env.API_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://${api}`,
      '/collab': { target: `ws://${api}`, ws: true },
    },
  },
});
