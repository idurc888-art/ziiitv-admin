import React, { useState, useEffect } from 'react'
import { Header } from '../components/layout/Header'
import { Table } from '../components/ui/Table'
import { Search, MonitorPlay } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { formatRelativeTime, formatDuration } from '../lib/utils'
import { supabaseAdmin } from '../lib/supabase'

interface WatchRow {
  id: number
  channel_name: string
  user_email: string
  duration_seconds: number
  progress_pct: number
  watched_at: string
}

export function WatchHistory() {
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<WatchRow[]>([])

  useEffect(() => {
    async function load() {
      const { data: events } = await supabaseAdmin
        .from('watch_events')
        .select('id, user_id, channel_name, duration_seconds, progress_pct, watched_at')
        .order('watched_at', { ascending: false })
        .limit(200)

      if (!events || events.length === 0) {
        setLoading(false)
        return
      }

      // Fetch user emails in a single batch
      const userIds = [...new Set(events.map(e => e.user_id).filter(Boolean))]
      const emailMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: userRows } = await supabaseAdmin
          .from('users')
          .select('id, email')
          .in('id', userIds)
        for (const u of (userRows || [])) emailMap[u.id] = u.email
      }

      setHistory(events.map(e => ({
        id:               e.id,
        channel_name:     e.channel_name,
        user_email:       emailMap[e.user_id] || '—',
        duration_seconds: e.duration_seconds ?? 0,
        progress_pct:     e.progress_pct ?? 0,
        watched_at:       e.watched_at,
      })))
      setLoading(false)
    }
    load()
  }, [])

  const filtered = history.filter(h =>
    h.channel_name.toLowerCase().includes(search.toLowerCase()) ||
    h.user_email.toLowerCase().includes(search.toLowerCase())
  )

  const columns: ColumnDef<WatchRow>[] = [
    {
      accessorKey: 'user_email',
      header: 'Usuário',
      cell: ({ row }) => <span className="font-medium text-text-primary">{row.original.user_email}</span>,
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
      ),
    },
    {
      accessorKey: 'duration_seconds',
      header: 'Duração',
      cell: ({ row }) => <span className="text-text-secondary">{formatDuration(row.original.duration_seconds)}</span>,
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
      ),
    },
    {
      accessorKey: 'watched_at',
      header: 'Quando',
      cell: ({ row }) => (
        <span className="text-sm text-text-secondary" title={new Date(row.original.watched_at).toLocaleString('pt-BR')}>
          {formatRelativeTime(row.original.watched_at)}
        </span>
      ),
    },
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
      <Table data={filtered} columns={columns} loading={loading} />
    </div>
  )
}
