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
  { href: '/activities.html', label: 'Activities', key: 'activities' },
  { href: '/coverage.html', label: 'Coverage', key: 'coverage' },
  { href: '/runs.html', label: 'Runs', key: 'runs' },
  { href: '/executions.html', label: 'Executions', key: 'executions' },
  { href: '/cron.html', label: 'Cron', key: 'cron' },
  { href: '/archive.html', label: 'Archive', key: 'archive' },
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
  const wrap = el('div', { class: 'max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap' });

  const brand = el('a', { href: '/', class: 'flex items-center gap-2 shrink-0' }, [
    el('span', {
      class: 'font-mono text-sm font-bold tracking-tight bg-black text-white px-2 py-0.5 rounded',
      text: 'CSI',
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

  const userArea = el('div', { class: 'relative shrink-0' });
  if (user) {
    const meta = user.user_metadata ?? {};
    const name = meta.name || meta.full_name || user.email || 'Signed in';
    const avatar = meta.avatar_url || meta.picture || null;

    const triggerChildren = [];
    if (avatar) {
      triggerChildren.push(el('img', {
        src: avatar,
        alt: '',
        class: 'w-7 h-7 rounded-full border border-gray-200',
        referrerpolicy: 'no-referrer',
      }));
    } else {
      triggerChildren.push(el('div', {
        class: 'w-7 h-7 rounded-full bg-gray-200 grid place-items-center text-xs font-medium text-gray-600',
        text: (name || 'U').slice(0, 1).toUpperCase(),
      }));
    }
    triggerChildren.push(el('span', {
      class: 'text-xs text-gray-700 hidden md:inline max-w-[14rem] truncate',
      title: user.email || '',
      text: name,
    }));

    const panel = el('div', {
      class: 'hidden absolute right-0 top-full mt-2 w-56 rounded-lg border border-gray-200 bg-white shadow-lg z-40 py-1',
      role: 'menu',
    });

    // Header: name + email (if different)
    panel.appendChild(el('div', { class: 'px-3 py-2 border-b border-gray-100' }, [
      el('div', { class: 'text-sm font-medium truncate', text: name }),
      ...(name !== user.email && user.email
        ? [el('div', { class: 'text-xs text-gray-500 truncate', text: user.email })]
        : []),
    ]));

    panel.appendChild(el('button', {
      type: 'button',
      role: 'menuitem',
      class: 'block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50',
      text: 'Sign out',
      on: { click: () => signOut() },
    }));

    const trigger = el('button', {
      type: 'button',
      class: 'flex items-center gap-2 rounded-full hover:bg-gray-100 px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-gray-300',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      on: {
        click: (e) => {
          e.stopPropagation();
          const isOpen = !panel.classList.contains('hidden');
          panel.classList.toggle('hidden', isOpen);
          trigger.setAttribute('aria-expanded', String(!isOpen));
        },
      },
    }, triggerChildren);

    // Click outside or press Escape closes the dropdown.
    document.addEventListener('click', (e) => {
      if (!userArea.contains(e.target)) {
        panel.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        panel.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    userArea.appendChild(trigger);
    userArea.appendChild(panel);
  }

  wrap.appendChild(brand);
  wrap.appendChild(nav);
  wrap.appendChild(userArea);
  header.appendChild(wrap);
  document.body.prepend(header);
}
