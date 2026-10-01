/** Tiny navigation bridge so screens can navigate without importing main.ts. */
export type ScreenId = 'home' | 'home2' | 'permissions' | 'live' | 'scanner' | 'passes' | 'saved' | 'history' | 'splash';

export interface NavParams {
  focusSatellite?: number;
  constellation?: string;
  sighting?: boolean;
  replayObservation?: string;
  replayTrace?: string;
}

let handler: ((s: ScreenId, p?: NavParams) => void) | null = null;
const extra = new Map<string, (...a: any[]) => unknown>(); // eslint-disable-line @typescript-eslint/no-explicit-any

export const router = {
  set(fn: (s: ScreenId, p?: NavParams) => void): void {
    handler = fn;
  },
  go(s: ScreenId, p?: NavParams): void {
    handler?.(s, p);
  },
  /** named actions provided by main (e.g. open settings, open alert sheet) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provide(name: string, fn: (...a: any[]) => unknown): void {
    extra.set(name, fn);
  },
  call(name: string, ...a: unknown[]): unknown {
    return extra.get(name)?.(...a);
  },
  callResult<T>(name: string, ...a: unknown[]): T | undefined {
    return extra.get(name)?.(...a) as T | undefined;
  },
};
