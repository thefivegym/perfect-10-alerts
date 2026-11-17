import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deniedHelp, setupKind, setupTab, setupTitle } from '../public/setup.js';

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
  assert.equal(setupTab('ios-safari'), 'iphone');
  assert.equal(setupTab('ios-other'), 'iphone');
  assert.equal(setupTab('android'), 'android');
  assert.equal(setupTab('desktop'), 'computer');
});

test('denied help tells each device where to turn notifications back on', () => {
  assert.match(deniedHelp('ios-safari'), /Settings, tap Notifications, tap Perfect 10 Alerts/);
  assert.match(deniedHelp('ios-other'), /Safari/);
  assert.match(deniedHelp('android'), /Permissions, then Notifications/);
  assert.match(deniedHelp('android'), /Android Settings/);
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
  assert.match(html, /Open as Web App/);
  assert.match(html, /Open in Safari/);
  assert.match(html, /•••/);
  assert.match(html, /iOS 16\.4 or newer/);
  assert.match(html, /id="copy-link"/);
  assert.match(html, /data-tab="android"/);
  assert.match(html, /data-tab="computer"/);
  assert.match(html, /Open in Chrome/);
  assert.match(html, /Add to Home screen/);
  assert.match(html, /Samsung Internet/);
  assert.match(html, /id="visitors"/);
  assert.match(html, /Settings, Notifications, Perfect 10 Alerts/);
});
