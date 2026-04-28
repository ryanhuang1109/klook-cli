'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function AuroraBackground({
  className,
  children,
  showRadialGradient = true,
}: {
  className?: string;
  children?: ReactNode;
  showRadialGradient?: boolean;
}) {
  return (
    <main
      className={cn(
        'relative flex flex-col h-[100vh] items-center justify-center bg-zinc-50 dark:bg-zinc-900 text-slate-950 transition-bg',
        className,
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={cn(
            // Aurora layer — two gradients blended via blur + opacity
            'pointer-events-none absolute -inset-[10px] opacity-50 will-change-transform',
            '[--white-gradient:repeating-linear-gradient(100deg,var(--color-white)_0%,var(--color-white)_7%,transparent_10%,transparent_12%,var(--color-white)_16%)]',
            '[--dark-gradient:repeating-linear-gradient(100deg,var(--color-zinc-900)_0%,var(--color-zinc-900)_7%,transparent_10%,transparent_12%,var(--color-zinc-900)_16%)]',
            '[--aurora:repeating-linear-gradient(100deg,var(--color-blue-500)_10%,var(--color-indigo-300)_15%,var(--color-blue-300)_20%,var(--color-violet-200)_25%,var(--color-blue-400)_30%)]',
            '[background-image:var(--white-gradient),var(--aurora)] dark:[background-image:var(--dark-gradient),var(--aurora)]',
            '[background-size:300%,_200%] [background-position:50%_50%,50%_50%]',
            'after:absolute after:inset-0 after:[background-image:var(--white-gradient),var(--aurora)] dark:after:[background-image:var(--dark-gradient),var(--aurora)] after:[background-size:200%,_100%] after:[background-attachment:fixed] after:mix-blend-difference',
            'aurora-animate filter blur-[10px] invert dark:invert-0',
            showRadialGradient &&
              '[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,var(--transparent)_70%)]',
          )}
        />
      </div>
      {children}
      <style>{`
        @keyframes aurora {
          0%   { background-position: 50% 50%, 50% 50%; }
          100% { background-position: 350% 50%, 350% 50%; }
        }
        .aurora-animate { animation: aurora 60s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .aurora-animate { animation: none; }
        }
      `}</style>
    </main>
  );
}
