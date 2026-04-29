'use client';

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type Row,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const STORAGE_PREFIX = 'csi.table.sizing.';

export type DataTableProps<T> = {
  /** Stable id used for persisting column widths in localStorage. */
  storageKey: string;
  data: T[];
  columns: ColumnDef<T, unknown>[];
  emptyMessage?: string;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** Override the table-element class (e.g. min-w for very wide tables). */
  tableClassName?: string;
};

/**
 * Read columns from localStorage on mount.
 *
 * Note: this returns `{}` on the server render, then loads stored sizes after
 * hydration. The brief flash of default widths is acceptable for an internal
 * tool — keeping the initial render deterministic avoids hydration warnings.
 */
function useColumnSizing(storageKey: string) {
  const [sizing, setSizing] = useState<ColumnSizingState>({});
  const fullKey = STORAGE_PREFIX + storageKey;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw) setSizing(JSON.parse(raw));
    } catch {
      // localStorage can be blocked in private browsing — fall through to defaults
    }
  }, [fullKey]);

  useEffect(() => {
    if (Object.keys(sizing).length === 0) return;
    try {
      localStorage.setItem(fullKey, JSON.stringify(sizing));
    } catch { /* ignore quota / privacy errors */ }
  }, [sizing, fullKey]);

  return [sizing, setSizing] as const;
}

export function DataTable<T>({
  storageKey,
  data,
  columns,
  emptyMessage = 'No rows.',
  rowKey,
  onRowClick,
  tableClassName,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useColumnSizing(storageKey);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const totalSize = useMemo(
    () => table.getCenterTotalSize(),
    // re-run when widths change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, columnSizing],
  );

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white overflow-x-auto">
      <table
        style={{ width: totalSize }}
        className={`text-sm ${tableClassName ?? ''}`.trim()}
      >
        <thead className="border-b border-zinc-200/70 bg-zinc-50/50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="relative h-10 px-3 text-left align-middle text-xs font-medium text-zinc-500 select-none"
                  >
                    <div
                      className={`flex items-center gap-1 ${
                        canSort ? 'cursor-pointer hover:text-zinc-900' : ''
                      }`}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort ? (
                        <span className="text-zinc-400">
                          {sorted === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-50" />
                          )}
                        </span>
                      ) : null}
                    </div>
                    {header.column.getCanResize() ? (
                      <ResizeHandle
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        active={header.column.getIsResizing()}
                      />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <DataRow
              key={rowKey(row.original)}
              row={row}
              onRowClick={onRowClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataRow<T>({
  row,
  onRowClick,
}: {
  row: Row<T>;
  onRowClick?: (row: T) => void;
}) {
  const clickable = !!onRowClick;
  return (
    <tr
      onClick={clickable ? () => onRowClick(row.original) : undefined}
      className={`border-b border-zinc-100 last:border-b-0 ${
        clickable ? 'cursor-pointer hover:bg-zinc-50' : ''
      }`}
    >
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          style={{ width: cell.column.getSize() }}
          className="px-3 py-2 align-middle overflow-hidden"
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

function ResizeHandle({
  onMouseDown,
  onTouchStart,
  active,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onClick={(e) => e.stopPropagation()}
      aria-label="Resize column"
      className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none ${
        active ? 'bg-blue-500' : 'bg-transparent hover:bg-zinc-300'
      }`}
    />
  );
}
