import React, { useState, useEffect } from 'react'
import { Header } from '../components/layout/Header'
import { Table } from '../components/ui/Table'
import { Search, MonitorPlay } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import type { WatchEvent } from '../types'
import { formatRelativeTime, formatDuration } from '../lib/utils'

// Mock Data
const mockHistory: WatchEvent[] = [
  { id: 1, user_id: '1', channel_id: '1', channel_name: 'HBO Max', duration_seconds: 7200, progress_pct: 100, watched_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), users: { email: 'mario.silva@gmail.com' } },
  { id: 2, user_id: '2', channel_id: '2', channel_name: 'ESPN Brasil', duration_seconds: 5400, progress_pct: 75, watched_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(), users: { email: 'admin@ziiitv.com' } },
  { id: 3, user_id: '4', channel_id: '3', channel_name: 'Telecine Premium', duration_seconds: 9000, progress_pct: 90, watched_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(), users: { email: 'carlos.tv@outlook.com' } },
  { id: 4, user_id: '4', channel_id: '4', channel_name: 'CNN Brasil', duration_seconds: 3600, progress_pct: 10, watched_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), users: { email: 'carlos.tv@outlook.com' } },
]

export function WatchHistory() {
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(t)
  }, [])

  const filteredHistory = mockHistory.filter(h => 
    h.channel_name.toLowerCase().includes(search.toLowerCase()) || 
    h.users?.email.toLowerCase().includes(search.toLowerCase())
  )

  const columns: ColumnDef<WatchEvent>[] = [
    {
      accessorKey: 'users.email',
      header: 'Usuário',
      cell: ({ row }) => <span className="font-medium text-text-primary">{row.original.users?.email}</span>
    },
    {
      accessorKey: 'channel_name',
      header: 'Conteúdo Assistido',
      cell: ({ row }) => (
        <div className="flex items-center gap-2 max-w-[250px]">
          <MonitorPlay className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="font-medium text-text-primary truncate" title={row.original.channel_name}>
            {row.original.channel_name}
          </span>
        </div>
      )
    },
    {
      accessorKey: 'duration_seconds',
      header: 'Duração',
      cell: ({ row }) => <span className="text-text-secondary">{formatDuration(row.original.duration_seconds)}</span>
    },
    {
      accessorKey: 'progress_pct',
      header: 'Progresso',
      cell: ({ row }) => (
        <div className="flex items-center gap-3 w-32">
          <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden border border-border">
            <div 
              className="h-full bg-accent rounded-full" 
              style={{ width: `${Math.min(100, Math.max(0, row.original.progress_pct))}%` }}
            />
          </div>
          <span className="text-xs font-medium text-text-muted w-8">{row.original.progress_pct}%</span>
        </div>
      )
    },
    {
      accessorKey: 'watched_at',
      header: 'Quando',
      cell: ({ row }) => (
        <span className="text-sm text-text-secondary" title={new Date(row.original.watched_at).toLocaleString()}>
          {formatRelativeTime(row.original.watched_at)}
        </span>
      )
    }
  ]

  return (
    <div className="animate-in fade-in duration-500">
      <Header 
        title="Histórico de Visualização" 
        description="Acompanhe o que os usuários estão assistindo em tempo real."
        action={
          <div className="flex bg-surface border border-border rounded-lg px-3 py-2 text-sm w-full sm:w-64">
            <Search className="w-4 h-4 text-text-muted mr-2 flex-shrink-0 mt-0.5" />
            <input 
              type="text" 
              placeholder="Buscar usuário ou canal..."
              className="bg-transparent border-none outline-none w-full text-text-primary placeholder:text-text-muted"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        }
      />

      <Table 
        data={filteredHistory} 
        columns={columns} 
        loading={loading}
      />
    </div>
  )
}
