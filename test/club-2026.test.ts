import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { buildClub, type ClubSource } from '../src/club.ts';
import { seasonFor } from '../src/time.ts';
import type { AlertDraft } from '../src/types.ts';

test('the seeded 2026 club is the real season and ranks on the leaderboard', () => {
  const raw = JSON.parse(readFileSync('data/club-2026.json', 'utf8')) as { season: number; count: number; entries: AlertDraft[] };
  assert.equal(raw.season, 2026);
  assert.equal(raw.entries.length, raw.count);
  assert.ok(raw.count >= 30, `expected a full season, found ${raw.count}`);
  for (const alert of raw.entries) {
    assert.equal(alert.exhibition, false);
    assert.equal(seasonFor(alert.meetDate), 2026, alert.id);
    assert.ok(alert.athleteName && alert.team && alert.event);
  }
  const chio = raw.entries.find((alert) => alert.athleteName === 'Kailin Chio' && alert.event === 'vault' && alert.meetDate === '2026-04-18');
  assert.ok(chio, 'Kailin Chio vault 10 at the 2026 NCAA championship');
  assert.match(chio.meetName, /National Championship/);

  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  db.exec(readFileSync('migrations/0002_club.sql', 'utf8'));
  db.exec(readFileSync('migrations/0003_club_2026.sql', 'utf8'));
  db.exec(readFileSync('migrations/0003_club_2026.sql', 'utf8'));
  const row = db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE hidden = 0 AND exhibition = 0').get() as { n: number };
  assert.equal(row.n, raw.count);

  const entries: ClubSource[] = raw.entries.map((alert) => ({
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
  const club = buildClub(entries, 2026);
  assert.equal(club.count, raw.count);
  assert.ok(club.leaderboard.length > 0);
  assert.equal(club.leaderboard[0]?.hot, club.leaderboard[0]?.count >= 2);
  const chioRow = club.leaderboard.find((leader) => leader.athlete === 'Kailin Chio');
  assert.ok(chioRow && chioRow.count >= 2 && chioRow.events.vault >= 1);
  assert.equal(buildClub(entries, 2027).count, 0);
});
