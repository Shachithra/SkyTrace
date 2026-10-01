/** Star catalogue types + offline-first loader (bundled JSON, cached in IndexedDB). */

export interface StarInfo {
  /** proper name */
  n?: string;
  /** Bayer / Flamsteed designation */
  d?: string;
  /** constellation abbreviation */
  c?: string;
  /** distance, light years (curated, approximate) */
  ly?: number;
  /** spectral type (curated) */
  sp?: string;
}

export interface StarCatalogData {
  version: string;
  epoch: 'J2000';
  source: string;
  /** [hip, raDeg, decDeg, mag, bv] sorted bright → faint */
  stars: [number, number, number, number, number | null][];
  info: Record<string, StarInfo>;
}

export interface ConstellationDef {
  id: string;
  name: string;
  gen: string;
  rank: number;
  /** label position, J2000 [raDeg, decDeg] */
  label: [number, number];
  /** stick-figure segments as pairs of indices into StarCatalogData.stars */
  lines: [number, number][];
  /** IAU boundary, J2000 [raDeg, decDeg][], densified to ≤1° steps */
  boundary: [number, number][];
}

export interface ConstellationData {
  version: string;
  epoch: 'J2000';
  source: string;
  constellations: ConstellationDef[];
}

export const STAR_DATA_URL = '/data/stars.v1.json';
export const CONSTELLATION_DATA_URL = '/data/constellations.v1.json';

function isCatalog(x: unknown): x is StarCatalogData {
  const o = x as StarCatalogData;
  return !!o && typeof o.version === 'string' && Array.isArray(o.stars) && o.stars.length > 100 && typeof o.info === 'object';
}
function isConstellations(x: unknown): x is ConstellationData {
  const o = x as ConstellationData;
  return !!o && typeof o.version === 'string' && Array.isArray(o.constellations) && o.constellations.length >= 88;
}

export interface SkyDatasets {
  stars: StarCatalogData;
  constellations: ConstellationData;
  source: 'cache' | 'network';
}

/**
 * Loads the star catalogue and constellation lines. IndexedDB copy first (works
 * fully offline), network/precache otherwise; the newer version wins.
 */
export async function loadSkyDatasets(
  cache: { get: (k: string) => Promise<unknown>; put: (k: string, v: unknown) => Promise<void> },
): Promise<SkyDatasets> {
  const [cs, cc] = await Promise.all([cache.get('stars'), cache.get('constellations')]);
  if (isCatalog(cs) && isConstellations(cc)) {
    // Refresh in the background if the bundled version changed.
    void refresh(cache, cs.version).catch(() => undefined);
    return { stars: cs, constellations: cc, source: 'cache' };
  }
  const fresh = await fetchBoth();
  await cache.put('stars', fresh.stars);
  await cache.put('constellations', fresh.constellations);
  return { ...fresh, source: 'network' };
}

async function fetchBoth(): Promise<{ stars: StarCatalogData; constellations: ConstellationData }> {
  const [a, b] = await Promise.all([fetch(STAR_DATA_URL), fetch(CONSTELLATION_DATA_URL)]);
  if (!a.ok || !b.ok) throw new Error('Star data unavailable');
  const stars = (await a.json()) as unknown;
  const constellations = (await b.json()) as unknown;
  if (!isCatalog(stars) || !isConstellations(constellations)) throw new Error('Star data failed validation');
  return { stars, constellations };
}

async function refresh(cache: { put: (k: string, v: unknown) => Promise<void> }, have: string): Promise<void> {
  const fresh = await fetchBoth();
  if (fresh.stars.version !== have) {
    await cache.put('stars', fresh.stars);
    await cache.put('constellations', fresh.constellations);
  }
}

/** Human-readable label for a star: proper name, else designation + constellation, else HIP. */
export function starLabel(hip: number, info: StarInfo | undefined): string {
  if (info?.n) return info.n;
  if (info?.d) return `${info.d}${info.c ? ` ${info.c}` : ''}`;
  return `HIP ${hip}`;
}

const CLASS_COLOUR: Record<string, string> = { O: 'Blue', B: 'Blue-white', A: 'White', F: 'Yellow-white', G: 'Yellow', K: 'Orange', M: 'Red' };

/** "Red supergiant" from a spectral type like "M1-2Ia". */
export function describeSpectral(sp: string): string {
  const colour = CLASS_COLOUR[sp[0]] ?? 'Star';
  const lum = /Ia|Iab|Ib/.test(sp) ? 'supergiant' : /III/.test(sp) ? 'giant' : /II/.test(sp) ? 'bright giant' : /IV/.test(sp) ? 'subgiant' : /V/.test(sp) ? 'main-sequence star' : 'star';
  return `${colour} ${lum}`;
}

/** Colour class from the B−V index when no spectral type is curated. */
export function colourFromBv(bv: number | null): string {
  if (bv === null) return 'Unknown';
  if (bv < -0.1) return 'Blue (hot)';
  if (bv < 0.15) return 'Blue-white';
  if (bv < 0.45) return 'White';
  if (bv < 0.7) return 'Yellow-white';
  if (bv < 1.0) return 'Yellow';
  if (bv < 1.4) return 'Orange';
  return 'Red (cool)';
}
