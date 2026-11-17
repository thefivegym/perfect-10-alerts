import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyMayContainPerfectTen, extractVirtiusTens } from '../src/detect.ts';
import type { MeetContext } from '../src/types.ts';

const KEY = 'MFrZ9epozB';

test('replay of the 2026 NCAA Championship final finds Kailin Chio\'s vault 10', async () => {
  const res = await fetch(`https://api.virti.us/session/${KEY}/json`, { signal: AbortSignal.timeout(20_000) });
  assert.equal(res.ok, true, `Virtius HTTP ${res.status}`);
  const text = await res.text();
  assert.equal(bodyMayContainPerfectTen(text), true);
  const meet: MeetContext = {
    meetKey: KEY,
    meetName: "NCAA '26: National Championship",
    meetDate: '2026-04-18',
    teamsLabel: 'Florida, LSU, Minnesota, Oklahoma',
    d1Teams: ['Florida', 'LSU', 'Minnesota', 'Oklahoma'],
    intrasquad: false,
    videoUrl: null,
    source: 'virtius',
  };
  const alerts = extractVirtiusTens(JSON.parse(text) as unknown, meet);
  const chio = alerts.find((alert) => alert.athleteName === 'Kailin Chio' && alert.event === 'vault');
  if (!chio) assert.fail(`expected Kailin Chio on vault, found ${alerts.map((alert) => alert.athleteName).join(', ') || 'nobody'}`);
  assert.equal(chio.exhibition, false);
  assert.equal(chio.team, 'LSU');
  assert.equal(chio.meetDate, '2026-04-18');
  assert.match(chio.scoreboardUrl, /date=2026-04-18#meet=MFrZ9epozB/);
  assert.match(chio.searchUrl, /Kailin%20Chio/);
  assert.equal(alerts.some((alert) => alert.athleteName === 'Lily Pederson'), false);
  assert.equal(alerts.every((alert) => ['vault', 'bars', 'beam', 'floor'].includes(alert.event)), true);
  assert.equal(new Set(alerts.map((alert) => alert.id)).size, alerts.length);
  assert.equal(alerts.length, 1);
  assert.equal(bodyMayContainPerfectTen(text.replaceAll('10.0000', '9.9875')), false);
});
