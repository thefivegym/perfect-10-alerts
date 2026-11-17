import { describeMeet, scoreboardUrl, xSearchUrl } from './messages.ts';
import { canonicalTeam } from './teams.ts';
import type { AlertDraft, EventKey, MeetContext, StoredMeet } from './types.ts';
import { asObj, decodeEntities, str } from './util.ts';

/**
 * What counts as a perfect 10
 *
 * A perfect 10 is an individual vault, bars, beam, or floor score of exactly
 * 10.0 (four decimal places, which is how Virtius publishes "10.0000").
 * All-around totals, team event totals, and judge start values are not alerts.
 *
 * Exhibition routines are not alerts. On Virtius, lineup order 7 or later is
 * an exhibition (the same rule as the live scoreboard). That 10.0 is dropped,
 * including when the event leaderboard lists it again. Messages never say
 * "Exhibition".
 *
 * Virtius `type === 0` means the score was the one dropped from a six-person
 * lineup. That flag is not reliable until the rotation is over, so waiting
 * for it would miss the one-to-two minute target. A posted final score of
 * 10.0 in slots 1 through 6 alerts immediately. In a normal top-five count, a
 * 10.0 is never the discarded score.
 *
 * Road to Nationals does not mark exhibitions, so this filter applies to
 * Virtius lineups. An individual event score of exactly 10.0 on the RTN feed
 * is still alerted.
 *
 * One alert per athlete + event + meet. The lineup and the event leaderboard
 * can both list the same 10; that is still one alert.
 */

const EVENT_BY_NAME: Record<string, EventKey | 'aa'> = {
  VAULT: 'vault',
  BARS: 'bars',
  BEAM: 'beam',
  FLOOR: 'floor',
  'ALL AROUND': 'aa',
  'ALL-AROUND': 'aa',
  AA: 'aa',
};

export function eventKey(name: unknown): EventKey | 'aa' | null {
  if (typeof name !== 'string') return null;
  const mapped = EVENT_BY_NAME[name.trim().toUpperCase()];
  if (mapped) return mapped;
  const lower = name.trim().toLowerCase();
  if (lower === 'vault' || lower === 'bars' || lower === 'beam' || lower === 'floor') return lower;
  if (lower === 'aa' || lower === 'all around' || lower === 'all-around') return 'aa';
  return null;
}

/** True only for a score that rounds to 10.0000 at Virtius's four-decimal precision. */
export function isPerfectTen(score: unknown): boolean {
  if (score === null || score === undefined) return false;
  if (typeof score === 'string' && score.trim() === '') return false;
  const n = typeof score === 'number' ? score : Number(typeof score === 'string' ? score.trim() : NaN);
  if (!Number.isFinite(n)) return false;
  return Math.round(n * 10000) === 100000;
}

/** Lineup slot 7+ is an exhibition on Virtius. */
export function isExhibitionOrder(order: unknown): boolean {
  const n = typeof order === 'number' ? order : Number(order);
  return Number.isFinite(n) && n >= 7;
}

export function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function normTeam(name: string): string {
  return decodeEntities(name).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Dedupe key: one alert per athlete + event + meet. */
export function alertId(meetKey: string, event: string, athleteId: string | null, athleteName: string): string {
  const who = (athleteId && athleteId.trim()) || normalizeName(athleteName).toLowerCase();
  return `${meetKey}|${event}|${who.toLowerCase()}`;
}

/**
 * Fast reject before JSON.parse. Matches an athlete score field of exactly 10,
 * and ignores judge start values (those use the key "start", usually "10.00").
 */
export function bodyMayContainPerfectTen(text: string): boolean {
  // `score` is a judge's mark on Virtius (often 10.00) and is not the routine total.
  const re = /"(?:final_score|vault|bars|beam|floor)"\s*:\s*"?10(?:\.0+)?"?(?![0-9.])/;
  return re.test(text);
}

export function teamIsD1(labels: string[], d1Teams: string[], intrasquad: boolean): boolean {
  if (intrasquad) return true;
  if (!d1Teams.length) return true;
  const norms = labels.map(normTeam).filter((s) => s.length > 0);
  if (!norms.length) return false;
  return d1Teams.some((team) => {
    const d = normTeam(team);
    if (!d) return false;
    return norms.some((n) => n === d || (d.length >= 4 && n.includes(d)) || (n.length >= 4 && d.includes(n)));
  });
}

function athleteName(g: Record<string, unknown>): string {
  const full = str(g.full_name) || str(g.name);
  if (full) return normalizeName(decodeEntities(full));
  const built = `${str(g.first_name) || str(g.fname)} ${str(g.last_name) || str(g.lname)}`.trim();
  return built ? normalizeName(decodeEntities(built)) : '';
}

function finish(partial: Omit<AlertDraft, 'scoreboardUrl' | 'searchUrl' | 'clipUrl'> & { clipUrl?: string | null }): AlertDraft {
  return {
    ...partial,
    clipUrl: partial.clipUrl ?? null,
    scoreboardUrl: scoreboardUrl(partial.meetDate, partial.meetKey),
    searchUrl: xSearchUrl(partial.athleteName),
  };
}

export function meetContext(meet: StoredMeet, source: MeetContext['source']): MeetContext {
  const names = describeMeet(meet);
  return {
    meetKey: meet.meetKey,
    meetName: names.meetName,
    meetDate: meet.date,
    teamsLabel: names.teamsLabel,
    d1Teams: meet.d1Teams,
    intrasquad: meet.intrasquad,
    videoUrl: meet.videoUrl,
    source,
  };
}

interface Found {
  athleteName: string;
  athleteId: string | null;
  teamLabels: string[];
  team: string;
  event: EventKey;
  exhibition: boolean;
}

function put(map: Map<string, AlertDraft>, excluded: Set<string>, found: Found, meet: MeetContext): void {
  const id = alertId(meet.meetKey, found.event, found.athleteId, found.athleteName);
  // Lineup order is the exhibition signal. Drop the score, and do not let a
  // later leaderboard row (which has no order) put it back.
  if (found.exhibition) {
    excluded.add(id);
    map.delete(id);
    return;
  }
  if (excluded.has(id)) return;
  const labels = found.teamLabels.filter(Boolean);
  if (!teamIsD1(labels.length ? labels : [found.team], meet.d1Teams, meet.intrasquad)) return;
  if (map.has(id)) return;
  map.set(id, finish({
    id,
    athleteName: found.athleteName,
    athleteId: found.athleteId,
    team: found.team || 'Unknown',
    event: found.event,
    exhibition: false,
    meetKey: meet.meetKey,
    meetName: meet.meetName,
    meetDate: meet.meetDate,
    teamsLabel: meet.teamsLabel,
    videoUrl: meet.videoUrl,
    source: meet.source,
  }));
}

export function extractVirtiusTens(json: unknown, meet: MeetContext): AlertDraft[] {
  const root = asObj(json);
  const session = asObj(root?.meet) ?? root;
  if (!session) return [];
  const found = new Map<string, AlertDraft>();
  const excluded = new Set<string>();

  const teams = Array.isArray(session.teams) ? session.teams : [];
  for (const teamRaw of teams) {
    const team = asObj(teamRaw);
    if (!team) continue;
    if (team.competing === 0 || team.competing === '0') continue;
    const teamName = decodeEntities(str(team.name));
    const short = decodeEntities(str(team.short_name) || str(team.tricode));
    const display = canonicalTeam({ id: str(team.team_id), name: teamName, short });
    const events = Array.isArray(team.events) ? team.events : [];
    for (const evRaw of events) {
      const ev = asObj(evRaw);
      if (!ev) continue;
      const event = eventKey(ev.event_name);
      if (!event || event === 'aa') continue;
      const gymnasts = Array.isArray(ev.gymnasts) ? ev.gymnasts : [];
      for (const gRaw of gymnasts) {
        const g = asObj(gRaw);
        if (!g || !isPerfectTen(g.final_score)) continue;
        const name = athleteName(g);
        if (!name) continue;
        put(found, excluded, {
          athleteName: name,
          athleteId: str(g.gymnast_id) || null,
          teamLabels: [display, teamName, short],
          team: display,
          event,
          exhibition: isExhibitionOrder(g.order),
        }, meet);
      }
    }
  }

  const results = Array.isArray(session.event_results) ? session.event_results : [];
  for (const erRaw of results) {
    const er = asObj(erRaw);
    if (!er) continue;
    const event = eventKey(er.event_name);
    if (!event || event === 'aa') continue;
    const gymnasts = Array.isArray(er.gymnasts) ? er.gymnasts : [];
    for (const gRaw of gymnasts) {
      const g = asObj(gRaw);
      if (!g || !isPerfectTen(g.final_score)) continue;
      const name = athleteName(g);
      if (!name) continue;
      put(found, excluded, {
        athleteName: name,
        athleteId: str(g.gymnast_id) || null,
        teamLabels: [str(g.short_name), str(g.tricode), str(g.team_name)].map(decodeEntities),
        team: canonicalTeam({
          id: str(g.team_id),
          name: decodeEntities(str(g.team_name)),
          short: decodeEntities(str(g.short_name) || str(g.tricode)),
        }),
        event,
        exhibition: false,
      }, meet);
    }
  }

  return [...found.values()];
}

const RTN_EVENTS: EventKey[] = ['vault', 'bars', 'beam', 'floor'];

/** Raw Road to Nationals `/meetresults/{id}`, or the scoreboard's normalized file. */
export function extractRtnTens(json: unknown, meet: MeetContext): AlertDraft[] {
  const root = asObj(json);
  if (!root) return [];
  const firstTeam = asObj(Array.isArray(root.teams) ? root.teams[0] : null);
  if (Array.isArray(root.scores) || (firstTeam && ('tname' in firstTeam || 'tscore' in firstTeam))) {
    return extractRawRtn(root, meet);
  }
  return extractNormalizedRtn(root, meet);
}

function extractRawRtn(root: Record<string, unknown>, meet: MeetContext): AlertDraft[] {
  const found = new Map<string, AlertDraft>();
  const excluded = new Set<string>();
  const teamNameById = new Map<string, string>();
  for (const raw of Array.isArray(root.teams) ? root.teams : []) {
    const team = asObj(raw);
    if (!team) continue;
    const id = str(team.tid) || str(team.team_id);
    const name = canonicalTeam({ id, name: decodeEntities(str(team.tname) || str(team.name)) });
    if (id && name && name !== 'Unknown') teamNameById.set(id, name);
  }
  for (const group of Array.isArray(root.scores) ? root.scores : []) {
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      const g = asObj(raw);
      if (!g) continue;
      const name = athleteName(g);
      if (!name) continue;
      const team = canonicalTeam({
        id: str(g.team_id) || str(g.tid),
        name: decodeEntities(str(g.tname) || teamNameById.get(str(g.team_id)) || ''),
      });
      const athleteId = str(g.gid) || str(g.gymnast_id) || null;
      for (const event of RTN_EVENTS) {
        // Gymnast rows use vault/bars/beam/floor. Team totals live on the team
        // object and are ignored here; a team total is never an individual 10.
        if (!isPerfectTen(g[event])) continue;
        put(found, excluded, {
          athleteName: name,
          athleteId,
          teamLabels: [team],
          team: team || 'Unknown',
          event,
          exhibition: false,
        }, meet);
      }
    }
  }
  return [...found.values()];
}

function extractNormalizedRtn(root: Record<string, unknown>, meet: MeetContext): AlertDraft[] {
  const found = new Map<string, AlertDraft>();
  const excluded = new Set<string>();
  for (const raw of Array.isArray(root.teams) ? root.teams : []) {
    const team = asObj(raw);
    if (!team) continue;
    const teamName = canonicalTeam({ id: str(team.tid) || str(team.team_id), name: decodeEntities(str(team.name) || str(team.tname)) });
    for (const evRaw of Array.isArray(team.events) ? team.events : []) {
      const ev = asObj(evRaw);
      if (!ev) continue;
      const event = eventKey(ev.event);
      if (!event || event === 'aa') continue;
      for (const gRaw of Array.isArray(ev.gymnasts) ? ev.gymnasts : []) {
        const g = asObj(gRaw);
        if (!g || !isPerfectTen(g.score ?? g.final_score)) continue;
        const name = athleteName(g);
        if (!name) continue;
        put(found, excluded, {
          athleteName: name,
          athleteId: str(g.gymnast_id) || null,
          teamLabels: [teamName],
          team: teamName || 'Unknown',
          event,
          exhibition: false,
        }, meet);
      }
    }
  }
  return [...found.values()];
}

/** Pure dedupe: the second time a key is seen, it is not sent again. */
export function unseenAlerts(already: Set<string>, found: AlertDraft[]): AlertDraft[] {
  const fresh: AlertDraft[] = [];
  for (const alert of found) {
    if (already.has(alert.id)) continue;
    already.add(alert.id);
    fresh.push(alert);
  }
  return fresh;
}
