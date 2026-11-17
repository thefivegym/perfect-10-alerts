/**
 * Fill a local database with the 2026 Perfect 10 Club, then write the seed
 * files the deploy applies. Road to Nationals is requested at most once every
 * 30 seconds. Nothing is sent to subscribers.
 *
 * Resume-safe: leave /tmp/club-2026.sqlite in place and run again.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { advanceSeasonBackfill, clubSeedSql } from '../src/backfill.ts';
import type { AlertDraft } from '../src/types.ts';

const dbPath = '/tmp/club-2026.sqlite';
const db = new DatabaseSync(dbPath);
db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
const hidden = db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('alerts') WHERE name = 'hidden'`).get() as { n: number };
if (!hidden.n) db.exec(readFileSync('migrations/0002_club.sql', 'utf8'));

function d1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      const wrap = (args: unknown[]) => ({
        bind(...next: unknown[]) {
          return wrap(next);
        },
        async first() {
          return stmt.get(...(args as [])) ?? null;
        },
        async all() {
          return { results: stmt.all(...(args as [])) };
        },
        async run() {
          const info = stmt.run(...(args as []));
          return { success: true, meta: { changes: Number(info.changes || 0) } };
        },
      });
      return wrap([]);
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      const out = [];
      for (const stmt of stmts) out.push(await stmt.run());
      return out;
    },
  } as unknown as D1Database;
}

const env = {
  DB: d1(db),
  SCOREBOARD_DATA_URL: 'https://thefivegym.github.io/live-scoreboard/data',
} as unknown as Env;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (;;) {
  const step = await advanceSeasonBackfill(env, 2026, false, new Date());
  console.log(JSON.stringify({ ...step, at: new Date().toISOString() }));
  if (!step.ok) process.exit(1);
  if (step.done) break;
  if (step.waiting) await sleep(step.retryAfterMs);
}

const rows = db.prepare(`SELECT id, athlete_name, athlete_id, team, event, meet_key, meet_name, meet_date,
  teams_label, video_url, clip_url, scoreboard_url, search_url, source
  FROM alerts WHERE hidden = 0 AND exhibition = 0
  ORDER BY meet_date, athlete_name, event`).all() as Array<Record<string, string | null>>;

const alerts: AlertDraft[] = rows.map((row) => ({
  id: String(row.id),
  athleteName: String(row.athlete_name),
  athleteId: row.athlete_id,
  team: String(row.team),
  event: row.event as AlertDraft['event'],
  exhibition: false,
  meetKey: String(row.meet_key),
  meetName: String(row.meet_name || ''),
  meetDate: String(row.meet_date),
  teamsLabel: String(row.teams_label || ''),
  videoUrl: row.video_url,
  clipUrl: row.clip_url,
  scoreboardUrl: String(row.scoreboard_url),
  searchUrl: String(row.search_url),
  source: row.source === 'rtn' ? 'rtn' : 'virtius',
}));

mkdirSync('data', { recursive: true });
const payload = {
  season: 2026,
  count: alerts.length,
  generated_at: new Date().toISOString(),
  entries: alerts,
};
writeFileSync('data/club-2026.json', `${JSON.stringify(payload, null, 2)}\n`);
writeFileSync('migrations/0003_club_2026.sql', clubSeedSql(alerts));
const samples = alerts.filter((alert) => /chio|wong|chiles|blakely|miller/i.test(alert.athleteName)).slice(0, 12);
console.log(JSON.stringify({ wrote: alerts.length, samples }, null, 2));
