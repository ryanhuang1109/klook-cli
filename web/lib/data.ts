import { createClient } from '@/lib/supabase/server';

export type Platform = 'klook' | 'trip' | 'getyourguide' | 'kkday' | 'airbnb';

export type ActivityRow = {
  id: number;
  platform: Platform;
  platform_product_id: string | null;
  canonical_url: string | null;
  title: string | null;
  poi: string | null;
  supplier: string | null;
  rating: number | null;
  review_count: number | null;
  order_count: number | null;
  duration_minutes: number | null;
  departure_city: string | null;
  package_count: number | null;
  sku_count: number | null;
  min_price_usd: number | null;
  max_price_usd: number | null;
  avg_avail_usd: number | null;
  first_scraped_at: string | null;
  last_scraped_at: string | null;
  review_status: 'unverified' | 'verified' | 'flagged' | 'rejected' | null;
  review_note: string | null;
  cancellation_policy: string | null;
  cover_image_url: string | null;
  screenshot_url: string | null;
  description: string | null;
  raw_extras_json: string | Record<string, unknown> | null;
};

export type PackageRow = {
  id: number;
  activity_id: number;
  platform_package_id: string | null;
  title: string | null;
  tour_type: string | null;
  group_size: string | null;
  meals: boolean | null;
  departure_city: string | null;
  departure_time: string | null;
  duration_minutes: number | null;
  available_languages: string[] | string | null;
  inclusions: string[] | string | null;
  exclusions: string[] | string | null;
};

export type SkuRow = {
  id: number;
  package_id: number;
  travel_date: string;
  price_local: number | null;
  price_usd: number | null;
  currency: string | null;
  available: boolean | null;
  last_checked_at: string | null;
};

export type SessionRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  poi: string | null;
  keyword: string | null;
  competitors: string | null;
  limit_value: number | null;
  status: string;
};

export type ExecutionRow = {
  id: number;
  session_id: number | null;
  started_at: string;
  platform: Platform;
  activity_id: string;
  strategy: string;
  duration_ms: number | null;
  succeeded: number | boolean;
  error_message: string | null;
  packages_written: number | null;
  skus_written: number | null;
};

export type CoverageRunRow = {
  id: number;
  run_at: string;
  poi: string;
  platform: Platform;
  filter_signature: string;
  fetched: number | null;
  new_unique: number | null;
  total_reported: number | null;
};

export type SearchRunRow = {
  id: number;
  run_at: string;
  platform: Platform;
  keyword: string;
  poi: string | null;
  found: number | null;
  ingested: number | null;
  succeeded: number | null;
  failed: number | null;
};

export type WhitelistRow = {
  email: string;
  is_admin: boolean;
  added_by: string | null;
  created_at: string;
};

export async function listActivitiesWithStats(opts: {
  poi?: string;
  platform?: Platform;
  search?: string;
  limit?: number;
} = {}): Promise<ActivityRow[]> {
  const sb = await createClient();
  let q = sb
    .from('v_activities_with_stats')
    .select('*')
    .order('last_scraped_at', { ascending: false })
    .limit(opts.limit ?? 500);
  if (opts.poi) q = q.ilike('poi', `%${opts.poi}%`);
  if (opts.platform) q = q.eq('platform', opts.platform);
  if (opts.search) q = q.ilike('title', `%${opts.search}%`);
  const { data, error } = await q;
  if (error) throw new Error(`activities: ${error.message}`);
  return (data ?? []) as ActivityRow[];
}

export async function listPackagesForActivity(activityId: number): Promise<PackageRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('packages')
    .select('*')
    .eq('activity_id', activityId)
    .order('id');
  if (error) throw new Error(`packages: ${error.message}`);
  return (data ?? []) as PackageRow[];
}

export type PackageWithStats = {
  id: number;
  activity_id: number;
  platform: Platform;
  poi: string | null;
  activity_title: string | null;
  platform_product_id: string | null;
  package_title: string | null;
  platform_package_id: string | null;
  tour_type: string | null;
  group_size: string | null;
  meals: boolean | null;
  departure_city: string | null;
  available_languages: string[] | string | null;
  duration_minutes: number | null;
  sku_count: number;
  min_price_usd: number | null;
  max_price_usd: number | null;
  last_checked_at: string | null;
};

/**
 * One row per package, with parent-activity context (platform/poi/title) and
 * SKU aggregates (count, price range, last check). The aggregates are
 * computed client-side instead of via a Postgres view since we don't have
 * one for this shape — running an aggregate here costs one extra round-trip
 * but is robust to schema changes.
 */
export async function listPackagesWithStats(): Promise<PackageWithStats[]> {
  const sb = await createClient();
  const [{ data: pkgs, error: pkgErr }, { data: acts, error: actErr }] = await Promise.all([
    sb.from('packages').select('*').limit(5000),
    sb.from('activities').select('id,platform,poi,title,platform_product_id').limit(5000),
  ]);
  if (pkgErr) throw new Error(`packages: ${pkgErr.message}`);
  if (actErr) throw new Error(`activities: ${actErr.message}`);
  if (!pkgs || pkgs.length === 0) return [];

  const actMap = new Map<number, { platform: Platform; poi: string | null; title: string | null; platform_product_id: string | null }>();
  for (const a of acts ?? []) {
    actMap.set(a.id, { platform: a.platform, poi: a.poi, title: a.title, platform_product_id: a.platform_product_id });
  }

  const { data: skus, error: skuErr } = await sb
    .from('skus')
    .select('package_id,price_usd,last_checked_at')
    .limit(20000);
  if (skuErr) throw new Error(`skus: ${skuErr.message}`);

  type Agg = { count: number; min: number | null; max: number | null; last: string | null };
  const agg = new Map<number, Agg>();
  for (const s of skus ?? []) {
    const a = agg.get(s.package_id) ?? { count: 0, min: null, max: null, last: null };
    a.count++;
    if (s.price_usd != null) {
      if (a.min == null || s.price_usd < a.min) a.min = s.price_usd;
      if (a.max == null || s.price_usd > a.max) a.max = s.price_usd;
    }
    if (s.last_checked_at && (!a.last || s.last_checked_at > a.last)) a.last = s.last_checked_at;
    agg.set(s.package_id, a);
  }

  return pkgs.map((p) => {
    const aRow = actMap.get(p.activity_id);
    const a = agg.get(p.id) ?? { count: 0, min: null, max: null, last: null };
    return {
      id: p.id,
      activity_id: p.activity_id,
      platform: (aRow?.platform ?? 'klook') as Platform,
      poi: aRow?.poi ?? null,
      activity_title: aRow?.title ?? null,
      platform_product_id: aRow?.platform_product_id ?? null,
      package_title: p.title ?? null,
      platform_package_id: p.platform_package_id ?? null,
      tour_type: p.tour_type ?? null,
      group_size: p.group_size ?? null,
      meals: p.meals ?? null,
      departure_city: p.departure_city ?? null,
      available_languages: p.available_languages ?? null,
      duration_minutes: p.duration_minutes ?? null,
      sku_count: a.count,
      min_price_usd: a.min,
      max_price_usd: a.max,
      last_checked_at: a.last,
    };
  });
}

export async function listSkusForActivity(activityId: number): Promise<SkuRow[]> {
  const pkgs = await listPackagesForActivity(activityId);
  if (pkgs.length === 0) return [];
  const sb = await createClient();
  const ids = pkgs.map((p) => p.id);
  const { data, error } = await sb
    .from('skus')
    .select('*')
    .in('package_id', ids)
    .order('travel_date');
  if (error) throw new Error(`skus: ${error.message}`);
  return (data ?? []) as SkuRow[];
}

export async function listSessions(limit = 50): Promise<SessionRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('run_sessions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`sessions: ${error.message}`);
  return (data ?? []) as SessionRow[];
}

export async function listExecutions(opts: {
  platform?: Platform;
  sinceIso?: string;
  sessionId?: number;
  limit?: number;
} = {}): Promise<ExecutionRow[]> {
  const sb = await createClient();
  let q = sb
    .from('execution_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.platform) q = q.eq('platform', opts.platform);
  if (opts.sinceIso) q = q.gte('started_at', opts.sinceIso);
  if (opts.sessionId) q = q.eq('session_id', opts.sessionId);
  const { data, error } = await q;
  if (error) throw new Error(`executions: ${error.message}`);
  return (data ?? []) as ExecutionRow[];
}

export async function listCoverageRuns(limit = 200): Promise<CoverageRunRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('coverage_runs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`coverage_runs: ${error.message}`);
  return (data ?? []) as CoverageRunRow[];
}

export async function listSearchRuns(limit = 100): Promise<SearchRunRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('search_runs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`search_runs: ${error.message}`);
  return (data ?? []) as SearchRunRow[];
}

export type CoverageReportRow = {
  poi: string;
  platform: Platform;
  filter_count: number;
  cumulative_unique: number;
  max_total_reported: number | null;
  coverage_pct: number | null;
  last_run_at: string | null;
};

export async function buildCoverageReport(): Promise<CoverageReportRow[]> {
  const sb = await createClient();
  const [actsRes, runsRes] = await Promise.all([
    sb.from('activities').select('id,poi,platform').limit(10000),
    sb.from('coverage_runs').select('*').order('run_at', { ascending: false }).limit(10000),
  ]);
  if (actsRes.error) throw new Error(`activities: ${actsRes.error.message}`);
  if (runsRes.error) throw new Error(`coverage_runs: ${runsRes.error.message}`);

  const lower = (s: string | null) => (s ?? '').trim().toLowerCase();
  const cum = new Map<string, number>();
  for (const a of actsRes.data ?? []) {
    if (!a.poi) continue;
    const k = `${lower(a.poi)}::${a.platform}`;
    cum.set(k, (cum.get(k) ?? 0) + 1);
  }
  const byKey = new Map<string, { poi: string; platform: Platform; runs: CoverageRunRow[] }>();
  for (const r of (runsRes.data ?? []) as CoverageRunRow[]) {
    const k = `${lower(r.poi)}::${r.platform}`;
    if (!byKey.has(k)) byKey.set(k, { poi: r.poi, platform: r.platform, runs: [] });
    byKey.get(k)!.runs.push(r);
  }
  const out: CoverageReportRow[] = [];
  for (const [k, g] of byKey) {
    const totals = g.runs.map((r) => r.total_reported).filter((n): n is number => n != null);
    const max_total = totals.length ? Math.max(...totals) : null;
    const cumulative = cum.get(k) ?? 0;
    out.push({
      poi: g.poi,
      platform: g.platform,
      filter_count: new Set(g.runs.map((r) => r.filter_signature)).size,
      cumulative_unique: cumulative,
      max_total_reported: max_total,
      coverage_pct: max_total ? Math.min(1, cumulative / max_total) : null,
      last_run_at: g.runs[0]?.run_at ?? null,
    });
  }
  out.sort((a, b) => a.poi.localeCompare(b.poi) || a.platform.localeCompare(b.platform));
  return out;
}

export async function listWhitelist(): Promise<WhitelistRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('email_whitelist')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`whitelist: ${error.message}`);
  return (data ?? []) as WhitelistRow[];
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return false;
  const { data } = await sb
    .from('email_whitelist')
    .select('is_admin')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();
  return !!data?.is_admin;
}
