import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Sparkles, Zap, CheckCircle, Clock, List } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'react-hot-toast'

interface PlaylistEnrich {
  id: string
  url_original: string
  processed_at: string | null
  total: number
  enriched: number
  loading: boolean
}

function friendlyName(url: string) {
  return url.replace(/^file:/, '').replace(/^https?:\/\/[^/]+\//, '')
}

export function EnrichIndex() {
  const navigate = useNavigate()
  const [playlists, setPlaylists] = useState<PlaylistEnrich[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Não autenticado')

      const { data: pls } = await supabase
        .from('playlists')
        .select('id, url_original, processed_at')
        .eq('user_id', user.id)
        .eq('status', 'ready')
        .order('processed_at', { ascending: false })

      const list: PlaylistEnrich[] = (pls || []).map(p => ({
        ...p,
        total: 0,
        enriched: 0,
        loading: true,
      }))
      setPlaylists(list)
      setLoading(false)

      await Promise.all(list.map(async (pl) => {
        const [totalRes, enrichedRes] = await Promise.all([
          supabase
            .from('channels')
            .select('*', { count: 'exact', head: true })
            .eq('playlist_id', pl.id)
            .in('content_type', ['series', 'movie']),
          supabase
            .from('channels')
            .select('*', { count: 'exact', head: true })
            .eq('playlist_id', pl.id)
            .in('content_type', ['series', 'movie'])
            .not('canonical_id', 'is', null),
        ])
        setPlaylists(prev => prev.map(p =>
          p.id === pl.id
            ? { ...p, total: totalRes.count ?? 0, enriched: enrichedRes.count ?? 0, loading: false }
            : p
        ))
      }))
    } catch (err: any) {
      toast.error(err.message || 'Erro ao carregar playlists')
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="animate-in fade-in duration-500">
        <Header title="Enriquecimento" description="Carregando playlists..." />
        <div className="flex justify-center py-20">
          <Clock className="w-8 h-8 text-accent animate-spin" />
        </div>
      </div>
    )
  }

  if (playlists.length === 0) {
    return (
      <div className="animate-in fade-in duration-500">
        <Header title="Enriquecimento" description="Nenhuma playlist disponível para enriquecer" />
        <Card className="text-center py-16">
          <List className="w-10 h-10 text-text-faint mx-auto mb-3" />
          <p className="text-text-secondary font-medium mb-1">Nenhuma playlist processada</p>
          <p className="text-sm text-text-muted">
            Faça upload de uma playlist M3U primeiro para habilitar o enriquecimento.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-4">
      <Header
        title="Enriquecimento"
        description="Vincule canais aos metadados do TMDB — poster, rating, sinopse"
      />

      {playlists.map(pl => {
        const pct = pl.total > 0 ? Math.round((pl.enriched / pl.total) * 100) : 0
        const pending = pl.total - pl.enriched

        return (
          <Card key={pl.id} className="overflow-hidden">
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary truncate" title={pl.url_original}>
                  {friendlyName(pl.url_original)}
                </p>
                {pl.processed_at && (
                  <p className="text-xs text-text-muted mt-0.5">
                    Processada em {new Date(pl.processed_at).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {pct === 100 ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-400 rounded-lg text-xs font-medium">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Completo
                  </div>
                ) : (
                  <button
                    onClick={() => navigate(`/admin/enrich/${pl.id}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Processar
                  </button>
                )}
              </div>
            </div>

            {pl.loading ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                <Clock className="w-3.5 h-3.5 animate-spin text-accent" />
                Calculando progresso...
              </div>
            ) : (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-xs text-text-secondary">
                      {pl.enriched.toLocaleString('pt-BR')} de {pl.total.toLocaleString('pt-BR')} títulos enriquecidos
                    </span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    pct >= 80 ? 'bg-green-500/15 text-green-400' :
                    pct >= 40 ? 'bg-yellow-500/15 text-yellow-400' :
                                'bg-red-500/15 text-red-400'
                  }`}>
                    {pct}%
                  </span>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-400 rounded-full transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {pending > 0 && (
                  <p className="text-[10px] text-text-muted mt-1">
                    {pending.toLocaleString('pt-BR')} títulos aguardando enriquecimento
                  </p>
                )}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
