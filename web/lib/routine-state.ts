import fs from 'node:fs';
import path from 'node:path';

export type RoutineState = {
  generated_at: string;
  config: {
    frequency?: string;
    [k: string]: unknown;
  } | null;
  host: {
    hostname?: string;
    last_run?: string;
    [k: string]: unknown;
  } | null;
  sessions: unknown[];
  error?: string;
};

/**
 * Read the routine-state.json shipped with the build. Returns null if the
 * file isn't there (which happens before the script has run for the first
 * time, or in dev environments with no daily-routine setup).
 */
export function readRoutineState(): RoutineState | null {
  const p = path.join(process.cwd(), 'public', 'routine-state.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as RoutineState;
  } catch {
    return null;
  }
}
