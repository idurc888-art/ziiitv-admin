import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/Button'
import { Search, Copy, Tv2, Film, Clapperboard, ChevronLeft, ChevronRight, Sparkles, XCircle } from 'lucide-react'
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
  canonical_id: string | null
  streams: Array<{ u: string; q: string }> | null
}

const PAGE_SIZE = 50

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
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const presetPlaylistId = searchParams.get('playlist_id')

  const [search, setSearch]       = useState('')
  const [contentType, setContentType] = useState<'all' | 'series' | 'movie' | 'live'>('all')
  const [enriched, setEnriched]   = useState<'all' | 'yes' | 'no'>('all')
  const [page, setPage]           = useState(0)
  const [loading, setLoading]     = useState(true)
  const [channels, setChannels]   = useState<DbChannel[]>([])
  const [total, setTotal]         = useState(0)
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchChannels = useCallback(async (searchVal: string, type: string, enrichedVal: string, pg: number) => {
    setLoading(true)
    let q = supabaseAdmin
      .from('channels')
      .select('id, name, group_name, logo_url, content_type, streaming, canonical_id, streams', { count: 'exact' })
      .order('name')
      .range(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE - 1)

    if (presetPlaylistId) q = q.eq('playlist_id', presetPlaylistId)
    if (type !== 'all')   q = q.eq('content_type', type)
    if (enrichedVal === 'yes') q = q.not('canonical_id', 'is', null)
    if (enrichedVal === 'no')  q = q.is('canonical_id', null)
    if (searchVal.trim()) q = q.ilike('name', `%${searchVal.trim()}%`)

    const { data, count } = await q
    setChannels(data || [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [presetPlaylistId])

  useEffect(() => {
    fetchChannels(search, contentType, enriched, page)
  }, [contentType, enriched, page, fetchChannels])

  function handleSearchChange(val: string) {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(0)
      fetchChannels(val, contentType, enriched, 0)
    }, 300)
  }

  function handleFilterChange(type: typeof contentType, enr: typeof enriched) {
    setContentType(type)
    setEnriched(enr)
    setPage(0)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasFilters = search || contentType !== 'all' || enriched !== 'all'

  return (
    <div className="animate-in fade-in duration-500">
      <Header
        title="Canais"
        description={
          presetPlaylistId
            ? `Canais da playlist selecionada — ${total.toLocaleString('pt-BR')} resultado${total !== 1 ? 's' : ''}`
            : `${total.toLocaleString('pt-BR')} canal${total !== 1 ? 'is' : ''} no total`
        }
        action={
          <div className="flex bg-surface border border-border rounded-lg px-3 py-2 text-sm w-full sm:w-64">
            <Search className="w-4 h-4 text-text-muted mr-2 flex-shrink-0 mt-0.5" />
            <input
              type="text"
              placeholder="Buscar canal..."
              className="bg-transparent border-none outline-none w-full text-text-primary placeholder:text-text-muted"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
            />
          </div>
        }
      />

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-5">
        {(['all', 'series', 'movie', 'live'] as const).map(t => (
          <button
            key={t}
            onClick={() => handleFilterChange(t, enriched)}
            className={classNames(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              contentType === t
                ? 'bg-accent text-white border-accent'
                : 'bg-surface text-text-secondary border-border hover:border-accent/40 hover:text-text-primary'
            )}
          >
            {t === 'all' ? 'Todos' : TYPE_LABEL[t]}
          </button>
        ))}
        <div className="w-px h-6 bg-border self-center" />
        {(['all', 'yes', 'no'] as const).map(e => (
          <button
            key={e}
            onClick={() => handleFilterChange(contentType, e)}
            className={classNames(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              enriched === e
                ? 'bg-accent text-white border-accent'
                : 'bg-surface text-text-secondary border-border hover:border-accent/40 hover:text-text-primary'
            )}
          >
            {e === 'all' && 'Todos'}
            {e === 'yes' && <><Sparkles className="w-3 h-3" /> Com TMDB</>}
            {e === 'no'  && <><XCircle  className="w-3 h-3" /> Sem TMDB</>}
          </button>
        ))}
        {hasFilters && (
          <button
            onClick={() => { setSearch(''); handleFilterChange('all', 'all') }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:text-danger border border-dashed border-border hover:border-danger/40 transition-colors"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Canal</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Tipo</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide hidden sm:table-cell">Grupo</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide hidden md:table-cell">Stream</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">TMDB</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-4 py-3"><div className="h-4 skeleton rounded w-48" /></td>
                  <td className="px-4 py-3"><div className="h-4 skeleton rounded w-16" /></td>
                  <td className="px-4 py-3 hidden sm:table-cell"><div className="h-4 skeleton rounded w-28" /></td>
                  <td className="px-4 py-3 hidden md:table-cell"><div className="h-4 skeleton rounded w-40" /></td>
                  <td className="px-4 py-3"><div className="h-4 skeleton rounded w-8 mx-auto" /></td>
                </tr>
              ))
            ) : channels.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-text-muted">
                  {hasFilters ? 'Nenhum canal encontrado com esses filtros.' : 'Nenhum canal disponível.'}
                </td>
              </tr>
            ) : (
              channels.map(ch => {
                const topQuality = ch.streams?.[0]?.q
                const streamUrl  = ch.streams?.[0]?.u
                const t = ch.content_type || 'live'
                return (
                  <tr
                    key={ch.id}
                    onClick={() => navigate(`/admin/channels/${ch.id}`)}
                    className="border-b border-border/50 hover:bg-elevated cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {ch.logo_url ? (
                          <img src={ch.logo_url} alt="" className="w-8 h-8 rounded object-contain bg-base flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-elevated border border-border flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-mono text-text-muted">TV</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="font-medium text-text-primary block truncate max-w-[220px]">{ch.name}</span>
                          {topQuality && (
                            <span className={classNames('text-xs font-mono px-1 py-0.5 rounded border', QUALITY_COLORS[topQuality] || QUALITY_COLORS['HD'])}>
                              {topQuality}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {TYPE_ICON[t]}
                        <span className="text-text-secondary">{TYPE_LABEL[t] || t}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-text-secondary truncate max-w-[150px] block">{ch.group_name || '—'}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {streamUrl ? (
                        <div className="flex items-center gap-2 max-w-[200px]">
                          <span className="font-mono text-xs text-text-muted truncate">{streamUrl}</span>
                          <button
                            className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-elevated flex-shrink-0"
                            onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(streamUrl); toast.success('URL copiada', { icon: '📋' }) }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {ch.canonical_id ? (
                        <Sparkles className="w-4 h-4 text-yellow-400 mx-auto" title="Enriquecido" />
                      ) : (
                        <span className="text-text-faint text-xs">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-text-muted">
            Página {page + 1} de {totalPages} · {total.toLocaleString('pt-BR')} canais
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-text-secondary w-6 text-center">{page + 1}</span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
