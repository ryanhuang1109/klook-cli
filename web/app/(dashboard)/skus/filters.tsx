'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { MultiCombobox } from '@/components/dashboard/multi-combobox';
import { PlatformLogo } from '@/components/dashboard/platform-logo';
import type { Platform } from '@/lib/data';
import type { SkuActivityOption } from './page';

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
  activities,
  defaultPlatform,
  defaultPois,
  defaultActivities,
}: {
  platforms: Platform[];
  pois: string[];
  activities: SkuActivityOption[];
  defaultPlatform?: Platform;
  defaultPois: string[];
  defaultActivities: string[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const selected = defaultPlatform ?? 'all';

  function update(patch: Record<string, string | string[] | null | undefined>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      const flat = Array.isArray(v) ? v.join(',') : v;
      if (flat && flat !== 'all') next.set(k, flat);
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
        <Pill label="All" active={selected === 'all'} onClick={() => update({ platform: null, activity: null })} />
        {platforms.map((p) => (
          <Pill
            key={p}
            label={LABEL[p]}
            icon={<PlatformLogo platform={p} size={14} />}
            activeClass={ACTIVE[p]}
            active={selected === p}
            onClick={() => update({ platform: p, activity: null })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MultiCombobox
          options={pois.map((p) => ({ value: p, label: p }))}
          value={defaultPois}
          onChange={(v) => update({ poi: v })}
          placeholder="All POIs"
          width="w-[240px]"
        />
        <MultiCombobox
          options={activities.map((a) => ({ value: a.id, label: a.label }))}
          value={defaultActivities}
          onChange={(v) => update({ activity: v })}
          placeholder="All activities"
          width="w-[380px]"
        />
      </div>
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
  activeClass,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  activeClass?: string;
  icon?: React.ReactNode;
}) {
  const cls = active
    ? (activeClass ?? 'bg-zinc-900 text-white border-zinc-900')
    : PILL_IDLE;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 h-8 inline-flex items-center gap-1.5 rounded-full border text-xs font-medium transition-colors whitespace-nowrap ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}
