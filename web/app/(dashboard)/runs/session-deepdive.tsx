'use client';

import { useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtDateTime } from '@/lib/format';
import type { ExecutionRow, SessionRow } from '@/lib/data';
import { getSessionExecutions } from './actions';

export function SessionDeepdive({ sessions }: { sessions: SessionRow[] }) {
  const [open, setOpen] = useState<SessionRow | null>(null);
  const [executions, setExecutions] = useState<ExecutionRow[] | null>(null);
  const [pending, startTransition] = useTransition();

  function openSession(s: SessionRow) {
    setOpen(s);
    setExecutions(null);
    startTransition(async () => {
      const rows = await getSessionExecutions(s.id);
      setExecutions(rows);
    });
  }

  return (
    <>
      <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
              <TableHead className="w-[180px]">Started</TableHead>
              <TableHead>POI</TableHead>
              <TableHead>Keyword</TableHead>
              <TableHead>Competitors</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow
                key={s.id}
                onClick={() => openSession(s)}
                className="cursor-pointer"
              >
                <TableCell className="text-xs font-mono text-zinc-500">
                  {fmtDateTime(s.started_at)}
                </TableCell>
                <TableCell>{s.poi ?? '—'}</TableCell>
                <TableCell className="text-zinc-700">{s.keyword ?? '—'}</TableCell>
                <TableCell className="text-xs text-zinc-500 font-mono">
                  {s.competitors ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-600">
                  {s.limit_value ?? '—'}
                </TableCell>
                <TableCell>
                  <SessionStatus status={s.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          {open ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <SessionStatus status={open.status} />
                  <span className="text-xs font-mono text-zinc-400">
                    session {open.id}
                  </span>
                </div>
                <DialogTitle className="text-lg">
                  {open.poi ?? '(no POI)'} · {open.keyword ?? '—'}
                </DialogTitle>
                <p className="text-xs text-zinc-500 font-mono">
                  {fmtDateTime(open.started_at)}
                  {open.finished_at ? ` → ${fmtDateTime(open.finished_at)}` : ''}
                </p>
              </DialogHeader>

              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                  Executions in this session
                </h3>
                {pending || executions === null ? (
                  <div className="space-y-2">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : executions.length === 0 ? (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-500 text-center">
                    No executions linked to this session.
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-200 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                          <TableHead>Started</TableHead>
                          <TableHead>Platform</TableHead>
                          <TableHead>Activity</TableHead>
                          <TableHead>Strategy</TableHead>
                          <TableHead className="text-right">Duration</TableHead>
                          <TableHead>Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {executions.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs font-mono text-zinc-500">
                              {fmtDateTime(e.started_at)}
                            </TableCell>
                            <TableCell><PlatformBadge platform={e.platform} /></TableCell>
                            <TableCell className="font-mono text-xs">{e.activity_id}</TableCell>
                            <TableCell className="text-xs text-zinc-600">{e.strategy}</TableCell>
                            <TableCell className="text-right tabular-nums text-zinc-600">
                              {e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : '—'}
                            </TableCell>
                            <TableCell>
                              <ResultBadge succeeded={e.succeeded} errorMessage={e.error_message} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SessionStatus({ status }: { status: string }) {
  const tone =
    status === 'succeeded' || status === 'finished'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'failed'
        ? 'bg-rose-100 text-rose-800'
        : status === 'running'
          ? 'bg-blue-100 text-blue-800'
          : 'bg-zinc-100 text-zinc-700';
  return <Badge className={`${tone} hover:${tone} border-transparent`}>{status}</Badge>;
}

function ResultBadge({ succeeded, errorMessage }: { succeeded: number | boolean; errorMessage: string | null }) {
  const ok = succeeded === 1 || succeeded === true;
  return (
    <div className="inline-flex items-center gap-2">
      <Badge className={ok ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-transparent' : 'bg-rose-100 text-rose-800 hover:bg-rose-100 border-transparent'}>
        {ok ? 'OK' : 'FAIL'}
      </Badge>
      {!ok && errorMessage ? (
        <span className="text-xs text-zinc-500 truncate max-w-md" title={errorMessage}>
          {errorMessage.slice(0, 50)}
        </span>
      ) : null}
    </div>
  );
}
