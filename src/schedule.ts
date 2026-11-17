import type { StoredMeet } from './types.ts';
import { seasonFor, zonedToUtcIso } from './time.ts';
import { asObj, decodeEntities, httpUrl, num, str } from './util.ts';
import { normTeam } from './detect.ts';

export function virtiusKeyFromLink(link: unknown): string | null {
  if (!link) return null;
  const match = String(link).match(/virti\.us\/[^\s]*?[?&]s=([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

function cleanKey(value: unknown): string | null {
  const key = str(value);
  if (!key || !/^[A-Za-z0-9_-]{6,64}$/.test(key)) return null;
  return key;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => decodeEntities(str(item))).filter(Boolean);
}

function splitTeams(value: unknown): string[] {
  return decodeEntities(str(value)).split(',').map((t) => t.trim()).filter(Boolean);
}

/** The published scoreboard file. Null when the shape is not the one we understand. */
export function parsePublishedSchedule(json: unknown): { meets: StoredMeet[]; source: string } | null {
  const root = asObj(json);
  if (!root || !Array.isArray(root.meets)) return null;
  if (!('season' in root) && !('generated_at' in root) && !('source' in root)) return null;
  const meets: StoredMeet[] = [];
  for (const raw of root.meets) {
    const meet = publishedMeet(raw);
    if (meet) meets.push(meet);
  }
  return { meets, source: str(root.source) || 'published schedule' };
}

function publishedMeet(raw: unknown): StoredMeet | null {
  const m = asObj(raw);
  if (!m) return null;
  const date = str(m.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const id = num(m.id);
  const virtius = cleanKey(m.virtius);
  const meetKey = virtius || (id != null ? `rtn-${id}` : '');
  if (!meetKey) return null;
  const home = strList(m.home);
  const away = strList(m.away);
  const d1 = strList(m.d1_teams);
  return {
    meetKey,
    rtnId: id,
    date,
    startUtc: str(m.start_utc) || null,
    description: decodeEntities(str(m.desc)),
    home,
    away,
    d1Teams: d1,
    virtius,
    videoUrl: httpUrl(m.video_link),
    videoDesc: decodeEntities(str(m.video_desc)) || null,
    intrasquad: false,
  };
}

interface IntrasquadEvent {
  school: string;
  event: string;
  date: string;
  timeLocal: string | null;
  tz: string;
  virtius: string | null;
  skip: boolean;
}

function eventsFrom(json: unknown): IntrasquadEvent[] {
  const root = asObj(json);
  const list = root && Array.isArray(root.events) ? root.events : Array.isArray(json) ? json : [];
  const out: IntrasquadEvent[] = [];
  for (const raw of list) {
    const e = asObj(raw);
    if (!e) continue;
    const date = str(e.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      school: decodeEntities(str(e.school)),
      event: decodeEntities(str(e.event)) || 'Intrasquad',
      date,
      timeLocal: str(e.time_local) || null,
      tz: str(e.tz) || 'America/Chicago',
      virtius: cleanKey(e.virtius),
      skip: e.skip === true,
    });
  }
  return out;
}

/**
 * Scored intrasquads. A key set on the hand list wins over a discovered key
 * for the same school and date. Events marked skip stay out unless a Virtius
 * key exists (then the scores are real).
 */
export function parseIntrasquads(hand: unknown, discovered: unknown): StoredMeet[] {
  const ordered = [...eventsFrom(hand), ...eventsFrom(discovered)];
  const seen = new Set<string>();
  const meets: StoredMeet[] = [];
  for (const event of ordered) {
    if (!event.virtius) continue;
    const slot = `${normTeam(event.school)}|${event.date}`;
    if (seen.has(slot) || seen.has(event.virtius)) continue;
    seen.add(slot);
    seen.add(event.virtius);
    let startUtc: string | null = null;
    if (event.timeLocal) {
      try { startUtc = zonedToUtcIso(event.date, event.timeLocal, event.tz); } catch { startUtc = null; }
    }
    meets.push({
      meetKey: event.virtius,
      rtnId: null,
      date: event.date,
      startUtc,
      description: event.event,
      home: event.school ? [event.school] : [],
      away: [],
      d1Teams: event.school ? [event.school] : [],
      virtius: event.virtius,
      videoUrl: null,
      videoDesc: null,
      intrasquad: true,
    });
  }
  return meets;
}

export function mergeMeets(schedule: StoredMeet[], intrasquads: StoredMeet[]): StoredMeet[] {
  const byKey = new Map<string, StoredMeet>();
  for (const meet of schedule) byKey.set(meet.meetKey, meet);
  for (const meet of intrasquads) {
    if (!byKey.has(meet.meetKey)) byKey.set(meet.meetKey, meet);
  }
  return [...byKey.values()];
}

/** RTN returns another season's dates when the requested season is not published yet. */
export function validSeason(sched: unknown, season: number): boolean {
  const root = asObj(sched);
  if (!root) return false;
  const keys = Object.keys(root).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
  return keys.length > 0 && keys.every((k) => seasonFor(k) === season);
}

export function d1NamesFromRankings(json: unknown): string[] | null {
  const root = asObj(json);
  const rows = root && Array.isArray(root.data) ? root.data : null;
  if (!rows) return null;
  const names = rows
    .map((row) => asObj(row))
    .filter((row): row is Record<string, unknown> => !!row && row.div === 'Div I')
    .map((row) => decodeEntities(str(row.name)))
    .filter(Boolean);
  if (names.length < 40) return null;
  return names;
}

export function d1NamesFromPublished(json: unknown): string[] | null {
  const root = asObj(json);
  if (!root || !Array.isArray(root.teams)) return null;
  const source = str(root.source);
  if (source && !/Div I/i.test(source)) return null;
  const names = root.teams.map((team) => decodeEntities(str(asObj(team)?.name))).filter(Boolean);
  if (names.length < 40) return null;
  return names;
}

export function overridesFrom(json: unknown): { include: string[]; exclude: string[] } {
  const root = asObj(json);
  return {
    include: strList(root?.include),
    exclude: strList(root?.exclude),
  };
}

/** Keep a meet when any participating team is Division I and not excluded. */
export function normalizeRtnSchedule(
  sched: unknown,
  d1Names: Set<string>,
  include: string[],
  exclude: string[],
): StoredMeet[] {
  const root = asObj(sched);
  if (!root) return [];
  const meets: StoredMeet[] = [];
  for (const [dateKey, dayRaw] of Object.entries(root)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    const day = asObj(dayRaw);
    const list = day && Array.isArray(day.meets) ? day.meets : [];
    for (const raw of list) {
      const m = asObj(raw);
      if (!m) continue;
      const home = splitTeams(m.home_teams);
      const away = splitTeams(m.away_teams);
      const isD1 = (team: string) => (d1Names.has(team) || include.includes(team)) && !exclude.includes(team);
      const d1Teams = [...home, ...away].filter(isD1);
      if (!d1Teams.length) continue;
      const id = num(m.meet_id);
      if (id == null) continue;
      const date = str(m.d) || dateKey;
      const time = str(m.time) || null;
      const virtius = virtiusKeyFromLink(m.stats_link);
      meets.push({
        meetKey: virtius || `rtn-${id}`,
        rtnId: id,
        date,
        startUtc: time ? zonedToUtcIso(date, time, 'America/New_York') : null,
        description: decodeEntities(str(m.meet_desc) || str(m.newdesc)),
        home,
        away,
        d1Teams,
        virtius,
        videoUrl: httpUrl(m.video_link),
        videoDesc: decodeEntities(str(m.video_desc)) || null,
        intrasquad: false,
      });
    }
  }
  return meets;
}
