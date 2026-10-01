// Shared helpers for SkyTrace Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Service-role client — server only, never shipped to the browser. */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

/** Resolve the calling user from the Authorization bearer token. */
export async function requireUser(req: Request): Promise<{ id: string } | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id };
}

/** Simple sliding-window rate limit backed by public.function_calls. */
export async function rateLimited(db: SupabaseClient, userId: string, fn: string, max: number, windowMinutes: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count } = await db.from('function_calls').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('fn', fn).gte('called_at', since);
  if ((count ?? 0) >= max) return true;
  await db.from('function_calls').insert({ user_id: userId, fn });
  return false;
}
