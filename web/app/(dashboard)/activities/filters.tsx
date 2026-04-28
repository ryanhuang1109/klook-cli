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

const PLATFORM_LABEL: Record<Platform | 'all', string> = {
  all: 'All',
  klook: 'Klook',
  trip: 'Trip.com',
  getyourguide: 'GYG',
  kkday: 'KKday',
  airbnb: 'Airbnb',
};

const PLATFORM_TONE: Record<Platform, { active: string; idle: string }> = {
  klook: {
    active: 'bg-orange-500 text-white border-orange-500',
    idle: 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100',
  },
  trip: {
    active: 'bg-blue-600 text-white border-blue-600',
    idle: 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100',
  },
  getyourguide: {
    active: 'bg-pink-600 text-white border-pink-600',
    idle: 'bg-pink-50 text-pink-800 border-pink-200 hover:bg-pink-100',
  },
  kkday: {
    active: 'bg-violet-600 text-white border-violet-600',
    idle: 'bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100',
  },
  airbnb: {
    active: 'bg-rose-600 text-white border-rose-600',
    idle: 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100',
  },
};

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
  const selected = defaultPlatform ?? 'all';

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <PlatformPill
          label="All"
          active={selected === 'all'}
          onClick={() => update({ platform: null })}
        />
        {platforms.map((p) => (
          <PlatformPill
            key={p}
            label={PLATFORM_LABEL[p]}
            tone={PLATFORM_TONE[p]}
            active={selected === p}
            onClick={() => update({ platform: p })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') update({ q: q.trim() || null });
          }}
          onBlur={() => update({ q: q.trim() || null })}
          className="max-w-xs h-9"
        />
        <Select
          defaultValue={defaultPoi ?? 'all'}
          onValueChange={(v) => update({ poi: v })}
        >
          <SelectTrigger className="w-[200px] h-9">
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
    </div>
  );
}

function PlatformPill({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: { active: string; idle: string };
}) {
  // "All" pill: neutral zinc tones; platform pills: their own tone.
  const cls = tone
    ? active
      ? tone.active
      : tone.idle
    : active
      ? 'bg-zinc-900 text-white border-zinc-900'
      : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50';
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
