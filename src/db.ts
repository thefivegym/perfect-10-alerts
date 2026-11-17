import type { ClubSource } from './club.ts';
import { CLAIM_STALE_MS, DELIVERY_ATTEMPTS } from './config.ts';
import { canonicalTeam } from './teams.ts';
import type { AlertDraft, EventKey, StoredMeet, SubscriberRow } from './types.ts';

export interface DeliveryState {
  status: string;
  attempts: number;
  updated_at: string;
}

/** Whether this subscriber still needs the message. Pure, so the dedupe rule can be tested without D1. */
export function deliveryDecision(existing: DeliveryState | null, nowMs: number): 'send' | 'skip' {
  if (!existing) return 'send';
  if (existing.status === 'sent') return 'skip';
  if (existing.attempts >= DELIVERY_ATTEMPTS) return 'skip';
  if (existing.status === 'claimed' && nowMs - Date.parse(existing.updated_at) < CLAIM_STALE_MS) return 'skip';
  return 'send';
}

export async function metaGet(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function metaSet(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

export async function replaceMeets(db: D1Database, meets: StoredMeet[]): Promise<void> {
  await db.prepare('DELETE FROM meets').run();
  const sql = `INSERT INTO meets (
    meet_key, rtn_id, date, start_utc, description, home_json, away_json, d1_teams_json,
    virtius, video_url, video_desc, intrasquad, last_polled_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`;
  const stmts: D1PreparedStatement[] = [];
  for (const meet of meets) {
    stmts.push(db.prepare(sql).bind(
      meet.meetKey,
      meet.rtnId,
      meet.date,
      meet.startUtc,
      meet.description,
      JSON.stringify(meet.home),
      JSON.stringify(meet.away),
      JSON.stringify(meet.d1Teams),
      meet.virtius,
      meet.videoUrl,
      meet.videoDesc,
      meet.intrasquad ? 1 : 0,
    ));
  }
  const chunk = 40;
  for (let i = 0; i < stmts.length; i += chunk) await db.batch(stmts.slice(i, i + chunk));
}

interface MeetSqlRow {
  meet_key: string;
  rtn_id: number | null;
  date: string;
  start_utc: string | null;
  description: string | null;
  home_json: string;
  away_json: string;
  d1_teams_json: string;
  virtius: string | null;
  video_url: string | null;
  video_desc: string | null;
  intrasquad: number;
  last_polled_at: string | null;
}

function readMeet(row: MeetSqlRow): StoredMeet {
  const parse = (value: string): string[] => {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  };
  return {
    meetKey: row.meet_key,
    rtnId: row.rtn_id,
    date: row.date,
    startUtc: row.start_utc,
    description: row.description || '',
    home: parse(row.home_json),
    away: parse(row.away_json),
    d1Teams: parse(row.d1_teams_json),
    virtius: row.virtius,
    videoUrl: row.video_url,
    videoDesc: row.video_desc,
    intrasquad: row.intrasquad === 1,
    lastPolledAt: row.last_polled_at,
  };
}

export async function meetsOnDates(db: D1Database, dates: string[]): Promise<StoredMeet[]> {
  if (!dates.length) return [];
  const marks = dates.map(() => '?').join(', ');
  const result = await db.prepare(`SELECT * FROM meets WHERE date IN (${marks})`).bind(...dates).all<MeetSqlRow>();
  return (result.results || []).map(readMeet);
}

export async function countMeets(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM meets').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function markPolled(db: D1Database, meetKeys: string[], iso: string): Promise<void> {
  if (!meetKeys.length) return;
  const stmts = meetKeys.map((key) => db.prepare('UPDATE meets SET last_polled_at = ? WHERE meet_key = ?').bind(iso, key));
  const chunk = 40;
  for (let i = 0; i < stmts.length; i += chunk) await db.batch(stmts.slice(i, i + chunk));
}

export const INSERT_ALERT_SQL = `INSERT INTO alerts (
  id, athlete_name, athlete_id, team, event, exhibition, meet_key, meet_name, meet_date,
  teams_label, video_url, clip_url, scoreboard_url, search_url, source, detected_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING`;

export function alertBinds(alert: AlertDraft, detectedAt: string): (string | number | null)[] {
  return [
    alert.id,
    alert.athleteName,
    alert.athleteId,
    alert.team,
    alert.event,
    alert.exhibition ? 1 : 0,
    alert.meetKey,
    alert.meetName,
    alert.meetDate,
    alert.teamsLabel,
    alert.videoUrl,
    alert.clipUrl,
    alert.scoreboardUrl,
    alert.searchUrl,
    alert.source,
    detectedAt,
  ];
}

/** True when this athlete already has this event on this date, under any meet id. */
export async function sameDayScore(db: D1Database, alert: Pick<AlertDraft, 'athleteId' | 'athleteName' | 'event' | 'meetDate'>): Promise<boolean> {
  const row = await db.prepare(
    `SELECT id FROM alerts
     WHERE event = ? AND meet_date = ?
       AND (
         (? <> '' AND athlete_id = ?)
         OR athlete_name = ? COLLATE NOCASE
       )
     LIMIT 1`,
  ).bind(alert.event, alert.meetDate, alert.athleteId || '', alert.athleteId || '', alert.athleteName).first<{ id: string }>();
  return !!row;
}

/** Returns true when this call stored a new alert. A repeat of the same score stores nothing. */
export async function insertAlert(db: D1Database, alert: AlertDraft, detectedAt: string): Promise<boolean> {
  if (await sameDayScore(db, alert)) return false;
  const named = { ...alert, team: canonicalTeam({ name: alert.team, short: alert.team }) };
  const result = await db.prepare(INSERT_ALERT_SQL).bind(...alertBinds(named, detectedAt)).run();
  return (result.meta?.changes ?? 0) > 0;
}

interface AlertSqlRow {
  id: string;
  athlete_name: string;
  athlete_id: string | null;
  team: string;
  event: string;
  exhibition: number;
  meet_key: string;
  meet_name: string | null;
  meet_date: string;
  teams_label: string | null;
  video_url: string | null;
  clip_url: string | null;
  scoreboard_url: string;
  search_url: string;
  source: string;
  detected_at: string;
}

export function readAlert(row: AlertSqlRow): AlertDraft {
  const event = row.event === 'bars' || row.event === 'beam' || row.event === 'floor' || row.event === 'vault' ? row.event : 'vault';
  return {
    id: row.id,
    athleteName: row.athlete_name,
    athleteId: row.athlete_id,
    team: row.team,
    event,
    exhibition: row.exhibition === 1,
    meetKey: row.meet_key,
    meetName: row.meet_name || '',
    meetDate: row.meet_date,
    teamsLabel: row.teams_label || '',
    videoUrl: row.video_url,
    clipUrl: row.clip_url,
    scoreboardUrl: row.scoreboard_url,
    searchUrl: row.search_url,
    source: row.source === 'rtn' ? 'rtn' : 'virtius',
    detectedAt: row.detected_at,
  };
}

function asEvent(value: string): EventKey {
  return value === 'bars' || value === 'beam' || value === 'floor' || value === 'vault' ? value : 'vault';
}

export async function listVisibleClub(db: D1Database): Promise<ClubSource[]> {
  const result = await db.prepare(
    `SELECT id, athlete_name, team, event, meet_name, meet_date, detected_at, scoreboard_url, clip_url
     FROM alerts WHERE hidden = 0 AND exhibition = 0
     ORDER BY meet_date DESC, detected_at DESC`,
  ).all<{
    id: string;
    athlete_name: string;
    team: string;
    event: string;
    meet_name: string | null;
    meet_date: string;
    detected_at: string;
    scoreboard_url: string;
    clip_url: string | null;
  }>();
  return (result.results || []).map((row) => ({
    id: row.id,
    athlete: row.athlete_name,
    team: row.team,
    event: asEvent(row.event),
    meet: row.meet_name || '',
    date: row.meet_date,
    detectedAt: row.detected_at,
    meetUrl: row.scoreboard_url,
    clipUrl: row.clip_url,
  }));
}

export async function updateClubEntry(
  db: D1Database,
  id: string,
  patch: { athlete?: string; team?: string; event?: EventKey; meet?: string; date?: string; clipUrl?: string | null; hidden?: boolean },
): Promise<boolean> {
  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (patch.athlete !== undefined) { sets.push('athlete_name = ?'); binds.push(patch.athlete); }
  if (patch.team !== undefined) { sets.push('team = ?'); binds.push(patch.team); }
  if (patch.event !== undefined) { sets.push('event = ?'); binds.push(patch.event); }
  if (patch.meet !== undefined) { sets.push('meet_name = ?'); binds.push(patch.meet); }
  if (patch.date !== undefined) { sets.push('meet_date = ?'); binds.push(patch.date); }
  if (patch.clipUrl !== undefined) { sets.push('clip_url = ?'); binds.push(patch.clipUrl); }
  if (patch.hidden !== undefined) { sets.push('hidden = ?'); binds.push(patch.hidden ? 1 : 0); }
  if (!sets.length) return false;
  binds.push(id);
  const result = await db.prepare(`UPDATE alerts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function listRecentAlerts(db: D1Database, sinceIso: string): Promise<AlertDraft[]> {
  const result = await db.prepare('SELECT * FROM alerts WHERE detected_at >= ? ORDER BY detected_at ASC').bind(sinceIso).all<AlertSqlRow>();
  return (result.results || []).map(readAlert);
}

export async function listAlerts(db: D1Database, limit = 50): Promise<AlertDraft[]> {
  const result = await db.prepare('SELECT * FROM alerts ORDER BY detected_at DESC LIMIT ?').bind(limit).all<AlertSqlRow>();
  return (result.results || []).map(readAlert);
}

export async function findAlert(db: D1Database, id: string): Promise<AlertDraft | null> {
  const row = await db.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first<AlertSqlRow>();
  return row ? readAlert(row) : null;
}

export async function findAlertByParts(db: D1Database, meetKey: string, event: string, athleteName: string): Promise<AlertDraft | null> {
  const row = await db.prepare(
    'SELECT * FROM alerts WHERE meet_key = ? AND event = ? AND athlete_name = ? COLLATE NOCASE',
  ).bind(meetKey, event, athleteName).first<AlertSqlRow>();
  return row ? readAlert(row) : null;
}

export async function setClip(db: D1Database, id: string, clipUrl: string): Promise<void> {
  await db.prepare('UPDATE alerts SET clip_url = ? WHERE id = ?').bind(clipUrl, id).run();
}

export async function listDeliverableSubscribers(db: D1Database): Promise<SubscriberRow[]> {
  const result = await db.prepare(
    `SELECT * FROM subscribers WHERE push_status = 'active' AND push_endpoint IS NOT NULL`,
  ).all<SubscriberRow>();
  return result.results || [];
}

export async function takeDelivery(
  db: D1Database,
  alertId: string,
  subscriberId: string,
  channel: string,
  detail: string,
  nowIso: string,
  nowMs: number,
): Promise<boolean> {
  const existing = await db.prepare(
    'SELECT status, attempts, updated_at FROM deliveries WHERE alert_id = ? AND subscriber_id = ? AND channel = ? AND detail = ?',
  ).bind(alertId, subscriberId, channel, detail).first<DeliveryState>();
  if (deliveryDecision(existing, nowMs) === 'skip') return false;
  if (!existing) {
    const inserted = await db.prepare(
      `INSERT INTO deliveries (alert_id, subscriber_id, channel, detail, status, attempts, updated_at)
       VALUES (?, ?, ?, ?, 'claimed', 1, ?) ON CONFLICT DO NOTHING`,
    ).bind(alertId, subscriberId, channel, detail, nowIso).run();
    return (inserted.meta?.changes ?? 0) > 0;
  }
  const updated = await db.prepare(
    `UPDATE deliveries SET status = 'claimed', attempts = attempts + 1, updated_at = ?
     WHERE alert_id = ? AND subscriber_id = ? AND channel = ? AND detail = ?
       AND status != 'sent' AND attempts < ? AND updated_at = ?`,
  ).bind(nowIso, alertId, subscriberId, channel, detail, DELIVERY_ATTEMPTS, existing.updated_at).run();
  return (updated.meta?.changes ?? 0) > 0;
}

export async function markDelivery(
  db: D1Database,
  alertId: string,
  subscriberId: string,
  channel: string,
  detail: string,
  status: 'sent' | 'failed',
  nowIso: string,
): Promise<void> {
  await db.prepare(
    'UPDATE deliveries SET status = ?, updated_at = ? WHERE alert_id = ? AND subscriber_id = ? AND channel = ? AND detail = ?',
  ).bind(status, nowIso, alertId, subscriberId, channel, detail).run();
}

export async function markPushGone(db: D1Database, subscriberId: string, nowIso: string): Promise<void> {
  await db.prepare(`UPDATE subscribers SET push_status = 'unsubscribed', updated_at = ? WHERE id = ?`).bind(nowIso, subscriberId).run();
}

const SUB_COLS = `id, push_endpoint, push_p256dh, push_auth, push_status, unsub_token, created_at, updated_at`;

export async function findSubscriberByPush(db: D1Database, endpoint: string): Promise<SubscriberRow | null> {
  return db.prepare(`SELECT ${SUB_COLS} FROM subscribers WHERE push_endpoint = ?`).bind(endpoint).first<SubscriberRow>();
}

export async function findSubscriberByUnsub(db: D1Database, token: string): Promise<SubscriberRow | null> {
  return db.prepare(`SELECT ${SUB_COLS} FROM subscribers WHERE unsub_token = ?`).bind(token).first<SubscriberRow>();
}

export async function saveSubscriber(db: D1Database, row: SubscriberRow): Promise<void> {
  await db.prepare(`INSERT INTO subscribers (${SUB_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      push_endpoint = excluded.push_endpoint,
      push_p256dh = excluded.push_p256dh,
      push_auth = excluded.push_auth,
      push_status = excluded.push_status,
      unsub_token = excluded.unsub_token,
      updated_at = excluded.updated_at`).bind(
    row.id, row.push_endpoint, row.push_p256dh, row.push_auth, row.push_status,
    row.unsub_token, row.created_at, row.updated_at,
  ).run();
}

export async function clearPush(db: D1Database, id: string, nowIso: string): Promise<void> {
  await db.prepare(`UPDATE subscribers SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL, push_status = 'unsubscribed', updated_at = ? WHERE id = ?`).bind(nowIso, id).run();
}

export async function unsubscribeSubscriber(db: D1Database, token: string, nowIso: string): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE subscribers SET push_status = 'unsubscribed', updated_at = ? WHERE unsub_token = ?`,
  ).bind(nowIso, token).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function allowRate(db: D1Database, bucket: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
  const row = await db.prepare('SELECT hits, reset_at FROM rate_limits WHERE bucket = ?').bind(bucket).first<{ hits: number; reset_at: number }>();
  if (!row || row.reset_at < nowMs) {
    await db.prepare(`INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET hits = 1, reset_at = excluded.reset_at`).bind(bucket, nowMs + windowMs).run();
    return true;
  }
  if (row.hits >= limit) return false;
  await db.prepare('UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?').bind(bucket).run();
  return true;
}
