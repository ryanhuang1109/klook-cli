'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Platform } from '@/lib/data';

export function ActivitiesFilters({
  platforms,
  pois,
  defaultPlatform,
  defaultPoi,
  defaultQ,
}: {
  platforms: Platform[];
  pois: string[];
  defaultPlatform?: Platform;
  defaultPoi?: string;
  defaultQ?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(defaultQ ?? '');

  function update(patch: Record<string, string | null | undefined>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== 'all') next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search title…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') update({ q: q.trim() || undefined });
        }}
        onBlur={() => update({ q: q.trim() || undefined })}
        className="max-w-xs h-9"
      />
      <Select
        defaultValue={defaultPlatform ?? 'all'}
        onValueChange={(v) => update({ platform: v })}
      >
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Platform" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All platforms</SelectItem>
          {platforms.map((p) => (
            <SelectItem key={p} value={p}>{p}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        defaultValue={defaultPoi ?? 'all'}
        onValueChange={(v) => update({ poi: v })}
      >
        <SelectTrigger className="w-[180px] h-9">
          <SelectValue placeholder="POI" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value="all">All POIs</SelectItem>
          {pois.map((p) => (
            <SelectItem key={p} value={p}>{p}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
