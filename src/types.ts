export type EventKey = 'vault' | 'bars' | 'beam' | 'floor';
export type AlertSource = 'virtius' | 'rtn';

export interface MeetContext {
  meetKey: string;
  meetName: string;
  meetDate: string;
  teamsLabel: string;
  d1Teams: string[];
  intrasquad: boolean;
  videoUrl: string | null;
  source: AlertSource;
}

/** A perfect 10 ready to store and send. `id` is the dedupe key. */
export interface AlertDraft {
  id: string;
  athleteName: string;
  athleteId: string | null;
  team: string;
  event: EventKey;
  exhibition: boolean;
  meetKey: string;
  meetName: string;
  meetDate: string;
  teamsLabel: string;
  videoUrl: string | null;
  clipUrl: string | null;
  scoreboardUrl: string;
  searchUrl: string;
  source: AlertSource;
  detectedAt?: string;
}

export interface StoredMeet {
  meetKey: string;
  rtnId: number | null;
  date: string;
  startUtc: string | null;
  description: string;
  home: string[];
  away: string[];
  d1Teams: string[];
  virtius: string | null;
  videoUrl: string | null;
  videoDesc: string | null;
  intrasquad: boolean;
  lastPolledAt?: string | null;
}

export interface SubscriberRow {
  id: string;
  push_endpoint: string | null;
  push_p256dh: string | null;
  push_auth: string | null;
  push_status: string;
  unsub_token: string;
  created_at: string;
  updated_at: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
