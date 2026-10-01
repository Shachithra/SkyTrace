import { registerSW } from 'virtual:pwa-register';
import { banner } from '../ui/Toast.ts';

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let pending = false;
let isBusy: () => boolean = () => false;

/**
 * New versions are announced, never applied silently — and never while the
 * user is in the middle of a scan.
 */
export function initUpdates(busy: () => boolean): void {
  isBusy = busy;
  if (!('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      offerIfIdle();
    },
    onOfflineReady() {
      /* app shell cached — nothing to announce */
    },
  });
}

/** Call when a scan finishes or the scanner becomes idle. */
export function offerIfIdle(): void {
  if (!pending || isBusy()) return;
  pending = false;
  const dismiss = banner('update', 'SKYTRACE UPDATE READY', 'A new version of the instrument is available.', [
    { label: 'APPLY UPDATE', primary: true, onClick: () => void applyUpdate?.(true) },
    {
      label: 'LATER',
      onClick: () => {
        dismiss();
      },
    },
  ]);
}
