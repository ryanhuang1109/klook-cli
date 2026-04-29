'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Platform } from '@/lib/data';

export function ExecutionsFilters({
  platforms,
  defaultPlatform,
  defaultHours,
}: {
  platforms: Platform[];
  defaultPlatform?: Platform;
  defaultHours: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        defaultValue={defaultPlatform ?? 'all'}
        onValueChange={(v) => update('platform', v)}
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
        defaultValue={defaultHours}
        onValueChange={(v) => update('hours', v)}
      >
        <SelectTrigger className="w-[120px] h-9">
          <SelectValue placeholder="Hours" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="24">Last 24h</SelectItem>
          <SelectItem value="72">Last 72h</SelectItem>
          <SelectItem value="168">Last 7d</SelectItem>
          <SelectItem value="all">All time</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
