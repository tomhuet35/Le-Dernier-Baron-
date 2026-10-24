import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const ici = (f: string) => fileURLToPath(new URL(f, import.meta.url));

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    // Deux pages : le jeu et la page Confidentialité (mêmes polices, servies par le jeu lui-même).
    rollupOptions: { input: { index: ici('client/index.html'), confidentialite: ici('client/confidentialite.html') } },
  },
  server: {
    host: true,
    proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true } },
  },
});
