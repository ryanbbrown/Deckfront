import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const repoRoot = resolve(import.meta.dirname, '..');

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), gameDataPlugin()],
  server: {
    fs: {
      allow: [repoRoot]
    }
  },
  build: {
    outDir: '../dist/viewer',
    emptyOutDir: true
  }
});

function gameDataPlugin(): Plugin {
  return {
    name: 'game-data',
    configureServer(server) {
      server.middlewares.use('/game-data', async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        if (
          !relativePath.startsWith('rulesets/') &&
          !relativePath.startsWith('scenarios/') &&
          !relativePath.startsWith('playthroughs/') &&
          !relativePath.startsWith('.games/')
        ) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }

        try {
          const content = await readFile(resolve(repoRoot, relativePath), 'utf8');
          response.setHeader('content-type', 'application/json; charset=utf-8');
          response.end(content);
        } catch {
          response.statusCode = 404;
          response.end('Not found');
        }
      });
    }
  };
}
