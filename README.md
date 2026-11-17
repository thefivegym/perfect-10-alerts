# Perfect 10 Alerts

Fans of [The Five That Score](https://x.com/thefivegym) sign up here and get one phone push whenever an NCAA Division I women's gymnast scores a **10.0** on vault, bars, beam, or floor.

The site and the checker are one Cloudflare Worker. Signups live in a private D1 database. Nothing about a subscriber is stored in this git repo.

This project does not import code from the live scoreboard, and it does not change that repo. It only reads the same public data the scoreboard reads.

## What you need

| Thing | Why |
| --- | --- |
| A [Cloudflare](https://dash.cloudflare.com/sign-up) account | Hosts the site, the once-a-minute checker, and the database. The free plan is enough to start. |
| [Node.js 22](https://nodejs.org/) | Runs the deploy commands on your computer. |
| Optional: a domain on that same Cloudflare account | Only if you want a custom web address later, such as `alerts.yourdomain.com`. The first deploy works on a `*.workers.dev` address with no domain. You do not need a domain, and you do not need an email service. |

You do **not** need a Virtius account or a Road to Nationals account. Both feeds used here are public.

## How a perfect 10 is detected

Every minute a cron trigger wakes the Worker.

1. It loads the meet schedule. First choice is the scoreboard's published file, `https://thefivegym.github.io/live-scoreboard/data/schedule.json`, but only when that file includes the current season (the season that contains January of its spring year; July–December belong to the next season). A file that only runs through April 2026 does not cover the 2027 season, so the Worker builds the schedule from Road to Nationals instead, one request per minute and never sooner than 30 seconds after the last one. It also falls back when the file is missing or no longer has a `meets` list. Division I is rows with `div = "Div I"`, plus names in `d1-overrides.json` when that file is still published. The schedule is refreshed about three times a day, not every minute.
2. During a meet window (from 15 minutes before the listed start until 8 hours after), it reads live scores from Virtius: `https://api.virti.us/session/{key}/json`.
3. Meets with no Virtius key fall back to Road to Nationals `GET /api/women/meetresults/{id}`. RTN's robots.txt asks for a 30 second crawl delay, so the Worker makes **at most one RTN request per minute**, and never sooner than 30 seconds after the previous one.
4. A score alerts only when it is an individual vault, bars, beam, or floor score of exactly 10.0 (Virtius publishes this as `"10.0000"`). All-around totals, team event totals, and a judge's starting value of 10.00 are not alerts.
5. The first time that athlete + event + meet is seen, one message goes out. Seeing the same 10 again on the next minute, or on both the lineup and the leaderboard, does not send a second message. A subscriber who joins after the score posts does not get a backfill of old 10s. A clip you attach later is a separate follow-up, once per clip URL.

Scored intrasquads that have a Virtius key (the same lists the scoreboard keeps) are included. A fashion show or other event marked skip stays out unless a Virtius key shows up.

### Exhibition scores

Virtius lineup slot 7 and later is an exhibition. That is the same rule the scoreboard uses. **Those scores are ignored.** A 10.0 in an exhibition routine does not send an alert, even if the same 10 also appears on the event leaderboard. Alerts never say "Exhibition".

A 10.0 in lineup slots 1 through 6 still alerts. Virtius later marks one score in that group as dropped (`type === 0`). The alert does not wait for that flag. It is not reliable while the rotation is still going, and waiting would miss the one-to-two minute target. In a normal top-five count, a 10.0 is never the score that gets thrown out.

Road to Nationals does not say which routines were exhibitions, so this filter applies to Virtius lineups. An individual event score of exactly 10.0 from the RTN feed is still alerted.

## Perfect 10 Club

Every 10 that would send an alert is also written to a public log: athlete, team, event, meet, and date. The same athlete + event + meet is stored once. Exhibition 10s are not stored. The signup page lists them newest first under the button, with a season count, a shoutout line, the meet link, and a clip link when one has been attached.

The same log builds the season leaderboard. Athletes are ranked by how many perfect 10s they have. People with the same count share a rank (so two leaders are 1 and 1, and the next person is 3). Within a tie, the gymnast with the more recent 10 is listed first. Each row shows team, count, and VT / UB / BB / FX badges. Anyone with two or more 10s is highlighted. Team totals sit under the board.

`GET /api/club` returns that JSON and nothing about subscribers. `?season=2026` picks a season. With no query it uses the current season (July through the following June, same rule as the schedule).

Hide or correct a row (admin token):

```sh
curl -X POST "$PUBLIC_BASE_URL/api/admin/club" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"MEET|vault|123","hidden":true}'
```

You can also send `athlete`, `team`, `event`, `meet`, `date`, or `clip_url`.

A normal replay does not write the log. To backfill past meets without notifying anyone:

```sh
curl -X POST "$PUBLIC_BASE_URL/api/admin/club/backfill" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"virtius":"MFrZ9epozB"}'
```

`keys` accepts up to eight session keys. `from` and `to` (`YYYY-MM-DD`) use Virtius meets already saved in the schedule. `"log": true` on `/api/admin/replay` does the same for one meet. `"record": true` still saves the 10s and also sends the push.

If this site is already deployed, apply the new table change on top of the existing database:

```sh
npx wrangler d1 migrations apply DB --remote
```

## Deploy

Do these in order. Commands are typed in a terminal, in this project folder. On Windows, PowerShell is fine.

### 1. Install Node and download the project

Install Node.js 22 from https://nodejs.org/ (the "LTS" or "Current" installer that is version 22 or newer). Then:

```sh
git clone <this repo's URL>
cd perfect-10-alerts
npm install
```

### 2. Log in to Cloudflare

```sh
npx wrangler login
```

A browser window opens. Approve access for the account that should own the site.

### 3. Create the database

```sh
npx wrangler d1 create perfect-10-alerts
```

The output includes a line like `database_id = "a1b2c3d4-...."`. Copy that id.

Open `wrangler.jsonc`. Replace the placeholder:

```jsonc
"database_id": "00000000-0000-0000-0000-000000000000"
```

with the id you just copied. Save the file.

Create the tables:

```sh
npx wrangler d1 migrations apply DB --remote
```

When it asks you to confirm, answer yes.

### 4. Generate the push keys and an admin token

```sh
npm run vapid
```

The terminal prints three values. Leave that window open. They are not written to a file. You will paste them in the next step. If you close the window before pasting, run `npm run vapid` again (old unused keys can be ignored).

### 5. Put non-secret settings in `wrangler.jsonc`

Edit the `vars` block:

- `VAPID_SUBJECT` — a real contact, for example `mailto:you@yourdomain.com`. Push services ask for this on each notification. It is not a mailbox this project sends from, and it is not a secret. If you have no domain, `mailto:alerts@example.com` still lets you deploy; replace it when you have an address you control.
- `PUBLIC_BASE_URL` — leave this blank for the first deploy. You will set it in step 7, after Cloudflare tells you the site address.
- `TURNSTILE_SITE_KEY` — leave blank unless you turn on the optional bot check below.

### 6. Store the secrets

Run each command, paste the value when asked, and press Enter. Wrangler does not save these into the git repo.

```sh
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put ADMIN_TOKEN
```

Use the three values from `npm run vapid`.

### 7. Deploy, then set the public address

```sh
npx wrangler deploy
```

The output ends with a URL like `https://perfect-10-alerts.<your-account>.workers.dev`. Open it in a browser to confirm the signup page loads.

Then set that URL as the public address so links inside alerts point at your site:

1. In `wrangler.jsonc`, set `PUBLIC_BASE_URL` to that URL with no slash at the end. Example: `https://perfect-10-alerts.example.workers.dev`.
2. Deploy again: `npx wrangler deploy`.

If you forget, the Worker remembers the address from the first visit and uses that. Setting it in the file is more reliable, especially before anyone has opened the site.

### 8. Send yourself a test alert

On a computer, open the site and allow notifications. On iPhone, use Safari: Share → Add to Home Screen, open Perfect 10 Alerts from the icon, then allow notifications. That saves this device. Then, from the project folder:

```sh
curl -X POST "$PUBLIC_BASE_URL/api/admin/test-alert" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"broadcast":true}'
```

Replace the URL and the token. The notification is labeled **Sample**. It uses the real 2026 NCAA final (Kailin Chio, LSU, vault) so you can see the layout. Nobody scored a 10 at the moment you sent it. `"broadcast": true` writes to every saved device, so don't use it once fans have signed up unless you mean to.

`/sample/push` on the site shows the same notification without sending it. Every real notification has an Unsubscribe action.

### 9. Prove the checker sees a real 10

On your computer, from this folder (needs the internet):

```sh
npm test
```

One test downloads the 2026 NCAA Championship final from Virtius (`MFrZ9epozB`) and checks that Kailin Chio's vault 10.0 is found, that Lily Pederson's 9.9875 is not, and that a second pass would not send a duplicate. `npm run replay` prints the same result without the rest of the tests.

After deploy, the same check through the site (it does not notify anyone unless you add `"record": true`):

```sh
curl -X POST "$PUBLIC_BASE_URL/api/admin/replay" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"virtius":"MFrZ9epozB"}'
```

You should see `"count": 1` and Kailin Chio on vault.

## Day to day

Fans open the site and allow notifications. On iPhone that only works in the installed Home Screen app, on iOS 16.4 or newer. The signup page says so.

- Every push has an Unsubscribe action. Tapping the notification itself opens a page with the meet, the stream or clip when we have one, an X search for the gymnast's name plus "10", and an unsubscribe button.
- The manage link shown after signup can turn push off, turn it back on for this device, or remove the signup. There is no password. The link is the login. Don't post it publicly.

Optional bot check: in the Cloudflare dashboard open **Turnstile**, add a site, copy the site key into `TURNSTILE_SITE_KEY` in `wrangler.jsonc`, then:

```sh
npx wrangler secret put TURNSTILE_SECRET
npx wrangler deploy
```

Signup is rate limited (8 attempts per 10 minutes per network) even without Turnstile.

### Attach a clip after the fact

```sh
curl -X POST "$PUBLIC_BASE_URL/api/admin/clip" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"meet_key":"MFrZ9epozB","athlete":"Kailin Chio","event":"vault","clip_url":"https://x.com/thefivegym/status/123"}'
```

`clip_url` has to be an `https` link. Subscribers who already got the 10 get one push follow-up for that URL. Setting a different URL sends another follow-up. The same URL does not.

`GET /api/admin/alerts` with the same `Authorization: Bearer` header lists recent alerts and their ids, if you would rather pass `"id"` than the meet and the name.

### A custom domain later

1. Add the domain to the **same** Cloudflare account that owns the Worker.
2. In `wrangler.jsonc`, add a routes entry (the file has a comment showing the shape):

```jsonc
"routes": [{ "pattern": "alerts.yourdomain.com", "custom_domain": true }]
```

3. Set `PUBLIC_BASE_URL` to `https://alerts.yourdomain.com`.
4. Run `npx wrangler deploy` again.

Cloudflare creates the DNS record for you when the domain is on that account.

## What it costs

The checker runs once a minute, about 1,440 Worker requests a day, which is under the Workers free plan's daily request allowance (100,000 requests a day as of the Cloudflare docs in November 2026). Most of those minutes, in the offseason or between meets, only read the database. Virtius is polled only while a meet is in its window, at most 8 sessions a minute (the rest come around on the next minute, so a busy Saturday is still inside about two minutes). Road to Nationals is at most once a minute.

The free plan allows about 10 milliseconds of CPU per run. Parsing scores and encrypting push messages is small for a modest list (the Worker sends at most 20 messages per minute and continues on the next minute). If the Cloudflare dashboard shows **Exceeded CPU time** on a packed meet day, the Workers Paid plan raises that CPU limit. You do not need it to launch.

Push subscriptions are rows in D1, not files in git.

## Run the tests, or preview the page, on your computer

```sh
npm test          # unit tests plus the live NCAA final replay
npm run check     # TypeScript
npm run preview   # signup page at http://127.0.0.1:8787 (does not save anyone)
npm run replay    # print 10s from a Virtius key (default: the 2026 final)
```

`npm run dev` runs the real Worker locally (`npx wrangler dev`) after you copy `.dev.vars.example` to `.dev.vars` and fill in secrets. Apply the local database once with `npm run db:migrate:local`.

## Project map

| Path | What it is |
| --- | --- |
| `src/index.ts` | The Worker: website requests and the every-minute cron |
| `src/detect.ts` | What counts as a 10.0. Exhibition routines are skipped. |
| `src/poll.ts` | Schedule refresh, Virtius, and the RTN fallback |
| `src/push.ts` | Web Push (VAPID + encrypted payload). This is the only alert channel. |
| `public/` | Signup page, manage page, service worker, manifest, icons |
| `migrations/` | D1 tables |
| `wrangler.jsonc` | Worker name, cron, database, and non-secret settings |

## Troubleshooting

- **The signup button says push is not turned on.** The VAPID secrets are missing. Run the three `wrangler secret put` commands and deploy again.
- **Nothing happens on iPhone.** Safari in the browser cannot subscribe. Share → Add to Home Screen, open the icon, then allow notifications. iOS 16.4 or newer.
- **Test alert returns 401.** The `Authorization: Bearer` value does not match `ADMIN_TOKEN`.
- **Replay returns a network error.** Virtius was briefly unreachable. Run it again. `npm test` hits the same URL.
- **`/manage` keeps redirecting.** The site must be this version: `/manage` is served directly, not by asking the asset host for `/manage.html` (that redirect loops).
- **No alerts during a meet you can see on the scoreboard.** Open `GET /api/health`. `scheduleRefreshedAt` should be recent and `meets` should be more than 0 after the first cron (give it a minute). If the published schedule is still last season, `scheduleSource` should mention Road to Nationals after a few minutes. In the Cloudflare dashboard, the Worker logs are JSON lines with `"event":"poll"`.
