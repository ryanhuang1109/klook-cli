'use server';

import { listExecutions, type ExecutionRow } from '@/lib/data';

export async function getSessionExecutions(sessionId: number): Promise<ExecutionRow[]> {
  return listExecutions({ sessionId, limit: 500 });
}
