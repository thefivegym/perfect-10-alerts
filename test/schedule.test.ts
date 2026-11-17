import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  d1NamesFromRankings,
  mergeMeets,
  normalizeRtnSchedule,
  parseIntrasquads,
  parsePublishedSchedule,
  validSeason,
  virtiusKeyFromLink,
} from '../src/schedule.ts';
import { seasonFor, zonedToUtcIso } from '../src/time.ts';
import { meetIsInWindow } from '../src/window.ts';

test('eastern meet time becomes UTC the way the scoreboard does', () => {
  assert.equal(zonedToUtcIso('2026-01-02', '21:00:00', 'America/New_York'), '2026-01-03T02:00:00.000Z');
  assert.equal(seasonFor('2026-11-17'), 2027);
  assert.equal(seasonFor('2026-04-18'), 2026);
});

test('Virtius key from a stats link', () => {
  assert.equal(virtiusKeyFromLink('https://scores.virti.us/?s=MFrZ9epozB'), 'MFrZ9epozB');
  assert.equal(virtiusKeyFromLink('https://example.com'), null);
});

test('published schedule shape, and a changed shape falls through', () => {
  const parsed = parsePublishedSchedule({
    season: 2026,
    source: 'rtn',
    meets: [{
      id: 32829,
      date: '2026-04-18',
      start_utc: '2026-04-18T20:00:00.000Z',
      desc: 'NCAA Championships Finals',
      home: [],
      away: ['Florida', 'LSU'],
      d1_teams: ['Florida', 'LSU'],
      virtius: 'MFrZ9epozB',
      video_link: null,
    }],
  });
  assert.equal(parsed?.meets.length, 1);
  assert.equal(parsed?.meets[0].meetKey, 'MFrZ9epozB');
  assert.equal(parsePublishedSchedule({ meets: 'nope' }), null);
  assert.equal(parsePublishedSchedule({ somethingElse: true }), null);
  assert.equal(parsePublishedSchedule({ meets: [], season: 2026, season_published: false })?.meets.length, 0);
});

test('RTN schedule keeps Division I meets only', () => {
  const raw = {
    '2026-01-02': {
      meets: [
        { meet_id: 1, home_teams: 'Utah', away_teams: 'Iowa, Club Gym', time: '21:00:00', stats_link: 'https://scores.virti.us/?s=yLmIWwKtU0', video_link: 'https://example.com/watch', meet_desc: '' },
        { meet_id: 2, home_teams: 'Tiny College', away_teams: 'Another Club', time: '18:00:00' },
      ],
    },
  };
  const meets = normalizeRtnSchedule(raw, new Set(['Utah', 'Iowa']), [], ['Iowa']);
  assert.equal(meets.length, 1);
  assert.equal(meets[0].virtius, 'yLmIWwKtU0');
  assert.deepEqual(meets[0].d1Teams, ['Utah']);
  assert.equal(meets[0].videoUrl, 'https://example.com/watch');
  assert.equal(meets[0].startUtc, '2026-01-03T02:00:00.000Z');
});

test('rankings rows with div Div I are the D1 list', () => {
  const data = [
    ...Array.from({ length: 40 }, (_, i) => ({ div: 'Div I', name: `Team ${i}` })),
    { div: 'Div II', name: 'Small School' },
  ];
  const names = d1NamesFromRankings({ data });
  assert.equal(names?.length, 40);
  assert.equal(names?.includes('Small School'), false);
  assert.equal(d1NamesFromRankings({ data: [{ div: 'Div I', name: 'Only One' }] }), null);
});

test('a future season that echoes another year is not valid', () => {
  assert.equal(validSeason({ '2026-01-02': { meets: [] }, '2026-04-18': {} }, 2026), true);
  assert.equal(validSeason({ '2026-01-02': {} }, 2027), false);
});

test('intrasquad keys are included and a hand-listed key wins', () => {
  const hand = {
    events: [
      { school: 'Alabama', event: 'Fashion', date: '2026-11-20', virtius: null, skip: true },
      { school: 'Utah', event: 'Preview', date: '2026-12-11', virtius: 'previewKey1', skip: true, tz: 'America/Denver' },
      { school: 'Minnesota', event: 'Maroon vs Gold', date: '2025-12-19', virtius: 'xzRr0AuPWC', skip: false, tz: 'America/Chicago' },
    ],
  };
  const discovered = { events: [{ school: 'Minnesota', event: 'Other', date: '2025-12-19', virtius: 'otherKey01', skip: false }] };
  const meets = parseIntrasquads(hand, discovered);
  assert.deepEqual(meets.map((meet) => meet.meetKey).sort(), ['previewKey1', 'xzRr0AuPWC']);
  assert.equal(meets.every((meet) => meet.intrasquad), true);
  const merged = mergeMeets([{ ...meets[0], intrasquad: false, description: 'From schedule' }], meets);
  assert.equal(merged.find((meet) => meet.meetKey === meets[0].meetKey)?.description, 'From schedule');
});

test('meet window is 15 minutes before the start through 8 hours after', () => {
  const meet = { date: '2026-04-18', startUtc: '2026-04-18T20:00:00.000Z' };
  assert.equal(meetIsInWindow(meet, new Date('2026-04-18T19:50:00.000Z')), true);
  assert.equal(meetIsInWindow(meet, new Date('2026-04-18T19:30:00.000Z')), false);
  assert.equal(meetIsInWindow(meet, new Date('2026-04-19T03:30:00.000Z')), true);
  assert.equal(meetIsInWindow(meet, new Date('2026-04-19T04:30:00.000Z')), false);
});
