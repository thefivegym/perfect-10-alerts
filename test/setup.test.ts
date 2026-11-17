import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deniedHelp, setupKind, setupTitle } from '../public/setup.js';

const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const iphoneChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1';
const instagram = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0.0';
const androidChrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

test('setup directions follow the browser that can actually turn alerts on', () => {
  assert.equal(setupKind({ ua: iphoneSafari, standalone: false }), 'ios-safari');
  assert.equal(setupKind({ ua: iphoneSafari, standalone: true }), 'ios-home');
  assert.equal(setupKind({ ua: iphoneChrome, standalone: false }), 'ios-other');
  assert.equal(setupKind({ ua: instagram, standalone: false }), 'ios-other');
  assert.equal(setupKind({ ua: androidChrome, standalone: false }), 'android');
  assert.equal(setupKind({ ua: desktop, standalone: false }), 'desktop');
  assert.equal(setupKind({ ua: desktop, platform: 'MacIntel', maxTouchPoints: 5, standalone: false }), 'ios-safari');
});

test('denied help tells each device where to turn notifications back on', () => {
  assert.match(deniedHelp('ios-safari'), /Settings, tap Notifications, tap Perfect 10 Alerts/);
  assert.match(deniedHelp('ios-other'), /Safari/);
  assert.match(deniedHelp('android'), /lock icon/);
  assert.match(deniedHelp('desktop'), /address bar/);
  assert.match(setupTitle('ios-safari'), /iPhone or iPad/);
  assert.match(setupTitle('ios-other'), /Safari/);
});

test('the signup page keeps the button first and has a guide for each device', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const button = html.indexOf('id="submit"');
  const guide = html.indexOf('id="setup"');
  const club = html.indexOf('id="club"');
  assert.ok(button > 0 && button < guide && guide < club);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /id="copy-link"/);
  assert.match(html, /data-setup="android"/);
  assert.match(html, /data-setup="desktop"/);
  assert.match(html, /Settings, Notifications, Perfect 10 Alerts/);
});
