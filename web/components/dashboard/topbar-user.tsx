'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function TopbarUser({
  email,
  name,
  avatarUrl,
}: {
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}) {
  const [signingOut, setSigningOut] = useState(false);

  if (!email) return null;

  // Hit the POST endpoint directly and redirect on success. We can't use a
  // <form> inside DropdownMenuContent — Radix portals the content out of the
  // DOM tree, which strips the form ancestor and closest('form') returns null.
  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const res = await fetch('/auth/signout', { method: 'POST' });
      window.location.href = res.redirected ? res.url : '/login';
    } catch {
      // Network failure — surface to user via the same redirect path so the
      // session cookie at least gets cleared on the server's next request.
      window.location.href = '/login';
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 shrink-0 rounded-full hover:bg-zinc-100 px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-zinc-300">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="w-7 h-7 rounded-full border border-zinc-200"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-200 grid place-items-center text-xs font-medium text-zinc-600">
            {(name ?? email).slice(0, 1).toUpperCase()}
          </div>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium truncate">{name ?? email}</div>
          {name && name !== email ? (
            <div className="text-xs text-zinc-500 truncate">{email}</div>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleSignOut();
          }}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
