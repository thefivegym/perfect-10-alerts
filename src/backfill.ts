import { RTN_CRAWL_DELAY_MS, RTN_ORIGIN, USER_AGENT, VIRTIUS_SESSION } from './config.ts';
import { insertAlert, metaGet, metaSet } from './db.ts';
import { extractRtnTens, extractVirtiusTens, meetContext } from './detect.ts';
import { describeMeet } from './messages.ts';
import { mergeMeets, parseIntrasquads, parsePublishedSchedule } from './schedule.ts';
import { seasonFor } from './time.ts';
import type { AlertDraft, StoredMeet } from './types.ts';
import { asObj, log, str } from './util.ts';

const JOB_KEY = 'club_backfill';
const VIRTIUS_BATCH = 6;

export interface BackfillJob {
  season: number;
  pending: StoredMeet[];
  logged: number;
  checked: number;
}

export interface BackfillStep {
  ok: boolean;
  season: number;
  logged: number;
  checked: number;
  remaining: number;
  done: boolean;
  waiting: boolean;
  retryAfterMs: number;
  pushes: 0;
  error?: string;
}

function dataBase(env: Env): string {
  return (env.SCOREBOARD_DATA_URL || 'https://thefivegym.github.io/live-scoreboard/data').replace(/\/$/, '');
}

async function getJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  return res.json() as Promise<unknown>;
}

/** Division I meets in `season`, Virtius sessions before Road to Nationals fallbacks. */
export function meetsForBackfill(meets: StoredMeet[], season: number): StoredMeet[] {
  const chosen = meets.filter((meet) => seasonFor(meet.date) === season && (meet.intrasquad || meet.d1Teams.length > 0));
  const virtius = chosen.filter((meet) => meet.virtius);
  const rtn = chosen.filter((meet) => !meet.virtius && meet.rtnId);
  return [...virtius, ...rtn];
}

export async function loadBackfillMeets(env: Env, season: number): Promise<StoredMeet[] | null> {
  const base = dataBase(env);
  const [schedule, hand, discovered] = await Promise.all([
    getJson(`${base}/schedule.json`),
    getJson(`${base}/intrasquads.json`),
    getJson(`${base}/intrasquads-discovered.json`),
  ]);
  const parsed = schedule ? parsePublishedSchedule(schedule) : null;
  if (!parsed) return null;
  return meetsForBackfill(mergeMeets(parsed.meets, parseIntrasquads(hand, discovered)), season);
}

function contextFromVirtius(json: unknown, meet: StoredMeet) {
  const session = asObj(asObj(json)?.meet) ?? asObj(json);
  const date = str(session?.meet_date);
  const teams = Array.isArray(session?.teams)
    ? session.teams.map((team) => str(asObj(team)?.name)).filter(Boolean)
    : [];
  const named = describeMeet(meet);
  return {
    meetKey: meet.meetKey,
    meetName: str(session?.name) || named.meetName || meet.meetKey,
    meetDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : meet.date,
    teamsLabel: teams.join(', ') || named.teamsLabel,
    d1Teams: meet.d1Teams,
    intrasquad: meet.intrasquad,
    videoUrl: meet.videoUrl,
    source: 'virtius' as const,
  };
}

async function readJob(env: Env): Promise<BackfillJob | null> {
  const raw = await metaGet(env.DB, JOB_KEY);
  if (!raw) return null;
  try {
    const job = JSON.parse(raw) as BackfillJob;
    if (!job || !Array.isArray(job.pending)) return null;
    return job;
  } catch {
    return null;
  }
}

async function writeJob(env: Env, job: BackfillJob | null): Promise<void> {
  await metaSet(env.DB, JOB_KEY, job ? JSON.stringify(job) : '');
}

async function storeDrafts(env: Env, drafts: AlertDraft[]): Promise<number> {
  let logged = 0;
  for (const draft of drafts) {
    const stamp = /^\d{4}-\d{2}-\d{2}$/.test(draft.meetDate) ? `${draft.meetDate}T12:00:00.000Z` : new Date().toISOString();
    if (await insertAlert(env.DB, draft, stamp)) logged += 1;
  }
  return logged;
}

function step(job: BackfillJob, extra: Partial<BackfillStep> = {}): BackfillStep {
  return {
    ok: true,
    season: job.season,
    logged: job.logged,
    checked: job.checked,
    remaining: job.pending.length,
    done: job.pending.length === 0,
    waiting: false,
    retryAfterMs: 0,
    pushes: 0,
    ...extra,
  };
}

/**
 * One slice of a season backfill. Virtius meets go in batches.
 * A meet with no Virtius key costs one Road to Nationals request, and never
 * sooner than the 30 second crawl delay. Nothing is pushed.
 */
export async function advanceSeasonBackfill(env: Env, season: number, reset = false, now = new Date()): Promise<BackfillStep> {
  if (!Number.isInteger(season) || season < 1990 || season > 2100) {
    return { ok: false, season, logged: 0, checked: 0, remaining: 0, done: false, waiting: false, retryAfterMs: 0, pushes: 0, error: 'Season must be a year.' };
  }
  if (reset) await writeJob(env, null);
  let job = await readJob(env);
  if (job && job.season !== season) job = null;
  if (!job) {
    const meets = await loadBackfillMeets(env, season);
    if (!meets) {
      return { ok: false, season, logged: 0, checked: 0, remaining: 0, done: false, waiting: false, retryAfterMs: 0, pushes: 0, error: 'The published schedule could not be read.' };
    }
    job = { season, pending: meets, logged: 0, checked: 0 };
    log('info', 'club_backfill_started', { season, meets: meets.length });
  }
  if (!job.pending.length) {
    await writeJob(env, null);
    return step(job, { done: true });
  }

  const next = job.pending[0];
  if (next?.virtius) {
    const batch: StoredMeet[] = [];
    while (job.pending[0]?.virtius && batch.length < VIRTIUS_BATCH) {
      const meet = job.pending.shift();
      if (meet) batch.push(meet);
    }
    const failed: StoredMeet[] = [];
    for (let i = 0; i < batch.length; i += VIRTIUS_BATCH) {
      const chunk = batch.slice(i, i + VIRTIUS_BATCH);
      const groups = await Promise.all(chunk.map(async (meet) => {
        const url = `${VIRTIUS_SESSION}/${encodeURIComponent(meet.virtius || '')}/json`;
        try {
          const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
          if (!res.ok) return { meet, drafts: null as AlertDraft[] | null };
          const json = await res.json() as unknown;
          return { meet, drafts: extractVirtiusTens(json, contextFromVirtius(json, meet)) };
        } catch (err) {
          log('error', 'club_backfill_virtius_failed', { meet: meet.meetKey, message: err instanceof Error ? err.message : 'fetch failed' });
          return { meet, drafts: null };
        }
      }));
      for (const group of groups) {
        job.checked += 1;
        if (!group.drafts) {
          if (group.meet.rtnId) failed.push({ ...group.meet, virtius: null });
          continue;
        }
        job.logged += await storeDrafts(env, group.drafts);
      }
    }
    job.pending.push(...failed);
    const done = job.pending.length === 0;
    await writeJob(env, done ? null : job);
    return step(job, { done });
  }

  const last = await metaGet(env.DB, 'last_rtn_at');
  const elapsed = last ? now.getTime() - Date.parse(last) : RTN_CRAWL_DELAY_MS;
  if (!Number.isFinite(elapsed) || elapsed < RTN_CRAWL_DELAY_MS) {
    return step(job, { waiting: true, retryAfterMs: Math.max(1000, RTN_CRAWL_DELAY_MS - (Number.isFinite(elapsed) ? elapsed : 0)) });
  }
  const meet = job.pending.shift();
  if (!meet || !meet.rtnId) {
    const done = job.pending.length === 0;
    await writeJob(env, done ? null : job);
    return step(job, { done });
  }
  await metaSet(env.DB, 'last_rtn_at', now.toISOString());
  job.checked += 1;
  try {
    const res = await fetch(`${RTN_ORIGIN}/meetresults/${meet.rtnId}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const json = await res.json() as unknown;
      job.logged += await storeDrafts(env, extractRtnTens(json, meetContext(meet, 'rtn')));
    }
  } catch (err) {
    log('error', 'club_backfill_rtn_failed', { meet: meet.meetKey, message: err instanceof Error ? err.message : 'fetch failed' });
  }
  const done = job.pending.length === 0;
  await writeJob(env, done ? null : job);
  log('info', 'club_backfill_step', { season, logged: job.logged, remaining: job.pending.length, source: 'rtn' });
  return step(job, { done });
}

function sqlText(value: string | null): string {
  if (value == null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

/** Idempotent INSERT statements. Applying them does not notify anyone. */
export function clubSeedSql(alerts: AlertDraft[]): string {
  const header = `-- 2026 Perfect 10 Club. ${alerts.length} perfect 10s from Virtius, with Road to Nationals where a meet had no Virtius session.\n-- Exhibition routines are not included. ON CONFLICT does nothing, and this file sends no pushes.\n`;
  if (!alerts.length) return header;
  const sorted = [...alerts].sort((a, b) => a.meetDate.localeCompare(b.meetDate) || a.athleteName.localeCompare(b.athleteName) || a.event.localeCompare(b.event) || a.id.localeCompare(b.id));
  const statements: string[] = [];
  const size = 20;
  for (let i = 0; i < sorted.length; i += size) {
    const rows = sorted.slice(i, i + size).map((alert) => {
      const detected = `${alert.meetDate}T12:00:00.000Z`;
      return `(${[
        sqlText(alert.id),
        sqlText(alert.athleteName),
        sqlText(alert.athleteId),
        sqlText(alert.team),
        sqlText(alert.event),
        '0',
        sqlText(alert.meetKey),
        sqlText(alert.meetName),
        sqlText(alert.meetDate),
        sqlText(alert.teamsLabel),
        sqlText(alert.videoUrl),
        sqlText(alert.clipUrl),
        sqlText(alert.scoreboardUrl),
        sqlText(alert.searchUrl),
        sqlText(alert.source),
        sqlText(detected),
        '0',
      ].join(', ')})`;
    });
    statements.push(`INSERT INTO alerts (
  id, athlete_name, athlete_id, team, event, exhibition, meet_key, meet_name, meet_date,
  teams_label, video_url, clip_url, scoreboard_url, search_url, source, detected_at, hidden
) VALUES
${rows.join(',\n')}
ON CONFLICT(id) DO NOTHING;`);
  }
  return `${header}\n${statements.join('\n\n')}\n`;
}
