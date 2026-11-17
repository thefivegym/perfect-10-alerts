import { alertSubject, clipSubject, eventLabel, formatWhen } from './messages.ts';
import type { AlertDraft } from './types.ts';
import { esc } from './util.ts';

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface EmailProvider {
  readonly name: string;
  send(message: OutboundEmail): Promise<void>;
}

/**
 * Swap the provider by setting EMAIL_PROVIDER.
 * `resend` posts to Resend's HTTP API. `webhook` POSTs the same message as JSON
 * to EMAIL_WEBHOOK_URL (optional bearer EMAIL_WEBHOOK_TOKEN) for any other HTTP API.
 * Add another class here if you want a provider built in.
 */
export function createEmailProvider(env: Env): EmailProvider | null {
  const which = (env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (which === 'webhook') {
    if (!env.EMAIL_WEBHOOK_URL || !env.EMAIL_FROM) return null;
    return new WebhookProvider(env.EMAIL_WEBHOOK_URL, env.EMAIL_WEBHOOK_TOKEN || '', env.EMAIL_FROM);
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return null;
  return new ResendProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
}

class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  private apiKey: string;
  private from: string;
  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }
  async send(message: OutboundEmail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Resend HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
}

class WebhookProvider implements EmailProvider {
  readonly name = 'webhook';
  private url: string;
  private token: string;
  private from: string;
  constructor(url: string, token: string, from: string) {
    this.url = url;
    this.token = token;
    this.from = from;
  }
  async send(message: OutboundEmail): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ from: this.from, ...message }),
    });
    if (!res.ok) throw new Error(`Email webhook HTTP ${res.status}`);
  }
}

export function listUnsubscribeHeaders(unsubUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export interface MailLinks {
  unsubscribe: string;
  manage: string;
  confirm?: string;
}

function shell(inner: string, preheader: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Perfect 10 Alerts</title>
</head>
<body style="margin:0;padding:0;background:#f3ecdf;">
<div style="display:none;max-height:0;overflow:hidden;color:#f3ecdf;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ecdf;padding:28px 12px;font-family:Georgia,'Iowan Old Style',serif;color:#1c1428;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #e4d7c4;">
<tr><td style="background:#1c1428;padding:18px 28px;">
<p style="margin:0;font-family:'Avenir Next',Futura,sans-serif;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#e2b340;">The Five That Score</p>
<p style="margin:6px 0 0;font-size:22px;color:#fffdf8;">Perfect 10 alerts</p>
</td></tr>
<tr><td style="padding:28px;">
${inner}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${esc(href)}" referrerpolicy="no-referrer" style="display:inline-block;margin:6px 8px 6px 0;padding:12px 16px;background:#1c1428;color:#f3ecdf;text-decoration:none;font-family:'Avenir Next',Futura,sans-serif;font-size:14px;">${esc(label)}</a>`;
}

function footer(links: MailLinks, why: string): string {
  return `<p style="margin:28px 0 0;font-family:'Avenir Next',Futura,sans-serif;font-size:13px;line-height:1.5;color:#5c5348;">${why}</p>
<p style="margin:12px 0 0;font-family:'Avenir Next',Futura,sans-serif;font-size:13px;line-height:1.5;">
<a href="${esc(links.unsubscribe)}" referrerpolicy="no-referrer" style="color:#c2185b;">Unsubscribe</a>
&nbsp;·&nbsp;
<a href="${esc(links.manage)}" referrerpolicy="no-referrer" style="color:#1c1428;">Manage alerts</a>
</p>
<p style="margin:16px 0 0;font-family:'Avenir Next',Futura,sans-serif;font-size:12px;line-height:1.5;color:#8a7d6b;">Unofficial fan project by The Five That Score (@thefivegym). Not affiliated with the NCAA, Virtius, or Road to Nationals.</p>`;
}

export function renderAlertEmail(alert: AlertDraft, links: MailLinks, opts: { sample?: boolean; clip?: boolean } = {}): { html: string; text: string; subject: string } {
  const exhibition = alert.exhibition ? 'Exhibition ' : '';
  const subject = opts.clip ? clipSubject(alert) : alertSubject(alert, opts.sample === true);
  const when = formatWhen(alert);
  const meet = alert.meetName || alert.teamsLabel || 'D1 meet';
  const banner = opts.sample
    ? `<p style="margin:0 0 16px;padding:8px 12px;background:#f8e7b0;font-family:'Avenir Next',Futura,sans-serif;font-size:13px;">Sample alert. Nobody just scored a 10. This is a test of the pipeline.</p>`
    : '';
  const clipNote = opts.clip && alert.clipUrl
    ? `<p style="margin:0 0 16px;font-size:18px;">The clip is up.</p>`
    : '';
  const linksHtml = [
    button(alert.scoreboardUrl, 'Open the meet'),
    alert.videoUrl ? button(alert.videoUrl, 'Watch the stream') : '',
    alert.clipUrl ? button(alert.clipUrl, 'Watch the clip') : '',
    button(alert.searchUrl, 'Find the clip on X'),
  ].join('');
  const videoLine = alert.videoUrl ? `Stream: ${alert.videoUrl}` : 'No TV or stream link was listed on the schedule for this meet.';
  const clipLine = alert.clipUrl ? `Clip: ${alert.clipUrl}` : '';
  const html = shell(`
${banner}
${clipNote}
<p style="margin:0;font-family:'Avenir Next',Futura,sans-serif;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#c2185b;">${esc(exhibition)}${esc(eventLabel(alert.event))}</p>
<p style="margin:8px 0 0;font-size:42px;line-height:1;">10.0</p>
<p style="margin:8px 0 0;font-size:28px;line-height:1.2;">${esc(alert.athleteName)}</p>
<p style="margin:4px 0 0;font-family:'Avenir Next',Futura,sans-serif;font-size:16px;color:#3a3128;">${esc(alert.team)}</p>
<p style="margin:22px 0 0;font-size:18px;line-height:1.4;">${esc(meet)}</p>
<p style="margin:4px 0 0;font-family:'Avenir Next',Futura,sans-serif;font-size:14px;color:#5c5348;">${esc(alert.teamsLabel)} · ${esc(when)}</p>
<p style="margin:22px 0 0;">${linksHtml}</p>
${footer(links, 'You get this because you asked Perfect 10 Alerts to write when a Division I gymnast scores a 10.0. One message per athlete, per event, per meet.')}
`, `${alert.athleteName} scored a 10.0 on ${eventLabel(alert.event)} for ${alert.team}.`);
  const text = [
    opts.sample ? 'SAMPLE ALERT. This is a test.' : '',
    opts.clip ? 'The clip is up.' : '',
    `${exhibition}${eventLabel(alert.event)} 10.0`,
    alert.athleteName,
    alert.team,
    meet,
    `${alert.teamsLabel} · ${when}`,
    '',
    `Meet: ${alert.scoreboardUrl}`,
    videoLine,
    clipLine,
    `Search X: ${alert.searchUrl}`,
    '',
    `Unsubscribe: ${links.unsubscribe}`,
    `Manage: ${links.manage}`,
    '',
    'The Five That Score. Unofficial; not affiliated with the NCAA, Virtius, or Road to Nationals.',
  ].filter((line) => line !== '').join('\n');
  return { html, text, subject };
}

export function renderConfirmEmail(links: MailLinks): { html: string; text: string; subject: string } {
  const confirm = links.confirm || links.manage;
  const html = shell(`
<p style="margin:0;font-size:26px;line-height:1.25;">Confirm your Perfect 10 alerts</p>
<p style="margin:14px 0 0;font-size:17px;line-height:1.45;">Tap the button and you're in. You'll get an email the moment a Division I women's gymnast scores a 10.0.</p>
<p style="margin:22px 0 0;">${button(confirm, 'Yes, send me the 10s')}</p>
${footer(links, 'If you did not ask for this, ignore the message or unsubscribe. We will not email a 10 until you confirm.')}
`, 'Confirm your Perfect 10 alerts from The Five That Score.');
  const text = [
    'Confirm your Perfect 10 alerts',
    '',
    `Yes, send me the 10s: ${confirm}`,
    '',
    `Unsubscribe: ${links.unsubscribe}`,
    '',
    'If you did not ask for this, you can ignore it.',
  ].join('\n');
  return { html, text, subject: 'Confirm your Perfect 10 alerts' };
}
