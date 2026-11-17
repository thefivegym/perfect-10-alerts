import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { advanceSeasonBackfill, clubSeedSql } from '../src/backfill.ts';
import type { AlertDraft } from '../src/types.ts';

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
  } as unknown as D1Database;
}

test('a season backfill logs a Virtius 10, skips the exhibition, and waits before Road to Nationals', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  db.exec(readFileSync('migrations/0002_club.sql', 'utf8'));
  const env = {
    DB: d1(db),
    SCOREBOARD_DATA_URL: 'https://scoreboard.test/data',
  } as unknown as Env;
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/schedule.json')) {
      return Response.json({
        season: 2026,
        source: 'test',
        meets: [
          { id: 10, date: '2026-02-01', virtius: 'virtiusKey1', home: ['LSU'], away: [], d1_teams: ['LSU'], desc: 'Dual' },
          { id: 11, date: '2026-02-08', home: ['Iowa'], away: [], d1_teams: ['Iowa'], desc: 'No Virtius' },
          { id: 12, date: '2026-02-09', home: ['Utah'], away: [], d1_teams: ['Utah'], desc: 'Also no Virtius' },
        ],
      });
    }
    if (url.endsWith('/intrasquads.json') || url.endsWith('/intrasquads-discovered.json')) {
      return Response.json({ events: [] });
    }
    if (url.includes('/session/virtiusKey1/json')) {
      return Response.json({
        meet: {
          name: 'LSU dual',
          meet_date: '2026-02-01',
          teams: [{
            name: 'LSU',
            short_name: 'LSU',
            competing: 1,
            events: [{
              event_name: 'VAULT',
              gymnasts: [
                { gymnast_id: '1', full_name: 'Kailin Chio', order: 1, final_score: '10.0000' },
                { gymnast_id: '2', full_name: 'Exhibition Gymnast', order: 7, final_score: '10.0000' },
              ],
            }],
          }],
        },
      });
    }
    if (url.includes('/meetresults/11')) {
      return Response.json({
        teams: [{ tid: '29', tname: 'Iowa' }],
        scores: [[{ fname: 'A', lname: 'Gymnast', gid: '9', team_id: '29', vault: '10.0', bars: '9.8', beam: '9.7', floor: '9.9' }]],
      });
    }
    return new Response('no', { status: 404 });
  };

  try {
    const now = new Date('2027-01-15T18:00:00.000Z');
    const first = await advanceSeasonBackfill(env, 2026, false, now);
    assert.equal(first.ok, true);
    assert.equal(first.pushes, 0);
    assert.equal(first.logged, 1);
    assert.equal(first.done, false);
    assert.equal(calls.some((url) => url.includes('/meetresults/')), false);
    const names = db.prepare('SELECT athlete_name FROM alerts').all() as Array<{ athlete_name: string }>;
    assert.deepEqual(names.map((row) => row.athlete_name), ['Kailin Chio']);

    const rtn = await advanceSeasonBackfill(env, 2026, false, now);
    assert.equal(rtn.waiting, false);
    assert.equal(rtn.logged, 2);
    assert.equal(calls.filter((url) => url.includes('/meetresults/')).length, 1);

    const early = await advanceSeasonBackfill(env, 2026, false, new Date(now.getTime() + 1000));
    assert.equal(early.waiting, true);
    assert.equal(early.pushes, 0);
    assert.equal(calls.filter((url) => url.includes('/meetresults/')).length, 1);

    const later = await advanceSeasonBackfill(env, 2026, false, new Date(now.getTime() + 31_000));
    assert.equal(later.waiting, false);
    assert.equal(later.done, true);
    assert.equal(later.logged, 2);
    assert.equal(later.pushes, 0);
    const all = db.prepare('SELECT athlete_name FROM alerts ORDER BY athlete_name').all() as Array<{ athlete_name: string }>;
    assert.deepEqual(all.map((row) => row.athlete_name), ['A Gymnast', 'Kailin Chio']);
  } finally {
    globalThis.fetch = original;
  }
});

test('seed SQL loads a 10 and does not insert an exhibition row', () => {
  const alert: AlertDraft = {
    id: 'meet|vault|1',
    athleteName: "O'Brien",
    athleteId: '1',
    team: 'LSU',
    event: 'vault',
    exhibition: false,
    meetKey: 'meet',
    meetName: 'Dual',
    meetDate: '2026-02-01',
    teamsLabel: 'LSU',
    videoUrl: null,
    clipUrl: null,
    scoreboardUrl: 'https://thefivegym.github.io/live-scoreboard/?date=2026-02-01#meet=meet',
    searchUrl: 'https://x.com/search?q=test',
    source: 'virtius',
  };
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  db.exec(readFileSync('migrations/0002_club.sql', 'utf8'));
  db.exec(clubSeedSql([alert]));
  db.exec(clubSeedSql([alert]));
  const row = db.prepare('SELECT athlete_name, hidden, exhibition, COUNT(*) AS n FROM alerts').get() as { athlete_name: string; hidden: number; exhibition: number; n: number };
  assert.equal(row.athlete_name, "O'Brien");
  assert.equal(row.hidden, 0);
  assert.equal(row.exhibition, 0);
  assert.equal(row.n, 1);
});
