export function setupKind(input: {
  ua?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}): 'ios-safari' | 'ios-home' | 'ios-other' | 'android' | 'desktop';

export function setupTitle(kind: string): string;

export function deniedHelp(kind: string): string;

export const SETUP_KINDS: string[];
