import type { Observer } from '../astronomy/types.ts';
import type { ConstellationData, StarCatalogData } from '../stars/starCatalog.ts';
import type { ConstellationInfo, PatternResult, SkyField, SkyOutbound } from './skyTypes.ts';

/** Main-thread facade for the sky (stars / constellations) worker. */
export class SkyClient {
  private worker: Worker;
  private seq = 1;
  private waits = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readyP: Promise<{ stars: number; constellations: number; version: string }> | null = null;
  private readyR: ((v: { stars: number; constellations: number; version: string }) => void) | null = null;
  loaded = false;

  constructor() {
    this.worker = new Worker(new URL('./sky.worker.ts', import.meta.url), { type: 'module', name: 'skytrace-sky' });
    this.worker.onmessage = (ev: MessageEvent<SkyOutbound>) => {
      const m = ev.data;
      if (m.type === 'READY') {
        this.loaded = true;
        this.readyR?.({ stars: m.stars, constellations: m.constellations, version: m.version });
        return;
      }
      const w = this.waits.get(m.id);
      this.waits.delete(m.id);
      if (!w) return;
      if (m.type === 'ERROR') w.reject(new Error(m.message));
      else if (m.type === 'FIELD') w.resolve(m.field);
      else if (m.type === 'LOOKUP') w.resolve(m.ids);
      else if (m.type === 'PATTERN') w.resolve(m.result);
      else if (m.type === 'CONSTELLATION_INFO') w.resolve(m.info);
    };
  }

  load(stars: StarCatalogData, constellations: ConstellationData): Promise<{ stars: number; constellations: number; version: string }> {
    this.readyP = new Promise((r) => (this.readyR = r));
    this.worker.postMessage({ type: 'LOAD', stars, constellations });
    return this.readyP;
  }

  private call<T>(msg: Record<string, unknown>): Promise<T> {
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      this.waits.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  field(observer: Observer, time: number, limitMag: number): Promise<SkyField> {
    return this.call({ type: 'FIELD', observer, time, limitMag });
  }
  lookup(observer: Observer, time: number, points: [number, number][]): Promise<(string | null)[]> {
    return this.call({ type: 'LOOKUP', observer, time, points });
  }
  pattern(observer: Observer, time: number, az: number, el: number, fovDeg: number, accuracyDeg: number): Promise<PatternResult> {
    return this.call({ type: 'PATTERN', observer, time, az, el, fovDeg, accuracyDeg });
  }
  constellationInfo(observer: Observer, time: number, constellation: string): Promise<ConstellationInfo | null> {
    return this.call({ type: 'CONSTELLATION_INFO', observer, time, constellation });
  }
}
