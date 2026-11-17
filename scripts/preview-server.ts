import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { samplePushPage } from '../src/pages.ts';

const root = join(import.meta.dirname, '..', 'public');
const port = Number(process.env.PORT || 8787);
const origin = `http://127.0.0.1:${port}`;
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', origin);
  if (url.pathname === '/api/config') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ pushConfigured: true, vapidPublicKey: '', turnstileSiteKey: '' }));
    return;
  }
  if (url.pathname === '/sample/push') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(samplePushPage(origin));
    return;
  }
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (path === '/manage') path = '/manage.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Preview (no database, no sending) at ${origin}`);
});
