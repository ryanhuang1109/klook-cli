import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client with service-role privileges.
 *
 * Used by server actions that need to write to RLS-protected tables
 * (e.g. routine_config — anon/authenticated can read but only
 * service_role can mutate). Never import this from a client component.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the Vercel project (run
 * `vercel env add SUPABASE_SERVICE_ROLE_KEY` and paste the key from
 * Project Settings → API). The variable name is intentionally
 * service-role-style and unprefixed so it never gets bundled to the
 * client.
 */
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set on this server. ' +
      'Run `vercel env add SUPABASE_SERVICE_ROLE_KEY` and paste the key ' +
      'from Supabase Dashboard → Project Settings → API.',
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
