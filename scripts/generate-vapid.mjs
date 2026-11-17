import { webcrypto } from 'node:crypto';

const crypto = webcrypto;
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
const admin = new Uint8Array(24);
crypto.getRandomValues(admin);

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

console.log('');
console.log('Paste each value when wrangler asks. Nothing here is saved to a file.');
console.log('');
console.log('VAPID_PUBLIC_KEY');
console.log(b64url(publicKey));
console.log('');
console.log('VAPID_PRIVATE_KEY');
console.log(b64url(privateKey));
console.log('');
console.log('ADMIN_TOKEN');
console.log(b64url(admin));
console.log('');
console.log('Also set VAPID_SUBJECT in wrangler.jsonc to a mailto: you control, for example mailto:alerts@yourdomain.com');
console.log('');
