import { sanitizeText } from '../astronomy/orbitLoader.ts';
import { db, type SatelliteMetadata } from './indexedDb.ts';
import { CELESTRAK_ORIGIN, satcatUrl } from './datasets.ts';
import { supabase } from '../sync/supabase.ts';

const OWNER_NAMES: Record<string, string> = {
  US: 'United States', PRC: 'China', CIS: 'Russia / CIS', ISS: 'ISS Partnership', ESA: 'European Space Agency',
  JPN: 'Japan', IND: 'India', FR: 'France', UK: 'United Kingdom', GER: 'Germany', EUME: 'EUMETSAT', SES: 'SES',
  IT: 'Italy', CA: 'Canada', SKOR: 'South Korea', NOR: 'Norway', ISRA: 'Israel', TBD: 'Unknown',
};

/** Fetch (once, then cache) catalogue metadata for a satellite. Only the catalogue number is sent. */
export async function satelliteMetadata(catalogId: number): Promise<SatelliteMetadata | null> {
  try {
    const cached = await (await db()).get('satelliteMetadata', catalogId);
    if (cached && Date.now() - cached.fetchedAt < 30 * 86_400_000) return cached;
  } catch {
    /* ignore */
  }
  if (!navigator.onLine || catalogId >= 900000) return null;
  // Public, read-only satellite_metadata table first (when sync is configured)…
  const sb = supabase();
  if (sb) {
    try {
      const { data } = await (await sb).from('satellite_metadata').select('norad_id,object_type,owner,launch_date').eq('norad_id', catalogId).maybeSingle();
      if (data) {
        const meta: SatelliteMetadata = {
          catalogId,
          owner: sanitizeText(data.owner, 40),
          launchDate: sanitizeText(String(data.launch_date ?? ''), 12),
          launchSite: '',
          decayDate: '',
          objectType: sanitizeText(data.object_type, 24),
          fetchedAt: Date.now(),
        };
        await (await db()).put('satelliteMetadata', meta).catch(() => undefined);
        return meta;
      }
    } catch {
      /* fall through to CelesTrak SATCAT */
    }
  }
  // …otherwise CelesTrak SATCAT.
  try {
    let res = await fetch(satcatUrl(catalogId, CELESTRAK_ORIGIN), { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok && import.meta.env?.DEV) res = await fetch(satcatUrl(catalogId, '/celestrak'));
    if (!res.ok) return null;
    const arr = (await res.json()) as unknown;
    if (!Array.isArray(arr) || !arr[0] || typeof arr[0] !== 'object') return null;
    const o = arr[0] as Record<string, unknown>;
    const ownerCode = sanitizeText(o.OWNER, 12);
    const meta: SatelliteMetadata = {
      catalogId,
      owner: OWNER_NAMES[ownerCode] ?? ownerCode,
      launchDate: sanitizeText(o.LAUNCH_DATE, 12),
      launchSite: sanitizeText(o.LAUNCH_SITE, 12),
      decayDate: sanitizeText(o.DECAY_DATE, 12),
      objectType: { PAY: 'Payload', 'R/B': 'Rocket body', DEB: 'Debris', UNK: 'Unknown' }[sanitizeText(o.OBJECT_TYPE, 4)] ?? sanitizeText(o.OBJECT_TYPE, 12),
      fetchedAt: Date.now(),
    };
    try {
      await (await db()).put('satelliteMetadata', meta);
    } catch {
      /* ignore */
    }
    return meta;
  } catch {
    return null;
  }
}
