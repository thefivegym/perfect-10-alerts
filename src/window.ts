import { MEET_LEAD_MS, MEET_TAIL_MS } from './config.ts';
import { addDays, ymdInTz } from './time.ts';

export function meetIsInWindow(meet: { date: string; startUtc: string | null }, now: Date): boolean {
  if (meet.startUtc) {
    const start = Date.parse(meet.startUtc);
    if (Number.isFinite(start)) {
      const t = now.getTime();
      return t >= start - MEET_LEAD_MS && t <= start + MEET_TAIL_MS;
    }
  }
  const today = ymdInTz(now);
  return meet.date === today || meet.date === addDays(today, -1);
}
