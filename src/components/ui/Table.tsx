import React from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  getPaginationRowModel,
  getSortedRowModel,
} from '@tanstack/react-table'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { classNames } from '../../lib/utils'
import { ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

interface TableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  loading?: boolean
  className?: string
  skeletonRows?: number
}

export function Table<TData, TValue>({
  columns,
  data,
  loading = false,
  className,
  skeletonRows = 5,
}: TableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: {
      pagination: { pageSize: 20 },
    },
  })

  return (
    <div className={classNames('w-full', className)}>
      <div className="overflow-x-auto rounded-t-xl border border-border bg-surface">
        <table className="w-full text-sm text-left">
          <thead className="bg-elevated text-text-secondary border-b border-border">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      className="px-6 py-4 font-medium whitespace-nowrap"
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          {...{
                            className: header.column.getCanSort()
                              ? 'cursor-pointer select-none flex items-center gap-2 hover:text-text-primary transition-colors'
                              : 'flex items-center gap-2',
                            onClick: header.column.getToggleSortingHandler(),
                          }}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {{
                            asc: <ChevronUp className="w-4 h-4 ml-1" />,
                            desc: <ChevronDown className="w-4 h-4 ml-1" />,
                          }[header.column.getIsSorted() as string] ??
                            (header.column.getCanSort() ? (
                              <ChevronsUpDown className="w-4 h-4 ml-1 opacity-20" />
                            ) : null)}
                        </div>
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border/50">
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i} className="hover:bg-elevated/30 transition-colors">
                  {columns.map((_, colIdx) => (
                    <td key={colIdx} className="px-6 py-4">
                      <div className="h-4 w-3/4 skeleton rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-elevated/50 transition-colors group"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-6 py-4 text-text-primary">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-24 text-center">
                  <span className="text-text-muted">Nenhum resultado encontrado.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      <div className="flex items-center justify-between px-6 py-3 border border-t-0 border-border bg-elevated rounded-b-xl">
        <div className="text-sm text-text-secondary">
          Página {table.getState().pagination.pageIndex + 1} de{' '}
          {table.getPageCount() || 1}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="p-1 rounded-lg border border-border bg-surface text-text-secondary hover:text-text-primary hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage() || loading}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            className="p-1 rounded-lg border border-border bg-surface text-text-secondary hover:text-text-primary hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage() || loading}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
