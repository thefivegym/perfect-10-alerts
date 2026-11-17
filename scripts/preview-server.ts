import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { buildClub, clubSeasons, type ClubSource } from '../src/club.ts';
import type { AlertDraft } from '../src/types.ts';
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
  if (url.pathname === '/api/club') {
    const requested = Number(url.searchParams.get('season'));
    const season = Number.isInteger(requested) && requested >= 1990 && requested <= 2100 ? requested : 2026;
    let entries: ClubSource[] = [];
    let sample = true;
    try {
      const raw = JSON.parse(await readFile(join(root, '../data/club-2026.json'), 'utf8')) as { entries?: AlertDraft[] };
      entries = (raw.entries || []).map((alert) => ({
        id: alert.id,
        athlete: alert.athleteName,
        team: alert.team,
        event: alert.event,
        meet: alert.meetName,
        date: alert.meetDate,
        detectedAt: `${alert.meetDate}T12:00:00.000Z`,
        meetUrl: alert.scoreboardUrl,
        clipUrl: alert.clipUrl,
      }));
      sample = false;
    } catch {
      entries = [
        { id: 'sample-1', athlete: 'Jamie Sample', team: 'Sample State', event: 'vault', meet: 'Sample Invitational', date: '2026-02-14', detectedAt: '2026-02-14T20:00:00.000Z', meetUrl: 'https://thefivegym.github.io/live-scoreboard/?date=2026-02-14#meet=sample', clipUrl: null },
      ];
    }
    const view = buildClub(entries, season);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...view, seasons: clubSeasons(entries.map((entry) => entry.date), season), sample }));
    return;
  }
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
