import { Suspense } from 'react';
import { LoginCard } from './login-card';
import { AuroraBackground } from '@/components/ui/aurora-background';

export const metadata = {
  title: 'Sign in — CSI',
};

export default function LoginPage() {
  return (
    <AuroraBackground>
      <div className="relative z-10 flex flex-col items-center gap-6 px-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold tracking-tight bg-black text-white px-2 py-0.5 rounded">
            CSI
          </span>
          <span className="text-zinc-500 text-sm font-medium">
            Competitor Monitor
          </span>
        </div>
        <Suspense fallback={null}>
          <LoginCard />
        </Suspense>
      </div>
    </AuroraBackground>
  );
}
