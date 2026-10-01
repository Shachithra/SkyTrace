import { activeLocationName, location, observer, passes } from '../app/services.ts';
import { tonightWindow } from '../sky/horizon.ts';
import { savedSatellites } from '../sync/favorites.ts';
import { localClock } from '../utils/format.ts';
import { $, clear, h, setText } from '../ui/dom.ts';
import { renderChoiceStrip } from '../ui/LayerControl.ts';
import { renderPassTimeline } from '../ui/PassTimeline.ts';
import { showPass } from './objectSheet.ts';

type Range = 'TONIGHT' | 'NEXT 24 HOURS';

/** UPCOMING PASSES: TONIGHT / NEXT 24 HOURS, FAVORITES, VISIBLE ONLY. */
export class PassesScreen {
  readonly root = $('#screen-passes');
  private range: Range = 'TONIGHT';
  private favOnly = false;
  private visOnly = true;
  private limit = 150;
  private constellation: string | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    renderChoiceStrip<Range>($('[data-passes-range]', this.root), 'Time range', ['TONIGHT', 'NEXT 24 HOURS'], this.range, (r) => {
      this.range = r;
      void this.render();
    });
    const toggles = $('[data-passes-toggles]', this.root);
    for (const [label, key] of [['FAVORITES', 'fav'], ['VISIBLE ONLY', 'vis']] as const) {
      const b = h('button', { class: 'strip-btn', type: 'button', 'aria-pressed': String(key === 'vis' ? this.visOnly : this.favOnly) }, label);
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        if (key === 'fav') this.favOnly = on;
        else this.visOnly = on;
        void this.render();
      });
      toggles.append(b);
    }
    passes.onChange(() => void this.render());
  }

  async open(params?: { constellation?: string }): Promise<void> {
    this.constellation = params?.constellation ?? null;
    await this.render();
    if (!passes.result) {
      this.poll = setInterval(() => this.progress(), 300);
      await passes.next24h();
      if (this.poll) clearInterval(this.poll);
      await this.render();
    }
  }

  close(): void {
    if (this.poll) clearInterval(this.poll);
  }

  private progress(): void {
    const p = passes.progress;
    setText($('[data-passes-note]', this.root), p.total ? `PREDICTING PASSES · ${p.done.toLocaleString('en-US')} / ${p.total.toLocaleString('en-US')} OBJECTS` : 'PREDICTING PASSES…');
  }

  async render(): Promise<void> {
    this.limit = Math.max(150, this.limit);
    const o = observer();
    const where = activeLocationName() ?? (location.status === 'manual' ? 'MANUAL COORDINATES' : location.observer ? 'CURRENT POSITION' : 'NO LOCATION');
    setText($('[data-passes-where]', this.root), where.toUpperCase());
    const host = $('[data-passes-list]', this.root);
    if (!o) {
      clear(host);
      setText($('[data-passes-note]', this.root), 'LOCATION NEEDED FOR PASS PREDICTIONS');
      return;
    }
    const r = passes.result;
    if (!r) {
      this.progress();
      clear(host);
      return;
    }
    const now = Date.now();
    const win = this.range === 'TONIGHT' ? tonightWindow(now, o.latitude, o.longitude) : { start: now, end: now + 24 * 3_600_000 };
    const favs = new Set((await savedSatellites.list()).map((s) => s.norad_id));
    let list = r.passes.filter((p) => p.set.t > Math.max(now, win.start) && p.rise.t < win.end);
    if (this.favOnly) list = list.filter((p) => favs.has(p.catalogId));
    if (this.visOnly) list = list.filter((p) => p.status !== 'NOT_EXPECTED');
    if (this.constellation) list = list.filter((p) => p.constellations.includes(this.constellation!));
    const notes = [
      `${list.length} PASS${list.length === 1 ? '' : 'ES'}`,
      this.range === 'TONIGHT' ? `${localClock(win.start)}–${localClock(win.end)}` : 'NEXT 24 H',
      `${r.considered.toLocaleString('en-US')} OBJECTS PREDICTED`,
      r.limited ? 'LARGE CONSTELLATIONS: FAVOURITES ONLY' : '',
      this.constellation ? `THROUGH ${this.constellation.toUpperCase()}` : '',
    ];
    setText($('[data-passes-note]', this.root), notes.filter(Boolean).join(' · '));
    if (!list.length) {
      clear(host);
      host.append(h('div', { class: 'empty' }, h('p', { class: 'empty-title mono' }, 'NO PASSES MATCH'), h('p', {}, this.favOnly ? 'Save satellites (★) to see their passes here.' : 'Try NEXT 24 HOURS or turn off VISIBLE ONLY.')));
      if (this.constellation) {
        const b = h('button', { class: 'btn small', type: 'button' }, 'SHOW ALL CONSTELLATIONS');
        b.addEventListener('click', () => {
          this.constellation = null;
          void this.render();
        });
        host.append(b);
      }
      return;
    }
    renderPassTimeline(host, list, {
      start: Math.max(now, win.start),
      end: win.end,
      now,
      favourites: favs,
      onSelect: (p) => showPass(p),
      limit: this.limit,
      onMore: () => {
        this.limit += 150;
        void this.render();
      },
    });
  }
}
