import type { Platform } from '@/lib/data';

const PLATFORM_LABEL: Record<Platform, string> = {
  klook: 'Klook',
  trip: 'Trip.com',
  getyourguide: 'GetYourGuide',
  kkday: 'KKday',
  airbnb: 'Airbnb',
};

/**
 * Renders the OTA logo as a small square image. Files live in
 * web/public/logos/<platform>.webp — see also OTA-Logos/ in the repo
 * root for the source assets.
 */
export function PlatformLogo({
  platform,
  size = 16,
  className,
}: {
  platform: Platform;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/logos/${platform}.webp`}
      alt={`${PLATFORM_LABEL[platform]} logo`}
      width={size}
      height={size}
      className={`rounded-[3px] object-cover shrink-0 ${className ?? ''}`}
      loading="lazy"
    />
  );
}
