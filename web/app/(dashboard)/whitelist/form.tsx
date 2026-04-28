'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addEmail, removeEmail, toggleAdmin } from './actions';

export function AddEmailForm() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function action(formData: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res = await addEmail(formData);
      if (res.ok) {
        setMsg({ tone: 'ok', text: 'Added.' });
        const form = document.getElementById('add-email-form') as HTMLFormElement | null;
        form?.reset();
      } else {
        setMsg({ tone: 'err', text: res.error ?? 'Failed' });
      }
    });
  }

  return (
    <form
      id="add-email-form"
      action={action}
      className="rounded-xl border border-zinc-200/80 bg-white p-4 space-y-3"
    >
      <h2 className="text-sm font-semibold text-zinc-700">Add email</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          name="email"
          type="email"
          required
          placeholder="someone@klook.com"
          className="flex-1 min-w-[18rem]"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input name="is_admin" type="checkbox" className="w-4 h-4 rounded border-zinc-300" />
          admin
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {msg ? (
        <p className={`text-sm ${msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}

export function RowActions({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="inline-flex items-center gap-2 justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(() => { toggleAdmin(email, !isAdmin); })}
      >
        {isAdmin ? 'Demote' : 'Promote'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
        onClick={() => {
          if (confirm(`Remove ${email}?`)) startTransition(() => { removeEmail(email); });
        }}
      >
        Remove
      </Button>
    </div>
  );
}
