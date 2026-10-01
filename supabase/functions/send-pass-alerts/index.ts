// Scheduled (pg_cron, every 5 min). Protected by the x-cron-secret header.
// For each enabled pass alert tied to a SAVED location (the server never knows a
// user's live position), predict the next pass and send a Web Push when it is
// `notify_minutes_before` away. Deduplicated via public.sent_alerts.
import webpush from 'npm:web-push@3';
import * as sat from 'npm:satellite.js@7';
import { admin, json } from '../_shared/http.ts';

const DEG = Math.PI / 180;
const MAX_ALERTS_PER_RUN = 500;

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'forbidden' }, 403);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
  const db = admin();
  const now = Date.now();

  const { data: alerts } = await db
    .from('pass_alerts')
    .select('id,user_id,norad_id,satellite_name,location_id,minimum_elevation,visibility_only,notify_minutes_before')
    .eq('enabled', true)
    .eq('deleted', false)
    .not('location_id', 'is', null)
    .limit(MAX_ALERTS_PER_RUN);
  if (!alerts?.length) return json({ ok: true, sent: 0 });

  const locIds = [...new Set(alerts.map((a) => a.location_id))];
  const userIds = [...new Set(alerts.map((a) => a.user_id))];
  const [{ data: locs }, { data: prefs }, { data: subs }] = await Promise.all([
    db.from('saved_locations').select('id,latitude,longitude,altitude').in('id', locIds),
    db.from('notification_preferences').select('user_id,push_enabled,quiet_hours_start,quiet_hours_end,visible_pass_only').in('user_id', userIds),
    db.from('push_subscriptions').select('user_id,endpoint,p256dh,auth,timezone').in('user_id', userIds),
  ]);

  // orbital elements, fetched once per satellite per run (OMM JSON)
  const elements = new Map<number, sat.SatRec | null>();
  async function satrec(id: number): Promise<sat.SatRec | null> {
    if (elements.has(id)) return elements.get(id)!;
    try {
      const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=json`);
      const arr = await r.json();
      const rec = Array.isArray(arr) && arr[0] ? sat.json2satrec(arr[0]) : null;
      elements.set(id, rec);
      return rec;
    } catch {
      elements.set(id, null);
      return null;
    }
  }

  let sent = 0;
  for (const a of alerts) {
    const p = prefs?.find((x) => x.user_id === a.user_id);
    if (p && !p.push_enabled) continue;
    const loc = locs?.find((l) => l.id === a.location_id);
    const userSubs = subs?.filter((s) => s.user_id === a.user_id) ?? [];
    if (!loc || !userSubs.length) continue;
    const rec = await satrec(a.norad_id);
    if (!rec) continue;
    const pass = nextPass(rec, loc.latitude, loc.longitude, (loc.altitude ?? 0) / 1000, now, now + 60 * 60_000, a.minimum_elevation);
    if (!pass) continue;
    if ((a.visibility_only || p?.visible_pass_only) && !pass.visible) continue;
    const fireAt = pass.start - a.notify_minutes_before * 60_000;
    if (fireAt > now + 5 * 60_000 || fireAt < now - 5 * 60_000) continue; // not in this 5-minute slot
    const key = `${a.id}:${Math.round(pass.start / 60_000)}`;
    const { error: dup } = await db.from('sent_alerts').insert({ key, user_id: a.user_id });
    if (dup) continue; // already sent
    const mins = Math.max(1, Math.round((pass.start - now) / 60_000));
    const payload = JSON.stringify({
      title: `${a.satellite_name ?? 'SATELLITE'} ${pass.visible ? 'VISIBLE' : 'PASSING'} IN ${mins} MIN`,
      body: `${pass.direction}\nMaximum elevation: ${Math.round(pass.maxEl)}°`,
      tag: key,
      url: `/?view=passes&sat=${a.norad_id}`,
    });
    for (const s of userSubs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600 });
        sent++;
      } catch (err) {
        // 404/410: subscription expired — remove it
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }
  }
  return json({ ok: true, sent });
});

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (az: number): string => POINTS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** Compact pass finder (30 s steps) with a simple visibility test: dark sky + sunlit satellite. */
function nextPass(rec: sat.SatRec, lat: number, lon: number, hKm: number, from: number, to: number, minEl: number) {
  const obs = { latitude: lat * DEG, longitude: lon * DEG, height: hKm };
  const look = (t: number) => {
    const d = new Date(t);
    const pv = sat.propagate(rec, d);
    if (!pv || !pv.position) return null;
    const gmst = sat.gstime(d);
    const la = sat.ecfToLookAngles(obs, sat.eciToEcf(pv.position, gmst));
    return { az: la.azimuth / DEG, el: la.elevation / DEG, eci: pv.position, jd: sat.jday(d) };
  };
  let start = 0;
  let maxEl = -90;
  let startAz = 0;
  let endAz = 0;
  let visible = false;
  for (let t = from; t <= to; t += 30_000) {
    const l = look(t);
    if (!l) return null;
    if (l.el > 0) {
      if (!start) {
        start = t;
        startAz = l.az;
      }
      maxEl = Math.max(maxEl, l.el);
      endAz = l.az;
      const sun = sat.sunPos(l.jd).rsun;
      const lit = sat.shadowFraction(sun, l.eci) < 0.5;
      const sunEl = sunElevation(sun, lat, lon, l.jd);
      if (lit && sunEl < -6 && l.el > 10) visible = true;
    } else if (start) break;
  }
  if (!start || maxEl < minEl) return null;
  return { start, maxEl, visible, direction: `${compass(startAz)} → ${compass(endAz)}` };
}

function sunElevation(rsun: { x: number; y: number; z: number }, lat: number, lon: number, jd: number): number {
  const ra = Math.atan2(rsun.y, rsun.x);
  const dec = Math.atan2(rsun.z, Math.hypot(rsun.x, rsun.y));
  const lst = sat.gstime(jd) + lon * DEG;
  const H = lst - ra;
  const p = lat * DEG;
  return Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(H)) / DEG;
}
