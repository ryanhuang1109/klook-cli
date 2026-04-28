/**
 * Browser-side Supabase data access for the dashboard.
 *
 * Routes all queries through the same Supabase client used by /auth.js so
 * the user's session token is attached automatically. RLS gates reads to
 * authenticated @klook.com emails; without a session every query returns
 * an empty array (and the page should have already redirected to login
 * via requireSession()).
 *
 * If you need a new query, prefer one of the helpers below over calling
 * sb.from(...) at the page level — keeps error handling consistent.
 */

import { sb } from '/auth.js';

async function unwrap(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`Supabase ${label}: ${error.message}`);
  return data;
}

/**
 * Activities joined with package/sku counts and price aggregates from the
 * v_activities_with_stats view (security_invoker=true, so RLS still gates
 * which rows the caller sees).
 */
export async function listActivitiesWithStats(opts = {}) {
  let q = sb.from('v_activities_with_stats')
    .select('*')
    .order('last_scraped_at', { ascending: false })
    .limit(opts.limit ?? 500);
  if (opts.poi) q = q.ilike('poi', `%${opts.poi}%`);
  if (opts.platform) q = q.eq('platform', opts.platform);
  if (opts.search) q = q.ilike('title', `%${opts.search}%`);
  return unwrap(q, 'listActivitiesWithStats');
}

export async function listPackagesForActivity(activityId) {
  return unwrap(
    sb.from('packages').select('*').eq('activity_id', activityId).order('id'),
    'listPackagesForActivity',
  );
}

export async function listSkusForActivity(activityId) {
  // Two-hop join via packages — Supabase JS doesn't support multi-table
  // joins in the embedded form when you don't own the relationship name,
  // so fetch packages first and filter SKUs by their ids.
  const pkgs = await listPackagesForActivity(activityId);
  if (pkgs.length === 0) return [];
  const ids = pkgs.map((p) => p.id);
  return unwrap(
    sb.from('skus').select('*').in('package_id', ids).order('travel_date'),
    'listSkusForActivity',
  );
}

export async function listActivities(opts = {}) {
  let q = sb.from('activities')
    .select('id,platform,platform_product_id,canonical_url,title,poi,supplier,rating,review_count,last_scraped_at,review_status')
    .order('last_scraped_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.poi) q = q.ilike('poi', opts.poi);
  if (opts.platform) q = q.eq('platform', opts.platform);
  return unwrap(q, 'listActivities');
}

export async function listSessions(limit = 50) {
  return unwrap(
    sb.from('run_sessions').select('*').order('started_at', { ascending: false }).limit(limit),
    'listSessions',
  );
}

export async function listExecutions(opts = {}) {
  let q = sb.from('execution_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.sessionId) q = q.eq('session_id', opts.sessionId);
  if (opts.platform) q = q.eq('platform', opts.platform);
  if (opts.sinceIso) q = q.gte('started_at', opts.sinceIso);
  return unwrap(q, 'listExecutions');
}

export async function listSearchRuns(limit = 100) {
  return unwrap(
    sb.from('search_runs').select('*').order('run_at', { ascending: false }).limit(limit),
    'listSearchRuns',
  );
}

export async function listCoverageRuns(opts = {}) {
  let q = sb.from('coverage_runs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.poi) q = q.eq('poi', opts.poi);
  if (opts.platform) q = q.eq('platform', opts.platform);
  return unwrap(q, 'listCoverageRuns');
}

/**
 * Per (POI, platform) saturation, computed client-side from two queries.
 * Postgres views aren't auto-exposed via PostgREST without explicit grants;
 * we'd rather not expand the schema for a derived metric.
 */
export async function buildCoverageReport() {
  const [acts, runs] = await Promise.all([
    unwrap(sb.from('activities').select('id,poi,platform').limit(10000), 'activities'),
    unwrap(sb.from('coverage_runs').select('*').order('run_at', { ascending: false }).limit(10000), 'coverage_runs'),
  ]);
  const lower = (s) => (s ?? '').trim().toLowerCase();
  const cum = new Map();
  for (const a of acts) {
    if (!a.poi) continue;
    const k = `${lower(a.poi)}::${a.platform}`;
    cum.set(k, (cum.get(k) ?? 0) + 1);
  }
  const byKey = new Map();
  for (const r of runs) {
    const k = `${lower(r.poi)}::${r.platform}`;
    if (!byKey.has(k)) byKey.set(k, { poi: r.poi, platform: r.platform, runs: [] });
    byKey.get(k).runs.push(r);
  }
  const out = [];
  for (const [k, g] of byKey) {
    const totals = g.runs.map((r) => r.total_reported).filter((n) => n != null);
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
      filters: [...new Set(g.runs.map((r) => r.filter_signature))],
    });
  }
  out.sort((a, b) => (a.poi ?? '').localeCompare(b.poi ?? '') || a.platform.localeCompare(b.platform));
  return out;
}

export async function listRecentSkuObservations(limit = 50) {
  return unwrap(
    sb.from('sku_observations')
      .select('id,sku_id,checked_at,price_local,price_usd,available')
      .order('checked_at', { ascending: false })
      .limit(limit),
    'listRecentSkuObservations',
  );
}

export async function tableCounts() {
  const tables = ['activities', 'packages', 'skus', 'sku_observations', 'run_sessions', 'execution_logs', 'search_runs', 'coverage_runs'];
  const out = {};
  await Promise.all(tables.map(async (t) => {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
    out[t] = error ? 0 : (count ?? 0);
  }));
  return out;
}
