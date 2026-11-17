import { MAX_SENDS_PER_TICK } from './config.ts';
import {
  listDeliverableSubscribers,
  markDelivery,
  markPushGone,
  metaGet,
  takeDelivery,
} from './db.ts';
import { notificationCopy } from './messages.ts';
import { pushPayload, sendWebPush } from './push.ts';
import type { AlertDraft, SubscriberRow } from './types.ts';
import { log } from './util.ts';

export async function publicOrigin(env: Env): Promise<string> {
  const configured = (env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  return ((await metaGet(env.DB, 'public_origin')) || '').replace(/\/$/, '');
}

export function manageUrl(origin: string, unsubToken: string): string {
  const base = origin || '';
  return `${base}/manage?token=${encodeURIComponent(unsubToken)}`;
}

export function wantsPush(sub: SubscriberRow): boolean {
  return sub.push_status === 'active' && !!sub.push_endpoint && !!sub.push_p256dh && !!sub.push_auth;
}

async function sendChannel(
  env: Env,
  alert: AlertDraft,
  sub: SubscriberRow,
  channel: 'push' | 'push_clip',
  detail: string,
  origin: string,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString();
  const owned = await takeDelivery(env.DB, alert.id, sub.id, channel, detail, nowIso, now.getTime());
  if (!owned) return false;
  try {
    if (!sub.push_endpoint || !sub.push_p256dh || !sub.push_auth) throw new Error('subscriber has no push subscription');
    const copy = notificationCopy(alert);
    const title = channel === 'push_clip' ? `Clip · ${alert.athleteName}` : copy.title;
    const open = origin
      ? `${origin}/a?id=${encodeURIComponent(alert.id)}&u=${encodeURIComponent(sub.unsub_token)}`
      : alert.clipUrl || alert.scoreboardUrl;
    const unsubscribe = origin
      ? `${origin}/unsubscribe?token=${encodeURIComponent(sub.unsub_token)}`
      : alert.scoreboardUrl;
    const result = await sendWebPush(
      { endpoint: sub.push_endpoint, p256dh: sub.push_p256dh, auth: sub.push_auth },
      pushPayload({ title, body: copy.body }, { open, unsubscribe }),
      env,
    );
    if (result === 'gone') {
      await markPushGone(env.DB, sub.id, nowIso);
      await markDelivery(env.DB, alert.id, sub.id, channel, detail, 'sent', nowIso);
      return true;
    }
    if (result === 'failed') throw new Error('push service rejected the notification');
    await markDelivery(env.DB, alert.id, sub.id, channel, detail, 'sent', nowIso);
    return true;
  } catch (err) {
    await markDelivery(env.DB, alert.id, sub.id, channel, detail, 'failed', nowIso);
    log('error', 'deliver_failed', {
      channel,
      alert: alert.id,
      message: err instanceof Error ? err.message : 'send failed',
    });
    return true;
  }
}

/** Send any alerts from the last 12 hours that a current subscriber has not received yet. */
export async function deliverPending(env: Env, alerts: AlertDraft[], now: Date): Promise<number> {
  const origin = await publicOrigin(env);
  if (!origin) log('error', 'public_origin_missing', { hint: 'Set PUBLIC_BASE_URL or open the site once' });
  const subs = await listDeliverableSubscribers(env.DB);
  let sent = 0;
  for (const alert of alerts) {
    for (const sub of subs) {
      const joinedAfter = sub.created_at > (alert.detectedAt || '');
      if (sent >= MAX_SENDS_PER_TICK) return sent;
      if (!joinedAfter && wantsPush(sub)) {
        if (await sendChannel(env, alert, sub, 'push', '', origin, now)) sent++;
      }
      if (!alert.clipUrl) continue;
      if (sent >= MAX_SENDS_PER_TICK) return sent;
      if (wantsPush(sub)) {
        if (await sendChannel(env, alert, sub, 'push_clip', alert.clipUrl, origin, now)) sent++;
      }
    }
  }
  return sent;
}
