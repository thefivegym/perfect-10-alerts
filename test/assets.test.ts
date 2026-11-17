import assert from 'node:assert/strict';
import { test } from 'node:test';
import { staticAssetUrl } from '../src/assets.ts';

test('manage is not fetched as manage.html, which the asset handler redirects back', () => {
  const out = staticAssetUrl(new URL('https://perfect-10-alerts.thefivegym.workers.dev/manage?token=abc'));
  assert.equal(out.pathname, '/manage');
  assert.equal(out.search, '?token=abc');
  assert.equal(out.pathname.endsWith('.html'), false);
});

test('a direct manage.html request is fetched as /manage so the redirect is not returned', () => {
  const out = staticAssetUrl(new URL('https://perfect-10-alerts.thefivegym.workers.dev/manage.html'));
  assert.equal(out.pathname, '/manage');
});

test('worker pages are not rewritten onto a .html asset path', () => {
  for (const path of ['/', '/unsubscribe', '/a', '/sample/push', '/manage']) {
    const out = staticAssetUrl(new URL(`https://perfect-10-alerts.thefivegym.workers.dev${path}`));
    assert.equal(out.pathname.endsWith('.html'), false, path);
  }
});

test('the favicon is a non-html file', () => {
  const out = staticAssetUrl(new URL('https://perfect-10-alerts.thefivegym.workers.dev/favicon.ico'));
  assert.equal(out.pathname, '/icons/favicon-32.png');
});
