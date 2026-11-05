import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// frontend/inbox.html is the legacy page the backend serves at "/". Vite would
// otherwise answer the SPA route /inbox with that file during development.
const spaRoutesOverLegacyHtml = (): Plugin => ({
  name: 'spa-routes-over-legacy-html',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/inbox(?:[/?#]|$)/.test(req.url)) req.url = '/index.html';
      next();
    });
  },
});

// The dev/preview proxy forwards API calls to the FastAPI backend and injects
// the application key server-side, so BACKEND_API_KEY never enters the bundle.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const target = env.BACKEND_URL || 'http://127.0.0.1:8000';
  const apiKey = env.BACKEND_API_KEY || '';
  const proxied = ['/api', '/emails', '/vendors', '/purchase-orders', '/health'];
  const proxy = Object.fromEntries(
    proxied.map((path) => [
      path,
      {
        target,
        changeOrigin: true,
        headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
      },
    ]),
  );
  return {
    plugins: [react(), spaRoutesOverLegacyHtml()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    test: { environment: 'jsdom' },
  };
});
