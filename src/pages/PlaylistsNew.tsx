import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { Trash2, Calendar, CheckCircle, XCircle, Clock, Eye } from 'lucide-react'
import { toast } from 'react-hot-toast'

interface Playlist {
  id: string
  url_original: string
  status: string
  channel_count: number
  processed_at: string
  created_at: string
  error_message: string | null
  pairing_code?: string
}

export function Playlists() {
  const navigate = useNavigate()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    loadPlaylists()
  }, [])

  const loadPlaylists = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Não autenticado')

      // Buscar playlists com código de pareamento
      const { data: playlistsData, error: playlistsError } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (playlistsError) throw playlistsError

      // Buscar códigos de pareamento
      const { data: codesData } = await supabase
        .from('pairing_codes')
        .select('code, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      // Mapear código mais recente para cada playlist (por proximidade de data)
      const playlistsWithCodes = playlistsData?.map(playlist => {
        const code = codesData?.find(c => 
          Math.abs(new Date(c.created_at).getTime() - new Date(playlist.created_at).getTime()) < 60000 // 1 min
        )
        return { ...playlist, pairing_code: code?.code }
      })

      setPlaylists(playlistsWithCodes || [])
    } catch (error) {
      console.error('Error loading playlists:', error)
      toast.error('Erro ao carregar playlists')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (playlistId: string) => {
    if (!confirm('Deletar playlist? Remove TODOS os canais e histórico associados. Não pode ser desfeito!')) {
      return
    }

    setDeleting(playlistId)
    try {
      // 1. Buscar IDs dos canais antes de deletar (para limpar watch_events)
      const { data: channelRows } = await supabase
        .from('channels')
        .select('id')
        .eq('playlist_id', playlistId)

      const channelIds = channelRows?.map(c => c.id) ?? []

      // 2. Desvincula watch_events (SET NULL — não perde o histórico, só desvincula o canal)
      if (channelIds.length > 0) {
        await supabase
          .from('watch_events')
          .update({ channel_id: null })
          .in('channel_id', channelIds)
      }

      // 3. Deletar canais
      const { error: channelsError } = await supabase
        .from('channels')
        .delete()
        .eq('playlist_id', playlistId)

      if (channelsError) throw channelsError

      // 4. Deletar playlist (CASCADE no DB remove registros dependentes restantes)
      const { error: playlistError } = await supabase
        .from('playlists')
        .delete()
        .eq('id', playlistId)

      if (playlistError) throw playlistError

      toast.success(`Playlist deletada — ${channelIds.length} canais removidos`)
      loadPlaylists()
    } catch (error: any) {
      console.error('[Delete] Error:', error)
      toast.error(error.message || 'Erro ao deletar playlist')
    } finally {
      setDeleting(null)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />
      case 'processing':
        return <Clock className="w-5 h-5 text-yellow-500 animate-spin" />
      default:
        return <Clock className="w-5 h-5 text-gray-500" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ready':
        return 'Pronta'
      case 'error':
        return 'Erro'
      case 'processing':
        return 'Processando'
      default:
        return 'Pendente'
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="Playlists" description="Gerenciar playlists" />
        <Card>
          <p className="text-gray-400">Carregando...</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header
        title="Playlists"
        description={`${playlists.length} playlist${playlists.length !== 1 ? 's' : ''} cadastrada${playlists.length !== 1 ? 's' : ''}`}
      />

      {playlists.length === 0 ? (
        <Card>
          <p className="text-gray-400 text-center py-8">
            Nenhuma playlist encontrada. Faça upload de uma playlist para começar.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {playlists.map((playlist) => (
            <Card key={playlist.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {getStatusIcon(playlist.status)}
                    <h3 className="text-lg font-semibold text-white">
                      {playlist.url_original}
                    </h3>
                    <span className={`px-2 py-1 text-xs rounded ${
                      playlist.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                      playlist.status === 'error' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {getStatusText(playlist.status)}
                    </span>
                  </div>

                  <div className="flex items-center gap-6 text-sm text-gray-400">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>
                        Criada em {new Date(playlist.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>

                    {playlist.channel_count > 0 && (
                      <div>
                        <span className="font-medium text-white">{playlist.channel_count}</span> canais
                      </div>
                    )}

                    {playlist.processed_at && (
                      <div>
                        Processada em {new Date(playlist.processed_at).toLocaleDateString('pt-BR')}
                      </div>
                    )}

                    {playlist.pairing_code && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Código:</span>
                        <code className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded font-mono text-sm font-bold">
                          {playlist.pairing_code}
                        </code>
                      </div>
                    )}
                  </div>

                  {playlist.error_message && (
                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
                      {playlist.error_message}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-4">
                  {playlist.status === 'ready' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/playlists/${playlist.id}`)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      Ver canais
                    </Button>
                  )}
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDelete(playlist.id)}
                  disabled={deleting === playlist.id}
                >
                  {deleting === playlist.id ? (
                    <>
                      <Clock className="w-4 h-4 mr-2 animate-spin" />
                      Deletando...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Deletar
                    </>
                  )}
                </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
