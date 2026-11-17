import {
  DELIVER_WINDOW_MS,
  MAX_VIRTIUS_PER_TICK,
  RTN_CRAWL_DELAY_MS,
  RTN_ORIGIN,
  SCHEDULE_TTL_MS,
  USER_AGENT,
  VIRTIUS_SESSION,
} from './config.ts';
import { extractRtnTens, extractVirtiusTens, bodyMayContainPerfectTen, meetContext } from './detect.ts';
import { deliverPending } from './deliver.ts';
import {
  countMeets,
  insertAlert,
  listRecentAlerts,
  markPolled,
  meetsOnDates,
  metaGet,
  metaSet,
  replaceMeets,
} from './db.ts';
import {
  d1NamesFromPublished,
  d1NamesFromRankings,
  mergeMeets,
  normalizeRtnSchedule,
  overridesFrom,
  parseIntrasquads,
  parsePublishedSchedule,
  validSeason,
} from './schedule.ts';
import { addDays, seasonFor, ymdInTz } from './time.ts';
import type { AlertDraft, StoredMeet } from './types.ts';
import { log } from './util.ts';
import { meetIsInWindow } from './window.ts';

export interface PollSummary {
  schedule: 'fresh' | 'refreshed' | 'rtn' | 'stale';
  virtiusChecked: number;
  rtnChecked: number;
  tens: number;
  newAlerts: number;
  sent: number;
}

interface RtnJob {
  season: number;
  step: 'week' | 'teams' | 'schedule';
  week?: number;
  triedPrev?: boolean;
  teams?: string[];
}

async function getText(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, { headers });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await getText(url, { Accept: 'application/json', 'User-Agent': USER_AGENT });
    if (!res.ok) return null;
    return JSON.parse(res.text) as unknown;
  } catch (err) {
    log('error', 'fetch_failed', { url, message: err instanceof Error ? err.message : 'fetch failed' });
    return null;
  }
}

function dataBase(env: Env): string {
  return (env.SCOREBOARD_DATA_URL || 'https://thefivegym.github.io/live-scoreboard/data').replace(/\/$/, '');
}

async function loadPublished(env: Env): Promise<StoredMeet[] | null> {
  const base = dataBase(env);
  const [schedule, hand, discovered] = await Promise.all([
    getJson(`${base}/schedule.json`),
    getJson(`${base}/intrasquads.json`),
    getJson(`${base}/intrasquads-discovered.json`),
  ]);
  const parsed = schedule ? parsePublishedSchedule(schedule) : null;
  if (!parsed) return null;
  return mergeMeets(parsed.meets, parseIntrasquads(hand, discovered));
}

async function rtnAllowed(env: Env, now: Date): Promise<boolean> {
  const last = await metaGet(env.DB, 'last_rtn_at');
  if (!last) return true;
  const then = Date.parse(last);
  return !Number.isFinite(then) || now.getTime() - then >= RTN_CRAWL_DELAY_MS;
}

async function markRtn(env: Env, now: Date): Promise<void> {
  await metaSet(env.DB, 'last_rtn_at', now.toISOString());
}

async function readJob(env: Env): Promise<RtnJob | null> {
  const raw = await metaGet(env.DB, 'rtn_job');
  if (!raw) return null;
  try { return JSON.parse(raw) as RtnJob; } catch { return null; }
}

async function rtnFetch(env: Env, path: string, now: Date): Promise<unknown | null> {
  await markRtn(env, now);
  return getJson(`${RTN_ORIGIN}${path}`);
}

/** One Road to Nationals request, then stop. The next cron minute is past the crawl delay. */
async function rtnRefreshStep(env: Env, now: Date): Promise<'done' | 'continue' | 'skipped'> {
  if (!(await rtnAllowed(env, now))) return 'skipped';
  const today = ymdInTz(now);
  let job = await readJob(env);
  if (!job) job = { season: seasonFor(today), step: 'week' };

  if (job.step === 'week') {
    const payload = await rtnFetch(env, `/currentweek/${job.season}`, now);
    const week = Number((payload as { max?: unknown } | null)?.max) || 0;
    if (!week) {
      if (!job.triedPrev) {
        await metaSet(env.DB, 'rtn_job', JSON.stringify({ season: job.season - 1, step: 'week', triedPrev: true }));
        return 'continue';
      }
      await metaSet(env.DB, 'schedule_refreshed_at', now.toISOString());
      await metaSet(env.DB, 'rtn_job', '');
      log('error', 'rtn_no_rankings', { season: job.season });
      return 'done';
    }
    await metaSet(env.DB, 'rtn_job', JSON.stringify({ ...job, step: 'teams', week }));
    return 'continue';
  }

  if (job.step === 'teams') {
    const payload = await rtnFetch(env, `/results/${job.season}/${job.week}/0/5`, now);
    const names = d1NamesFromRankings(payload);
    if (!names) {
      if (!job.triedPrev) {
        await metaSet(env.DB, 'rtn_job', JSON.stringify({ season: job.season - 1, step: 'week', triedPrev: true }));
        return 'continue';
      }
      await metaSet(env.DB, 'schedule_refreshed_at', now.toISOString());
      await metaSet(env.DB, 'rtn_job', '');
      log('error', 'rtn_d1_list_short', { season: job.season });
      return 'done';
    }
    await metaSet(env.DB, 'rtn_job', JSON.stringify({ ...job, step: 'schedule', teams: names }));
    return 'continue';
  }

  const payload = await rtnFetch(env, `/schedule/${job.season}/1`, now);
  if (!validSeason(payload, job.season)) {
    if (!job.triedPrev) {
      await metaSet(env.DB, 'rtn_job', JSON.stringify({ season: job.season - 1, step: 'week', triedPrev: true }));
      return 'continue';
    }
    await metaSet(env.DB, 'schedule_refreshed_at', now.toISOString());
    await metaSet(env.DB, 'rtn_job', '');
    log('error', 'rtn_schedule_unusable', { season: job.season });
    return 'done';
  }
  const base = dataBase(env);
  const [overridesJson, hand, discovered] = await Promise.all([
    getJson(`${base}/d1-overrides.json`),
    getJson(`${base}/intrasquads.json`),
    getJson(`${base}/intrasquads-discovered.json`),
  ]);
  const overrides = overridesFrom(overridesJson);
  const schedule = normalizeRtnSchedule(payload, new Set(job.teams || []), overrides.include, overrides.exclude);
  const meets = mergeMeets(schedule, parseIntrasquads(hand, discovered));
  await replaceMeets(env.DB, meets);
  await metaSet(env.DB, 'schedule_refreshed_at', now.toISOString());
  await metaSet(env.DB, 'schedule_source', `${RTN_ORIGIN}/schedule/${job.season}/1`);
  await metaSet(env.DB, 'rtn_job', '');
  log('info', 'schedule_refreshed', { source: 'rtn', meets: meets.length, season: job.season });
  return 'done';
}

async function ensureSchedule(env: Env, now: Date): Promise<PollSummary['schedule']> {
  const refreshed = await metaGet(env.DB, 'schedule_refreshed_at');
  const age = refreshed ? now.getTime() - Date.parse(refreshed) : Infinity;
  const pending = await metaGet(env.DB, 'rtn_job');
  if (age < SCHEDULE_TTL_MS && !pending) return 'fresh';

  if (!pending) {
    const published = await loadPublished(env);
    if (published) {
      await replaceMeets(env.DB, published);
      await metaSet(env.DB, 'schedule_refreshed_at', now.toISOString());
      await metaSet(env.DB, 'schedule_source', 'published');
      await metaSet(env.DB, 'rtn_job', '');
      log('info', 'schedule_refreshed', { source: 'published', meets: published.length });
      return 'refreshed';
    }
    log('error', 'published_schedule_unreadable', { url: `${dataBase(env)}/schedule.json` });
  }
  const step = await rtnRefreshStep(env, now);
  return step === 'skipped' ? 'stale' : 'rtn';
}

async function pollVirtius(meet: StoredMeet): Promise<AlertDraft[]> {
  const url = `${VIRTIUS_SESSION}/${encodeURIComponent(meet.virtius || '')}/json`;
  const res = await getText(url, { Accept: 'application/json', 'User-Agent': USER_AGENT });
  if (!res.ok) throw new Error(`Virtius HTTP ${res.status}`);
  if (res.text.length > 2_000_000) throw new Error('Virtius payload too large');
  if (!bodyMayContainPerfectTen(res.text)) return [];
  return extractVirtiusTens(JSON.parse(res.text) as unknown, meetContext(meet, 'virtius'));
}

async function pollRtn(env: Env, meet: StoredMeet, now: Date): Promise<AlertDraft[] | null> {
  if (!meet.rtnId) return null;
  if (!(await rtnAllowed(env, now))) return null;
  const payload = await rtnFetch(env, `/meetresults/${meet.rtnId}`, now);
  if (!payload) return [];
  return extractRtnTens(payload, meetContext(meet, 'rtn'));
}

export async function pollOnce(env: Env, now = new Date()): Promise<PollSummary> {
  const schedule = await ensureSchedule(env, now);
  const today = ymdInTz(now);
  const dates = [addDays(today, -1), today, addDays(today, 1)];
  const meets = await meetsOnDates(env.DB, dates);
  const live = meets.filter((meet) => meetIsInWindow(meet, now));
  const virtius = live.filter((meet) => meet.virtius).sort((a, b) => (a.lastPolledAt || '').localeCompare(b.lastPolledAt || '')).slice(0, MAX_VIRTIUS_PER_TICK);
  const rtnMeet = schedule === 'rtn'
    ? null
    : live.filter((meet) => !meet.virtius && meet.rtnId).sort((a, b) => (a.lastPolledAt || '').localeCompare(b.lastPolledAt || ''))[0] || null;

  const drafts: AlertDraft[] = [];
  const checked: string[] = [];
  // Six at a time matches the Workers simultaneous-connection limit.
  for (let i = 0; i < virtius.length; i += 6) {
    const chunk = virtius.slice(i, i + 6);
    const results = await Promise.all(chunk.map(async (meet) => {
      checked.push(meet.meetKey);
      try {
        return await pollVirtius(meet);
      } catch (err) {
        log('error', 'virtius_poll_failed', { meet: meet.meetKey, message: err instanceof Error ? err.message : 'poll failed' });
        return [] as AlertDraft[];
      }
    }));
    for (const list of results) drafts.push(...list);
  }
  let rtnChecked = 0;
  if (rtnMeet) {
    try {
      const found = await pollRtn(env, rtnMeet, now);
      if (found) {
        rtnChecked = 1;
        checked.push(rtnMeet.meetKey);
        drafts.push(...found);
      }
    } catch (err) {
      log('error', 'rtn_poll_failed', { meet: rtnMeet.meetKey, message: err instanceof Error ? err.message : 'poll failed' });
    }
  }
  await markPolled(env.DB, checked, now.toISOString());

  let newAlerts = 0;
  for (const draft of drafts) {
    if (await insertAlert(env.DB, draft, now.toISOString())) newAlerts++;
  }
  const since = new Date(now.getTime() - DELIVER_WINDOW_MS).toISOString();
  const pending = await listRecentAlerts(env.DB, since);
  const sent = await deliverPending(env, pending, now);
  const summary: PollSummary = {
    schedule,
    virtiusChecked: virtius.length,
    rtnChecked,
    tens: drafts.length,
    newAlerts,
    sent,
  };
  log('info', 'poll', { ...summary, meets: meets.length, stored: await countMeets(env.DB) });
  return summary;
}
