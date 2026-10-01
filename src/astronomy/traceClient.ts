import type { OrbitRecord, Observer, SatelliteInfo, TraceRequest, TraceResult, WorkerOutbound } from './types.ts';

/**
 * Main-thread facade for the trace worker. Orbit parsing, propagation, crossing
 * search and ranking all happen off the main thread so the scanner stays at 60 FPS.
 */
export class TraceClient {
  private worker: Worker;
  private progressHandlers = new Map<string, (checked: number, total: number) => void>();
  private pending = new Map<string, { resolve: (r: TraceResult) => void; reject: (e: Error) => void }>();
  private infoQueue: ((info: SatelliteInfo | null) => void)[] = [];
  private readyResolve: ((n: { count: number; rejected: number }) => void) | null = null;
  loadedCount = 0;

  constructor() {
    this.worker = new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module', name: 'skytrace-orbits' });
    this.worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => this.handle(ev.data);
  }

  private handle(msg: WorkerOutbound): void {
    switch (msg.type) {
      case 'ORBITS_READY':
        this.loadedCount = msg.count;
        this.readyResolve?.({ count: msg.count, rejected: msg.rejected });
        this.readyResolve = null;
        break;
      case 'TRACE_PROGRESS':
        this.progressHandlers.get(msg.requestId)?.(msg.checked, msg.total);
        break;
      case 'TRACE_COMPLETE': {
        const p = this.pending.get(msg.result.requestId);
        this.pending.delete(msg.result.requestId);
        this.progressHandlers.delete(msg.result.requestId);
        p?.resolve(msg.result);
        break;
      }
      case 'TRACE_ERROR': {
        const p = this.pending.get(msg.requestId);
        this.pending.delete(msg.requestId);
        this.progressHandlers.delete(msg.requestId);
        p?.reject(new Error(msg.message));
        break;
      }
      case 'SAT_INFO_RESULT':
        this.infoQueue.shift()?.(msg.info);
        break;
    }
  }

  load(records: OrbitRecord[]): Promise<{ count: number; rejected: number }> {
    return new Promise((resolve) => {
      this.readyResolve = resolve;
      this.worker.postMessage({ type: 'LOAD_ORBITS', records });
    });
  }

  trace(request: TraceRequest, onProgress?: (checked: number, total: number) => void): Promise<TraceResult> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      if (onProgress) this.progressHandlers.set(request.requestId, onProgress);
      this.worker.postMessage({ type: 'TRACE_REQUEST', request });
    });
  }

  cancel(requestId: string): void {
    this.worker.postMessage({ type: 'CANCEL', requestId });
  }

  info(catalogId: number, observer: Observer | null, time = Date.now()): Promise<SatelliteInfo | null> {
    return new Promise((resolve) => {
      this.infoQueue.push(resolve);
      this.worker.postMessage({ type: 'SAT_INFO', catalogId, observer, time });
    });
  }
}
