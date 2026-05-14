import React, { useState, useEffect } from 'react'
import { Header } from '../components/layout/Header'
import { Table } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Search, Eye, Mail, Calendar, Key, AlertCircle } from 'lucide-react'
import { formatRelativeTime } from '../lib/utils'
import type { ColumnDef } from '@tanstack/react-table'
import type { User } from '../types'

// MOCK DATA for layout testing
const mockUsers: User[] = [
  { id: '1', email: 'mario.silva@gmail.com', role: 'user', created_at: '2023-11-10T10:00:00Z', last_processed: '2024-03-24T15:30:00Z', m3u_url: 'http://cdc55.net/...', playlists: [{ count: 2 }] },
  { id: '2', email: 'admin@ziiitv.com', role: 'admin', created_at: '2023-10-01T08:00:00Z', last_processed: null, m3u_url: null, playlists: [{ count: 0 }] },
  { id: '3', email: 'joao.pereira@hotmail.com', role: 'user', created_at: '2024-01-15T14:20:00Z', last_processed: '2024-03-22T09:15:00Z', m3u_url: 'http://tv.example.com/...', playlists: [{ count: 1 }] },
  { id: '4', email: 'carlos.tv@outlook.com', role: 'user', created_at: '2024-02-28T20:45:00Z', last_processed: '2024-03-25T11:00:00Z', m3u_url: 'http://iptvmaster.com/...', playlists: [{ count: 3 }] },
  { id: '5', email: 'ana.julia@gmail.com', role: 'user', created_at: '2024-03-10T16:10:00Z', last_processed: null, m3u_url: 'http://cdc55.net/...', playlists: [{ count: 0 }] },
]

export function Users() {
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600)
    return () => clearTimeout(t)
  }, [])

  const filteredUsers = mockUsers.filter(u => 
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  const columns: ColumnDef<User>[] = [
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
      )
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => <Badge variant={row.original.role} />
    },
    {
      id: 'playlists',
      header: 'Playlists',
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.playlists?.[0]?.count || 0}
        </span>
      )
    },
    {
      accessorKey: 'last_processed',
      header: 'Última Atividade',
      cell: ({ row }) => (
        <span className="text-sm text-text-secondary">
          {row.original.last_processed ? formatRelativeTime(row.original.last_processed) : 'Nunca'}
        </span>
      )
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
      )
    }
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

      <Table 
        data={filteredUsers} 
        columns={columns} 
        loading={loading}
      />

      {/* User Details Modal */}
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
                    Cadastrado em {new Date(selectedUser.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h5 className="text-sm font-medium text-text-secondary mb-2 flex items-center gap-2">
                  <Key className="w-4 h-4" /> M3U URL Principal
                </h5>
                {selectedUser.m3u_url ? (
                  <div className="bg-base border border-border rounded flex items-center justify-between p-2">
                    <span className="text-xs font-mono text-text-primary truncate mr-4">
                      {selectedUser.m3u_url}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(selectedUser.m3u_url!)}>
                      Copiar
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-text-muted bg-base p-3 border border-dashed border-border rounded">
                    <AlertCircle className="w-4 h-4" /> Nenhum link M3U cadastrado
                  </div>
                )}
              </div>

              <div>
                <h5 className="text-sm font-medium text-text-secondary mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> Resumo de Atividade
                </h5>
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-border bg-base p-3 rounded">
                    <span className="block text-xs text-text-muted mb-1">Playlists Importadas</span>
                    <span className="font-medium text-text-primary">{selectedUser.playlists?.[0]?.count || 0}</span>
                  </div>
                  <div className="border border-border bg-base p-3 rounded">
                    <span className="block text-xs text-text-muted mb-1">Última Carga M3U</span>
                    <span className="font-medium text-text-primary">
                      {selectedUser.last_processed ? new Date(selectedUser.last_processed).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border mt-6">
              <Button variant="ghost" onClick={() => setSelectedUser(null)}>Fechar</Button>
              <Button>Ver Histórico</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
