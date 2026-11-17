import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { buildClub, clubSeasons, clubWriteMode, rankLeaders, shoutout, type ClubSource } from '../src/club.ts';
import { alertBinds, INSERT_ALERT_SQL } from '../src/db.ts';
import type { AlertDraft } from '../src/types.ts';

function entry(partial: Partial<ClubSource> & Pick<ClubSource, 'id' | 'athlete' | 'team' | 'event' | 'date'>): ClubSource {
  return {
    meet: 'Sample Meet',
    detectedAt: `${partial.date}T12:00:00.000Z`,
    meetUrl: 'https://example.com/meet',
    clipUrl: null,
    ...partial,
  };
}

test('the season menu includes the seeded 2026 log and the current season', () => {
  const seasons = clubSeasons(['2026-04-18'], 2026, new Date('2026-11-17T18:00:00.000Z'));
  assert.deepEqual(seasons, [2027, 2026]);
  const board = buildClub([
    entry({ id: 'chio', athlete: 'Kailin Chio', team: 'LSU', event: 'vault', date: '2026-04-18' }),
  ], 2026);
  assert.equal(board.count, 1);
  assert.equal(board.leaderboard[0]?.athlete, 'Kailin Chio');
  assert.equal(board.leaderboard[0]?.events.vault, 1);
});

test('a shoutout names the gymnast, event, and team', () => {
  assert.equal(shoutout('Jamie Sample', 'vault', 'Sample State'), 'Congrats, Jamie Sample! Perfect 10 on vault for Sample State.');
});

test('the club lists a season newest first and ranks ties by the latest 10', () => {
  const entries = [
    entry({ id: 'a1', athlete: 'Jamie Sample', team: 'Sample State', event: 'vault', date: '2026-02-14', clipUrl: 'https://example.com/clip' }),
    entry({ id: 'a2', athlete: 'Jamie Sample', team: 'Sample State', event: 'floor', date: '2026-04-01' }),
    entry({ id: 'b1', athlete: 'Alex Sample', team: 'Example U', event: 'vault', date: '2026-01-10' }),
    entry({ id: 'b2', athlete: 'Alex Sample', team: 'Example U', event: 'beam', date: '2026-03-01' }),
    entry({ id: 'c1', athlete: 'Riley Sample', team: 'Example U', event: 'bars', date: '2026-03-20' }),
    entry({ id: 'old', athlete: 'Pat Sample', team: 'Old College', event: 'vault', date: '2025-02-01' }),
  ];
  const club = buildClub(entries, 2026);
  assert.equal(club.count, 5);
  assert.deepEqual(club.entries.map((row) => row.id), ['a2', 'c1', 'b2', 'a1', 'b1']);
  assert.equal(club.entries[0].shoutout, 'Congrats, Jamie Sample! Perfect 10 on floor for Sample State.');
  assert.equal(club.entries[0].clipUrl, null);
  assert.equal(club.entries.find((row) => row.id === 'a1')?.clipUrl, 'https://example.com/clip');
  assert.deepEqual(club.leaderboard.map((row) => [row.rank, row.athlete, row.count, row.hot]), [
    [1, 'Jamie Sample', 2, true],
    [1, 'Alex Sample', 2, true],
    [3, 'Riley Sample', 1, false],
  ]);
  assert.deepEqual(club.leaderboard[0].events, { vault: 1, bars: 0, beam: 0, floor: 1 });
  assert.deepEqual(club.teams, [
    { team: 'Example U', count: 3 },
    { team: 'Sample State', count: 2 },
  ]);
  assert.equal(rankLeaders(entries.filter((row) => row.date.startsWith('2025'))).length, 1);
});

test('a plain replay does not write the public log', () => {
  assert.equal(clubWriteMode({}), 'none');
  assert.equal(clubWriteMode({ record: false, log: false }), 'none');
  assert.equal(clubWriteMode({ log: true }), 'log');
  assert.equal(clubWriteMode({ record: true }), 'notify');
});

test('hidden club rows stay out of the public query', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  db.exec(readFileSync('migrations/0002_club.sql', 'utf8'));
  const insert = db.prepare(INSERT_ALERT_SQL);
  const row = (id: string, name: string): AlertDraft => ({
    id, athleteName: name, athleteId: null, team: 'Sample State', event: 'vault', exhibition: false,
    meetKey: 'sample', meetName: 'Sample Meet', meetDate: '2026-02-14', teamsLabel: '',
    videoUrl: null, clipUrl: null, scoreboardUrl: 'https://example.com/meet', searchUrl: 'https://example.com/search',
    source: 'virtius',
  });
  insert.run(...alertBinds(row('keep', 'Jamie Sample'), '2026-02-14T12:00:00.000Z'));
  insert.run(...alertBinds(row('hide', 'Hidden Sample'), '2026-02-14T12:00:00.000Z'));
  db.prepare('UPDATE alerts SET hidden = 1 WHERE id = ?').run('hide');
  const visible = db.prepare('SELECT athlete_name AS name FROM alerts WHERE hidden = 0 AND exhibition = 0').all() as { name: string }[];
  assert.deepEqual(visible.map((item) => item.name), ['Jamie Sample']);
});
