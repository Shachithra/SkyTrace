// POST { subscription: PushSubscriptionJSON, timezone? }  → store
// POST { endpoint, remove: true }                         → delete
// Auth: user JWT. Rate limited: 20 calls / hour / user.
import { admin, cors, json, rateLimited, requireUser } from '../_shared/http.ts';

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const db = admin();
  if (await rateLimited(db, user.id, 'push-subscribe', 20, 60)) return json({ error: 'rate limited' }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  if (body.remove === true) {
    const endpoint = String(body.endpoint ?? '');
    await db.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
    return json({ ok: true });
  }

  const sub = body.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
  const endpoint = sub?.endpoint ?? '';
  const p256dh = sub?.keys?.p256dh ?? '';
  const auth = sub?.keys?.auth ?? '';
  // validate all user data
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return json({ error: 'invalid endpoint' }, 400);
  if (!B64URL.test(p256dh) || p256dh.length > 200 || !B64URL.test(auth) || auth.length > 100) return json({ error: 'invalid keys' }, 400);
  const timezone = typeof body.timezone === 'string' && body.timezone.length < 64 ? body.timezone : null;

  const { error } = await db.from('push_subscriptions').upsert({ user_id: user.id, endpoint, p256dh, auth, timezone }, { onConflict: 'endpoint' });
  if (error) return json({ error: 'store failed' }, 500);
  return json({ ok: true });
});
