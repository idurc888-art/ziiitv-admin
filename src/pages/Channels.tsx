import React, { useState, useEffect } from 'react'
import { Header } from '../components/layout/Header'
import { Table } from '../components/ui/Table'
import { Button } from '../components/ui/Button'
import { Search, Copy, Tv2, Film, Clapperboard } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import toast from 'react-hot-toast'
import { classNames } from '../lib/utils'
import { supabaseAdmin } from '../lib/supabase'

interface DbChannel {
  id: string
  name: string
  group_name: string | null
  logo_url: string | null
  content_type: string | null
  streaming: string | null
  streams: Array<{ u: string; q: string }> | null
}

const QUALITY_COLORS: Record<string, string> = {
  '4K':  'border-warning/30 text-warning bg-warning/10',
  'FHD': 'border-accent/30 text-accent bg-accent/10',
  'HD':  'border-text-secondary/30 text-text-secondary bg-text-secondary/10',
  'SD':  'border-text-muted/30 text-text-muted bg-text-muted/10',
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  series:  <Clapperboard className="w-4 h-4 text-purple-400" />,
  movie:   <Film className="w-4 h-4 text-blue-400" />,
  live:    <Tv2 className="w-4 h-4 text-green-400" />,
}

const TYPE_LABEL: Record<string, string> = {
  series: 'Série',
  movie:  'Filme',
  live:   'TV ao Vivo',
}

export function Channels() {
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<DbChannel[]>([])

  useEffect(() => {
    async function load() {
      const { data } = await supabaseAdmin
        .from('channels')
        .select('id, name, group_name, logo_url, content_type, streaming, streams')
        .order('name')
        .limit(500)
      setChannels(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = channels.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.group_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.content_type ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url)
    toast.success('URL copiada', { icon: '📋' })
  }

  const columns: ColumnDef<DbChannel>[] = [
    {
      accessorKey: 'name',
      header: 'Canal',
      cell: ({ row }) => {
        const ch = row.original
        const topQuality = ch.streams?.[0]?.q
        return (
          <div className="flex items-center gap-3">
            {ch.logo_url ? (
              <img src={ch.logo_url} alt="" className="w-8 h-8 rounded object-contain bg-base flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded bg-elevated border border-border flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-mono text-text-muted">TV</span>
              </div>
            )}
            <div className="min-w-0">
              <span className="font-medium text-text-primary block truncate">{ch.name}</span>
              {topQuality && (
                <span className={classNames('text-xs font-mono px-1 py-0.5 rounded border', QUALITY_COLORS[topQuality] || QUALITY_COLORS['HD'])}>
                  {topQuality}
                </span>
              )}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'content_type',
      header: 'Tipo',
      cell: ({ row }) => {
        const t = row.original.content_type || 'live'
        return (
          <div className="flex items-center gap-2">
            {TYPE_ICON[t]}
            <span className="text-sm text-text-secondary">{TYPE_LABEL[t] || t}</span>
          </div>
        )
      },
    },
    {
      accessorKey: 'group_name',
      header: 'Grupo',
      cell: ({ row }) => (
        <span className="text-sm text-text-secondary truncate max-w-[150px] block">
          {row.original.group_name || '—'}
        </span>
      ),
    },
    {
      id: 'streams_count',
      header: 'Streams',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted">
          {row.original.streams?.length ?? 0}
        </span>
      ),
    },
    {
      id: 'stream_url',
      header: 'Stream URL',
      cell: ({ row }) => {
        const url = row.original.streams?.[0]?.u
        if (!url) return <span className="text-text-muted text-xs">—</span>
        return (
          <div className="flex items-center gap-2 max-w-[200px]">
            <span className="font-mono text-xs text-text-muted truncate">{url}</span>
            <button
              className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-elevated flex-shrink-0"
              onClick={() => handleCopy(url)}
              title="Copiar URL"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="animate-in fade-in duration-500">
      <Header
        title="Canais Tratados"
        description="Visualize os canais processados — séries, filmes e TV ao vivo"
        action={
          <div className="flex bg-surface border border-border rounded-lg px-3 py-2 text-sm w-full sm:w-64">
            <Search className="w-4 h-4 text-text-muted mr-2 flex-shrink-0 mt-0.5" />
            <input
              type="text"
              placeholder="Buscar canal ou grupo..."
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
