import { bodyMayContainPerfectTen, extractVirtiusTens } from '../src/detect.ts';
import type { MeetContext } from '../src/types.ts';

const key = process.argv[2] || 'MFrZ9epozB';
const res = await fetch(`https://api.virti.us/session/${encodeURIComponent(key)}/json`);
if (!res.ok) {
  console.error(`Virtius HTTP ${res.status}`);
  process.exit(1);
}
const text = await res.text();
const json = JSON.parse(text) as { meet?: { name?: string; meet_date?: string } };
const meet: MeetContext = {
  meetKey: key,
  meetName: json.meet?.name || key,
  meetDate: json.meet?.meet_date || '1970-01-01',
  teamsLabel: '',
  d1Teams: [],
  intrasquad: false,
  videoUrl: null,
  source: 'virtius',
};
const alerts = extractVirtiusTens(json, meet);
console.log(JSON.stringify({
  key,
  prefilter: bodyMayContainPerfectTen(text),
  count: alerts.length,
  perfect_tens: alerts.map((alert) => ({
    athlete: alert.athleteName,
    team: alert.team,
    event: alert.event,
    exhibition: alert.exhibition,
    id: alert.id,
  })),
}, null, 2));
if (!alerts.length) process.exit(2);
