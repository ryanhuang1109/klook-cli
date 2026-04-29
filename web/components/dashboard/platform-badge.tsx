import { Badge } from '@/components/ui/badge';
import { PlatformLogo } from './platform-logo';
import type { Platform } from '@/lib/data';

const TONE: Record<Platform, string> = {
  klook: 'bg-orange-100 text-orange-800 hover:bg-orange-100 border-transparent',
  trip: 'bg-blue-100 text-blue-800 hover:bg-blue-100 border-transparent',
  getyourguide: 'bg-pink-100 text-pink-800 hover:bg-pink-100 border-transparent',
  kkday: 'bg-violet-100 text-violet-800 hover:bg-violet-100 border-transparent',
  airbnb: 'bg-rose-100 text-rose-800 hover:bg-rose-100 border-transparent',
};

const LABEL: Record<Platform, string> = {
  klook: 'Klook',
  trip: 'Trip.com',
  getyourguide: 'GYG',
  kkday: 'KKday',
  airbnb: 'Airbnb',
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  const tone = TONE[platform] ?? 'bg-zinc-100 text-zinc-800 hover:bg-zinc-100 border-transparent';
  return (
    <Badge className={`gap-1 pl-1 pr-2 ${tone}`}>
      <PlatformLogo platform={platform} size={14} />
      {LABEL[platform] ?? platform}
    </Badge>
  );
}
