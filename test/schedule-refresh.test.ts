import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SCHEDULE_TTL_MS } from '../src/config.ts';
import { pollOnce } from '../src/poll.ts';

const RTN = 'https://www.roadtonationals.com/api/women';
const DATA = 'https://scoreboard.test/data';

function d1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
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
          stmt.run(...(args as []));
          return { success: true };
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

function meta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

test('a completed fallback to last season stays fresh for the refresh interval', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  const env = {
    DB: d1(db),
    SCOREBOARD_DATA_URL: DATA,
    PUBLIC_BASE_URL: 'https://alerts.test',
  } as unknown as Env;

  const teams = Array.from({ length: 40 }, (_, i) => `Team ${i + 1}`);
  const hits: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    hits.push(url);
    let body: unknown = {};
    if (url === `${DATA}/schedule.json`) {
      body = {
        season: 2026,
        season_published: false,
        source: 'published',
        meets: [
          { id: 1, date: '2024-12-20', virtius: 'oldkey01', home: ['Minnesota'], away: [] },
          { id: 2, date: '2026-04-18', virtius: 'MFrZ9epozB', home: [], away: ['LSU'] },
        ],
      };
    } else if (url === `${DATA}/intrasquads.json` || url === `${DATA}/intrasquads-discovered.json`) {
      body = { events: [] };
    } else if (url === `${RTN}/currentweek/2027`) {
      body = { max: 0 };
    } else if (url === `${RTN}/currentweek/2026`) {
      body = { max: 4 };
    } else if (url === `${RTN}/results/2026/4/0/5`) {
      body = { data: teams.map((name) => ({ div: 'Div I', name })) };
    } else if (url === `${RTN}/schedule/2026/1`) {
      body = {
        '2026-04-18': {
          meets: [{
            meet_id: 99,
            d: '2026-04-18',
            time: '18:00:00',
            home_teams: 'Team 1',
            away_teams: 'Team 2',
            meet_desc: 'Last season meet',
          }],
        },
      };
    } else {
      return new Response('no', { status: 404 });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    let now = new Date('2027-01-15T18:00:00.000Z');
    let done = false;
    for (let tick = 0; tick < 6 && !done; tick++) {
      await pollOnce(env, now);
      done = !!meta(db, 'schedule_refreshed_at') && !meta(db, 'rtn_job');
      now = new Date(now.getTime() + 60_000);
    }
    assert.equal(done, true, `refresh did not finish; hits=${hits.join(' ')}`);
    const rtnDuring = hits.filter((url) => url.startsWith(RTN));
    assert.deepEqual(rtnDuring, [
      `${RTN}/currentweek/2027`,
      `${RTN}/currentweek/2026`,
      `${RTN}/results/2026/4/0/5`,
      `${RTN}/schedule/2026/1`,
    ]);
    assert.equal(meta(db, 'schedule_season'), '2027');
    assert.match(meta(db, 'schedule_source') || '', /schedule\/2026\/1/);
    const stored = db.prepare('SELECT COUNT(*) AS n FROM meets').get() as { n: number };
    assert.equal(stored.n > 0, true);

    const after = hits.length;
    // The completing tick already moved `now` one minute ahead. Stay inside the interval.
    for (let tick = 0; tick < 5; tick++) {
      const summary = await pollOnce(env, now);
      assert.equal(summary.schedule, 'fresh');
      now = new Date(now.getTime() + 60_000);
    }
    const hourLater = new Date(Date.parse(meta(db, 'schedule_refreshed_at') || '') + 60 * 60 * 1000);
    const hourSummary = await pollOnce(env, hourLater);
    assert.equal(hourSummary.schedule, 'fresh');
    assert.equal(hits.length, after, `refreshed again inside the interval: ${hits.slice(after).join(' ')}`);

    const nextInterval = new Date(Date.parse(meta(db, 'schedule_refreshed_at') || '') + SCHEDULE_TTL_MS + 60_000);
    const again = await pollOnce(env, nextInterval);
    assert.equal(again.schedule, 'rtn');
    assert.equal(hits.filter((url) => url.startsWith(RTN)).length, rtnDuring.length + 1);
  } finally {
    globalThis.fetch = original;
  }
});
