'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { saveRoutineConfig, type RoutineConfig, type SaveResult } from './actions';

type Props = {
  initial: RoutineConfig;
  updatedAt: string | null;
  updatedBy: string | null;
};

const ALL_PLATFORMS = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'] as const;

export default function ConfigForm({ initial, updatedAt, updatedBy }: Props) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    saveRoutineConfig,
    null,
  );
  const [pois, setPois] = useState(
    initial.pois.length > 0
      ? initial.pois
      : [{ destination: '', keyword: '', poi: '' }],
  );
  const [competitors, setCompetitors] = useState<Set<string>>(
    new Set(initial.competitors),
  );
  const [sort, setSort] = useState(initial.sort ?? 'reviews');

  const toggleCompetitor = (p: string) => {
    setCompetitors((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  return (
    <form action={formAction} className="space-y-6">
      {/* POIs ---------------------------------------------------- */}
      <section className="rounded-xl border border-zinc-200/80 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">POIs</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Each row drives one search. Keyword feeds the search query;
              POI label is what the activity rows get tagged with in the DB.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setPois((p) => [...p, { destination: '', keyword: '', poi: '' }])
            }
          >
            + Add POI
          </Button>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 text-xs uppercase tracking-wide text-zinc-500 px-1">
            <div className="col-span-3">Destination</div>
            <div className="col-span-4">Keyword (search query)</div>
            <div className="col-span-4">POI label</div>
            <div className="col-span-1" />
          </div>
          {pois.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <Input
                name="poi_destination"
                placeholder="tokyo"
                defaultValue={row.destination}
                className="col-span-3"
              />
              <Input
                name="poi_keyword"
                placeholder="mt fuji"
                defaultValue={row.keyword}
                className="col-span-4"
                required={i === 0}
              />
              <Input
                name="poi_label"
                placeholder="Mount Fuji"
                defaultValue={row.poi}
                className="col-span-4"
                required={i === 0}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-1 text-rose-600 hover:text-rose-700"
                onClick={() => setPois((p) => p.filter((_, j) => j !== i))}
                disabled={pois.length === 1}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Competitors ---------------------------------------------- */}
      <section className="rounded-xl border border-zinc-200/80 bg-white p-5">
        <h3 className="text-sm font-semibold mb-3">Competitors</h3>
        <div className="flex flex-wrap gap-2">
          {ALL_PLATFORMS.map((p) => {
            const on = competitors.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => toggleCompetitor(p)}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  on
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-400'
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
        {/* Hidden inputs to ship checked state to the server action */}
        {Array.from(competitors).map((p) => (
          <input key={p} type="hidden" name="competitor" value={p} />
        ))}
      </section>

      {/* Tunables ------------------------------------------------- */}
      <section className="rounded-xl border border-zinc-200/80 bg-white p-5">
        <h3 className="text-sm font-semibold mb-3">Tunables</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              Limit per platform
            </span>
            <Input
              name="limit_per_platform"
              type="number"
              min={1}
              max={200}
              defaultValue={initial.limit_per_platform}
              className="mt-1"
            />
            <span className="text-[11px] text-zinc-400 mt-1 block">
              Top-N to enrich on scan. 30–100 is sensible.
            </span>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              Pin top N
            </span>
            <Input
              name="pin_top"
              type="number"
              min={1}
              max={50}
              defaultValue={initial.pin_top ?? 5}
              className="mt-1"
            />
            <span className="text-[11px] text-zinc-400 mt-1 block">
              How many activities to pin per (POI, platform) for daily price refresh.
            </span>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              Sort
            </span>
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reviews">reviews (popular first)</SelectItem>
                <SelectItem value="recommended">recommended (API order)</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="sort" value={sort} />
          </label>
          <label className="flex items-start gap-2 mt-6">
            <input
              type="checkbox"
              name="screenshot"
              defaultChecked={initial.screenshot ?? false}
              className="mt-0.5"
            />
            <span className="text-sm">
              Capture screenshots
              <span className="block text-[11px] text-zinc-400">
                Adds ~2s per activity. Useful for audit but not required.
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Save ----------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-500">
          {updatedAt ? (
            <>
              Last edit:{' '}
              <span className="font-mono">{new Date(updatedAt).toLocaleString()}</span>
              {updatedBy ? <span className="text-zinc-400"> · by {updatedBy}</span> : null}
            </>
          ) : (
            <span>No edit yet — saving will create the first revision.</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {state?.ok === true ? (
            <Badge className="bg-emerald-100 text-emerald-800 border-transparent">
              saved {new Date(state.updated_at).toLocaleTimeString()}
            </Badge>
          ) : null}
          {state?.ok === false ? (
            <span className="text-sm text-rose-600">{state.error}</span>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save config'}
          </Button>
        </div>
      </div>
    </form>
  );
}
