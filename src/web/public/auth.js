/**
 * Supabase Auth wrapper for the dashboard.
 *
 * Why Supabase Auth (not a custom JWT layer):
 *   - We have no backend at runtime — Vercel serves static files only.
 *     Custom JWT would need a Vercel Function for token signing, which adds
 *     a deploy unit and another secret.
 *   - The data we want to protect lives in Supabase, so gating the database
 *     itself (via RLS keyed on auth.jwt()) is strictly stronger than gating
 *     the UI alone. A UI gate doesn't stop someone calling REST with the
 *     publishable key.
 *
 * Usage:
 *   import { requireSession, signInWithGoogle, signOut, getUser } from '/auth.js';
 *   await requireSession();   // call at page boot — redirects to /login.html if not signed in
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = 'https://zmxuwkkctfegemaytgve.supabase.co';
const SUPABASE_KEY = 'sb_publishable_v8YvR08-gtz2L9AOo0icmA_Cejk_VyI';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handle OAuth redirect (?access_token=... in URL)
    flowType: 'pkce',
  },
});

export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

let _adminCache = null;

/**
 * Whether the current user is in the email_whitelist with is_admin=true.
 * Cached per session — call `clearAdminCache()` after mutating the
 * whitelist if you need a fresh read.
 */
export async function isAdmin() {
  if (_adminCache !== null) return _adminCache;
  const user = await getUser();
  if (!user?.email) return (_adminCache = false);
  const { data, error } = await sb
    .from('email_whitelist')
    .select('is_admin')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();
  if (error) {
    console.error('isAdmin lookup failed', error);
    return false;
  }
  return (_adminCache = !!data?.is_admin);
}

export function clearAdminCache() {
  _adminCache = null;
}

/**
 * Page-level gate. Call from any protected page.
 * If unauthenticated, redirects to /login.html and never resolves.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login.html?next=${next}`);
    // Stall the page so calling code doesn't continue rendering.
    return new Promise(() => {});
  }
  return session;
}

export async function signInWithGoogle() {
  // The auth provider (Supabase) returns to this page after OAuth; the SDK
  // picks the access token out of the URL hash (detectSessionInUrl above).
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: location.origin + (new URLSearchParams(location.search).get('next') || '/coverage.html'),
    },
  });
  if (error) throw error;
}

export async function signOut() {
  await sb.auth.signOut();
  location.replace('/login.html');
}
