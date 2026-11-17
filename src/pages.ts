import { eventLabel, formatWhen, notificationCopy, SAMPLE_ALERT } from './messages.ts';
import type { AlertDraft } from './types.ts';
import { esc } from './util.ts';

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="icon" href="/icons/favicon-32.png">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="wrap">
<header class="top"><p class="brand"><a href="/">The Five That Score</a></p></header>
<main>${body}</main>
<footer class="foot">Unofficial fan project. Not affiliated with the NCAA, Virtius, or Road to Nationals.</footer>
</div>
</body>
</html>`;
}

export function unsubscribePage(kind: 'done' | 'missing' | 'sample'): string {
  const copy = kind === 'done'
    ? `<h1>You're unsubscribed.</h1><p class="lede">No more perfect-10 push alerts for that signup. You can sign up again any time.</p>`
    : kind === 'sample'
      ? `<h1>That's the sample link.</h1><p class="lede">A real alert carries your own unsubscribe link, and one tap removes you. Nothing was changed.</p>`
      : `<h1>That unsubscribe link isn't valid.</h1><p class="lede">If you still get alerts, open a recent message and use the link at the bottom, or write from the address you signed up with.</p>`;
  return layout('Unsubscribe · Perfect 10 Alerts', `${copy}<p><a class="btn" href="/">Sign up again</a></p>`);
}

export function alertPage(alert: AlertDraft, unsubUrl: string): string {
  const copy = notificationCopy(alert);
  const links = [
    `<a class="btn" href="${esc(alert.scoreboardUrl)}" rel="noopener noreferrer" referrerpolicy="no-referrer">Open the meet</a>`,
    alert.videoUrl ? `<a class="btn btn-ghost" href="${esc(alert.videoUrl)}" rel="noopener noreferrer" referrerpolicy="no-referrer">Watch the stream</a>` : '',
    alert.clipUrl ? `<a class="btn btn-ghost" href="${esc(alert.clipUrl)}" rel="noopener noreferrer" referrerpolicy="no-referrer">Watch the clip</a>` : '',
    `<a class="btn btn-ghost" href="${esc(alert.searchUrl)}" rel="noopener noreferrer" referrerpolicy="no-referrer">Find the clip on X</a>`,
  ].join('');
  return layout(`${alert.athleteName} · 10.0`, `
<p class="kicker">${esc(eventLabel(alert.event))}</p>
<p class="score">10.0</p>
<h1>${esc(alert.athleteName)}</h1>
<p class="lede">${esc(alert.team)} · ${esc(alert.meetName || alert.teamsLabel)} · ${esc(formatWhen(alert))}</p>
<p class="quiet">${esc(copy.body)}</p>
<div class="row">${links}</div>
<form method="post" action="${esc(unsubUrl)}"><button class="texty" type="submit">Unsubscribe</button></form>
`);
}

export function notFoundPage(): string {
  return layout('Not found · Perfect 10 Alerts', `<h1>That page isn't here.</h1><p class="lede"><a href="/">Back to Perfect 10 alerts</a></p>`);
}

/** Lock-screen preview of the exact title, body, and actions the service worker shows. */
export function samplePushPage(origin: string): string {
  const copy = notificationCopy(SAMPLE_ALERT, true);
  const open = `${origin}/a?id=sample&u=sample`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sample push · Perfect 10 Alerts</title>
<link rel="icon" href="/icons/favicon-32.png">
<link rel="stylesheet" href="/styles.css">
</head>
<body class="lock">
<div class="phone">
<p class="phone-time">9:41</p>
<p class="phone-date">Saturday, April 18</p>
<article class="note-card">
<div class="note-top">
<img src="/icons/icon-192.png" alt="" width="28" height="28">
<p>PERFECT 10</p>
<span>now</span>
</div>
<h1>${esc(copy.title)}</h1>
<p>${esc(copy.body)}</p>
<div class="note-actions">
<a href="${esc(open)}">Open</a>
<a href="${esc(origin)}/unsubscribe?token=sample">Unsubscribe</a>
</div>
</article>
<p class="phone-caption">This is the notification the installed app shows. On iPhone it appears after you add the site to your Home Screen (iOS 16.4 or newer). The buttons are the notification actions.</p>
<p class="phone-caption"><a href="/">Back to signup</a></p>
</div>
</body>
</html>`;
}
