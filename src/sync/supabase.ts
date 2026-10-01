import type { Session, SupabaseClient } from '@supabase/supabase-js';

/**
 * Optional Supabase connection. Guest mode (the default) never loads the
 * client library. Only the public anon key is used in the browser — Row Level
 * Security on every table limits users to their own rows.
 */
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const supabaseConfigured = (): boolean => !!(URL_ && KEY && /^https:\/\//.test(URL_));
export const supabaseUrl = (): string | undefined => URL_;

let clientP: Promise<SupabaseClient> | null = null;
let session: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();

export function supabase(): Promise<SupabaseClient> | null {
  if (!supabaseConfigured()) return null;
  if (!clientP) {
    clientP = import('@supabase/supabase-js').then(({ createClient }) => {
      const c = createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      c.auth.onAuthStateChange((_e, s) => {
        session = s;
        for (const l of listeners) l(s);
      });
      return c;
    });
  }
  return clientP;
}

export async function currentSession(): Promise<Session | null> {
  const c = supabase();
  if (!c) return null;
  const { data } = await (await c).auth.getSession();
  session = data.session;
  return session;
}

export const cachedSession = (): Session | null => session;

export function onSession(fn: (s: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Passwordless sign-in: Supabase emails a magic link back to this app. */
export async function signInWithEmail(email: string): Promise<void> {
  const c = supabase();
  if (!c) throw new Error('Sync is not configured for this deployment');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new Error('Enter a valid email');
  const { error } = await (await c).auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/?view=saved` } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const c = supabase();
  if (!c) return;
  await (await c).auth.signOut();
}

/** Call a Supabase Edge Function with the user's JWT. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const c = supabase();
  if (!c) throw new Error('Sync is not configured');
  const { data, error } = await (await c).functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) throw error;
  return data as T;
}
