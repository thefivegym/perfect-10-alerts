import { staticAssetUrl } from './assets.ts';
import { advanceSeasonBackfill } from './backfill.ts';
import { buildClub, clubSeasons, clubWriteMode, currentSeason } from './club.ts';
import { USER_AGENT, VIRTIUS_SESSION, RTN_ORIGIN } from './config.ts';
import { allowRate, clearPush, countMeets, findAlert, findAlertByParts, findSubscriberByPush, insertAlert, listAlerts, listDeliverableSubscribers, listVisibleClub, meetsOnDates, metaGet, metaSet, saveSubscriber, setClip, updateClubEntry } from './db.ts';
import { deliverPending, publicOrigin, wantsPush } from './deliver.ts';
import { bodyMayContainPerfectTen, extractRtnTens, extractVirtiusTens } from './detect.ts';
import { alertPage, notFoundPage, samplePushPage, unsubscribePage } from './pages.ts';
import { notificationCopy, SAMPLE_ALERT } from './messages.ts';
import { pushPayload, sendWebPush } from './push.ts';
import { findSubscriberByUnsub, parsePush, removeByToken, subscribe } from './subscribe.ts';
import type { AlertDraft, MeetContext } from './types.ts';
import type { EventKey } from './types.ts';
import { addDays } from './time.ts';
import { asObj, html, httpsUrl, json, safeEqual, sha256Hex, str } from './util.ts';

async function rememberOrigin(env: Env, request: Request): Promise<void> {
  if ((env.PUBLIC_BASE_URL || '').trim()) return;
  try {
    const origin = new URL(request.url).origin;
    if (!origin.startsWith('http')) return;
    const current = await metaGet(env.DB, 'public_origin');
    if (current !== origin) await metaSet(env.DB, 'public_origin', origin);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'origin_remember_failed', message: err instanceof Error ? err.message : 'failed' }));
  }
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : (request.headers.get('X-Admin-Token') || '').trim();
  if (!token) return false;
  return safeEqual(token, env.ADMIN_TOKEN);
}

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 20_000) throw new Error('too large');
  const text = await request.text();
  if (text.length > 20_000) throw new Error('too large');
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

function replayContext(json: unknown, meetKey: string): MeetContext {
  const session = asObj(asObj(json)?.meet) ?? asObj(json);
  const date = str(session?.meet_date);
  const teams = Array.isArray(session?.teams)
    ? session.teams.map((team) => str(asObj(team)?.name)).filter(Boolean)
    : [];
  return {
    meetKey,
    meetName: str(session?.name) || meetKey,
    meetDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '1970-01-01',
    teamsLabel: teams.join(', '),
    d1Teams: [],
    intrasquad: false,
    videoUrl: null,
    source: 'virtius',
  };
}

async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET);
  body.set('response', token);
  body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  if (!res.ok) return false;
  const payload = await res.json() as { success?: boolean };
  return payload.success === true;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  await rememberOrigin(env, request);

  if (path === '/api/health' && request.method === 'GET') {
    const [refreshed, source, meets] = await Promise.all([
      metaGet(env.DB, 'schedule_refreshed_at'),
      metaGet(env.DB, 'schedule_source'),
      countMeets(env.DB),
    ]);
    return json({ ok: true, meets, scheduleRefreshedAt: refreshed, scheduleSource: source });
  }

  if (path === '/api/club' && request.method === 'GET') {
    const requested = Number(url.searchParams.get('season'));
    const season = Number.isInteger(requested) && requested >= 1990 && requested <= 2100 ? requested : currentSeason();
    const visible = await listVisibleClub(env.DB);
    const seasons = clubSeasons(visible.map((entry) => entry.date), season);
    return json({ ...buildClub(visible, season), seasons, sample: false });
  }

  if (path === '/api/config' && request.method === 'GET') {
    return json({
      pushConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
      vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    });
  }

  if (path === '/api/subscribe' && request.method === 'POST') {
    let payload: unknown;
    try { payload = await readBody(request); } catch { return json({ error: 'Send a JSON body.' }, 400); }
    const body = asObj(payload) || {};
    if (str(body.company)) return json({ ok: true, message: 'Push is on for this device.' });
    const ip = clientIp(request);
    const bucket = await sha256Hex(`subscribe|${ip}`);
    if (!(await allowRate(env.DB, bucket, 8, 10 * 60 * 1000, Date.now()))) {
      return json({ error: 'Too many signups from this network. Wait a few minutes and try again.' }, 429);
    }
    if (!(await verifyTurnstile(env, str(body.turnstile), ip))) {
      return json({ error: 'The signup check failed. Refresh the page and try again.' }, 400);
    }
    const result = await subscribe(env, parsePush(body.push), new Date());
    return json(result.body, result.status);
  }

  if (path === '/api/me' && request.method === 'GET') {
    const row = await findSubscriberByUnsub(env.DB, url.searchParams.get('token') || '');
    if (!row) return json({ error: 'That manage link is not valid.' }, 404);
    return json({ pushStatus: row.push_status });
  }

  if (path === '/api/me' && request.method === 'POST') {
    let payload: unknown;
    try { payload = await readBody(request); } catch { return json({ error: 'Send a JSON body.' }, 400); }
    const body = asObj(payload) || {};
    const token = str(body.token);
    const row = await findSubscriberByUnsub(env.DB, token);
    if (!row) return json({ error: 'That manage link is not valid.' }, 404);
    const action = str(body.action);
    const now = new Date();
    if (action === 'remove' || action === 'unsubscribe') {
      await removeByToken(env, token, now);
      return json({ ok: true, message: 'You are unsubscribed.' });
    }
    if (action === 'push-off') {
      row.push_status = 'unsubscribed';
      row.updated_at = now.toISOString();
      await saveSubscriber(env.DB, row);
      return json({ ok: true, message: 'Push alerts are off for the saved device.' });
    }
    if (action === 'push-on') {
      const push = parsePush(body.push);
      if (!push) return json({ error: 'Allow notifications in the installed app, then try again.' }, 400);
      if (!env.VAPID_PUBLIC_KEY) return json({ error: 'Push is not set up on this site yet.' }, 503);
      const other = await findSubscriberByPush(env.DB, push.endpoint);
      if (other && other.id !== row.id) await clearPush(env.DB, other.id, now.toISOString());
      row.push_endpoint = push.endpoint;
      row.push_p256dh = push.keys.p256dh;
      row.push_auth = push.keys.auth;
      row.push_status = 'active';
      row.updated_at = now.toISOString();
      await saveSubscriber(env.DB, row);
      return json({ ok: true, message: 'Push is on for this device.' });
    }
    return json({ error: 'Unknown action.' }, 400);
  }

  if (path === '/unsubscribe' && (request.method === 'GET' || request.method === 'POST')) {
    const token = url.searchParams.get('token') || '';
    if (token === 'sample') return html(unsubscribePage('sample'));
    if (!token) return html(unsubscribePage('missing'), 400);
    const removed = await removeByToken(env, token, new Date());
    return html(unsubscribePage(removed ? 'done' : 'missing'), removed ? 200 : 404);
  }

  if (path === '/api/unsubscribe' && request.method === 'POST') {
    let payload: unknown = {};
    try { payload = await readBody(request); } catch { payload = {}; }
    const token = str(asObj(payload)?.token) || url.searchParams.get('token') || '';
    if (token === 'sample') return json({ ok: true, sample: true });
    const removed = await removeByToken(env, token, new Date());
    return json(removed ? { ok: true } : { error: 'That unsubscribe link is not valid.' }, removed ? 200 : 404);
  }

  if (path === '/a' && request.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const token = url.searchParams.get('u') || '';
    if (id === 'sample') {
      const origin = await publicOrigin(env) || new URL(request.url).origin;
      return html(alertPage(SAMPLE_ALERT, `${origin}/unsubscribe?token=sample`));
    }
    const alert = await findAlert(env.DB, id);
    if (!alert) return html(notFoundPage(), 404);
    const origin = await publicOrigin(env) || new URL(request.url).origin;
    const unsub = `${origin}/unsubscribe?token=${encodeURIComponent(token)}`;
    return html(alertPage(alert, unsub));
  }

  if (path === '/sample/push' && request.method === 'GET') {
    const origin = await publicOrigin(env) || new URL(request.url).origin;
    return html(samplePushPage(origin));
  }

  if (path.startsWith('/api/admin/')) {
    if (!(await isAdmin(request, env))) return json({ error: 'Admin token required.' }, 401);
    return admin(request, env, path);
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const assetUrl = staticAssetUrl(url);
    const assetRequest = assetUrl.href === url.href ? request : new Request(assetUrl, request);
    const asset = await env.ASSETS.fetch(assetRequest);
    // A redirect from "/page" to "/page.html" (or the reverse) would loop
    // through this worker. Those pages are either served above or by the
    // extensionless asset path.
    if (asset.status >= 300 && asset.status < 400) {
      const location = asset.headers.get('Location') || '';
      try {
        const next = new URL(location, url).pathname;
        if (next === path || next === `${path}.html` || `${next}.html` === path) {
          return html(notFoundPage(), 404);
        }
      } catch { /* not a URL we generated; fall through */ }
    }
    if (asset.status !== 404) return asset;
    return html(notFoundPage(), 404);
  }

  return json({ error: 'Not found.' }, 404);
}

async function admin(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/admin/alerts' && request.method === 'GET') {
    const alerts = await listAlerts(env.DB, 50);
    return json({
      alerts: alerts.map((alert) => ({
        id: alert.id,
        athlete: alert.athleteName,
        team: alert.team,
        event: alert.event,
        exhibition: alert.exhibition,
        meetKey: alert.meetKey,
        meetName: alert.meetName,
        meetDate: alert.meetDate,
        clipUrl: alert.clipUrl,
        detectedAt: alert.detectedAt,
      })),
    });
  }

  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  let payload: unknown;
  try { payload = await readBody(request); } catch { return json({ error: 'Send a JSON body.' }, 400); }
  const body = asObj(payload) || {};

  if (path === '/api/admin/test-alert') {
    return sendSample(env, body);
  }
  if (path === '/api/admin/replay') {
    return replay(env, body);
  }
  if (path === '/api/admin/clip') {
    return attachClip(env, body);
  }
  if (path === '/api/admin/club') {
    return correctClub(env, body);
  }
  if (path === '/api/admin/club/backfill') {
    return backfillClub(env, body);
  }
  return json({ error: 'Not found.' }, 404);
}

async function sendSample(env: Env, body: Record<string, unknown>): Promise<Response> {
  const origin = await publicOrigin(env);
  if (!origin) return json({ error: 'Set PUBLIC_BASE_URL or open the site once so links in the sample work.' }, 503);
  const broadcast = body.broadcast === true;
  const push = parsePush(body.push);
  if (!push && !broadcast) {
    return json({ error: 'Pass {"broadcast": true} after you subscribe on the site, or {"push": {"endpoint","keys"}} for one device.' }, 400);
  }
  const copy = notificationCopy(SAMPLE_ALERT, true);
  const sent: string[] = [];
  const notify = (endpoint: string, p256dh: string, auth: string, token: string) => sendWebPush(
    { endpoint, p256dh, auth },
    pushPayload(copy, {
      open: `${origin}/a?id=sample&u=${encodeURIComponent(token)}`,
      unsubscribe: `${origin}/unsubscribe?token=${encodeURIComponent(token)}`,
    }),
    env,
  );
  if (push) {
    const result = await notify(push.endpoint, push.keys.p256dh, push.keys.auth, 'sample');
    if (result !== 'sent') return json({ error: `Push sample was not accepted (${result}).`, sent }, 502);
    sent.push('push');
  }
  if (broadcast) {
    const subs = await listDeliverableSubscribers(env.DB);
    let n = 0;
    for (const sub of subs) {
      if (!wantsPush(sub) || !sub.push_endpoint || !sub.push_p256dh || !sub.push_auth) continue;
      const result = await notify(sub.push_endpoint, sub.push_p256dh, sub.push_auth, sub.unsub_token);
      if (result === 'sent') n++;
    }
    sent.push(`broadcast:${n}`);
  }
  return json({ ok: true, sent });
}

async function replay(env: Env, body: Record<string, unknown>): Promise<Response> {
  const key = str(body.virtius);
  const rtnId = Number(body.rtn_meet_id);
  let alerts: AlertDraft[] = [];
  let prefilter: boolean | null = null;
  if (key) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(key)) return json({ error: 'That Virtius key does not look right.' }, 400);
    const res = await fetch(`${VIRTIUS_SESSION}/${encodeURIComponent(key)}/json`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (!res.ok) return json({ error: `Virtius HTTP ${res.status}` }, 502);
    const text = await res.text();
    prefilter = bodyMayContainPerfectTen(text);
    const parsed = JSON.parse(text) as unknown;
    alerts = extractVirtiusTens(parsed, replayContext(parsed, key));
  } else if (Number.isFinite(rtnId) && rtnId > 0) {
    const last = await metaGet(env.DB, 'last_rtn_at');
    if (last && Date.now() - Date.parse(last) < 30_000) {
      return json({ error: 'Road to Nationals asks for a 30 second pause between requests. Try again in a moment.' }, 429);
    }
    await metaSet(env.DB, 'last_rtn_at', new Date().toISOString());
    const res = await fetch(`${RTN_ORIGIN}/meetresults/${rtnId}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (!res.ok) return json({ error: `Road to Nationals HTTP ${res.status}` }, 502);
    const parsed = await res.json() as unknown;
    const date = str(body.meet_date) || '1970-01-01';
    alerts = extractRtnTens(parsed, {
      meetKey: `rtn-${rtnId}`,
      meetName: str(body.meet_name) || `Meet ${rtnId}`,
      meetDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '1970-01-01',
      teamsLabel: '',
      d1Teams: [],
      intrasquad: false,
      videoUrl: null,
      source: 'rtn',
    });
  } else {
    return json({ error: 'Pass {"virtius":"MFrZ9epozB"} or {"rtn_meet_id":12345}.' }, 400);
  }

  let recorded = 0;
  const write = clubWriteMode(body);
  if (write !== 'none') {
    const now = new Date();
    for (const alert of alerts) {
      if (await insertAlert(env.DB, alert, alert.meetDate ? `${alert.meetDate}T12:00:00.000Z` : now.toISOString())) recorded++;
    }
    if (write === 'notify') {
      await deliverPending(env, alerts.map((alert) => ({ ...alert, detectedAt: now.toISOString() })), now);
    }
  }

  return json({
    count: alerts.length,
    prefilter,
    recorded,
    perfect_tens: alerts.map((alert) => ({
      id: alert.id,
      athlete: alert.athleteName,
      team: alert.team,
      event: alert.event,
      exhibition: alert.exhibition,
      meet: alert.meetName,
      date: alert.meetDate,
      scoreboard: alert.scoreboardUrl,
      search: alert.searchUrl,
    })),
  });
}

async function correctClub(env: Env, body: Record<string, unknown>): Promise<Response> {
  const id = str(body.id);
  if (!id) return json({ error: 'Pass the entry id.' }, 400);
  const existing = await findAlert(env.DB, id);
  if (!existing) return json({ error: 'No club entry with that id.' }, 404);
  const event = str(body.event);
  if (event && event !== 'vault' && event !== 'bars' && event !== 'beam' && event !== 'floor') {
    return json({ error: 'Event must be vault, bars, beam, or floor.' }, 400);
  }
  const date = str(body.date);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Date must be YYYY-MM-DD.' }, 400);
  let clipUrl: string | null | undefined;
  if ('clip_url' in body) {
    if (body.clip_url === null || body.clip_url === '') clipUrl = null;
    else {
      const clip = httpsUrl(body.clip_url);
      if (!clip) return json({ error: 'clip_url must be an https link.' }, 400);
      clipUrl = clip;
    }
  }
  const updated = await updateClubEntry(env.DB, id, {
    athlete: str(body.athlete) || undefined,
    team: str(body.team) || undefined,
    event: (event || undefined) as EventKey | undefined,
    meet: str(body.meet) || undefined,
    date: date || undefined,
    clipUrl,
    hidden: typeof body.hidden === 'boolean' ? body.hidden : undefined,
  });
  return json({ ok: true, id, updated });
}

async function backfillClub(env: Env, body: Record<string, unknown>): Promise<Response> {
  const season = Number(body.season);
  if (Number.isInteger(season) && season >= 1990 && season <= 2100) {
    const step = await advanceSeasonBackfill(env, season, body.reset === true);
    const status = step.ok ? (step.waiting ? 429 : 200) : 502;
    return json(step, status);
  }
  const keys: string[] = [];
  if (str(body.virtius)) keys.push(str(body.virtius));
  if (Array.isArray(body.keys)) {
    for (const key of body.keys) if (typeof key === 'string') keys.push(key);
  }
  const from = str(body.from) || str(body.date);
  const to = str(body.to) || from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const dates: string[] = [];
    let day = from;
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : from;
    while (day <= end && dates.length < 16) {
      dates.push(day);
      day = addDays(day, 1);
    }
    const meets = await meetsOnDates(env.DB, dates);
    for (const meet of meets) if (meet.virtius) keys.push(meet.virtius);
  }
  const unique = [...new Set(keys)].filter((key) => /^[A-Za-z0-9_-]{6,64}$/.test(key));
  if (!unique.length) {
    return json({ error: 'Pass {"virtius":"KEY"}, {"keys":["KEY"]}, or {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"} for meets already on the schedule.' }, 400);
  }
  const batch = unique.slice(0, 8);
  let logged = 0;
  for (let i = 0; i < batch.length; i += 6) {
    const chunk = batch.slice(i, i + 6);
    const groups = await Promise.all(chunk.map(async (key) => {
      const res = await fetch(`${VIRTIUS_SESSION}/${encodeURIComponent(key)}/json`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      if (!res.ok) return [] as AlertDraft[];
      const parsed = await res.json() as unknown;
      return extractVirtiusTens(parsed, replayContext(parsed, key));
    }));
    for (const alerts of groups) {
      for (const alert of alerts) {
        const stamp = /^\d{4}-\d{2}-\d{2}$/.test(alert.meetDate) ? `${alert.meetDate}T12:00:00.000Z` : new Date().toISOString();
        if (await insertAlert(env.DB, alert, stamp)) logged += 1;
      }
    }
  }
  return json({ ok: true, logged, checked: batch.length, remaining: unique.length - batch.length });
}

async function attachClip(env: Env, body: Record<string, unknown>): Promise<Response> {
  const clip = httpsUrl(body.clip_url);
  if (!clip) return json({ error: 'clip_url must be an https link.' }, 400);
  let alert = str(body.id) ? await findAlert(env.DB, str(body.id)) : null;
  if (!alert && str(body.meet_key) && str(body.event) && str(body.athlete)) {
    alert = await findAlertByParts(env.DB, str(body.meet_key), str(body.event), str(body.athlete));
  }
  if (!alert) return json({ error: 'No matching alert. GET /api/admin/alerts lists recent ones.' }, 404);
  await setClip(env.DB, alert.id, clip);
  alert.clipUrl = clip;
  const sent = await deliverPending(env, [alert], new Date());
  return json({ ok: true, id: alert.id, clipUrl: clip, followupsSent: sent });
}
