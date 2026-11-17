/** Shared limits. The cron is every minute; these caps keep a free-plan tick small. */

/** Road to Nationals robots.txt asks for a 30 second crawl delay. */
export const RTN_CRAWL_DELAY_MS = 30_000;

/** Refresh the schedule a few times a day, not every minute. */
export const SCHEDULE_TTL_MS = 8 * 60 * 60 * 1000;

/** Start polling this long before the scheduled start. */
export const MEET_LEAD_MS = 15 * 60 * 1000;

/** Keep polling this long after the start so a late 10.0 is still caught. */
export const MEET_TAIL_MS = 8 * 60 * 60 * 1000;

/** Virtius sessions fetched on one tick. The rest are picked up next minute. */
export const MAX_VIRTIUS_PER_TICK = 8;

/** At most this many outbound alert sends per tick. The rest wait for the next minute. */
export const MAX_SENDS_PER_TICK = 20;

export const DELIVERY_ATTEMPTS = 6;

/** A claimed delivery older than this can be retried (the previous tick died). */
export const CLAIM_STALE_MS = 2 * 60 * 1000;

/** How long a new 10.0 keeps trying to reach subscribers who were already signed up. */
export const DELIVER_WINDOW_MS = 12 * 60 * 60 * 1000;

export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const USER_AGENT = 'Perfect10Alerts/1.0 (+https://x.com/thefivegym; D1 perfect-10 alerts)';

export const RTN_ORIGIN = 'https://www.roadtonationals.com/api/women';
export const VIRTIUS_SESSION = 'https://api.virti.us/session';

export const SCOREBOARD_HOME = 'https://thefivegym.github.io/live-scoreboard/';
