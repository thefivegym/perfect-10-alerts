import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildClub, dedupeSameDay, type ClubSource } from '../src/club.ts';
import { canonicalTeam } from '../src/teams.ts';

test('Virtius short codes and team ids use the Road to Nationals name', () => {
  assert.equal(canonicalTeam({ id: '61', short: 'STAN' }), 'Stanford');
  assert.equal(canonicalTeam({ id: '22', name: 'Florida', short: 'FLA' }), 'Florida');
  assert.equal(canonicalTeam({ short: 'OKLA' }), 'Oklahoma');
  assert.equal(canonicalTeam({ short: 'UTAH' }), 'Utah');
  assert.equal(canonicalTeam({ short: 'MSU' }), 'Michigan State');
  assert.equal(canonicalTeam({ id: '17', name: 'CMU', short: 'CMU' }), 'Central Michigan');
  assert.equal(canonicalTeam({ name: 'LSU', short: 'LSU' }), 'LSU');
  assert.equal(canonicalTeam({ name: 'UCLA' }), 'UCLA');
  assert.equal(canonicalTeam({ name: 'University of Oklahoma' }), 'Oklahoma');
});

test('the same athlete, event, and date counts once and team totals do not split a school', () => {
  const shared = { event: 'beam' as const, date: '2026-02-27', detectedAt: '2026-02-27T12:00:00.000Z', clipUrl: null };
  const entries: ClubSource[] = [
    { ...shared, id: 'virtius|beam|32994', athlete: 'Skye Blakely', team: 'FLA', meet: 'Florida quad', meetUrl: 'https://example.com/?date=2026-02-27#meet=81i9ZkWi9w' },
    { ...shared, id: 'rtn-32195|beam|32994', athlete: 'Skye Blakely', team: 'Florida', meet: 'Florida quad', meetUrl: 'https://example.com/?date=2026-02-27#meet=rtn-32195' },
    { ...shared, id: 'other|vault|1', athlete: 'Anna Roberts', team: 'STAN', event: 'vault', meet: 'Stanford', meetUrl: 'https://example.com/#meet=abc', date: '2026-02-27' },
  ];
  const club = buildClub(entries, 2026);
  assert.equal(club.count, 2);
  assert.equal(club.entries.filter((entry) => entry.athlete === 'Skye Blakely').length, 1);
  assert.equal(club.entries.find((entry) => entry.athlete === 'Skye Blakely')?.team, 'Florida');
  assert.equal(club.leaderboard.find((row) => row.athlete === 'Anna Roberts')?.team, 'Stanford');
  assert.deepEqual(club.teams.map((team) => team.team).sort(), ['Florida', 'Stanford']);
  assert.equal(dedupeSameDay(entries).length, 2);
});
