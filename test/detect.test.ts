import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alertId,
  bodyMayContainPerfectTen,
  eventKey,
  extractRtnTens,
  extractVirtiusTens,
  isExhibitionOrder,
  isPerfectTen,
  teamIsD1,
  unseenAlerts,
} from '../src/detect.ts';
import type { AlertDraft, MeetContext } from '../src/types.ts';

const meet: MeetContext = {
  meetKey: 'MEETKEY1',
  meetName: 'Test Meet',
  meetDate: '2026-02-13',
  teamsLabel: 'Oklahoma, Utah',
  d1Teams: ['Oklahoma', 'Utah'],
  intrasquad: false,
  videoUrl: 'https://example.com/watch',
  source: 'virtius',
};

test('exact 10.0 only', () => {
  assert.equal(isPerfectTen('10.0000'), true);
  assert.equal(isPerfectTen('10'), true);
  assert.equal(isPerfectTen(10), true);
  assert.equal(isPerfectTen('10.0'), true);
  assert.equal(isPerfectTen('9.9875'), false);
  assert.equal(isPerfectTen('10.0001'), false);
  assert.equal(isPerfectTen('9.9999'), false);
  assert.equal(isPerfectTen('49.8000'), false);
  assert.equal(isPerfectTen(''), false);
  assert.equal(isPerfectTen(null), false);
  assert.equal(isPerfectTen('start'), false);
});

test('exhibition is lineup order 7 or later', () => {
  assert.equal(isExhibitionOrder(7), true);
  assert.equal(isExhibitionOrder('8'), true);
  assert.equal(isExhibitionOrder(6), false);
  assert.equal(isExhibitionOrder(1), false);
  assert.equal(isExhibitionOrder(null), false);
});

test('event names skip all-around', () => {
  assert.equal(eventKey('VAULT'), 'vault');
  assert.equal(eventKey('All Around'), 'aa');
  assert.equal(eventKey('ALL-AROUND'), 'aa');
});

test('prefilter ignores judge start values', () => {
  assert.equal(bodyMayContainPerfectTen('{"final_score":"10.0000"}'), true);
  assert.equal(bodyMayContainPerfectTen('{"final_score":"9.9875","start":"10.00","score":"9.80"}'), false);
  assert.equal(bodyMayContainPerfectTen('{"vault":"49.500","bars":"49.200"}'), false);
  assert.equal(bodyMayContainPerfectTen('{"vault":"10.0"}'), true);
  assert.equal(bodyMayContainPerfectTen('{"score":"10.00","final_score":"9.9500"}'), false);
  assert.equal(bodyMayContainPerfectTen('{"final_score":"10.0001"}'), false);
});

test('Virtius extraction: counting, exhibition, dropped, and not the near-misses', () => {
  const json = {
    meet: {
      teams: [
        {
          name: 'University of Oklahoma',
          short_name: 'Oklahoma',
          competing: 1,
          events: [
            {
              event_name: 'VAULT',
              event_score: '49.8000',
              gymnasts: [
                { gymnast_id: '1', full_name: 'A Starter', order: 1, type: 1, final_score: '10.0000', scores: [{ start: '10.00', score: '10.00' }] },
                { gymnast_id: '2', full_name: 'B Exhibition', order: 7, type: 0, final_score: '10.0' },
                { gymnast_id: '3', full_name: 'C Nine', order: 2, type: 1, final_score: '9.9875' },
                { gymnast_id: '4', full_name: 'D Dropped Ten', order: 6, type: 0, final_score: '10.0000' },
              ],
            },
            {
              event_name: 'BARS',
              event_score: '10.0000',
              gymnasts: [
                { gymnast_id: '5', full_name: 'E Not Ten', order: 1, type: 1, final_score: '9.9000', scores: [{ start: '10.00', score: '9.90' }] },
              ],
            },
          ],
        },
        {
          name: 'Club Gym',
          short_name: 'Club',
          competing: 1,
          events: [
            { event_name: 'FLOOR', event_score: '10', gymnasts: [{ gymnast_id: '9', full_name: 'F Club', order: 1, type: 1, final_score: '10.0000' }] },
          ],
        },
      ],
      event_results: [
        { event_name: 'VAULT', gymnasts: [
          { gymnast_id: '1', full_name: 'A Starter', final_score: '10.0000', short_name: 'Oklahoma' },
          { gymnast_id: '2', full_name: 'B Exhibition', final_score: '10.0000', short_name: 'Oklahoma' },
        ] },
        { event_name: 'All Around', gymnasts: [{ gymnast_id: '1', full_name: 'A Starter', final_score: '40.0000', short_name: 'Oklahoma' }] },
      ],
    },
  };
  const alerts = extractVirtiusTens(json, meet);
  const names = alerts.map((alert) => alert.athleteName).sort();
  assert.deepEqual(names, ['A Starter', 'D Dropped Ten']);
  assert.equal(alerts.some((alert) => alert.athleteName === 'B Exhibition'), false);
  assert.equal(alerts.every((alert) => alert.exhibition === false), true);
  assert.equal(alerts.filter((alert) => alert.athleteName === 'A Starter').length, 1);
  assert.equal(alerts[0].scoreboardUrl.includes('#meet=MEETKEY1'), true);
  assert.equal(alerts[0].videoUrl, 'https://example.com/watch');
  assert.equal(new Set(alerts.map((alert) => alert.id)).size, alerts.length);
});

test('an exhibition 10 is skipped', () => {
  const json = {
    meet: {
      teams: [{
        name: 'Oklahoma',
        short_name: 'Oklahoma',
        competing: 1,
        events: [{
          event_name: 'VAULT',
          gymnasts: [
            { gymnast_id: '2', full_name: 'B Exhibition', order: 7, type: 1, final_score: '10.0000' },
            { gymnast_id: '8', full_name: 'Late Exhibition', order: 9, final_score: '10' },
            { gymnast_id: '1', full_name: 'A Starter', order: 6, type: 1, final_score: '10.0000' },
          ],
        }],
      }],
      event_results: [{
        event_name: 'VAULT',
        gymnasts: [
          { gymnast_id: '2', full_name: 'B Exhibition', final_score: '10.0000', short_name: 'Oklahoma' },
          { gymnast_id: '8', full_name: 'Late Exhibition', final_score: '10.0000', short_name: 'Oklahoma' },
          { gymnast_id: '1', full_name: 'A Starter', final_score: '10.0000', short_name: 'Oklahoma' },
        ],
      }],
    },
  };
  const alerts = extractVirtiusTens(json, meet);
  assert.deepEqual(alerts.map((alert) => alert.athleteName), ['A Starter']);
  assert.equal(alerts[0].exhibition, false);
  assert.equal(alerts.some((alert) => /exhibition/i.test(alert.athleteName)), false);
});

test('Road to Nationals individual 10s ignore team totals', () => {
  const raw = {
    teams: [{ tid: 47, tname: 'Oklahoma', vault: '49.500', bars: '49.100', beam: '49', floor: '49' }],
    scores: [[
      { team_id: 47, first_name: 'Faith', last_name: 'Torrez', vault: '10.000', bars: '', beam: null, floor: '9.950', all_around: '39.500' },
      { team_id: 1, first_name: 'Jordan', last_name: 'Bowers', vault: '9.900', bars: '9.800', beam: '9.800', floor: '9.800' },
    ]],
  };
  const alerts = extractRtnTens(raw, { ...meet, source: 'rtn', meetKey: 'rtn-1' });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].athleteName, 'Faith Torrez');
  assert.equal(alerts[0].event, 'vault');
  assert.equal(alerts[0].exhibition, false);
  assert.equal(alerts[0].team, 'Oklahoma');
});

test('normalized RTN rows use gymnast scores, not the event total', () => {
  const normalized = {
    teams: [{
      name: 'LSU',
      events: [{ event: 'vault', score: 49.6, gymnasts: [{ name: 'Kailin Chio', score: 10 }, { name: 'Other', score: 9.8 }] }],
    }],
  };
  const alerts = extractRtnTens(normalized, { ...meet, d1Teams: ['LSU'], source: 'rtn' });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].athleteName, 'Kailin Chio');
});

test('intrasquads count every gymnast from that school', () => {
  const json = {
    meet: {
      teams: [{
        name: 'Maroon',
        short_name: 'Maroon',
        competing: 1,
        events: [{ event_name: 'BEAM', gymnasts: [{ gymnast_id: '7', full_name: 'Squad Star', order: 1, final_score: '10' }] }],
      }],
    },
  };
  const alerts = extractVirtiusTens(json, { ...meet, intrasquad: true, d1Teams: ['Minnesota'] });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].team, 'Maroon');
});

test('team name matching', () => {
  assert.equal(teamIsD1(['LSU'], ['LSU', 'Oklahoma'], false), true);
  assert.equal(teamIsD1(['University of Oklahoma'], ['Oklahoma'], false), true);
  assert.equal(teamIsD1(['Club'], ['Oklahoma'], false), false);
  assert.equal(teamIsD1(['Anyone'], [], false), true);
  assert.equal(teamIsD1(['Maroon'], ['Minnesota'], true), true);
});

test('dedupe key is athlete + event + meet, and a repeat is not sent', () => {
  const first: AlertDraft = {
    id: alertId('M', 'vault', '1', 'A Starter'),
    athleteName: 'A Starter', athleteId: '1', team: 'Oklahoma', event: 'vault', exhibition: false,
    meetKey: 'M', meetName: 'Meet', meetDate: '2026-02-13', teamsLabel: '', videoUrl: null, clipUrl: null,
    scoreboardUrl: '', searchUrl: '', source: 'virtius',
  };
  const again = { ...first };
  const otherEvent = { ...first, id: alertId('M', 'bars', '1', 'A Starter'), event: 'bars' as const };
  const seen = new Set<string>();
  assert.equal(unseenAlerts(seen, [first, again, otherEvent]).map((alert) => alert.event).join(','), 'vault,bars');
  assert.deepEqual(unseenAlerts(seen, [first, otherEvent]), []);
});
