(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const summary = document.querySelector('#summary');
  const details = document.querySelector('#details');
  const status = document.querySelector('#status');
  if (!token || token === 'sample') {
    summary.textContent = 'This page needs the private link from the signup screen.';
    document.querySelector('.stack').hidden = true;
    return;
  }

  function say(message, bad = false) {
    status.textContent = message;
    status.classList.toggle('bad', bad);
  }

  function urlBase64ToUint8Array(value) {
    const pad = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function load() {
    const res = await fetch(`/api/me?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      summary.textContent = data.error || 'That link is not valid.';
      return null;
    }
    const push = data.pushStatus === 'active' ? 'On for a saved device' : data.pushStatus;
    summary.textContent = 'This link is the only login. Keep it, or remove yourself below.';
    details.innerHTML = '';
    for (const [label, value] of [['Push', push]]) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = label;
      const val = document.createElement('strong');
      val.textContent = value;
      li.append(name, val);
      details.appendChild(li);
    }
    return data;
  }

  async function post(action, extra = {}) {
    const res = await fetch('/api/me', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'That did not work.');
    say(data.message || 'Saved.');
    await load();
  }

  document.querySelector('#remove').addEventListener('click', () => post('remove').catch((err) => say(err.message, true)));
  document.querySelector('#push-off').addEventListener('click', () => post('push-off').catch((err) => say(err.message, true)));
  document.querySelector('#push-on').addEventListener('click', async () => {
    try {
      const configRes = await fetch('/api/config');
      const config = await configRes.json();
      if (!config.vapidPublicKey) throw new Error('Push is not configured yet.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications are blocked.');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
      });
      await post('push-on', { push: subscription.toJSON() });
    } catch (err) {
      say(err instanceof Error ? err.message : 'Push could not be enabled.', true);
    }
  });

  load().catch(() => { summary.textContent = 'Could not load this signup.'; });
})();
