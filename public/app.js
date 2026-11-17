import { deniedHelp, SETUP_KINDS, setupKind, setupTitle } from './setup.js';

(() => {
  const form = document.querySelector('#signup');
  if (!form) return;
  const status = document.querySelector('#status');
  const submit = document.querySelector('#submit');
  const hint = document.querySelector('#setup-hint');
  const turnstileBox = document.querySelector('#turnstile');
  let config = { pushConfigured: true, vapidPublicKey: '', turnstileSiteKey: '' };

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

  const forced = new URLSearchParams(location.search).get('setup');
  const kind = SETUP_KINDS.includes(forced) ? forced : setupKind({
    ua: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone: window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches,
  });
  const setup = document.querySelector('#setup');
  const denied = document.querySelector('#denied');
  const title = document.querySelector('#setup-title');
  if (title) title.textContent = setupTitle(kind);
  for (const guide of document.querySelectorAll('.guide')) {
    guide.hidden = guide.dataset.setup !== kind;
  }
  if (forced && setup) setup.open = true;

  function showDenied() {
    if (!denied) return;
    denied.hidden = false;
    denied.textContent = deniedHelp(kind);
    if (setup) setup.open = true;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') showDenied();

  document.querySelector('#copy-link')?.addEventListener('click', async () => {
    const button = document.querySelector('#copy-link');
    const link = `${location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(link);
      if (button) button.textContent = 'Link copied';
    } catch {
      if (button) button.textContent = link;
    }
  });

  async function enablePush() {
    if (!config.vapidPublicKey) throw new Error('Push is not configured on this site yet.');
    if (kind === 'ios-other') {
      if (setup) setup.open = true;
      throw new Error('Tap Open in Safari first. Then use •••, Share, and Add to Home Screen.');
    }
    if (kind === 'ios-safari') {
      if (setup) setup.open = true;
      throw new Error('In Safari, tap ••• next to the address bar, then Share, then Add to Home Screen. Open the icon and tap Turn on alerts.');
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      throw new Error('This browser cannot receive push notifications.');
    }
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (permission === 'denied') showDenied();
      throw new Error(permission === 'denied' ? 'Notifications are off for this site.' : 'Tap Allow when the browser asks.');
    }
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
    });
    return subscription.toJSON();
  }

  fetch('/api/config').then(async (res) => {
    if (!res.ok) return;
    config = await res.json();
    if (!config.pushConfigured) {
      submit.disabled = true;
      hint.textContent = 'Push is not turned on yet. The site owner still needs to add the push keys.';
    }
    if (config.turnstileSiteKey) {
      turnstileBox.hidden = false;
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      document.head.appendChild(script);
      turnstileBox.className = 'cf-turnstile';
      turnstileBox.dataset.sitekey = config.turnstileSiteKey;
    }
  }).catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    say('');
    submit.disabled = true;
    try {
      const payload = {
        company: new FormData(form).get('company') || '',
        turnstile: document.querySelector('[name="cf-turnstile-response"]')?.value || '',
        push: await enablePush(),
      };
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Signup failed.');
      say(data.message || 'Push is on for this device.');
      if (data.manageUrl) {
        const link = document.createElement('a');
        link.href = data.manageUrl;
        link.textContent = ' Manage or remove this signup.';
        status.appendChild(link);
      }
    } catch (err) {
      say(err instanceof Error ? err.message : 'Signup failed.', true);
    } finally {
      if (config.pushConfigured !== false) submit.disabled = false;
    }
  });

  const club = document.querySelector('#club');
  const seasonSelect = document.querySelector('#club-season');
  const count = document.querySelector('#club-count');
  const board = document.querySelector('#club-board');
  const log = document.querySelector('#club-log');
  const teams = document.querySelector('#club-teams');
  const sample = document.querySelector('#club-sample');
  if (!club || !seasonSelect) return;

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function renderClub(data) {
    sample.hidden = !data.sample;
    count.textContent = data.count === 1 ? `1 perfect 10 in ${data.season}` : `${data.count} perfect 10s in ${data.season}`;
    const current = String(data.season);
    if (![...seasonSelect.options].some((option) => option.value === current)) {
      clear(seasonSelect);
      for (const year of data.seasons || [data.season]) {
        const option = document.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        seasonSelect.appendChild(option);
      }
    }
    seasonSelect.value = current;
    clear(board);
    clear(log);
    if (!data.leaderboard?.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No perfect 10s logged for this season yet.';
      board.appendChild(empty);
    }
    for (const row of data.leaderboard || []) {
      const li = document.createElement('li');
      if (row.hot) li.className = 'hot';
      const name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = row.athlete;
      const total = document.createElement('span');
      total.className = 'board-count';
      total.textContent = String(row.count);
      li.append(name, total);
      board.appendChild(li);
    }
    for (const entry of data.entries || []) {
      const li = document.createElement('li');
      const line = document.createElement('p');
      line.className = 'shout';
      line.textContent = entry.shoutout;
      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = `${entry.meet} · ${entry.date}`;
      const links = document.createElement('p');
      links.className = 'links';
      if (entry.meetUrl) {
        const meet = document.createElement('a');
        meet.href = entry.meetUrl;
        meet.rel = 'noopener noreferrer';
        meet.referrerPolicy = 'no-referrer';
        meet.textContent = 'Meet';
        links.appendChild(meet);
      }
      if (entry.clipUrl) {
        const clip = document.createElement('a');
        clip.href = entry.clipUrl;
        clip.rel = 'noopener noreferrer';
        clip.referrerPolicy = 'no-referrer';
        clip.textContent = 'Clip';
        links.appendChild(clip);
      }
      li.append(line, meta, links);
      log.appendChild(li);
    }
    teams.textContent = (data.teams || []).map((team) => `${team.team} ${team.count}`).join(' · ');
  }

  async function loadClub(season) {
    const query = season ? `?season=${encodeURIComponent(season)}` : '';
    const res = await fetch(`/api/club${query}`);
    if (!res.ok) {
      count.textContent = 'The club log is not available yet.';
      return;
    }
    renderClub(await res.json());
  }

  seasonSelect.addEventListener('change', () => { loadClub(seasonSelect.value).catch(() => {}); });
  loadClub('').catch(() => { count.textContent = 'The club log is not available yet.'; });
})();
