import { ArrowUpRight } from 'lucide-react';
import { PlatformLogo } from './platform-logo';
import type { Platform } from '@/lib/data';

const PLATFORM_LABEL: Record<Platform, string> = {
  klook: 'Klook',
  trip: 'Trip.com',
  getyourguide: 'GetYourGuide',
  kkday: 'KKday',
  airbnb: 'Airbnb',
};

const PLATFORM_TONE: Record<Platform, string> = {
  klook: 'bg-orange-500 text-white hover:bg-orange-600',
  trip: 'bg-blue-600 text-white hover:bg-blue-700',
  getyourguide: 'bg-pink-600 text-white hover:bg-pink-700',
  kkday: 'bg-violet-600 text-white hover:bg-violet-700',
  airbnb: 'bg-rose-600 text-white hover:bg-rose-700',
};

/**
 * Tinted "open on Klook / Trip.com / etc." button — used in the activity
 * dialog header so people can jump to the original listing without
 * hunting for the URL line. Logo on the left, ArrowUpRight on the right.
 */
export function PlatformLinkButton({
  platform,
  href,
  className,
}: {
  platform: Platform;
  href: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 h-9 px-3 rounded-md text-sm font-medium transition-colors ${PLATFORM_TONE[platform]} ${className ?? ''}`}
    >
      <PlatformLogo platform={platform} size={18} className="border border-white/30" />
      <span>Open on {PLATFORM_LABEL[platform]}</span>
      <ArrowUpRight className="size-4 opacity-90" />
    </a>
  );
}
