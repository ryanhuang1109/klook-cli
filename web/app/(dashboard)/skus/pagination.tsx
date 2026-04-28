'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export function SkusPagination({ page, totalPages }: { page: number; totalPages: number }) {
  const sp = useSearchParams();

  const hrefFor = (p: number) => {
    const next = new URLSearchParams(sp.toString());
    if (p <= 1) next.delete('page');
    else next.set('page', String(p));
    const qs = next.toString();
    return qs ? `?${qs}` : '?';
  };

  return (
    <div className="flex items-center justify-between text-sm text-zinc-600">
      <span>
        Page <span className="font-medium tabular-nums">{page}</span> of{' '}
        <span className="tabular-nums">{totalPages}</span>
      </span>
      <div className="flex items-center gap-1">
        <PageLink disabled={page === 1} href={hrefFor(1)}>« First</PageLink>
        <PageLink disabled={page === 1} href={hrefFor(page - 1)}>‹ Prev</PageLink>
        <PageLink disabled={page === totalPages} href={hrefFor(page + 1)}>Next ›</PageLink>
        <PageLink disabled={page === totalPages} href={hrefFor(totalPages)}>Last »</PageLink>
      </div>
    </div>
  );
}

function PageLink({ disabled, href, children }: { disabled: boolean; href: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <span className="px-3 h-8 inline-flex items-center rounded-md text-xs text-zinc-400">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      className="px-3 h-8 inline-flex items-center rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 text-xs"
    >
      {children}
    </Link>
  );
}
