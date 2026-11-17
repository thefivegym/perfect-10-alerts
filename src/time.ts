export function ymdInTz(date: Date, tz = 'America/Chicago'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  let hour = Number(p.hour);
  let day = Number(p.day);
  // Some engines report midnight as hour 24 on the previous calendar day.
  if (hour === 24) {
    hour = 0;
    const bumped = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, day));
    bumped.setUTCDate(bumped.getUTCDate() + 1);
    return Date.UTC(bumped.getUTCFullYear(), bumped.getUTCMonth(), bumped.getUTCDate(), hour, Number(p.minute), Number(p.second)) - utcMs;
  }
  return Date.UTC(Number(p.year), Number(p.month) - 1, day, hour, Number(p.minute), Number(p.second)) - utcMs;
}

/** Wall-clock time in an IANA zone, returned as ISO UTC. RTN meet times are US Eastern. */
export function zonedToUtcIso(ymd: string, hms: string, tz: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm, ss] = (hms || '00:00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return new Date(t).toISOString();
}

/** Season year is the spring year. July through December belong to the next season. */
export function seasonFor(ymd: string): number {
  const [y, m] = ymd.split('-').map(Number);
  return m >= 7 ? y + 1 : y;
}

export function formatMeetDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
