import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import {
  Trash2, Calendar, CheckCircle, XCircle, Clock,
  Eye, Clapperboard, Film, Tv2, Sparkles, Info, Copy, Check, Upload, Zap,
  LayoutList, Wand2, RefreshCw,
} from 'lucide-react'
import { toast } from 'react-hot-toast'

interface Playlist {
  id: string
  url_original: string
  status: string
  channel_count: number
  processed_at: string | null
  created_at: string
  error_message: string | null
  presentation_mode: 'auto' | 'curated' | null
  last_synced_at: string | null
  content_count: number | null
}

interface PlaylistStats {
  total:    number
  series:   number
  movies:   number
  live:     number
  enriched: number
  loading:  boolean
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function statusIcon(status: string) {
  if (status === 'ready')      return <CheckCircle className="w-4 h-4 text-green-400" />
  if (status === 'error')      return <XCircle     className="w-4 h-4 text-red-400" />
  if (status === 'processing') return <Clock       className="w-4 h-4 text-yellow-400 animate-spin" />
  return                              <Clock       className="w-4 h-4 text-gray-500" />
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    ready: 'Pronta', error: 'Erro', processing: 'Processando', pending: 'Pendente',
  }
  return map[status] ?? status
}

function statusColor(status: string) {
  if (status === 'ready')      return 'bg-green-500/15 text-green-400 border-green-500/30'
  if (status === 'error')      return 'bg-red-500/15 text-red-400 border-red-500/30'
  if (status === 'processing') return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
  return 'bg-gray-500/15 text-gray-400 border-gray-500/30'
}

function friendlyName(urlOriginal: string) {
  return urlOriginal.replace(/^file:/, '').replace(/^https?:\/\/[^/]+\//, '')
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function Playlists() {
  const navigate  = useNavigate()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [statsMap,  setStatsMap]  = useState<Record<string, PlaylistStats>>({})
  const [loading,       setLoading]      = useState(true)
  const [deleting,      setDeleting]     = useState<string | null>(null)
  const [codesMap,      setCodesMap]     = useState<Record<string, string>>({})
  const [codeCopied,    setCodeCopied]   = useState<string | null>(null)
  const [generatingCode, setGeneratingCode] = useState<string | null>(null)
  const [togglingMode,  setTogglingMode] = useState<string | null>(null)

  const loadPlaylists = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Não autenticado')

      const [{ data: pls }, { data: codes }] = await Promise.all([
        supabase.from('playlists')
          .select('id, url_original, status, channel_count, processed_at, created_at, error_message, presentation_mode, last_synced_at, content_count')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase.from('pairing_codes')
          .select('code, playlist_id')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString()),
      ])

      // Mapeia playlist_id → código
      const map: Record<string, string> = {}
      for (const c of (codes || [])) {
        if (c.playlist_id) map[c.playlist_id] = c.code
      }
      setCodesMap(map)

      const list: Playlist[] = (pls || []).map(pl => ({ ...pl }))
      setPlaylists(list)

      // Inicializa loading state para todas as playlists prontas
      const initial: Record<string, PlaylistStats> = {}
      for (const pl of list) {
        if (pl.status === 'ready') initial[pl.id] = { total: 0, series: 0, movies: 0, live: 0, enriched: 0, loading: true }
      }
      setStatsMap(initial)

      // Busca stats de todas as playlists prontas em paralelo
      const readyIds = list.filter(p => p.status === 'ready').map(p => p.id)
      if (readyIds.length > 0) {
        await Promise.all(readyIds.map(pid => loadStats(pid)))
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao carregar playlists')
    } finally {
      setLoading(false)
    }
  }, [])

  async function loadStats(pid: string) {
    const [totalRes, seriesRes, moviesRes, liveRes, enrichedRes] = await Promise.all([
      supabase.from('channels').select('*', { count: 'exact', head: true }).eq('playlist_id', pid),
      supabase.from('channels').select('*', { count: 'exact', head: true }).eq('playlist_id', pid).eq('content_type', 'series'),
      supabase.from('channels').select('*', { count: 'exact', head: true }).eq('playlist_id', pid).eq('content_type', 'movie'),
      supabase.from('channels').select('*', { count: 'exact', head: true }).eq('playlist_id', pid).eq('content_type', 'live'),
      supabase.from('channels').select('*', { count: 'exact', head: true }).eq('playlist_id', pid).not('canonical_id', 'is', null),
    ])

    setStatsMap(prev => ({
      ...prev,
      [pid]: {
        total:    totalRes.count    ?? 0,
        series:   seriesRes.count   ?? 0,
        movies:   moviesRes.count   ?? 0,
        live:     liveRes.count     ?? 0,
        enriched: enrichedRes.count ?? 0,
        loading:  false,
      },
    }))
  }

  useEffect(() => { loadPlaylists() }, [loadPlaylists])

  const handleGenerateCode = async (playlistId: string) => {
    setGeneratingCode(playlistId)
    try {
      const { data, error } = await supabase.functions.invoke('generate-code', {
        body: { playlist_id: playlistId },
      })
      if (error) throw error
      setCodesMap(prev => ({ ...prev, [playlistId]: data.code }))
      toast.success(`Código gerado: ${data.code}`)
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar código')
    } finally {
      setGeneratingCode(null)
    }
  }

  const handleToggleMode = async (pl: Playlist) => {
    const next = (pl.presentation_mode ?? 'auto') === 'auto' ? 'curated' : 'auto'
    setTogglingMode(pl.id)
    try {
      const { error } = await supabase
        .from('playlists')
        .update({ presentation_mode: next })
        .eq('id', pl.id)
      if (error) throw error
      setPlaylists(prev => prev.map(p => p.id === pl.id ? { ...p, presentation_mode: next } : p))
      toast.success(next === 'curated' ? 'Modo Curado ativo — só aparece o que você configurar na Home' : 'Modo Auto ativo — mostra tudo da lista')
    } catch (err: any) {
      toast.error(err.message || 'Erro ao alterar modo')
    } finally {
      setTogglingMode(null)
    }
  }

  const handleDelete = async (playlistId: string) => {
    if (!confirm('Deletar playlist? Remove TODOS os canais associados. Não pode ser desfeito!')) return
    setDeleting(playlistId)
    try {
      const { data: channelRows } = await supabase.from('channels').select('id').eq('playlist_id', playlistId)
      const channelIds = channelRows?.map(c => c.id) ?? []
      if (channelIds.length > 0) {
        await supabase.from('watch_events').update({ channel_id: null }).in('channel_id', channelIds)
      }
      await supabase.from('channels').delete().eq('playlist_id', playlistId)
      await supabase.from('playlists').delete().eq('id', playlistId)
      toast.success(`Playlist deletada — ${channelIds.length} canais removidos`)
      loadPlaylists()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao deletar playlist')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div className="animate-in fade-in duration-500">
        <Header title="Playlists" description="Carregando..." />
        <div className="flex justify-center py-20">
          <Clock className="w-8 h-8 text-accent animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <Header
        title="Playlists"
        description={`${playlists.length} playlist${playlists.length !== 1 ? 's' : ''} cadastrada${playlists.length !== 1 ? 's' : ''}`}
        action={
          <Button onClick={() => navigate('/admin/upload')}>
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Nova Playlist
          </Button>
        }
      />

      {/* Aviso TMDB */}
      <div className="flex gap-3 p-4 bg-accent/5 border border-accent/20 rounded-xl">
        <Info className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <div className="text-sm text-text-secondary">
          <strong className="text-text-primary">TMDB é compartilhado globalmente.</strong>{' '}
          Cada título é enriquecido <strong>uma única vez</strong> — independente de quantas playlists contenham o mesmo
          filme ou série. O dado fica em <span className="font-mono text-xs bg-elevated px-1 rounded">canonical_titles</span>{' '}
          e todas as playlists apontam para ele. O botão{' '}
          <span className="font-mono text-xs bg-elevated px-1 rounded">EnrichQueue</span>{' '}
          processa os que ainda não têm TMDB.
        </div>
      </div>

      {playlists.length === 0 ? (
        <Card>
          <p className="text-gray-400 text-center py-10">
            Nenhuma playlist ainda. Faça upload pela página <strong>Upload Playlist</strong>.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {playlists.map(pl => {
            const st = statsMap[pl.id]
            const enrichPct = st && st.total > 0 ? Math.round((st.enriched / st.total) * 100) : 0
            const plCode = codesMap[pl.id]

            const isXtream = pl.url_original.includes('get.php?username=')
            const mode = pl.presentation_mode ?? 'auto'
            const isCurated = mode === 'curated'

            return (
              <Card key={pl.id} className="overflow-hidden">
                {/* ── Cabeçalho do card ─────────────────────────────────── */}
                <div className="flex items-start gap-3 mb-4">
                  <div className="mt-0.5">{statusIcon(pl.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-text-primary truncate max-w-[340px]" title={pl.url_original}>
                        {friendlyName(pl.url_original)}
                      </h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full border font-medium ${statusColor(pl.status)}`}>
                        {statusLabel(pl.status)}
                      </span>
                      {plCode && (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(plCode)
                            setCodeCopied(pl.id)
                            setTimeout(() => setCodeCopied(null), 2000)
                          }}
                          title="Copiar código — digitar na TV para carregar esta lista"
                          className="flex items-center gap-1.5 px-2 py-0.5 bg-purple-500/15 text-purple-400 border border-purple-500/30 rounded-full font-mono text-xs font-bold hover:bg-purple-500/25 transition-colors"
                        >
                          <Tv2 className="w-3 h-3 opacity-70" />
                          {plCode}
                          {codeCopied === pl.id
                            ? <Check className="w-3 h-3 text-green-400" />
                            : <Copy className="w-3 h-3 opacity-60" />}
                        </button>
                      )}
                      {/* Modo de apresentação — só Xtream */}
                      {isXtream && (
                        <button
                          onClick={() => handleToggleMode(pl)}
                          disabled={togglingMode === pl.id}
                          title={isCurated ? 'Modo Curado: só aparece o que está na Home. Clique para mudar para Auto.' : 'Modo Auto: mostra tudo da lista. Clique para mudar para Curado.'}
                          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium transition-colors ${
                            isCurated
                              ? 'bg-accent/15 text-accent border-accent/30 hover:bg-accent/25'
                              : 'bg-gray-500/15 text-gray-400 border-gray-500/30 hover:bg-gray-500/25'
                          }`}
                        >
                          {togglingMode === pl.id
                            ? <Clock className="w-3 h-3 animate-spin" />
                            : isCurated
                              ? <Wand2 className="w-3 h-3" />
                              : <LayoutList className="w-3 h-3" />}
                          {isCurated ? 'Curado' : 'Auto'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Criada {new Date(pl.created_at).toLocaleDateString('pt-BR')}
                      </span>
                      {pl.processed_at && (
                        <span>Processada {new Date(pl.processed_at).toLocaleDateString('pt-BR')}</span>
                      )}
                      {/* Sync status — só Xtream */}
                      {isXtream && pl.last_synced_at ? (
                        <span className="flex items-center gap-1 text-green-400/70">
                          <RefreshCw className="w-3 h-3" />
                          Sincronizado {new Date(pl.last_synced_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          {pl.content_count != null && ` · ${pl.content_count.toLocaleString('pt-BR')} títulos`}
                        </span>
                      ) : isXtream ? (
                        <span className="flex items-center gap-1 text-text-muted/60">
                          <RefreshCw className="w-3 h-3" />
                          Não sincronizado — abra a lista na TV
                        </span>
                      ) : null}
                      <span className="font-mono text-[10px] text-text-muted/60">{pl.id.slice(0, 8)}…</span>
                    </div>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {pl.status === 'ready' && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/playlists/${pl.id}`)}>
                          <Eye className="w-3.5 h-3.5 mr-1" /> Ver canais
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/enrich/${pl.id}`)}>
                          <Zap className="w-3.5 h-3.5 mr-1" /> Enriquecer
                        </Button>
                        {!plCode && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleGenerateCode(pl.id)}
                            disabled={generatingCode === pl.id}
                          >
                            {generatingCode === pl.id
                              ? <Clock className="w-3.5 h-3.5 mr-1 animate-spin" />
                              : <Tv2 className="w-3.5 h-3.5 mr-1" />}
                            {generatingCode === pl.id ? 'Gerando...' : 'Gerar código TV'}
                          </Button>
                        )}
                      </>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(pl.id)}
                      disabled={deleting === pl.id}
                    >
                      {deleting === pl.id
                        ? <Clock className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                      {deleting === pl.id ? 'Deletando...' : 'Deletar'}
                    </Button>
                  </div>
                </div>

                {/* ── Stats grid ────────────────────────────────────────── */}
                {pl.status === 'ready' && (
                  <>
                    {st?.loading ? (
                      <div className="flex items-center gap-2 py-3 text-xs text-text-muted">
                        <Clock className="w-3.5 h-3.5 animate-spin text-accent" />
                        Carregando estatísticas...
                      </div>
                    ) : st ? (
                      <>
                        <div className="grid grid-cols-4 gap-3 mb-4">
                          {/* Total */}
                          <div className="bg-elevated rounded-lg p-3 border border-border">
                            <p className="text-xs text-text-muted mb-1">Total</p>
                            <p className="text-xl font-bold text-text-primary">
                              {st.total.toLocaleString('pt-BR')}
                            </p>
                            <p className="text-[10px] text-text-muted mt-0.5">canais únicos</p>
                          </div>

                          {/* Séries */}
                          <div className="bg-elevated rounded-lg p-3 border border-border">
                            <div className="flex items-center gap-1 mb-1">
                              <Clapperboard className="w-3 h-3 text-purple-400" />
                              <p className="text-xs text-text-muted">Séries</p>
                            </div>
                            <p className="text-xl font-bold text-purple-400">
                              {st.series.toLocaleString('pt-BR')}
                            </p>
                            <p className="text-[10px] text-text-muted mt-0.5">
                              {st.total > 0 ? Math.round((st.series / st.total) * 100) : 0}% do total
                            </p>
                          </div>

                          {/* Filmes */}
                          <div className="bg-elevated rounded-lg p-3 border border-border">
                            <div className="flex items-center gap-1 mb-1">
                              <Film className="w-3 h-3 text-blue-400" />
                              <p className="text-xs text-text-muted">Filmes</p>
                            </div>
                            <p className="text-xl font-bold text-blue-400">
                              {st.movies.toLocaleString('pt-BR')}
                            </p>
                            <p className="text-[10px] text-text-muted mt-0.5">
                              {st.total > 0 ? Math.round((st.movies / st.total) * 100) : 0}% do total
                            </p>
                          </div>

                          {/* TV ao Vivo */}
                          <div className="bg-elevated rounded-lg p-3 border border-border">
                            <div className="flex items-center gap-1 mb-1">
                              <Tv2 className="w-3 h-3 text-green-400" />
                              <p className="text-xs text-text-muted">TV ao Vivo</p>
                            </div>
                            <p className="text-xl font-bold text-green-400">
                              {st.live.toLocaleString('pt-BR')}
                            </p>
                            <p className="text-[10px] text-text-muted mt-0.5">
                              {st.total > 0 ? Math.round((st.live / st.total) * 100) : 0}% do total
                            </p>
                          </div>
                        </div>

                        {/* TMDB barra */}
                        <div className="bg-elevated rounded-lg p-3 border border-border">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
                              <span className="text-xs font-medium text-text-primary">TMDB Enriquecidos</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-yellow-400">
                                {st.enriched.toLocaleString('pt-BR')}
                              </span>
                              <span className="text-xs text-text-muted">de {st.total.toLocaleString('pt-BR')}</span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                enrichPct >= 80 ? 'bg-green-500/15 text-green-400' :
                                enrichPct >= 40 ? 'bg-yellow-500/15 text-yellow-400' :
                                                  'bg-red-500/15 text-red-400'
                              }`}>
                                {enrichPct}%
                              </span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-border rounded-full overflow-hidden">
                            <div
                              className="h-full bg-yellow-400 rounded-full transition-all duration-700"
                              style={{ width: `${enrichPct}%` }}
                            />
                          </div>
                          {enrichPct < 100 && (
                            <p className="text-[10px] text-text-muted mt-1.5">
                              {(st.total - st.enriched).toLocaleString('pt-BR')} títulos aguardando enriquecimento na{' '}
                              <span className="font-mono">EnrichQueue</span>
                            </p>
                          )}
                        </div>
                      </>
                    ) : null}
                  </>
                )}

                {/* Erro */}
                {pl.error_message && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                    {pl.error_message}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
