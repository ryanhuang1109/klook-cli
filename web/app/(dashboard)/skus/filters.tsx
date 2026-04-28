'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Platform } from '@/lib/data';

const LABEL: Record<Platform | 'all', string> = {
  all: 'All',
  klook: 'Klook',
  trip: 'Trip.com',
  getyourguide: 'GYG',
  kkday: 'KKday',
  airbnb: 'Airbnb',
};

const PILL_IDLE = 'bg-white text-zinc-500 border-zinc-200 hover:bg-zinc-50 hover:text-zinc-700';

const ACTIVE: Record<Platform, string> = {
  klook: 'bg-orange-500 text-white border-orange-500',
  trip: 'bg-blue-600 text-white border-blue-600',
  getyourguide: 'bg-pink-600 text-white border-pink-600',
  kkday: 'bg-violet-600 text-white border-violet-600',
  airbnb: 'bg-rose-600 text-white border-rose-600',
};

export function SkusFilters({
  platforms,
  pois,
  defaultPlatform,
  defaultPoi,
}: {
  platforms: Platform[];
  pois: string[];
  defaultPlatform?: Platform;
  defaultPoi?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const selected = defaultPlatform ?? 'all';

  function update(patch: Record<string, string | null | undefined>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== 'all') next.set(k, v);
      else next.delete(k);
    }
    // Changing a filter resets pagination — otherwise users land on a page
    // that may be past the filtered set's last page.
    next.delete('page');
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill label="All" active={selected === 'all'} onClick={() => update({ platform: null })} />
        {platforms.map((p) => (
          <Pill
            key={p}
            label={LABEL[p]}
            activeClass={ACTIVE[p]}
            active={selected === p}
            onClick={() => update({ platform: p })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={defaultPoi ?? 'all'}
          onValueChange={(v) => update({ poi: v })}
        >
          <SelectTrigger className="w-[220px] h-9">
            <SelectValue placeholder="All POIs" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">All POIs</SelectItem>
            {pois.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
  activeClass,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  activeClass?: string;
}) {
  const cls = active
    ? (activeClass ?? 'bg-zinc-900 text-white border-zinc-900')
    : PILL_IDLE;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 h-8 inline-flex items-center rounded-full border text-xs font-medium transition-colors whitespace-nowrap ${cls}`}
    >
      {label}
    </button>
  );
}
