import { listWhitelist, isCurrentUserAdmin } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AddEmailForm, RowActions } from './form';

export const metadata = { title: 'Whitelist — CSI' };
export const dynamic = 'force-dynamic';

export default async function WhitelistPage() {
  const [rows, admin] = await Promise.all([
    listWhitelist(),
    isCurrentUserAdmin(),
  ]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Email whitelist</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Only listed emails can sign in. Admins can manage this list.
        </p>
      </div>

      {!admin ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          You are signed in but not an administrator. This page is read-only for non-admins.
        </div>
      ) : (
        <AddEmailForm />
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
          No entries yet.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                <TableHead>Email</TableHead>
                <TableHead className="w-[120px]">Role</TableHead>
                <TableHead>Added by</TableHead>
                <TableHead className="w-[120px]">Created</TableHead>
                {admin ? <TableHead className="w-[160px] text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.email}>
                  <TableCell className="font-mono text-sm">{r.email}</TableCell>
                  <TableCell>
                    {r.is_admin ? (
                      <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100 border-transparent">
                        admin
                      </Badge>
                    ) : (
                      <span className="text-xs text-zinc-500">member</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500 font-mono truncate max-w-[16rem]">
                    {r.added_by ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500 tabular-nums">
                    {fmtDate(r.created_at)}
                  </TableCell>
                  {admin ? (
                    <TableCell className="text-right">
                      <RowActions email={r.email} isAdmin={r.is_admin} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
