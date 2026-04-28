/**
 * Upload a captured screenshot to Supabase Storage and return the public URL.
 *
 * The bucket `scrape-screenshots` is public, so the URL is directly viewable
 * by any signed-in dashboard user (the dashboard itself is auth-gated by
 * Google SSO + email_whitelist). If the data ever becomes sensitive enough
 * to need TTL'd access, switch the bucket to private and use
 * supabase.storage.from(bucket).createSignedUrl(path, ttl) on the
 * dashboard side instead of plumbing the raw URL.
 *
 * Uploads use the service-role key (server-side only). Never call this
 * from a browser context.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env.js';

const BUCKET = 'scrape-screenshots';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  loadEnv();
  _client = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _client;
}

/**
 * Read a local PNG file and upload it to Supabase Storage at
 * `<platform>/<activityId>-<stamp>.png`. Returns the public URL.
 *
 * Errors propagate — caller decides whether the screenshot failure should
 * abort the broader ingest (typically: don't, screenshots are best-effort
 * proof, not load-bearing).
 */
export async function uploadScreenshot(
  localPath: string,
  platform: string,
  activityId: string,
): Promise<string> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Screenshot not found at ${localPath}`);
  }
  const buf = fs.readFileSync(localPath);
  // ISO timestamp without colons so it's safe in URLs / filesystems.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const objectPath = `${platform}/${platform}-${activityId}-${stamp}.png`;

  const client = getClient();
  const { error } = await client.storage
    .from(BUCKET)
    .upload(objectPath, buf, {
      contentType: 'image/png',
      upsert: false, // each scrape gets its own timestamped object
    });
  if (error) throw new Error(`Storage upload failed (${objectPath}): ${error.message}`);

  const { data } = client.storage.from(BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

/**
 * Convenience wrapper around captureScreenshot + uploadScreenshot. Returns
 * { localPath, publicUrl } so the caller can persist either, and best-effort
 * cleans up the local file (commented out by default — keep until we're
 * confident the cloud copy is reliable).
 */
export async function captureAndUploadScreenshot(
  url: string,
  platform: string,
  activityId: string,
  opts: { scrollTimes?: number; settleMs?: number; fullPage?: boolean } = {},
): Promise<{ localPath: string; publicUrl: string }> {
  const { captureScreenshot } = await import('./screenshot.js');
  const localPath = await captureScreenshot(url, platform, activityId, opts);
  const publicUrl = await uploadScreenshot(localPath, platform, activityId);
  return { localPath, publicUrl };
}
