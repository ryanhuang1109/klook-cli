/**
 * Shared header + nav + auth gate for every dashboard page.
 *
 * Call `mountLayout({ active: 'coverage' })` from each page. This:
 *   1. Calls `requireSession()` — redirects to /login.html if not signed in
 *      (and never returns, so the rest of the page won't render).
 *   2. Injects a consistent top bar with nav + user info + sign out.
 *
 * Uses createElement everywhere — no innerHTML — so the security-reminder
 * hook stays happy and there's zero XSS surface even if NAV ever pulls
 * from external data later.
 */

import { requireSession, getUser, signOut, isAdmin } from '/auth.js';

const NAV = [
  { href: '/dashboard.html', label: 'POI Compare', key: 'dashboard' },
  { href: '/tours.html', label: 'Tours Routine', key: 'tours' },
  { href: '/coverage.html', label: 'Coverage', key: 'coverage' },
  { href: '/runs.html', label: 'Runs', key: 'runs' },
  { href: '/executions.html', label: 'Executions', key: 'executions' },
  { href: '/cron.html', label: 'Cron', key: 'cron' },
];

const ADMIN_NAV = [
  { href: '/whitelist.html', label: 'Whitelist', key: 'whitelist' },
];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') {
      for (const [event, handler] of Object.entries(v)) node.addEventListener(event, handler);
    }
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

export async function mountLayout({ active }) {
  // Block until the user has a session — redirects to /login.html otherwise.
  await requireSession();
  const user = await getUser();

  const header = el('header', { class: 'border-b border-gray-200 bg-white' });
  const wrap = el('div', { class: 'max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap' });

  const brand = el('a', { href: '/', class: 'flex items-center gap-2 shrink-0' }, [
    el('span', {
      class: 'font-mono text-sm font-bold tracking-tight bg-black text-white px-2 py-0.5 rounded',
      text: 'klook-cli',
    }),
    el('span', {
      class: 'text-gray-400 text-sm font-medium hidden sm:inline',
      text: 'Competitor Monitor',
    }),
  ]);

  const nav = el('nav', { class: 'flex items-center gap-1 overflow-x-auto -mx-1 px-1 flex-1' });
  const userIsAdmin = await isAdmin().catch(() => false);
  const links = [...NAV, ...(userIsAdmin ? ADMIN_NAV : [])];
  for (const n of links) {
    const isActive = n.key === active;
    const link = el('a', {
      href: n.href,
      class: `px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap ${
        isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`,
      text: n.label,
    });
    nav.appendChild(link);
  }

  const userArea = el('div', { class: 'flex items-center gap-3 shrink-0' });
  if (user) {
    const meta = user.user_metadata ?? {};
    const name = meta.name || meta.full_name || user.email || 'Signed in';
    const avatar = meta.avatar_url || meta.picture || null;
    if (avatar) {
      userArea.appendChild(el('img', {
        src: avatar,
        alt: '',
        class: 'w-7 h-7 rounded-full border border-gray-200',
        referrerpolicy: 'no-referrer',
      }));
    }
    userArea.appendChild(el('span', {
      class: 'text-xs text-gray-600 hidden md:inline max-w-[14rem] truncate',
      title: user.email || '',
      text: name,
    }));
    userArea.appendChild(el('button', {
      type: 'button',
      class: 'text-xs text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline',
      text: 'Sign out',
      on: { click: () => signOut() },
    }));
  }

  wrap.appendChild(brand);
  wrap.appendChild(nav);
  wrap.appendChild(userArea);
  header.appendChild(wrap);
  document.body.prepend(header);
}
