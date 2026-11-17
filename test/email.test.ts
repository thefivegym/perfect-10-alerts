import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listUnsubscribeHeaders, renderAlertEmail, renderConfirmEmail } from '../src/email.ts';
import { SAMPLE_ALERT } from '../src/messages.ts';

const links = {
  unsubscribe: 'https://alerts.example/unsubscribe?token=abc',
  manage: 'https://alerts.example/manage?token=abc',
  confirm: 'https://alerts.example/confirm?token=def',
};

test('an alert email names the gymnast, the meet link, the X search, and a one-click unsubscribe', () => {
  const alert = { ...SAMPLE_ALERT, athleteName: 'A <Script>' };
  const rendered = renderAlertEmail(alert, links);
  assert.match(rendered.subject, /A <Script>/);
  assert.match(rendered.html, /A &lt;Script&gt;/);
  assert.equal(rendered.html.includes('<Script>'), false);
  assert.match(rendered.html, /10\.0/);
  assert.match(rendered.html, /Open the meet/);
  assert.match(rendered.html, new RegExp(alert.scoreboardUrl.replace(/[?]/g, '\\?')));
  assert.match(rendered.html, /Find the clip on X/);
  assert.match(rendered.text, /Unsubscribe: https:\/\/alerts\.example\/unsubscribe\?token=abc/);
  const headers = listUnsubscribeHeaders(links.unsubscribe);
  assert.equal(headers['List-Unsubscribe'], `<${links.unsubscribe}>`);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('confirmation mail asks before any 10 is sent', () => {
  const rendered = renderConfirmEmail(links);
  assert.match(rendered.subject, /Confirm/);
  assert.match(rendered.html, /confirm\?token=def/);
  assert.match(rendered.text, /Unsubscribe: https:\/\/alerts\.example\/unsubscribe\?token=abc/);
});

test('a follow-up leads with the clip', () => {
  const rendered = renderAlertEmail({ ...SAMPLE_ALERT, clipUrl: 'https://x.com/thefivegym/status/1' }, links, { clip: true });
  assert.match(rendered.subject, /^Clip:/);
  assert.match(rendered.html, /https:\/\/x\.com\/thefivegym\/status\/1/);
  assert.match(rendered.text, /The clip is up/);
});
