(() => {
  const form = document.querySelector('#signup');
  if (!form) return;
  const status = document.querySelector('#status');
  const emailField = document.querySelector('#email-field');
  const emailInput = document.querySelector('#email');
  const submit = document.querySelector('#submit');
  const hint = document.querySelector('#setup-hint');
  const turnstileBox = document.querySelector('#turnstile');
  const buttons = [...document.querySelectorAll('.channels button')];
  let channel = 'both';
  let config = { pushConfigured: true, emailConfigured: true, vapidPublicKey: '', turnstileSiteKey: '' };

  function say(message, bad = false) {
    status.textContent = message;
    status.classList.toggle('bad', bad);
  }

  function select(next) {
    channel = next;
    buttons.forEach((button) => button.setAttribute('aria-checked', String(button.dataset.channel === next)));
    const needsEmail = next !== 'push';
    emailField.hidden = !needsEmail;
    emailInput.required = needsEmail;
  }

  buttons.forEach((button) => button.addEventListener('click', () => {
    if (button.disabled) return;
    select(button.dataset.channel);
  }));

  function urlBase64ToUint8Array(value) {
    const pad = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (iphone) document.querySelector('#iphone').classList.add('here');

  async function enablePush() {
    if (!config.vapidPublicKey) throw new Error('Push is not configured on this site yet.');
    if (iphone && !standalone) {
      throw new Error('On iPhone, add this site to your Home Screen first, open it from the icon, then allow notifications.');
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('This browser cannot receive push. Email still works.');
    }
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications are blocked. You can still subscribe with email.');
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
      buttons.filter((button) => button.dataset.channel !== 'email').forEach((button) => { button.disabled = true; });
      select('email');
      hint.textContent = 'Push is not turned on yet. Email still works.';
    } else if (!config.emailConfigured) {
      buttons.filter((button) => button.dataset.channel !== 'push').forEach((button) => { button.disabled = true; });
      select('push');
      hint.textContent = 'Email is not turned on yet. Push still works.';
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
        channels: channel,
        company: new FormData(form).get('company') || '',
        turnstile: document.querySelector('[name="cf-turnstile-response"]')?.value || '',
      };
      if (channel !== 'push') payload.email = emailInput.value.trim();
      if (channel !== 'email') payload.push = await enablePush();
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Signup failed.');
      say(data.message || 'You are signed up.');
      if (data.manageUrl) {
        const link = document.createElement('a');
        link.href = data.manageUrl;
        link.textContent = ' Manage or remove this signup.';
        status.appendChild(link);
      }
      form.reset();
      select(channel);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Signup failed.', true);
    } finally {
      submit.disabled = false;
    }
  });
})();
