import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { alertBinds, deliveryDecision, INSERT_ALERT_SQL } from '../src/db.ts';
import type { AlertDraft } from '../src/types.ts';

const alert: AlertDraft = {
  id: 'MFrZ9epozB|vault|33047',
  athleteName: 'Kailin Chio',
  athleteId: '33047',
  team: 'LSU',
  event: 'vault',
  exhibition: false,
  meetKey: 'MFrZ9epozB',
  meetName: 'NCAA Championships Finals',
  meetDate: '2026-04-18',
  teamsLabel: 'Florida, LSU, Minnesota, Oklahoma',
  videoUrl: null,
  clipUrl: null,
  scoreboardUrl: 'https://thefivegym.github.io/live-scoreboard/?date=2026-04-18#meet=MFrZ9epozB',
  searchUrl: 'https://x.com/search?q=%22Kailin%20Chio%22%2010',
  source: 'virtius',
};

test('the alerts primary key stores one row per athlete, event, and meet', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  const insert = db.prepare(INSERT_ALERT_SQL);
  const first = insert.run(...alertBinds(alert, '2026-04-18T22:10:00.000Z'));
  const second = insert.run(...alertBinds(alert, '2026-04-18T22:11:00.000Z'));
  const count = db.prepare('SELECT COUNT(*) AS n FROM alerts').get() as { n: number };
  assert.equal(first.changes, 1);
  assert.equal(second.changes, 0);
  assert.equal(count.n, 1);
});

test('a sent delivery is never claimed again, and a fresh one is', () => {
  assert.equal(deliveryDecision(null, 1_000), 'send');
  assert.equal(deliveryDecision({ status: 'sent', attempts: 1, updated_at: '2026-04-18T22:00:00.000Z' }, Date.parse('2026-04-18T23:00:00.000Z')), 'skip');
  assert.equal(deliveryDecision({ status: 'failed', attempts: 6, updated_at: '2026-04-18T22:00:00.000Z' }, Date.parse('2026-04-18T23:00:00.000Z')), 'skip');
  assert.equal(deliveryDecision({ status: 'failed', attempts: 2, updated_at: '2026-04-18T22:00:00.000Z' }, Date.parse('2026-04-18T23:00:00.000Z')), 'send');
  const claimedAt = '2026-04-18T22:00:00.000Z';
  assert.equal(deliveryDecision({ status: 'claimed', attempts: 1, updated_at: claimedAt }, Date.parse(claimedAt) + 30_000), 'skip');
  assert.equal(deliveryDecision({ status: 'claimed', attempts: 1, updated_at: claimedAt }, Date.parse(claimedAt) + 3 * 60_000), 'send');
});
