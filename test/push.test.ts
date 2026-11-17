import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptPush, encryptPush, vapidAuthorization } from '../src/push.ts';
import { b64urlToBytes, bytesToB64url } from '../src/util.ts';

const RFC_BODY = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
const RFC_PUBLIC = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const RFC_PRIVATE = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
const RFC_AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';

test('decrypts the RFC 8291 worked example', async () => {
  const pub = b64urlToBytes(RFC_PUBLIC);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: RFC_PRIVATE,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  };
  const plain = await decryptPush(b64urlToBytes(RFC_BODY), jwk, b64urlToBytes(RFC_AUTH));
  assert.equal(new TextDecoder().decode(plain), 'When I grow up, I want to be a watermelon');
});

function asPair(key: CryptoKey | CryptoKeyPair): CryptoKeyPair {
  if ('privateKey' in key && 'publicKey' in key) return key;
  throw new Error('expected a key pair');
}

test('round-trips a perfect-10 payload', async () => {
  const pair = asPair(await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const exported = await crypto.subtle.exportKey('raw', pair.publicKey);
  if (!(exported instanceof ArrayBuffer)) throw new Error('expected raw key bytes');
  const publicKey = new Uint8Array(exported);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (jwk instanceof ArrayBuffer) throw new Error('expected a JWK');
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const message = 'Perfect 10 · Kailin Chio';
  const body = await encryptPush(new TextEncoder().encode(message), publicKey, auth);
  const back = await decryptPush(body, jwk, auth);
  assert.equal(new TextDecoder().decode(back), message);
  assert.equal(body[20], 65);
});

test('VAPID JWT is signed for the push service origin', async () => {
  const pair = asPair(await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']));
  const rawPublic = await crypto.subtle.exportKey('raw', pair.publicKey);
  const rawPrivate = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  if (!(rawPublic instanceof ArrayBuffer) || !(rawPrivate instanceof ArrayBuffer)) throw new Error('expected raw key bytes');
  const publicKey = bytesToB64url(new Uint8Array(rawPublic));
  const privateKey = bytesToB64url(new Uint8Array(rawPrivate));
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', publicKey, privateKey, 'mailto:alerts@example.com');
  assert.match(header, /^vapid t=/);
  assert.match(header, new RegExp(`, k=${publicKey}$`));
  const jwt = header.slice('vapid t='.length).split(', k=')[0];
  const [h, p, s] = jwt.split('.');
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.publicKey,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  assert.equal(ok, true);
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as { aud: string; sub: string };
  assert.equal(payload.aud, 'https://fcm.googleapis.com');
  assert.equal(payload.sub, 'mailto:alerts@example.com');
});
