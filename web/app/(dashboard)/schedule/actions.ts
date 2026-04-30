'use server';

import { revalidatePath } from 'next/cache';
import { getServiceClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';

export type RoutinePoi = { destination: string; keyword: string; poi: string };
export type RoutineConfig = {
  pois: RoutinePoi[];
  competitors: string[];
  limit_per_platform: number;
  pin_top?: number;
  screenshot?: boolean;
  sort?: 'reviews' | 'recommended';
  agent_mode_on_retry?: 'oneshot' | 'loop' | 'none';
  [k: string]: unknown;
};

export type RoutineConfigRow = {
  config: RoutineConfig;
  updated_at: string;
  updated_by: string | null;
};

export async function getRoutineConfig(): Promise<RoutineConfigRow | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('routine_config')
    .select('config, updated_at, updated_by')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(`getRoutineConfig: ${error.message}`);
  return data as RoutineConfigRow | null;
}

const VALID_PLATFORMS = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'] as const;
const VALID_SORTS = ['reviews', 'recommended'] as const;

function parseConfig(form: FormData): RoutineConfig {
  // POIs come as parallel arrays — destination[i], keyword[i], poi[i].
  // Empty rows are dropped silently so the user can leave a blank trailing
  // row in the UI without breaking the save.
  const destinations = form.getAll('poi_destination').map(String);
  const keywords = form.getAll('poi_keyword').map(String);
  const pois = form.getAll('poi_label').map(String);
  const rowCount = Math.max(destinations.length, keywords.length, pois.length);
  const poiRows: RoutinePoi[] = [];
  for (let i = 0; i < rowCount; i++) {
    const dest = (destinations[i] ?? '').trim();
    const kw = (keywords[i] ?? '').trim();
    const label = (pois[i] ?? '').trim();
    if (!dest && !kw && !label) continue;
    if (!label) throw new Error(`Row ${i + 1}: POI label is required`);
    if (!kw) throw new Error(`Row ${i + 1} (${label}): keyword is required`);
    poiRows.push({ destination: dest, keyword: kw, poi: label });
  }
  if (poiRows.length === 0) throw new Error('At least one POI row is required');

  const competitors = form
    .getAll('competitor')
    .map(String)
    .filter((c) => (VALID_PLATFORMS as readonly string[]).includes(c));
  if (competitors.length === 0) throw new Error('Pick at least one competitor');

  const limit = Number(form.get('limit_per_platform'));
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    throw new Error('limit_per_platform must be 1–200');
  }
  const pinTop = Number(form.get('pin_top'));
  if (!Number.isFinite(pinTop) || pinTop < 1 || pinTop > 50) {
    throw new Error('pin_top must be 1–50');
  }

  const sort = String(form.get('sort') ?? 'reviews');
  if (!(VALID_SORTS as readonly string[]).includes(sort)) {
    throw new Error(`Invalid sort: ${sort}`);
  }
  const screenshot = form.get('screenshot') != null;

  return {
    pois: poiRows,
    competitors,
    limit_per_platform: Math.floor(limit),
    pin_top: Math.floor(pinTop),
    sort: sort as 'reviews' | 'recommended',
    screenshot,
  };
}

export type SaveResult =
  | { ok: true; updated_at: string }
  | { ok: false; error: string };

export async function saveRoutineConfig(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  // Defence-in-depth: server actions are reachable via direct POST, so we
  // re-verify auth inside the action even though auth-proxy.ts middleware
  // also gates the route. (Per Next 16 / React 19 forms guide.)
  const userClient = await createServerClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated' };
  }

  let config: RoutineConfig;
  try {
    config = parseConfig(formData);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Service-role write — RLS allows authenticated read but only service_role
  // mutate. We've already verified `user` above, so it's safe to elevate.
  let supabase;
  try {
    supabase = getServiceClient();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Audit trail uses the verified user's email.
  const updatedBy = user.email ? `web:${user.email}` : 'web';

  const { data, error } = await supabase
    .from('routine_config')
    .upsert(
      { id: 1, config, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
    .select('updated_at')
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath('/schedule');
  return { ok: true, updated_at: data!.updated_at as string };
}
