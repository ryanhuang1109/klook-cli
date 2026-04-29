import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isCurrentUserAdmin } from '@/lib/data';
import { TopbarUser } from './topbar-user';
import { TopbarNav, type NavItem } from './topbar-nav';

const PRIMARY_NAV: NavItem[] = [
  { href: '/activities', label: 'Activities' },
  { href: '/packages', label: 'Packages' },
  { href: '/skus', label: 'SKUs' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/runs', label: 'Runs' },
  { href: '/logs', label: 'Logs' },
  { href: '/schedule', label: 'Schedule' },
];

export async function Topbar() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const admin = await isCurrentUserAdmin();
  const adminChildren = [
    { href: '/archive', label: 'Archive' },
    ...(admin ? [{ href: '/whitelist', label: 'Whitelist' }] : []),
  ];
  const links: NavItem[] = [...PRIMARY_NAV, { label: 'Admin', children: adminChildren }];

  type Meta = {
    name?: string;
    full_name?: string;
    avatar_url?: string;
    picture?: string;
  };
  const meta = (user?.user_metadata ?? {}) as Meta;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-5">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-sm font-bold tracking-tight bg-zinc-900 text-white px-2 py-0.5 rounded">
            CSI
          </span>
          <span className="text-zinc-400 text-sm font-medium hidden sm:inline">
            Competitor Monitor
          </span>
        </Link>

        <TopbarNav links={links} />

        <TopbarUser
          email={user?.email ?? null}
          name={meta.name ?? meta.full_name ?? user?.email ?? null}
          avatarUrl={meta.avatar_url ?? meta.picture ?? null}
        />
      </div>
    </header>
  );
}
