import { CONFIRM_TTL_MS } from './config.ts';
import {
  clearPush,
  confirmSubscriber,
  findSubscriberByConfirm,
  findSubscriberByEmail,
  findSubscriberByPush,
  findSubscriberByUnsub,
  saveSubscriber,
  unsubscribeSubscriber,
} from './db.ts';
import { mailLinks, publicOrigin } from './deliver.ts';
import { createEmailProvider, listUnsubscribeHeaders, renderConfirmEmail } from './email.ts';
import type { ChannelChoice, PushSubscriptionInput, SubscriberRow } from './types.ts';
import { b64urlToBytes, httpsUrl, isEmail, randomToken, str, asObj } from './util.ts';

export function parseChannels(value: unknown): ChannelChoice | null {
  return value === 'email' || value === 'push' || value === 'both' ? value : null;
}

export function parsePush(value: unknown): PushSubscriptionInput | null {
  const obj = asObj(value);
  const keys = asObj(obj?.keys);
  const endpoint = httpsUrl(obj?.endpoint);
  const p256dh = str(keys?.p256dh);
  const auth = str(keys?.auth);
  if (!endpoint || !p256dh || !auth) return null;
  try {
    if (b64urlToBytes(p256dh).length !== 65) return null;
    if (b64urlToBytes(auth).length < 16) return null;
  } catch {
    return null;
  }
  return { endpoint, keys: { p256dh, auth } };
}

export interface SubscribeInput {
  channels: ChannelChoice;
  email: string | null;
  push: PushSubscriptionInput | null;
}

export interface SubscribeResult {
  status: number;
  body: Record<string, unknown>;
}

async function sendConfirm(env: Env, row: SubscriberRow, origin: string): Promise<void> {
  if (!row.email || !row.confirm_token) throw new Error('nothing to confirm');
  const provider = createEmailProvider(env);
  if (!provider) throw new Error('email provider is not configured');
  const links = mailLinks(origin, row.unsub_token, row.confirm_token);
  const rendered = renderConfirmEmail(links);
  await provider.send({
    to: row.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: listUnsubscribeHeaders(links.unsubscribe),
  });
}

export async function subscribe(env: Env, input: SubscribeInput, now: Date): Promise<SubscribeResult> {
  const origin = await publicOrigin(env);
  const wantsMail = input.channels === 'email' || input.channels === 'both';
  const wantsDevice = input.channels === 'push' || input.channels === 'both';
  if (wantsMail && !input.email) return { status: 400, body: { error: 'Enter an email address.' } };
  if (wantsMail && input.email && !isEmail(input.email)) return { status: 400, body: { error: 'That email address does not look right.' } };
  if (wantsDevice && !input.push) return { status: 400, body: { error: 'Push permission is missing. Allow notifications, or choose email.' } };
  if (wantsMail && !createEmailProvider(env)) {
    return { status: 503, body: { error: 'Email is not set up on this site yet. You can still choose push, or try again after the owner adds an email provider.' } };
  }
  if (wantsDevice && !env.VAPID_PUBLIC_KEY) {
    return { status: 503, body: { error: 'Push is not set up on this site yet. Choose email, or try again after the owner adds VAPID keys.' } };
  }
  if (wantsMail && !origin) {
    return { status: 503, body: { error: 'The site does not know its public address yet. Set PUBLIC_BASE_URL, then try again.' } };
  }

  const email = input.email ? input.email.toLowerCase() : null;
  const nowIso = now.toISOString();
  let row = email ? await findSubscriberByEmail(env.DB, email) : null;
  const byPush = input.push ? await findSubscriberByPush(env.DB, input.push.endpoint) : null;
  if (!row && byPush) row = byPush;
  if (row && byPush && row.id !== byPush.id) await clearPush(env.DB, byPush.id, nowIso);

  const next: SubscriberRow = {
    id: row?.id || crypto.randomUUID(),
    email: wantsMail ? email : row?.email ?? null,
    email_status: row?.email_status || 'none',
    confirm_token: row?.confirm_token ?? null,
    confirm_expires_at: row?.confirm_expires_at ?? null,
    push_endpoint: row?.push_endpoint ?? null,
    push_p256dh: row?.push_p256dh ?? null,
    push_auth: row?.push_auth ?? null,
    push_status: row?.push_status || 'none',
    channels: input.channels,
    unsub_token: row?.unsub_token || randomToken(),
    created_at: row?.created_at || nowIso,
    updated_at: nowIso,
  };

  let emailPending = false;
  if (wantsMail && email) {
    next.email = email;
    const sameConfirmed = row?.email === email && row.email_status === 'confirmed';
    if (!sameConfirmed) {
      next.email_status = 'pending';
      next.confirm_token = randomToken();
      next.confirm_expires_at = new Date(now.getTime() + CONFIRM_TTL_MS).toISOString();
      emailPending = true;
    } else {
      next.email_status = 'confirmed';
      next.confirm_token = null;
      next.confirm_expires_at = null;
    }
  } else if (!wantsMail) {
    // Keep a previously confirmed address on file, but stop emailing if they switched to push only.
    if (next.email_status === 'confirmed' || next.email_status === 'pending') next.email_status = 'unsubscribed';
  }

  if (wantsDevice && input.push) {
    next.push_endpoint = input.push.endpoint;
    next.push_p256dh = input.push.keys.p256dh;
    next.push_auth = input.push.keys.auth;
    next.push_status = 'active';
  } else if (next.push_status === 'active') {
    next.push_status = 'unsubscribed';
  }

  await saveSubscriber(env.DB, next);
  if (emailPending) {
    try {
      await sendConfirm(env, next, origin);
    } catch {
      return {
        status: 502,
        body: {
          error: 'We saved your request but could not send the confirmation email. Wait a minute and submit again.',
          manageUrl: `${origin}/manage?token=${encodeURIComponent(next.unsub_token)}`,
        },
      };
    }
  }

  const manageUrl = `${origin}/manage?token=${encodeURIComponent(next.unsub_token)}`;
  let message = 'You are signed up.';
  if (emailPending && wantsDevice) message = 'Push is on. Check your email and tap confirm so the 10s can reach your inbox too.';
  else if (emailPending) message = 'Check your email and tap confirm. We will not send a 10 until you do.';
  else if (wantsMail && wantsDevice) message = 'You are confirmed for email, and push is on for this device.';
  else if (wantsDevice) message = 'Push is on for this device.';
  else message = 'Email alerts are on.';
  return { status: 200, body: { ok: true, message, manageUrl, emailPending, pushOn: next.push_status === 'active' } };
}

export async function confirmToken(env: Env, token: string, now: Date): Promise<'ok' | 'expired' | 'missing'> {
  if (!token) return 'missing';
  const row = await findSubscriberByConfirm(env.DB, token);
  if (!row) return 'missing';
  if (row.confirm_expires_at && Date.parse(row.confirm_expires_at) < now.getTime()) return 'expired';
  await confirmSubscriber(env.DB, row.id, now.toISOString());
  return 'ok';
}

export async function removeByToken(env: Env, token: string, now: Date): Promise<boolean> {
  if (!token || token === 'sample') return false;
  return unsubscribeSubscriber(env.DB, token, now.toISOString());
}

export async function resendConfirm(env: Env, row: SubscriberRow, now: Date): Promise<string | null> {
  if (!row.email || row.email_status === 'confirmed') return null;
  const origin = await publicOrigin(env);
  if (!origin) return 'The site address is not configured yet.';
  row.confirm_token = randomToken();
  row.confirm_expires_at = new Date(now.getTime() + CONFIRM_TTL_MS).toISOString();
  row.email_status = 'pending';
  row.updated_at = now.toISOString();
  await saveSubscriber(env.DB, row);
  try {
    await sendConfirm(env, row, origin);
  } catch {
    return 'The confirmation email could not be sent. Try again in a minute.';
  }
  return null;
}

export { findSubscriberByUnsub };
