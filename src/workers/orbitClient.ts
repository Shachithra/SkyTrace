import type { OrbitRecord, Observer, SatelliteInfo, TraceRequest, TraceResult } from '../astronomy/types.ts';
import type { ConstellationData } from '../stars/starCatalog.ts';
import type { LiveFrame, OrbitOutbound, PassRequest, PassResult, TrajectoryPoint } from './orbitTypes.ts';

/** Main-thread facade for the orbit worker. */
export class OrbitClient {
  private worker: Worker;
  private progress = new Map<string, (checked: number, total: number) => void>();
  private traces = new Map<string, { resolve: (r: TraceResult) => void; reject: (e: Error) => void }>();
  private infoQueue: ((info: SatelliteInfo | null) => void)[] = [];
  private ready: ((n: { count: number; rejected: number }) => void) | null = null;
  private seq = 1;
  private waits = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (d: number, t: number) => void }>();
  loadedCount = 0;

  constructor() {
    this.worker = new Worker(new URL('./orbit.worker.ts', import.meta.url), { type: 'module', name: 'skytrace-orbit' });
    this.worker.onmessage = (ev: MessageEvent<OrbitOutbound>) => this.handle(ev.data);
  }

  private handle(m: OrbitOutbound): void {
    switch (m.type) {
      case 'ORBITS_READY':
        this.loadedCount = m.count;
        this.ready?.({ count: m.count, rejected: m.rejected });
        this.ready = null;
        break;
      case 'TRACE_PROGRESS':
        this.progress.get(m.requestId)?.(m.checked, m.total);
        break;
      case 'TRACE_COMPLETE': {
        const p = this.traces.get(m.result.requestId);
        this.traces.delete(m.result.requestId);
        this.progress.delete(m.result.requestId);
        p?.resolve(m.result);
        break;
      }
      case 'TRACE_ERROR': {
        const p = this.traces.get(m.requestId);
        this.traces.delete(m.requestId);
        this.progress.delete(m.requestId);
        p?.reject(new Error(m.message));
        break;
      }
      case 'SAT_INFO_RESULT':
        this.infoQueue.shift()?.(m.info);
        break;
      case 'LIVE':
        this.settle(m.frame.requestId, m.frame);
        break;
      case 'TRAJECTORY':
        this.settle(m.requestId, m.points);
        break;
      case 'PASS_PROGRESS':
        this.waits.get(m.requestId)?.progress?.(m.done, m.total);
        break;
      case 'PASSES':
        this.settle(m.result.requestId, m.result);
        break;
      case 'ERROR': {
        const w = this.waits.get(m.requestId);
        this.waits.delete(m.requestId);
        w?.reject(new Error(m.message));
        break;
      }
    }
  }

  private settle(id: number, v: unknown): void {
    const w = this.waits.get(id);
    this.waits.delete(id);
    w?.resolve(v);
  }

  private wait<T>(id: number, progress?: (d: number, t: number) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => this.waits.set(id, { resolve: resolve as (v: unknown) => void, reject, progress }));
  }

  load(records: OrbitRecord[]): Promise<{ count: number; rejected: number }> {
    return new Promise((resolve) => {
      this.ready = resolve;
      this.worker.postMessage({ type: 'LOAD_ORBITS', records });
    });
  }

  loadConstellations(data: ConstellationData): void {
    this.worker.postMessage({ type: 'LOAD_CONSTELLATIONS', data });
  }

  trace(request: TraceRequest, onProgress?: (checked: number, total: number) => void): Promise<TraceResult> {
    return new Promise((resolve, reject) => {
      this.traces.set(request.requestId, { resolve, reject });
      if (onProgress) this.progress.set(request.requestId, onProgress);
      this.worker.postMessage({ type: 'TRACE_REQUEST', request });
    });
  }

  cancel(requestId: string | number): void {
    this.worker.postMessage({ type: 'CANCEL', requestId: String(requestId) });
  }

  info(catalogId: number, observer: Observer | null, time = Date.now()): Promise<SatelliteInfo | null> {
    return new Promise((resolve) => {
      this.infoQueue.push(resolve);
      this.worker.postMessage({ type: 'SAT_INFO', catalogId, observer, time });
    });
  }

  live(observer: Observer, t0: number, t1: number, catalogIds: number[] | null = null): Promise<LiveFrame> {
    const requestId = this.seq++;
    const p = this.wait<LiveFrame>(requestId);
    this.worker.postMessage({ type: 'LIVE', requestId, observer, t0, t1, catalogIds });
    return p;
  }

  trajectory(catalogId: number, observer: Observer, from: number, to: number, stepS = 10): Promise<TrajectoryPoint[]> {
    const requestId = this.seq++;
    const p = this.wait<TrajectoryPoint[]>(requestId);
    this.worker.postMessage({ type: 'TRAJECTORY', requestId, catalogId, observer, from, to, stepS });
    return p;
  }

  passes(req: Omit<PassRequest, 'requestId'>, onProgress?: (d: number, t: number) => void): { requestId: number; promise: Promise<PassResult> } {
    const requestId = this.seq++;
    const promise = this.wait<PassResult>(requestId, onProgress);
    this.worker.postMessage({ type: 'PASSES', request: { ...req, requestId } });
    return { requestId, promise };
  }
}
