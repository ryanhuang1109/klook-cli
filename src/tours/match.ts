/**
 * match-from-url: given a source URL on one platform, find the most likely
 * equivalent tours on other platforms.
 *
 * Flow:
 *   1. Shell out to `opencli <source-platform> detail` to get title / POI signals.
 *   2. Derive 2 search phrases from the source title (strip brand/stop words).
 *   3. Run `opencli <target-platform> search <phrase>` for each phrase and collect candidates.
 *   4. Ask the LLM to rank candidates with a structured JSON response, constrained
 *      to IDs drawn from the candidate set so the model can't hallucinate URLs.
 */
import { execFileSync } from 'node:child_process';
import { chatJSON } from './llm.js';

export interface MatchCandidate {
  platform: string;
  title: string;
  url: string;
  price: string;
  rating: string;
  review_count: string;
}

export interface MatchResult {
  source: {
    platform: string;
    url: string;
    title: string;
    poi: string | null;
  };
  target_platform: string;
  candidates: MatchCandidate[];
  ranked: RankedMatch[];
}

export interface RankedMatch {
  url: string;
  title: string;
  confidence: number;
  reasons: string[];
}

function opencli(platform: string, sub: string, args: string[]): unknown {
  const out = execFileSync(
    'opencli',
    [platform, sub, ...args, '-f', 'json'],
    { encoding: 'utf-8', timeout: 180_000, maxBuffer: 50 * 1024 * 1024 },
  );
  const jsonStr = out
    .split('\n')
    .filter((l) => !l.includes('Update available') && !l.includes('Run: npm'))
    .join('\n');
  return JSON.parse(jsonStr);
}

function parseIdFromUrl(url: string): { platform: string; id: string } | null {
  const patterns: { platform: string; regex: RegExp }[] = [
    { platform: 'klook', regex: /klook\.com\/[^/]+\/activity\/(\d+)/i },
    { platform: 'klook', regex: /klook\.com\/activity\/(\d+)/i },
    { platform: 'trip', regex: /trip\.com\/.*detail\/(\d+)/i },
    { platform: 'kkday', regex: /kkday\.com\/[^/]+\/product\/(\d+)/i },
    { platform: 'getyourguide', regex: /getyourguide\.com\/.+-t(\d+)/i },
  ];
  for (const { platform, regex } of patterns) {
    const m = url.match(regex);
    if (m) return { platform, id: m[1] };
  }
  return null;
}

function buildSearchPhrases(title: string): string[] {
  const stop = new Set([
    'the', 'a', 'an', 'to', 'from', 'with', 'and', 'or', 'for', 'of',
    'tour', 'day', 'trip', 'experience', 'activity', 'private', 'shared',
  ]);
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));

  const core = words.slice(0, 4).join(' ');
  const poi = words.slice(0, 2).join(' ');
  const phrases = [core, poi].filter((p, i, arr) => p && arr.indexOf(p) === i);
  return phrases.length ? phrases : [title];
}

export async function matchFromUrl(
  sourceUrl: string,
  targetPlatform: string,
  opts: { limit?: number; model?: string } = {},
): Promise<MatchResult> {
  const parsed = parseIdFromUrl(sourceUrl);
  if (!parsed) {
    throw new Error(`Could not extract platform/id from URL: ${sourceUrl}`);
  }

  const sourceDetail = opencli(parsed.platform, 'detail', [parsed.id]) as any;
  const sourceTitle: string = sourceDetail?.title || '';
  if (!sourceTitle) {
    throw new Error('Source detail returned no title; cannot build search');
  }

  const phrases = buildSearchPhrases(sourceTitle);
  const limit = opts.limit ?? 8;
  const seen = new Set<string>();
  const candidates: MatchCandidate[] = [];

  for (const phrase of phrases) {
    try {
      const results = opencli(targetPlatform, 'search', [
        phrase, '--limit', String(limit),
      ]) as any[];
      if (!Array.isArray(results)) continue;
      for (const r of results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        candidates.push({
          platform: targetPlatform,
          title: r.title ?? '',
          url: r.url,
          price: r.price ?? '',
          rating: r.rating ?? '',
          review_count: r.review_count ?? '',
        });
      }
    } catch (err) {
      candidates.push({
        platform: targetPlatform,
        title: `(search failed for phrase "${phrase}": ${(err as Error).message.slice(0, 120)})`,
        url: '',
        price: '',
        rating: '',
        review_count: '',
      });
    }
  }

  const realCandidates = candidates.filter((c) => c.url);
  const ranked = realCandidates.length
    ? await rankCandidatesWithLLM(sourceDetail, realCandidates, opts.model)
    : [];

  return {
    source: {
      platform: parsed.platform,
      url: sourceUrl,
      title: sourceTitle,
      poi: sourceDetail?.city || null,
    },
    target_platform: targetPlatform,
    candidates: realCandidates,
    ranked,
  };
}

async function rankCandidatesWithLLM(
  sourceDetail: any,
  candidates: MatchCandidate[],
  model?: string,
): Promise<RankedMatch[]> {
  const sourceSummary = {
    title: sourceDetail.title,
    city: sourceDetail.city,
    rating: sourceDetail.rating,
    review_count: sourceDetail.review_count,
    itinerary_first_steps: (sourceDetail.itinerary ?? [])
      .slice(0, 4)
      .map((s: any) => `${s.time || ''} ${s.title || ''}`.trim())
      .filter(Boolean),
    packages_preview: (sourceDetail.packages ?? []).slice(0, 3).map((p: any) => p.name),
  };

  const numbered = candidates.map((c, i) => ({
    idx: i,
    url: c.url,
    title: c.title,
    price: c.price,
    rating: c.rating,
    reviews: c.review_count,
  }));

  const system =
    'You compare OTA tour listings across platforms. Be strict — only mark as high ' +
    'confidence when titles, POI, and package structure strongly align. Do not invent ' +
    'URLs; only return URLs present in the candidate list.';

  const user = `Source tour:
${JSON.stringify(sourceSummary, null, 2)}

Candidate tours from the target platform (use the "url" field verbatim):
${JSON.stringify(numbered, null, 2)}

Return a JSON object with this shape:
{
  "ranked": [
    { "idx": number, "url": string, "title": string, "confidence": 0..1, "reasons": [string, ...] }
  ]
}

Rules:
- Only include candidates with confidence >= 0.4
- Sort by confidence descending
- At most 5 entries
- "reasons" should be short phrases (e.g. "same POI", "same duration", "supplier match")`;

  const resp = await chatJSON<{ ranked: RankedMatch[] & { idx: number }[] }>(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { model, temperature: 0.1, max_tokens: 1500 },
  );

  const allowedUrls = new Set(candidates.map((c) => c.url));
  return (resp.ranked ?? [])
    .filter((r) => allowedUrls.has(r.url))
    .map((r) => ({
      url: r.url,
      title: r.title,
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
      reasons: Array.isArray(r.reasons) ? r.reasons.slice(0, 5) : [],
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}
