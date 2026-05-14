import React, { useState, useEffect } from 'react'
import { Header } from '../components/layout/Header'
import { Table } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Search, Copy, CheckCircle2, XCircle, ShieldOff } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import type { Channel } from '../types'
import toast from 'react-hot-toast'
import { classNames } from '../lib/utils'

// Mock Data
const mockChannels: Channel[] = [
  { id: '1', playlist_id: '1', user_id: '1', name: 'HBO Max', group_name: 'Filmes', quality: 'FHD', stream_url: 'http://my-provider.tv/live/joao/123/111.ts', active: true, created_at: '2024-03-22T09:15:00Z', canonical_id: 'hbo-max', logo_url: 'http://my-provider.tv/logs/hbo.png' },
  { id: '2', playlist_id: '1', user_id: '1', name: 'ESPN Brasil', group_name: 'Esportes', quality: 'HD', stream_url: 'http://my-provider.tv/live/joao/123/222.ts', active: true, created_at: '2024-03-22T09:15:00Z', canonical_id: 'espn-br', logo_url: null },
  { id: '3', playlist_id: '2', user_id: '4', name: 'Telecine Premium', group_name: 'Filmes', quality: '4K', stream_url: 'http://my-provider.tv/live/joao/123/333.ts', active: false, created_at: '2024-03-26T14:05:00Z', canonical_id: 'tc-premium', logo_url: null },
  { id: '4', playlist_id: '1', user_id: '1', name: 'CNN Brasil', group_name: 'Notícias', quality: 'SD', stream_url: 'http://my-provider.tv/live/joao/123/444.ts', active: true, created_at: '2024-03-22T09:15:00Z', canonical_id: 'cnn-br', logo_url: null },
]

export function Channels() {
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(t)
  }, [])

  const filteredChannels = mockChannels.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.group_name?.toLowerCase().includes(search.toLowerCase())
  )

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url)
    toast.success('URL copiada para a área de transferência', { 
      icon: '📋',
      style: { maxWidth: '500px' } 
    })
  }

  const columns: ColumnDef<Channel>[] = [
    {
      accessorKey: 'name',
      header: 'Canal',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          {row.original.logo_url ? (
            <img src={row.original.logo_url} alt="Logo" className="w-8 h-8 rounded object-contain bg-base" />
          ) : (
            <div className="w-8 h-8 rounded bg-elevated border border-border flex items-center justify-center">
              <span className="text-xs font-mono text-text-muted">TV</span>
            </div>
          )}
          <span className={classNames('font-medium', row.original.active ? 'text-text-primary' : 'text-text-muted line-through')}>
            {row.original.name}
          </span>
        </div>
      )
    },
    {
      accessorKey: 'group_name',
      header: 'Grupo',
      cell: ({ row }) => <span className="text-text-secondary">{row.original.group_name || 'Sem Categoria'}</span>
    },
    {
      accessorKey: 'quality',
      header: 'Qualidade',
      cell: ({ row }) => {
        const q = row.original.quality
        if (!q) return <span className="text-text-muted">—</span>
        return (
          <span className={classNames(
            'text-xs font-mono px-1.5 py-0.5 rounded border',
            q === '4K' ? 'border-warning/30 text-warning bg-warning/10' :
            q === 'FHD' ? 'border-accent/30 text-accent bg-accent/10' :
            'border-text-secondary/30 text-text-secondary bg-text-secondary/10'
          )}>
            {q}
          </span>
        )
      }
    },
    {
      accessorKey: 'active',
      header: 'Status',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.active ? (
            <Badge variant="active" label="Ativo" />
          ) : (
            <Badge variant="inactive" label="Desativado" />
          )}
        </div>
      )
    },
    {
      accessorKey: 'stream_url',
      header: 'Stream URL',
      cell: ({ row }) => (
        <div className="flex items-center gap-2 max-w-[200px]">
          <span className="font-mono text-xs text-text-muted truncate">
            {row.original.stream_url}
          </span>
          <button 
            className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-elevated"
            onClick={() => handleCopy(row.original.stream_url)}
            title="Copiar URL"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      )
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: ({ row }) => (
        <Button 
          variant={row.original.active ? "ghost" : "primary"} 
          size="sm" 
          icon={row.original.active ? <ShieldOff className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          onClick={() => {
            const action = row.original.active ? 'desativado' : 'ativado'
            toast.success(`Canal ${row.original.name} ${action}!`)
          }}
        >
          {row.original.active ? 'Desativar' : 'Ativar'}
        </Button>
      )
    }
  ]

  return (
    <div className="animate-in fade-in duration-500">
      <Header 
        title="Canais Tratados" 
        description="Visualize e gerencie os canais processados no Edge"
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

      <Table 
        data={filteredChannels} 
        columns={columns} 
        loading={loading}
      />
    </div>
  )
}
