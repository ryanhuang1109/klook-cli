'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function TopbarNav({
  links,
}: {
  links: Array<{ href: string; label: string }>;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto flex-1">
      {links.map((n) => {
        const isActive = pathname === n.href || pathname.startsWith(n.href + '/');
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`px-3 h-8 inline-flex items-center rounded-md text-sm whitespace-nowrap transition-colors ${
              isActive
                ? 'bg-zinc-900 text-white font-medium'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
