/** Which setup guide to show. Pure so the device rules can be tested. */
export function setupKind(input) {
  const ua = String(input.ua || '');
  const ios = /iPhone|iPad|iPod/i.test(ua) || (input.platform === 'MacIntel' && Number(input.maxTouchPoints) > 1);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|OPT\/|GSA\//i.test(ua);
  const inApp = /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok|MicroMessenger|musical_ly|Bytedance/i.test(ua);
  if (ios && (otherBrowser || inApp || !/Safari/i.test(ua))) return 'ios-other';
  if (ios && input.standalone) return 'ios-home';
  if (ios) return 'ios-safari';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function setupTitle(kind) {
  if (kind === 'ios-safari' || kind === 'ios-home') return 'How to set up on iPhone or iPad';
  if (kind === 'ios-other') return 'Open in Safari first';
  if (kind === 'android') return 'How to set up on Android';
  return 'How to set up on this computer';
}

export function deniedHelp(kind) {
  if (kind === 'ios-home' || kind === 'ios-safari') {
    return 'Notifications are off. Open Settings, tap Notifications, tap Perfect 10 Alerts, and turn Allow Notifications on. Then come back and tap Turn on alerts.';
  }
  if (kind === 'ios-other') {
    return 'iPhone only allows these alerts from the Safari Home Screen icon. Copy the link, open it in Safari, and add it to your Home Screen.';
  }
  if (kind === 'android') {
    return 'Notifications are blocked. In Chrome tap the lock icon, then Permissions, then Notifications, and choose Allow. Then tap Turn on alerts again.';
  }
  return 'Notifications are blocked. Click the lock icon in the address bar, set Notifications to Allow, then tap Turn on alerts again.';
}

export const SETUP_KINDS = ['ios-safari', 'ios-home', 'ios-other', 'android', 'desktop'];
