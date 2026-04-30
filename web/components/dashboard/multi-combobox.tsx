'use client';

import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export type ComboOption = { value: string; label: string };

export type MultiComboboxProps = {
  options: ComboOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Width on the trigger; popover matches it. */
  width?: string;
  /** Custom empty-search message. */
  emptyMessage?: string;
};

/**
 * Multi-select combobox: trigger button + popover with search input + checkbox list.
 * No external deps — uses click-outside + Escape to close.
 *
 * Trigger label policy:
 *  - 0 selected: placeholder
 *  - 1 selected: that label
 *  - 2+ selected: "N selected"
 * On the trigger we also expose an inline ✕ to clear all selections without
 * opening the popover.
 */
export function MultiCombobox({
  options,
  value,
  onChange,
  placeholder = 'All',
  width = 'w-[260px]',
  emptyMessage = 'No matches.',
}: MultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      // Slight delay so the popover is mounted before we focus.
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
    setQuery('');
  }, [open]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(v: string) {
    const next = new Set(value);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // Preserve the option order to keep URL stable across toggles
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  }

  function clearAll(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  const triggerLabel =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? value[0]
        : `${value.length} selected`;

  return (
    <div ref={ref} className={`relative ${width}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full h-9 px-3 inline-flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
      >
        <span className={`truncate ${value.length === 0 ? 'text-zinc-500' : ''}`}>
          {triggerLabel}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {value.length > 0 ? (
            <span
              role="button"
              tabIndex={0}
              onClick={clearAll}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') clearAll(e as unknown as React.MouseEvent);
              }}
              aria-label="Clear selection"
              className="rounded-full p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <ChevronsUpDown className="h-3.5 w-3.5 text-zinc-400" />
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 mt-1 w-full rounded-md border border-zinc-200 bg-white shadow-lg z-30 overflow-hidden"
        >
          <div className="border-b border-zinc-100 p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full h-8 px-2 text-sm bg-zinc-50 rounded outline-none focus:ring-2 focus:ring-zinc-200"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-500">{emptyMessage}</div>
            ) : (
              filtered.map((o) => {
                const checked = selectedSet.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(o.value)}
                    className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-sm hover:bg-zinc-50 ${
                      checked ? 'text-zinc-900' : 'text-zinc-700'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                        checked ? 'bg-zinc-900 border-zinc-900 text-white' : 'border-zinc-300 bg-white'
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
