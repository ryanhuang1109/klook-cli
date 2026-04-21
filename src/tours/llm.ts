/**
 * Thin OpenRouter adapter used by the matching / URL-lookup flow.
 *
 * Stays deliberately minimal: one `chat()` function that takes a JSON schema
 * hint and returns parsed JSON. The model is overridable so we can cheapen
 * out with small models for bulk work and upgrade for hard matches.
 */
import { loadEnv, requireEnv } from './env.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  json?: boolean;
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini';

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  loadEnv();
  const apiKey = requireEnv('OPENROUTER_API_KEY');

  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 1200,
  };
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/klook-cli',
      'X-Title': 'klook-cli-tours',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no content');
  return content;
}

export async function chatJSON<T>(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<T> {
  const raw = await chat(messages, { ...opts, json: true });
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from LLM: ${(err as Error).message}\nRaw: ${raw.slice(0, 500)}`,
    );
  }
}
