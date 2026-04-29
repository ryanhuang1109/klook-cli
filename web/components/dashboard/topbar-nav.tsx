'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type NavLink = { href: string; label: string };
export type NavItem =
  | NavLink
  | { label: string; children: NavLink[] };

export function TopbarNav({ links }: { links: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto flex-1">
      {links.map((n) =>
        'children' in n ? (
          <NavDropdown key={n.label} label={n.label} children={n.children} pathname={pathname} />
        ) : (
          <NavLinkItem key={n.href} link={n} active={isActive(pathname, n.href)} />
        ),
      )}
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

function NavLinkItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      className={`px-3 h-8 inline-flex items-center rounded-md text-sm whitespace-nowrap transition-colors ${
        active
          ? 'bg-zinc-900 text-white font-medium'
          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
      }`}
    >
      {link.label}
    </Link>
  );
}

function NavDropdown({
  label,
  children,
  pathname,
}: {
  label: string;
  children: NavLink[];
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const groupActive = children.some((c) => isActive(pathname, c.href));

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`px-3 h-8 inline-flex items-center gap-1 rounded-md text-sm whitespace-nowrap transition-colors ${
          groupActive
            ? 'bg-zinc-900 text-white font-medium'
            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
        }`}
      >
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden
          className="opacity-70"
        >
          <path d="M2 4 L6 8 L10 4 Z" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-[160px] rounded-md border border-zinc-200 bg-white shadow-lg py-1 z-40"
        >
          {children.map((c) => {
            const active = isActive(pathname, c.href);
            return (
              <Link
                key={c.href}
                href={c.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block px-3 py-1.5 text-sm whitespace-nowrap ${
                  active
                    ? 'bg-zinc-100 text-zinc-900 font-medium'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
