'use client';

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
  if (!email) return null;

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
        <form action="/auth/signout" method="post">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              (e.currentTarget.closest('form') as HTMLFormElement | null)?.requestSubmit();
            }}
          >
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
