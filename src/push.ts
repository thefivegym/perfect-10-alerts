import { b64urlToBytes, bytesToB64url } from './util.ts';

/**
 * Web Push encryption (RFC 8291 + the aes128gcm content coding in RFC 8188)
 * and a VAPID ES256 JWT. Web Crypto only, so it runs in a Worker.
 */

function asKeyPair(key: CryptoKey | CryptoKeyPair): CryptoKeyPair {
  if ('privateKey' in key && 'publicKey' in key) return key;
  throw new Error('expected a key pair');
}

function asBuffer(value: ArrayBuffer | JsonWebKey): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  throw new Error('expected raw key bytes');
}

function deriveShared(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
  // Workers types name this field `$public` because `public` is reserved. The runtime key is `public`.
  const algorithm = { name: 'ECDH', public: publicKey } as SubtleCryptoDeriveKeyAlgorithm;
  return crypto.subtle.deriveBits(algorithm, privateKey, 256);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
}

export interface EphemeralKey {
  publicKey: Uint8Array;
  privateKey: CryptoKey;
}

export async function encryptPush(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  ephemeral?: EphemeralKey,
  saltIn?: Uint8Array,
): Promise<Uint8Array> {
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) {
    throw new Error('p256dh must be a 65-byte uncompressed P-256 public key');
  }
  if (authSecret.length < 16) throw new Error('auth secret must be at least 16 bytes');

  let asPublic: Uint8Array;
  let asPrivate: CryptoKey;
  if (ephemeral) {
    asPublic = ephemeral.publicKey;
    asPrivate = ephemeral.privateKey;
  } else {
    const pair = asKeyPair(await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(asBuffer(await crypto.subtle.exportKey('raw', pair.publicKey)));
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await deriveShared(asPrivate, uaKey));
  const salt = saltIn ?? crypto.getRandomValues(new Uint8Array(16));

  const keyInfo = concat([ascii('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic]);
  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat([keyInfo, new Uint8Array([1])]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat([ascii('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])]))).slice(0, 16);
  const nonce = (await hmac(prk, concat([ascii('Content-Encoding: nonce'), new Uint8Array([0, 1])]))).slice(0, 12);

  const rs = 4096;
  const padLen = rs - 16 - plaintext.length - 1;
  if (padLen < 0) throw new Error('push payload is too large');
  const record = new Uint8Array(plaintext.length + 1 + padLen);
  record.set(plaintext, 0);
  record[plaintext.length] = 2;

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record));
  const header = concat([salt, u32be(rs), new Uint8Array([asPublic.length]), asPublic]);
  return concat([header, cipher]);
}

export function rawPublicFromJwk(jwk: JsonWebKey): Uint8Array {
  if (!jwk.x || !jwk.y) throw new Error('JWK is missing x or y');
  const x = b64urlToBytes(jwk.x);
  const y = b64urlToBytes(jwk.y);
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

/** Decrypt a message this module encrypted. Used to prove the RFC 8291 example. */
export async function decryptPush(body: Uint8Array, uaPrivate: JsonWebKey, authSecret: Uint8Array): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = rawPublicFromJwk(uaPrivate);
  const privateKey = await crypto.subtle.importKey('jwk', uaPrivate, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await deriveShared(privateKey, asKey));
  const keyInfo = concat([ascii('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic]);
  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat([keyInfo, new Uint8Array([1])]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat([ascii('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])]))).slice(0, 16);
  const nonce = (await hmac(prk, concat([ascii('Content-Encoding: nonce'), new Uint8Array([0, 1])]))).slice(0, 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, cipher));
  let end = record.length;
  while (end > 0 && record[end - 1] === 0) end--;
  if (end === 0 || record[end - 1] !== 2) throw new Error('push padding delimiter missing');
  return record.slice(0, end - 1);
}

function b64urlJson(value: unknown): string {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(value)));
}

export async function vapidAuthorization(endpoint: string, publicKey: string, privatePkcs8: string, subject: string): Promise<string> {
  const origin = new URL(endpoint).origin;
  const header = b64urlJson({ typ: 'JWT', alg: 'ES256' });
  const payload = b64urlJson({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  });
  const signingInput = ascii(`${header}.${payload}`);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    b64urlToBytes(privatePkcs8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput));
  const jwt = `${header}.${payload}.${bytesToB64url(sig)}`;
  return `vapid t=${jwt}, k=${publicKey}`;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendWebPush(target: PushTarget, payload: string, env: Env): Promise<'sent' | 'gone' | 'failed'> {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error('VAPID keys are not configured');
  const subject = env.VAPID_SUBJECT || 'mailto:alerts@example.com';
  const body = await encryptPush(new TextEncoder().encode(payload), b64urlToBytes(target.p256dh), b64urlToBytes(target.auth));
  const authorization = await vapidAuthorization(target.endpoint, publicKey, privateKey, subject);
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) return 'failed';
  return 'sent';
}

export function pushPayload(copy: { title: string; body: string }, links: { open: string; unsubscribe: string }): string {
  return JSON.stringify({
    title: copy.title,
    body: copy.body,
    open: links.open,
    unsubscribe: links.unsubscribe,
  });
}
