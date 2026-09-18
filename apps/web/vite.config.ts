import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, strictPort: true,
    https: process.env.LOCAL_TLS_CERT && process.env.LOCAL_TLS_KEY ? { cert: readFileSync(process.env.LOCAL_TLS_CERT), key: readFileSync(process.env.LOCAL_TLS_KEY) } : undefined,
    proxy: { '/api': { target: 'http://127.0.0.1:3001' }, '/socket.io': { target: 'http://127.0.0.1:3001', ws: true } },
  },
});
