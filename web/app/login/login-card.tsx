'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

export function LoginCard() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const oauthError = params.get('error');
  const [pending, setPending] = useState(false);

  async function handleGoogle() {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm border-zinc-200/80 bg-white/80 backdrop-blur-md shadow-xl">
      <CardContent className="p-8 space-y-5">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-500">
            Use your authorized corporate Google account.
          </p>
        </div>

        <Button
          type="button"
          onClick={handleGoogle}
          disabled={pending}
          variant="outline"
          className="w-full h-10 gap-2"
        >
          <GoogleIcon />
          {pending ? 'Redirecting…' : 'Continue with Google'}
        </Button>

        {oauthError ? (
          <p className="text-xs text-red-600">
            Sign-in didn&apos;t complete. Try again.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A10.99 10.99 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
