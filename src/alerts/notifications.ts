import type { ScheduledAlert } from './alertRules.ts';
import { getMeta, setMeta } from '../data/indexedDb.ts';
import { callFunction, cachedSession, VAPID_PUBLIC_KEY, supabaseConfigured } from '../sync/supabase.ts';

/**
 * PWA notifications.
 *  - Local alerts: scheduled with timers while SkyTrace is open or recently
 *    backgrounded, shown through the service worker.
 *  - Web Push (optional): when Supabase + VAPID keys are configured and the user
 *    is signed in, the push subscription is registered with the server, which
 *    sends pass alerts even when the app is closed.
 */
export const notificationsSupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
export const pushSupported = (): boolean => notificationsSupported() && 'PushManager' in window && !!VAPID_PUBLIC_KEY && supabaseConfigured();

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export async function scheduleLocal(items: ScheduledAlert[]): Promise<number> {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  if (!notificationsSupported() || Notification.permission !== 'granted') return 0;
  const fired = new Set((await getMeta<string[]>('firedAlerts')) ?? []);
  const horizon = Date.now() + 12 * 3_600_000; // browsers throttle very long timers
  let n = 0;
  for (const it of items) {
    if (fired.has(it.key) || it.fireAt > horizon) continue;
    const delay = Math.max(0, it.fireAt - Date.now());
    timers.set(
      it.key,
      setTimeout(() => void show(it), delay),
    );
    n++;
  }
  await updateBadge(items.filter((i) => i.passStart - Date.now() < 3 * 3_600_000 && i.passStart > Date.now()).length);
  return n;
}

async function show(it: ScheduledAlert): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(it.title, {
    body: it.body,
    tag: it.key,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    data: { url: `/?view=passes&sat=${it.catalogId}` },
  });
  const fired = (await getMeta<string[]>('firedAlerts')) ?? [];
  fired.push(it.key);
  await setMeta('firedAlerts', fired.slice(-200));
}

/** App badge (where supported): number of alerted passes in the next 3 hours. */
export async function updateBadge(count: number): Promise<void> {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* unsupported */
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Subscribe to Web Push and register the subscription with the server. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported() || !cachedSession()) return false;
  if ((await requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource }));
  await callFunction('push-subscribe', { subscription: sub.toJSON(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return true;
}

export async function disablePush(): Promise<void> {
  if (!notificationsSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager?.getSubscription();
  if (sub) {
    try {
      await callFunction('push-subscribe', { endpoint: sub.endpoint, remove: true });
    } catch {
      /* server may be unreachable; unsubscribe locally anyway */
    }
    await sub.unsubscribe();
  }
}
