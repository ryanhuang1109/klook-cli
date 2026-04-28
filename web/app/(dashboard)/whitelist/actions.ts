'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isCurrentUserAdmin } from '@/lib/data';

async function requireAdmin() {
  const admin = await isCurrentUserAdmin();
  if (!admin) throw new Error('Forbidden: admin only');
}

export async function addEmail(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const isAdmin = formData.get('is_admin') === 'on';
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Invalid email' };
  }
  const sb = await createClient();
  const { error } = await sb.from('email_whitelist').insert({
    email,
    is_admin: isAdmin,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/whitelist');
  return { ok: true };
}

export async function removeEmail(email: string) {
  await requireAdmin();
  const sb = await createClient();
  const { error } = await sb.from('email_whitelist').delete().eq('email', email);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/whitelist');
  return { ok: true };
}

export async function toggleAdmin(email: string, isAdmin: boolean) {
  await requireAdmin();
  const sb = await createClient();
  const { error } = await sb
    .from('email_whitelist')
    .update({ is_admin: isAdmin })
    .eq('email', email);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/whitelist');
  return { ok: true };
}
