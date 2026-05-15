import { useState, useEffect } from 'react'
import { Header } from '../components/layout/Header'
import { Table } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Search, Eye, Calendar, AlertCircle } from 'lucide-react'
import { formatRelativeTime } from '../lib/utils'
import { supabaseAdmin } from '../lib/supabase'
import type { ColumnDef } from '@tanstack/react-table'
import type { User, UserRole } from '../types'

interface UserWithStats extends User {
  playlist_count: number
}

export function Users() {
  const [search, setSearch]           = useState('')
  const [loading, setLoading]         = useState(true)
  const [users, setUsers]             = useState<UserWithStats[]>([])
  const [selectedUser, setSelectedUser] = useState<UserWithStats | null>(null)

  useEffect(() => {
    async function load() {
      const [usersRes, playlistsRes] = await Promise.all([
        supabaseAdmin.from('users').select('id, email, role, created_at').order('created_at', { ascending: false }).limit(200),
        supabaseAdmin.from('playlists').select('user_id, processed_at').eq('status', 'ready'),
      ])

      const usersData = (usersRes.data || []) as Array<{ id: string; email: string; role: string; created_at: string }>
      const plData    = (playlistsRes.data || []) as Array<{ user_id: string; processed_at: string | null }>

      const statsMap: Record<string, { count: number; lastProcessed: string | null }> = {}
      for (const pl of plData) {
        if (!statsMap[pl.user_id]) statsMap[pl.user_id] = { count: 0, lastProcessed: null }
        statsMap[pl.user_id].count++
        if (!statsMap[pl.user_id].lastProcessed || (pl.processed_at && pl.processed_at > statsMap[pl.user_id].lastProcessed!)) {
          statsMap[pl.user_id].lastProcessed = pl.processed_at
        }
      }

      setUsers(
        usersData.map(u => ({
          ...u,
          role:           u.role as UserRole,
          m3u_url:        null,
          last_processed: statsMap[u.id]?.lastProcessed ?? null,
          playlists:      [{ count: statsMap[u.id]?.count ?? 0 }],
          playlist_count: statsMap[u.id]?.count ?? 0,
        }))
      )
      setLoading(false)
    }
    load()
  }, [])

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  const columns: ColumnDef<UserWithStats>[] = [
    {
      accessorKey: 'email',
      header: 'E-mail',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-elevated border border-border flex items-center justify-center flex-shrink-0">
            <span className="font-mono text-xs text-text-secondary">
              {row.original.email.substring(0, 2).toUpperCase()}
            </span>
          </div>
          <div>
            <span className="font-medium text-text-primary block">{row.original.email}</span>
            <span className="text-xs text-text-muted mt-0.5 block">ID: {row.original.id.substring(0, 8)}...</span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => <Badge variant={row.original.role} />,
    },
    {
      id: 'playlists',
      header: 'Playlists',
      cell: ({ row }) => (
        <span className="text-sm">{row.original.playlist_count}</span>
      ),
    },
    {
      accessorKey: 'last_processed',
      header: 'Última Atividade',
      cell: ({ row }) => (
        <span className="text-sm text-text-secondary">
          {row.original.last_processed ? formatRelativeTime(row.original.last_processed) : 'Nunca'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Ações',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Eye className="w-4 h-4" />}
          onClick={() => setSelectedUser(row.original)}
        >
          Detalhes
        </Button>
      ),
    },
  ]

  return (
    <div className="animate-in fade-in duration-500">
      <Header
        title="Usuários"
        description="Gerenciamento de contas e vínculos de M3U"
        action={
          <div className="flex bg-surface border border-border rounded-lg px-3 py-2 text-sm w-full sm:w-64">
            <Search className="w-4 h-4 text-text-muted mr-2 flex-shrink-0 mt-0.5" />
            <input
              type="text"
              placeholder="Buscar por e-mail..."
              className="bg-transparent border-none outline-none w-full text-text-primary placeholder:text-text-muted"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        }
      />

      <Table data={filtered} columns={columns} loading={loading} />

      <Modal
        isOpen={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        title="Detalhes do Usuário"
      >
        {selectedUser && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 border border-border bg-base rounded-lg shadow-inner">
              <div className="w-12 h-12 rounded bg-elevated border border-border flex items-center justify-center">
                <span className="font-mono text-lg text-text-secondary">
                  {selectedUser.email.substring(0, 2).toUpperCase()}
                </span>
              </div>
              <div>
                <h4 className="font-semibold text-text-primary text-lg">{selectedUser.email}</h4>
                <div className="flex gap-2 mt-1">
                  <Badge variant={selectedUser.role} />
                  <span className="text-xs text-text-muted mt-0.5 border-l border-border pl-2">
                    Cadastrado em {new Date(selectedUser.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h5 className="text-sm font-medium text-text-secondary mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> Resumo de Atividade
                </h5>
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-border bg-base p-3 rounded">
                    <span className="block text-xs text-text-muted mb-1">Playlists Processadas</span>
                    <span className="font-medium text-text-primary">{selectedUser.playlist_count}</span>
                  </div>
                  <div className="border border-border bg-base p-3 rounded">
                    <span className="block text-xs text-text-muted mb-1">Última Carga M3U</span>
                    <span className="font-medium text-text-primary">
                      {selectedUser.last_processed
                        ? new Date(selectedUser.last_processed).toLocaleDateString('pt-BR')
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {selectedUser.playlist_count === 0 && (
                <div className="flex items-center gap-2 text-sm text-text-muted bg-base p-3 border border-dashed border-border rounded">
                  <AlertCircle className="w-4 h-4" /> Nenhuma playlist processada ainda
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border mt-6">
              <Button variant="ghost" onClick={() => setSelectedUser(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
