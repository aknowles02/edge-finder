import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: { manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
});
