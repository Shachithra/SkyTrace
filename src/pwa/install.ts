import { settings } from '../data/settings.ts';
import { banner } from '../ui/Toast.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let shown = false;

export function initInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Never show the browser's install UI on load — let the instrument earn it first.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    settings.set({ installDismissed: true });
  });
}

const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Called after the first successful trace: a subtle, dismissible prompt. */
export function maybeOfferInstall(): void {
  if (shown || isStandalone() || settings.get().installDismissed) return;
  if (!deferred && !isIOS()) return;
  shown = true;
  const text = isIOS()
    ? 'Tap Share, then “Add to Home Screen” — faster launch, full-screen scanner, cached orbit data.'
    : 'Faster launch · full-screen scanner · cached orbit data.';
  const dismiss = banner('install', 'ADD SKYTRACE TO YOUR HOME SCREEN', text, [
    ...(deferred
      ? [
          {
            label: 'ADD',
            primary: true,
            onClick: async () => {
              dismiss();
              await deferred?.prompt();
              deferred = null;
            },
          },
        ]
      : []),
    {
      label: 'LATER',
      onClick: () => {
        dismiss();
        settings.set({ installDismissed: true });
      },
    },
  ]);
}
