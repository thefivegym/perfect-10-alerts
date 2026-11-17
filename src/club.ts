import { eventLabel } from './messages.ts';
import type { EventKey } from './types.ts';
import { seasonFor, ymdInTz } from './time.ts';

export const EVENT_BADGE: Record<EventKey, string> = {
  vault: 'VT',
  bars: 'UB',
  beam: 'BB',
  floor: 'FX',
};

export interface ClubSource {
  id: string;
  athlete: string;
  team: string;
  event: EventKey;
  meet: string;
  date: string;
  detectedAt: string;
  meetUrl: string;
  clipUrl: string | null;
}

export interface ClubEntry extends ClubSource {
  shoutout: string;
  badge: string;
}

export interface LeaderRow {
  rank: number;
  athlete: string;
  team: string;
  count: number;
  latest: string;
  hot: boolean;
  events: Record<EventKey, number>;
}

export interface TeamRow {
  team: string;
  count: number;
}

/** Replay and backfill stay off the public log unless the caller asks. */
export function clubWriteMode(body: { record?: unknown; log?: unknown }): 'none' | 'log' | 'notify' {
  if (body.record === true) return 'notify';
  if (body.log === true) return 'log';
  return 'none';
}

export function shoutout(athlete: string, event: string, team: string): string {
  return `Congrats, ${athlete}! Perfect 10 on ${eventLabel(event).toLowerCase()} for ${team}.`;
}

export function currentSeason(now = new Date()): number {
  return seasonFor(ymdInTz(now));
}

/** Season 2026 is 1 Jul 2025 through 30 Jun 2026. */
export function inSeason(date: string, season: number): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && seasonFor(date) === season;
}

function athleteKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function rankLeaders(entries: ClubSource[]): LeaderRow[] {
  const grouped = new Map<string, LeaderRow & { latestAt: string }>();
  const chronological = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.detectedAt.localeCompare(b.detectedAt));
  for (const entry of chronological) {
    const key = athleteKey(entry.athlete);
    let row = grouped.get(key);
    if (!row) {
      row = {
        rank: 0,
        athlete: entry.athlete,
        team: entry.team,
        count: 0,
        latest: entry.date,
        latestAt: entry.detectedAt,
        hot: false,
        events: { vault: 0, bars: 0, beam: 0, floor: 0 },
      };
      grouped.set(key, row);
    }
    row.count += 1;
    row.events[entry.event] += 1;
    if (entry.date > row.latest || (entry.date === row.latest && entry.detectedAt >= row.latestAt)) {
      row.latest = entry.date;
      row.latestAt = entry.detectedAt;
      row.athlete = entry.athlete;
      row.team = entry.team;
    }
  }
  const ordered = [...grouped.values()].sort((a, b) =>
    b.count - a.count || b.latest.localeCompare(a.latest) || b.latestAt.localeCompare(a.latestAt) || a.athlete.localeCompare(b.athlete));
  let rank = 0;
  let previousCount = -1;
  return ordered.map((row, index) => {
    if (row.count !== previousCount) {
      rank = index + 1;
      previousCount = row.count;
    }
    return {
      rank,
      athlete: row.athlete,
      team: row.team,
      count: row.count,
      latest: row.latest,
      hot: row.count >= 2,
      events: row.events,
    };
  });
}

export function teamCounts(entries: ClubSource[]): TeamRow[] {
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(entry.team, (totals.get(entry.team) || 0) + 1);
  return [...totals.entries()]
    .map(([team, count]) => ({ team, count }))
    .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
}

export function buildClub(entries: ClubSource[], season: number): {
  season: number;
  count: number;
  entries: ClubEntry[];
  leaderboard: LeaderRow[];
  teams: TeamRow[];
} {
  const seasonEntries = entries
    .filter((entry) => inSeason(entry.date, season))
    .sort((a, b) => b.date.localeCompare(a.date) || b.detectedAt.localeCompare(a.detectedAt));
  return {
    season,
    count: seasonEntries.length,
    entries: seasonEntries.map((entry) => ({
      ...entry,
      shoutout: shoutout(entry.athlete, entry.event, entry.team),
      badge: EVENT_BADGE[entry.event],
    })),
    leaderboard: rankLeaders(seasonEntries),
    teams: teamCounts(seasonEntries),
  };
}
