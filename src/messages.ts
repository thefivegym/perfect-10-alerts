import { SCOREBOARD_HOME } from './config.ts';
import type { AlertDraft, EventKey, StoredMeet } from './types.ts';
import { formatMeetDate } from './time.ts';

export function eventLabel(event: string): string {
  switch (event) {
    case 'vault': return 'Vault';
    case 'bars': return 'Bars';
    case 'beam': return 'Beam';
    case 'floor': return 'Floor';
    default: return event;
  }
}

export function teamsLabel(home: string[], away: string[]): string {
  if (away.length && home.length) return `${away.join(', ')} at ${home.join(', ')}`;
  return [...away, ...home].join(', ');
}

export function scoreboardUrl(date: string, meetKey: string): string {
  return `${SCOREBOARD_HOME}?date=${date}#meet=${meetKey}`;
}

/** Live X search for the athlete's name plus 10, so fans can find the clip. */
export function xSearchUrl(athleteName: string): string {
  const q = `"${athleteName}" 10`;
  return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
}

export function notificationCopy(alert: Pick<AlertDraft, 'athleteName' | 'team' | 'event' | 'meetName' | 'teamsLabel'>, sample = false): { title: string; body: string } {
  const where = alert.meetName || alert.teamsLabel || 'a D1 meet';
  return {
    title: `${sample ? 'Sample · ' : ''}Perfect 10 · ${alert.athleteName}`,
    body: `${eventLabel(alert.event)} 10.0 · ${alert.team} · ${where}`,
  };
}

export function describeMeet(meet: Pick<StoredMeet, 'description' | 'home' | 'away'>): { meetName: string; teamsLabel: string } {
  const label = teamsLabel(meet.home, meet.away);
  return { meetName: meet.description || label, teamsLabel: label };
}

export function formatWhen(alert: Pick<AlertDraft, 'meetDate'>): string {
  return formatMeetDate(alert.meetDate);
}

export const SAMPLE_ALERT: AlertDraft = {
  id: 'sample',
  athleteName: 'Kailin Chio',
  athleteId: '33047',
  team: 'LSU',
  event: 'vault' satisfies EventKey,
  exhibition: false,
  meetKey: 'MFrZ9epozB',
  meetName: 'NCAA Championships Finals',
  meetDate: '2026-04-18',
  teamsLabel: 'Florida, LSU, Minnesota, Oklahoma',
  videoUrl: null,
  clipUrl: null,
  scoreboardUrl: scoreboardUrl('2026-04-18', 'MFrZ9epozB'),
  searchUrl: xSearchUrl('Kailin Chio'),
  source: 'virtius',
};
