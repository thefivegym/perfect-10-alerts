import { findSubscriberByPush, findSubscriberByUnsub, saveSubscriber, unsubscribeSubscriber } from './db.ts';
import { manageUrl, publicOrigin } from './deliver.ts';
import type { PushSubscriptionInput } from './types.ts';
import { asObj, b64urlToBytes, httpsUrl, randomToken, str } from './util.ts';

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

export interface SubscribeResult {
  status: number;
  body: Record<string, unknown>;
}

export async function subscribe(env: Env, push: PushSubscriptionInput | null, now: Date): Promise<SubscribeResult> {
  if (!push) {
    return { status: 400, body: { error: 'Allow notifications to subscribe. On iPhone, add the site to your Home Screen first (iOS 16.4 or newer), then open it from the icon.' } };
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { status: 503, body: { error: 'Push is not set up on this site yet. The owner still needs to add the VAPID keys.' } };
  }

  const nowIso = now.toISOString();
  const existing = await findSubscriberByPush(env.DB, push.endpoint);
  const id = existing?.id || crypto.randomUUID();
  const unsubToken = existing?.unsub_token || randomToken();
  await saveSubscriber(env.DB, {
    id,
    push_endpoint: push.endpoint,
    push_p256dh: push.keys.p256dh,
    push_auth: push.keys.auth,
    push_status: 'active',
    unsub_token: unsubToken,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
  });

  const origin = await publicOrigin(env);
  return {
    status: 200,
    body: {
      ok: true,
      message: 'Push is on for this device. A 10.0 will show up as a notification.',
      manageUrl: manageUrl(origin, unsubToken),
      pushOn: true,
    },
  };
}

export async function removeByToken(env: Env, token: string, now: Date): Promise<boolean> {
  if (!token || token === 'sample') return false;
  return unsubscribeSubscriber(env.DB, token, now.toISOString());
}

export { findSubscriberByUnsub };
