// src/compare/llm.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CompareResult } from '../shared/types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

interface LLMConfig {
  apiKey: string;
  model: string;
}

interface RawProduct {
  platform: string;
  title: string;
  price: string;
  rating: string;
  review_count: string;
  url: string;
}

export function getConfig(): LLMConfig {
  const configPath = path.join(os.homedir(), '.klook-cli', 'config.json');
  let fileConfig: Record<string, string> = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch { /* no config file */ }

  const apiKey = fileConfig.openrouter_api_key || process.env.OPENROUTER_API_KEY || '';
  const model = fileConfig.openrouter_model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return { apiKey, model };
}

const SYSTEM_PROMPT = `You are a travel product analyst. Given search results from multiple platforms for the same POI, group them into clusters of similar/equivalent products.

Rules:
- Group products that visit the same set of attractions with similar duration
- Convert all prices to USD (use approximate current rates, state rates used)
- For each group, identify the cheapest and best-rated option
- Flag notable differences (includes hotel pickup, meal, express pass, etc.)
- Output valid JSON matching the schema below. No other text.

Schema:
{
  "query": "string",
  "date": "string",
  "groups": [
    {
      "group_name": "string — short descriptive name",
      "description": "string — one sentence about what this group covers",
      "products": [
        {
          "platform": "klook | trip | getyourguide | kkday",
          "title": "string",
          "price_usd": number | null,
          "price_original": "string — original price as shown",
          "rating": "string",
          "review_count": "string",
          "url": "string",
          "notes": "string — notable differences or empty"
        }
      ],
      "cheapest": "string — platform name",
      "best_rated": "string — platform name"
    }
  ],
  "currency_rates_used": "string — e.g. 1 HKD ≈ 0.128 USD, 1 TWD ≈ 0.031 USD"
}`;

export function buildClusterPrompt(products: RawProduct[], query: string, date: string): string {
  const productList = products.map((p, i) =>
    `[${i + 1}] platform=${p.platform} | title=${p.title} | price=${p.price} | rating=${p.rating} | reviews=${p.review_count} | url=${p.url}`
  ).join('\n');

  return `Query: "${query}"\nDate: ${date}\nTotal products: ${products.length}\n\n${productList}`;
}

export function parseClusterResponse(raw: string): CompareResult {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }
  if (!parsed.groups || !Array.isArray(parsed.groups)) {
    throw new Error('LLM response missing "groups" array');
  }
  return parsed as CompareResult;
}

export async function clusterProducts(
  products: RawProduct[],
  query: string,
  date: string,
): Promise<CompareResult> {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error(
      'OpenRouter API key not set. Set OPENROUTER_API_KEY env var or add openrouter_api_key to ~/.klook-cli/config.json'
    );
  }

  const userPrompt = buildClusterPrompt(products, query, date);

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned empty response');
  }

  return parseClusterResponse(content);
}

export const __test__ = { getConfig };
