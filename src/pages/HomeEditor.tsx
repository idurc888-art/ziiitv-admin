import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from 'react-hot-toast'
import {
  ArrowLeft, Plus, GripVertical, Trash2, Pencil,
  ChevronDown, ChevronUp, Loader2, CheckCircle2, Check,
  Tv2, Film, Clapperboard, Sparkles, Eye, EyeOff, List,
} from 'lucide-react'

// ─── Metadados de exibição ────────────────────────────────────────────────────

const SERIES_META: Record<string, { label: string; color: string }> = {
  netflix:       { label: 'Netflix',          color: 'bg-red-600' },
  hbo:           { label: 'HBO Max',           color: 'bg-purple-600' },
  disney:        { label: 'Disney+',           color: 'bg-blue-600' },
  amazon:        { label: 'Amazon Prime',      color: 'bg-orange-500' },
  globoplay:     { label: 'Globoplay',         color: 'bg-green-600' },
  paramount:     { label: 'Paramount+',        color: 'bg-blue-500' },
  apple:         { label: 'Apple TV+',         color: 'bg-zinc-700' },
  star:          { label: 'Star+',             color: 'bg-yellow-500' },
  crunchyroll:   { label: 'Crunchyroll',       color: 'bg-orange-600' },
  discovery:     { label: 'Discovery+',        color: 'bg-sky-600' },
  novelas:       { label: 'Novelas',           color: 'bg-pink-500' },
  kids:          { label: 'Kids / Desenhos',   color: 'bg-yellow-400' },
  series_leg:    { label: 'Legendadas',        color: 'bg-slate-500' },
  series_outros: { label: 'Outras Séries',     color: 'bg-slate-400' },
  starz:         { label: 'Starz',             color: 'bg-yellow-600' },
  directv:       { label: 'DirecTV',           color: 'bg-blue-700' },
  outros:        { label: 'Outras',            color: 'bg-slate-400' },
}

const MOVIE_META: Record<string, { label: string; color: string }> = {
  filmes_acao:        { label: 'Ação',               color: 'bg-red-600' },
  filmes_drama:       { label: 'Drama',              color: 'bg-purple-500' },
  filmes_comedia:     { label: 'Comédia',            color: 'bg-yellow-500' },
  filmes_terror:      { label: 'Terror',             color: 'bg-zinc-800' },
  filmes_suspense:    { label: 'Suspense',           color: 'bg-indigo-600' },
  filmes_crime:       { label: 'Crime',              color: 'bg-zinc-700' },
  filmes_4k:          { label: '4K UHD',             color: 'bg-teal-600' },
  filmes_leg:         { label: 'Legendados',         color: 'bg-slate-500' },
  filmes_nacionais:   { label: 'Nacionais',          color: 'bg-green-700' },
  filmes_lancamentos: { label: 'Lançamentos',        color: 'bg-orange-500' },
  filmes_ficcao:      { label: 'Ficção Científica',  color: 'bg-cyan-600' },
  filmes_marvel:      { label: 'Marvel & DC',        color: 'bg-red-700' },
  filmes_animacao:    { label: 'Animação',           color: 'bg-pink-500' },
  filmes_romance:     { label: 'Romance',            color: 'bg-rose-500' },
  filmes_aventura:    { label: 'Aventura',           color: 'bg-amber-600' },
  filmes_classicos:   { label: 'Clássicos',          color: 'bg-amber-800' },
  filmes_doc:         { label: 'Documentários',      color: 'bg-stone-600' },
  filmes_kids:        { label: 'Infantis',           color: 'bg-yellow-400' },
  netflix:            { label: 'Netflix',            color: 'bg-red-600' },
  hbo:                { label: 'HBO Max',            color: 'bg-purple-600' },
  disney:             { label: 'Disney+',            color: 'bg-blue-600' },
  amazon:             { label: 'Amazon Prime',       color: 'bg-orange-500' },
  telecine:           { label: 'Telecine',           color: 'bg-red-800' },
  globoplay:          { label: 'Globoplay',          color: 'bg-green-600' },
  star:               { label: 'Star+',              color: 'bg-yellow-500' },
  paramount:          { label: 'Paramount+',         color: 'bg-blue-500' },
  outros:             { label: 'Outros Filmes',      color: 'bg-slate-400' },
}

const LIVE_META: Record<string, { label: string; color: string }> = {
  canais_esportes:   { label: 'Esportes',        color: 'bg-green-600' },
  canais_globo:      { label: 'Globo',           color: 'bg-green-500' },
  canais_abertos:    { label: 'Canais Abertos',  color: 'bg-blue-500' },
  canais_hbo:        { label: 'HBO / Max',       color: 'bg-purple-600' },
  canais_sbt:        { label: 'SBT',             color: 'bg-blue-400' },
  canais_record:     { label: 'Record',          color: 'bg-red-600' },
  canais_band:       { label: 'Band',            color: 'bg-yellow-600' },
  canais_noticias:   { label: 'Notícias',        color: 'bg-slate-600' },
  canais_kids:       { label: 'Infantis',        color: 'bg-yellow-400' },
  canais_religiosos: { label: 'Religiosos',      color: 'bg-indigo-500' },
  canais_variedades: { label: 'Variedades',      color: 'bg-pink-500' },
  canais_4k:         { label: '4K ao Vivo',      color: 'bg-teal-600' },
  outros:            { label: 'Outros Canais',   color: 'bg-slate-400' },
}

const SPECIAL_SECTIONS = [
  { type: 'continue_watching',  label: 'Continuar Assistindo',    desc: 'Retoma o que o usuário estava assistindo',  color: 'bg-accent' },
  { type: 'recently_added',     label: 'Adicionados Recentemente', desc: 'Canais mais novos na playlist do usuário', color: 'bg-sky-600' },
  { type: 'editorial',          label: 'Em Destaque (Editorial)',  desc: 'Admin escolhe o que aparecer',             color: 'bg-purple-600' },
  { type: 'canonical_movies',   label: 'Filmes do Catálogo',      desc: 'Todos os filmes disponíveis',              color: 'bg-orange-500' },
  { type: 'canonical_series',   label: 'Séries do Catálogo',      desc: 'Todas as séries disponíveis',              color: 'bg-green-600' },
]

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Section {
  id: string
  home_id: string
  title: string
  type: string
  sort_order: number
  active: boolean
  config: any
}

interface HomeInfo {
  id: string
  name: string
  is_active: boolean
}

type TabKey = 'series' | 'movies' | 'live' | 'special' | 'playlist'

interface XtreamGroup {
  group_title: string
  content_type: string
  count: number
  playlist_name: string
  playlist_id: string
}

interface XtreamPlaylist {
  id: string
  url_original: string
  last_synced_at: string | null
  content_count: number | null
  presentation_mode: 'auto' | 'curated'
  home_id: string | null
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function HomeEditor() {
  const { id } = useParams<{ id: string }>()

  const [homeInfo,    setHomeInfo]    = useState<HomeInfo | null>(null)
  const [sections,    setSections]    = useState<Section[]>([])
  const [loadingHome, setLoadingHome] = useState(true)
  const [stats,       setStats]       = useState<Record<string, Record<string, number>>>({})
  const [statsLoading,setStatsLoading]= useState(true)
  const [activeTab,   setActiveTab]   = useState<TabKey>('series')
  const [editingSection, setEditingSection] = useState<Section | null>(null)
  const [editTitle,   setEditTitle]   = useState('')
  const [adding,      setAdding]      = useState<string | null>(null)
  const [xtreamGroups,    setXtreamGroups]    = useState<XtreamGroup[]>([])
  const [xtreamLoading,   setXtreamLoading]   = useState(false)
  const [xtreamPlaylists, setXtreamPlaylists] = useState<XtreamPlaylist[]>([])
  const [selectedPid,     setSelectedPid]     = useState<string | null>(null)
  const [togglingMode,    setTogglingMode]    = useState(false)
  const [assigningHome,   setAssigningHome]   = useState(false)

  // ── Carrega home + seções ─────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!id) return
    setLoadingHome(true)
    const [{ data: home }, { data: secs }] = await Promise.all([
      supabase.from('homes').select('id, name, is_active').eq('id', id).single(),
      supabase.from('home_sections').select('*').eq('home_id', id).order('sort_order'),
    ])
    setHomeInfo(home)
    setSections(secs || [])
    setLoadingHome(false)
  }, [id])

  // ── Carrega estatísticas do catálogo ──────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    const { data: rows } = await supabase
      .from('channels')
      .select('streaming, content_type')
      .in('content_type', ['series', 'movie', 'live'])
      .limit(200000)

    const acc: Record<string, Record<string, number>> = { series: {}, movie: {}, live: {} }
    for (const row of (rows || [])) {
      const ct = row.content_type as string || 'live'
      const st = row.streaming   as string || 'outros'
      if (!acc[ct]) acc[ct] = {}
      acc[ct][st] = (acc[ct][st] || 0) + 1
    }
    setStats(acc)
    setStatsLoading(false)
  }, [])

  const fetchXtreamPlaylists = useCallback(async () => {
    const { data } = await supabase
      .from('playlists')
      .select('id, url_original, last_synced_at, content_count, presentation_mode, home_id')
      .ilike('url_original', '%get.php?username=%')
      .order('created_at', { ascending: false })
    const list = (data || []) as XtreamPlaylist[]
    setXtreamPlaylists(list)
    setSelectedPid(prev => prev ?? (list[0]?.id || null))
  }, [])

  const fetchXtreamGroups = useCallback(async (pid: string) => {
    setXtreamLoading(true)
    const { data, error } = await supabase.rpc('get_playlist_group_counts', { p_playlist_id: pid })
    if (error) console.error('[HomeEditor] fetchXtreamGroups error:', error)
    if (data) {
      setXtreamGroups((data as any[]).map(row => ({
        group_title:  row.group_title,
        content_type: row.content_type,
        count:        Number(row.count),
        playlist_name: '',
        playlist_id:  row.playlist_id,
      })))
    }
    setXtreamLoading(false)
  }, [])

  useEffect(() => { fetchData(); fetchStats() }, [fetchData, fetchStats])
  useEffect(() => {
    if (activeTab === 'playlist') fetchXtreamPlaylists()
  }, [activeTab, fetchXtreamPlaylists])
  useEffect(() => {
    if (activeTab === 'playlist' && selectedPid) fetchXtreamGroups(selectedPid)
  }, [activeTab, selectedPid, fetchXtreamGroups])

  // ── Adicionar seção do catálogo ───────────────────────────────────────────
  async function addFromCatalog(
    streaming: string,
    contentType: string,
    label: string,
    sectionType: string,
  ) {
    const key = `${streaming}:${contentType}`
    setAdding(key)
    const config = contentType === 'special'
      ? null
      : { streaming, content_type: contentType }

    const { error } = await supabase.from('home_sections').insert({
      home_id:    id,
      title:      label,
      type:       sectionType,
      active:     true,
      config,
      sort_order: sections.length,
    })
    if (error) toast.error('Erro ao adicionar: ' + error.message)
    else { toast.success(`"${label}" adicionada!`); fetchData() }
    setAdding(null)
  }

  // ── Verifica se já está na home ───────────────────────────────────────────
  function isInHome(streaming: string, contentType: string): boolean {
    if (contentType === 'special') return sections.some(s => s.type === streaming)
    return sections.some(s =>
      s.config?.streaming === streaming && s.config?.content_type === contentType
    )
  }

  function isXtreamGroupInHome(groupTitle: string, contentType: string): boolean {
    return sections.some(s =>
      s.type === 'xtream_group' &&
      s.config?.group_title === groupTitle &&
      s.config?.content_type === contentType
    )
  }

  async function addXtreamGroup(group: XtreamGroup) {
    const key = `${group.group_title}||${group.content_type}`
    setAdding(key)
    const { error } = await supabase.from('home_sections').insert({
      home_id:    id,
      title:      group.group_title.replace(/^[^|]+\|\s*/, ''), // remove "Canais | " prefix
      type:       'xtream_group',
      active:     true,
      config:     { group_title: group.group_title, content_type: group.content_type, playlist_id: group.playlist_id },
      sort_order: sections.length,
    })
    if (error) toast.error('Erro ao adicionar: ' + error.message)
    else { toast.success(`"${group.group_title}" adicionada!`); fetchData() }
    setAdding(null)
  }

  // Enterprise: alterna presentation_mode da playlist (auto ↔ curated)
  async function togglePresentationMode(playlist: XtreamPlaylist) {
    setTogglingMode(true)
    const next = playlist.presentation_mode === 'curated' ? 'auto' : 'curated'
    const { error } = await supabase
      .from('playlists')
      .update({ presentation_mode: next })
      .eq('id', playlist.id)
    if (error) toast.error('Erro ao atualizar modo: ' + error.message)
    else toast.success(next === 'curated' ? '✅ Modo Curado ativado — TV usará esta home' : '🔄 Modo Auto ativado — TV mostra tudo da lista')
    setTogglingMode(false)
    fetchXtreamPlaylists()
  }

  // Enterprise: linka esta home à playlist selecionada
  async function assignHomeToPlaylist(playlist: XtreamPlaylist) {
    setAssigningHome(true)
    const alreadyLinked = playlist.home_id === id
    const { error } = await supabase
      .from('playlists')
      .update({ home_id: alreadyLinked ? null : id })
      .eq('id', playlist.id)
    if (error) toast.error('Erro ao vincular home: ' + error.message)
    else toast.success(alreadyLinked ? 'Home desvinculada' : '🔗 Esta home vinculada à playlist!')
    setAssigningHome(false)
    fetchXtreamPlaylists()
  }

  // ── Ações das seções ──────────────────────────────────────────────────────
  async function handleToggle(s: Section) {
    await supabase.from('home_sections').update({ active: !s.active }).eq('id', s.id)
    setSections(prev => prev.map(sec => sec.id === s.id ? { ...sec, active: !sec.active } : sec))
  }

  async function handleDelete(s: Section) {
    if (!confirm(`Remover "${s.title}" da home?`)) return
    await supabase.from('home_sections').delete().eq('id', s.id)
    toast.success('Seção removida')
    fetchData()
  }

  async function handleRename(s: Section) {
    if (!editTitle.trim()) return
    await supabase.from('home_sections').update({ title: editTitle }).eq('id', s.id)
    toast.success('Título atualizado')
    setEditingSection(null)
    fetchData()
  }

  async function moveSection(index: number, dir: -1 | 1) {
    const sorted = [...sections].sort((a, b) => a.sort_order - b.sort_order)
    const target = index + dir
    if (target < 0 || target >= sorted.length) return
    const a = sorted[index]
    const b = sorted[target]
    await Promise.all([
      supabase.from('home_sections').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('home_sections').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    fetchData()
  }

  // ─── Renderização do catálogo ───────────────────────────────────────────────

  function CatalogRow({
    streaming, contentType, label, color, count, sectionType,
  }: {
    streaming: string; contentType: string; label: string
    color: string; count: number; sectionType: string
  }) {
    const inHome  = isInHome(streaming, contentType)
    const key     = `${streaming}:${contentType}`
    const loading = adding === key

    return (
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
        inHome ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface hover:bg-elevated'
      }`}>
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-text-primary">{label}</span>
        </div>
        {count > 0 && (
          <span className="text-xs font-mono text-text-muted bg-elevated px-1.5 py-0.5 rounded border border-border flex-shrink-0">
            {count.toLocaleString('pt-BR')}
          </span>
        )}
        {inHome ? (
          <span className="flex items-center gap-1 text-xs text-accent font-medium flex-shrink-0 px-2">
            <Check className="w-3 h-3" /> Na home
          </span>
        ) : (
          <button
            onClick={() => addFromCatalog(streaming, contentType, label, sectionType)}
            disabled={!!loading}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 flex-shrink-0"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Adicionar
          </button>
        )}
      </div>
    )
  }

  function renderCatalog() {
    if (statsLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
          <span className="ml-2 text-sm text-text-muted">Carregando catálogo...</span>
        </div>
      )
    }

    if (activeTab === 'series') {
      const data = stats['series'] || {}
      const sorted = Object.entries(data).sort((a, b) => b[1] - a[1])
      const known   = sorted.filter(([k]) => SERIES_META[k])
      const unknown = sorted.filter(([k]) => !SERIES_META[k])
      const items   = [...known, ...unknown]

      if (items.length === 0) return <EmptyCatalog label="séries" />

      return (
        <div className="space-y-1.5">
          {items.map(([streaming, count]) => {
            const meta = SERIES_META[streaming] || { label: streaming, color: 'bg-slate-400' }
            return (
              <CatalogRow
                key={streaming}
                streaming={streaming}
                contentType="series"
                label={meta.label}
                color={meta.color}
                count={count}
                sectionType="by_streaming"
              />
            )
          })}
        </div>
      )
    }

    if (activeTab === 'movies') {
      const data = stats['movie'] || {}
      const sorted = Object.entries(data).sort((a, b) => b[1] - a[1])
      const known   = sorted.filter(([k]) => MOVIE_META[k])
      const unknown = sorted.filter(([k]) => !MOVIE_META[k])
      const items   = [...known, ...unknown]

      if (items.length === 0) return <EmptyCatalog label="filmes" />

      return (
        <div className="space-y-1.5">
          {items.map(([streaming, count]) => {
            const meta = MOVIE_META[streaming] || { label: streaming, color: 'bg-slate-400' }
            return (
              <CatalogRow
                key={streaming}
                streaming={streaming}
                contentType="movie"
                label={meta.label}
                color={meta.color}
                count={count}
                sectionType="by_streaming"
              />
            )
          })}
        </div>
      )
    }

    if (activeTab === 'live') {
      const data = stats['live'] || {}
      const sorted = Object.entries(data).sort((a, b) => b[1] - a[1])
      const known   = sorted.filter(([k]) => LIVE_META[k])
      const unknown = sorted.filter(([k]) => !LIVE_META[k])
      const items   = [...known, ...unknown]

      if (items.length === 0) return <EmptyCatalog label="canais ao vivo" />

      return (
        <div className="space-y-1.5">
          {items.map(([streaming, count]) => {
            const meta = LIVE_META[streaming] || { label: streaming, color: 'bg-slate-400' }
            return (
              <CatalogRow
                key={streaming}
                streaming={streaming}
                contentType="live"
                label={meta.label}
                color={meta.color}
                count={count}
                sectionType="live_featured"
              />
            )
          })}
        </div>
      )
    }

    if (activeTab === 'special') {
      return (
        <div className="space-y-1.5">
          {SPECIAL_SECTIONS.map(sp => {
            const inHome  = isInHome(sp.type, 'special')
            const loading = adding === `${sp.type}:special`
            return (
              <div
                key={sp.type}
                className={`flex items-start gap-3 px-3 py-3 rounded-lg border transition-all ${
                  inHome ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface hover:bg-elevated'
                }`}
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${sp.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{sp.label}</p>
                  <p className="text-xs text-text-muted mt-0.5">{sp.desc}</p>
                </div>
                {inHome ? (
                  <span className="flex items-center gap-1 text-xs text-accent font-medium flex-shrink-0 px-2 mt-0.5">
                    <Check className="w-3 h-3" /> Na home
                  </span>
                ) : (
                  <button
                    onClick={() => addFromCatalog(sp.type, 'special', sp.label, sp.type)}
                    disabled={!!loading}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 flex-shrink-0 mt-0.5"
                  >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    Adicionar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )
    }

    if (activeTab === 'playlist') {
      const selectedPl   = xtreamPlaylists.find(p => p.id === selectedPid)
      const liveGroups   = xtreamGroups.filter(g => g.content_type === 'live')
      const movieGroups  = xtreamGroups.filter(g => g.content_type === 'movie')
      const seriesGroups = xtreamGroups.filter(g => g.content_type === 'series')

      function XtreamGroupRow({ group }: { group: XtreamGroup }) {
        const inHome  = isXtreamGroupInHome(group.group_title, group.content_type)
        const rowKey  = `${group.group_title}||${group.content_type}`
        const loading = adding === rowKey
        return (
          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
            inHome ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface hover:bg-elevated'
          }`}>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              group.content_type === 'live' ? 'bg-green-500' :
              group.content_type === 'movie' ? 'bg-blue-500' : 'bg-purple-500'
            }`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{group.group_title}</p>
            </div>
            {group.count > 1 && (
              <span className="text-xs font-mono text-text-muted bg-elevated px-1.5 py-0.5 rounded border border-border flex-shrink-0">
                {group.count.toLocaleString('pt-BR')}
              </span>
            )}
            {inHome ? (
              <span className="flex items-center gap-1 text-xs text-accent font-medium flex-shrink-0 px-2">
                <Check className="w-3 h-3" /> Na home
              </span>
            ) : (
              <button
                onClick={() => addXtreamGroup(group)}
                disabled={!!loading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 flex-shrink-0"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Adicionar
              </button>
            )}
          </div>
        )
      }

      return (
        <div className="space-y-3">
          {/* Seletor de playlist */}
          <div className="flex items-center gap-2">
            <select
              value={selectedPid || ''}
              onChange={e => { setSelectedPid(e.target.value || null); setXtreamGroups([]) }}
              className="flex-1 text-xs bg-elevated border border-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-accent"
            >
              {xtreamPlaylists.length === 0
                ? <option value="">Nenhuma playlist Xtream cadastrada</option>
                : xtreamPlaylists.map(pl => {
                    const host = (() => { try { return new URL(pl.url_original).host } catch { return pl.id.slice(0, 8) } })()
                    return <option key={pl.id} value={pl.id}>{host}</option>
                  })
              }
            </select>
          </div>

          {/* Enterprise controls: modo + vínculo */}
          {selectedPl && (
            <div className="flex gap-2">
              <button
                onClick={() => togglePresentationMode(selectedPl)}
                disabled={togglingMode}
                title={selectedPl.presentation_mode === 'curated' ? 'Clique para usar modo Auto (mostra tudo)' : 'Clique para ativar Modo Curado (usa esta home)'}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ${
                  selectedPl.presentation_mode === 'curated'
                    ? 'bg-accent text-white hover:bg-accent/80'
                    : 'bg-elevated border border-border text-text-muted hover:border-accent hover:text-accent'
                }`}
              >
                {togglingMode ? <Loader2 className="w-3 h-3 animate-spin" /> : selectedPl.presentation_mode === 'curated' ? <CheckCircle2 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {selectedPl.presentation_mode === 'curated' ? 'Modo Curado (ativo)' : 'Ativar Modo Curado'}
              </button>
              <button
                onClick={() => assignHomeToPlaylist(selectedPl)}
                disabled={assigningHome}
                title={selectedPl.home_id === id ? 'Desvincular esta home da playlist' : 'Vincular esta home à playlist'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ${
                  selectedPl.home_id === id
                    ? 'bg-green-700/30 border border-green-500/40 text-green-400'
                    : 'bg-elevated border border-border text-text-muted hover:border-green-500 hover:text-green-400'
                }`}
              >
                {assigningHome ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                {selectedPl.home_id === id ? 'Home vinculada ✓' : 'Vincular esta Home'}
              </button>
            </div>
          )}

          {selectedPl?.last_synced_at && (
            <p className="text-[10px] text-text-muted px-0.5">
              📡 Sincronizado pela TV em {new Date(selectedPl.last_synced_at).toLocaleString('pt-BR')}
              {selectedPl.content_count != null && ` · ${selectedPl.content_count.toLocaleString('pt-BR')} itens`}
            </p>
          )}
          {selectedPl && !selectedPl.last_synced_at && (
            <p className="text-[10px] text-yellow-500/80 px-0.5">
              ⏳ Aguardando sincronização — abra a lista na TV com o código
            </p>
          )}

          {xtreamPlaylists.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted px-4">
              <List className="w-7 h-7 mb-2 opacity-40" />
              <p className="text-sm">Nenhuma playlist Xtream cadastrada.</p>
            </div>
          ) : xtreamLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
              <span className="ml-2 text-xs text-text-muted">Carregando grupos...</span>
            </div>
          ) : xtreamGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted px-4">
              <Tv2 className="w-7 h-7 mb-2 opacity-40" />
              <p className="text-sm font-medium mb-1">Aguardando sincronização da TV</p>
              <p className="text-xs mb-1">Os grupos aparecem aqui após você abrir a lista na TV com o código.</p>
              <p className="text-[10px] opacity-60">O servidor IPTV só aceita IPs residenciais — por isso a TV faz o sync.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {liveGroups.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-green-400 uppercase tracking-wider mb-1.5 px-1">Canais ao Vivo · {liveGroups.length}</p>
                  <div className="space-y-1.5">{liveGroups.map(g => <XtreamGroupRow key={`${g.group_title}||${g.content_type}`} group={g} />)}</div>
                </div>
              )}
              {movieGroups.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1.5 px-1">Filmes · {movieGroups.length}</p>
                  <div className="space-y-1.5">{movieGroups.map(g => <XtreamGroupRow key={`${g.group_title}||${g.content_type}`} group={g} />)}</div>
                </div>
              )}
              {seriesGroups.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1.5 px-1">Séries · {seriesGroups.length}</p>
                  <div className="space-y-1.5">{seriesGroups.map(g => <XtreamGroupRow key={`${g.group_title}||${g.content_type}`} group={g} />)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  function EmptyCatalog({ label }: { label: string }) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-text-muted">
        <p className="text-sm">Nenhum(a) {label} encontrado(a) no banco.</p>
        <p className="text-xs mt-1">Faça upload de uma playlist M3U primeiro.</p>
      </div>
    )
  }

  // ─── Estatísticas do catálogo por tab ────────────────────────────────────────

  function tabCount(tab: TabKey): number {
    if (tab === 'series')  return Object.values(stats['series']  || {}).reduce((a, b) => a + b, 0)
    if (tab === 'movies')  return Object.values(stats['movie']   || {}).reduce((a, b) => a + b, 0)
    if (tab === 'live')    return Object.values(stats['live']    || {}).reduce((a, b) => a + b, 0)
    return 0
  }

  function tabCategoryCount(tab: TabKey): number {
    if (tab === 'series')  return Object.keys(stats['series']  || {}).length
    if (tab === 'movies')  return Object.keys(stats['movie']   || {}).length
    if (tab === 'live')    return Object.keys(stats['live']    || {}).length
    return SPECIAL_SECTIONS.length
  }

  const sorted = [...sections].sort((a, b) => a.sort_order - b.sort_order)

  const TABS: { key: TabKey; label: string; Icon: any }[] = [
    { key: 'series',   label: 'Séries',   Icon: Clapperboard },
    { key: 'movies',   label: 'Filmes',   Icon: Film },
    { key: 'live',     label: 'Canais',   Icon: Tv2 },
    { key: 'special',  label: 'Especiais', Icon: Sparkles },
    { key: 'playlist', label: 'Playlist', Icon: List },
  ]

  return (
    <div className="h-full flex flex-col" style={{ minHeight: 0 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border flex-shrink-0">
        <Link to="/homes" className="p-2 rounded-lg text-text-muted hover:bg-elevated transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-text-primary truncate">
              {loadingHome ? '...' : homeInfo?.name || 'Home'}
            </h1>
            {homeInfo?.is_active && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-xs rounded-full font-medium flex-shrink-0">
                <CheckCircle2 className="w-3 h-3" /> Ativa na TV
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Clique em <strong>Adicionar</strong> no catálogo para montar os trilhos da home
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-text-muted">Seções ativas</p>
          <p className="text-2xl font-bold text-text-primary">{sections.filter(s => s.active).length}</p>
        </div>
      </div>

      {/* ── Corpo — dois painéis ────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Painel esquerdo: Catálogo ────────────────────────────────────── */}
        <div className="w-[58%] flex flex-col border-r border-border overflow-hidden">

          {/* Tabs */}
          <div className="flex border-b border-border flex-shrink-0">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex-1 flex flex-col items-center py-3 px-2 text-xs font-medium transition-colors border-b-2 gap-0.5 ${
                  activeTab === key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
                {!statsLoading && key !== 'special' && (
                  <span className="text-[10px] font-mono opacity-70">
                    {tabCount(key).toLocaleString('pt-BR')}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Sub-header com totais */}
          {!statsLoading && activeTab !== 'special' && (
            <div className="px-4 py-2 bg-elevated/50 border-b border-border flex items-center gap-3 flex-shrink-0">
              <span className="text-xs text-text-muted">
                <strong className="text-text-primary">{tabCategoryCount(activeTab)}</strong> categorias ·{' '}
                <strong className="text-text-primary">{tabCount(activeTab).toLocaleString('pt-BR')}</strong> itens no banco
              </span>
              <span className="text-xs text-text-muted">·</span>
              <span className="text-xs text-accent">
                {sections.filter(s =>
                  activeTab === 'series' ? s.config?.content_type === 'series' :
                  activeTab === 'movies' ? s.config?.content_type === 'movie' :
                  activeTab === 'live'   ? s.config?.content_type === 'live' : false
                ).length} na home
              </span>
            </div>
          )}

          {/* Lista de itens */}
          <div className="flex-1 overflow-y-auto p-4">
            {renderCatalog()}
          </div>
        </div>

        {/* ── Painel direito: Seções da Home ───────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Seções da Home</h2>
              <p className="text-xs text-text-muted">{sorted.length} seções · arraste para reordenar</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loadingHome ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <p className="text-sm text-text-muted mb-1">Nenhuma seção ainda</p>
                <p className="text-xs text-text-muted">Use o catálogo ao lado para adicionar rows</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sorted.map((s, i) => (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-2.5 transition-all ${
                      s.active ? 'border-border bg-surface' : 'border-border/50 bg-surface/50 opacity-60'
                    }`}
                  >
                    {/* Linha principal */}
                    <div className="flex items-center gap-2">
                      {/* Reordenar */}
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => moveSection(i, -1)}
                          disabled={i === 0}
                          className="text-text-faint hover:text-text-primary disabled:opacity-20 transition-colors"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <GripVertical className="w-3 h-3 text-text-faint" />
                        <button
                          onClick={() => moveSection(i, 1)}
                          disabled={i === sorted.length - 1}
                          className="text-text-faint hover:text-text-primary disabled:opacity-20 transition-colors"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Número */}
                      <div className="w-5 h-5 rounded bg-elevated flex items-center justify-center text-[10px] text-text-muted font-mono flex-shrink-0">
                        {i + 1}
                      </div>

                      {/* Título e config */}
                      {editingSection?.id === s.id ? (
                        <input
                          autoFocus
                          className="flex-1 text-sm bg-elevated border border-accent rounded px-2 py-0.5 text-text-primary focus:outline-none"
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRename(s)
                            if (e.key === 'Escape') setEditingSection(null)
                          }}
                          onBlur={() => handleRename(s)}
                        />
                      ) : (
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-text-primary truncate">{s.title}</p>
                          <p className="text-[10px] text-text-muted truncate">
                            {s.config?.streaming && (
                              <span className="font-mono">{s.config.streaming}</span>
                            )}
                            {s.config?.content_type && (
                              <span> · {s.config.content_type}</span>
                            )}
                            {!s.config && s.type}
                          </p>
                        </div>
                      )}

                      {/* Ações */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleToggle(s)}
                          className={`p-1 rounded transition-colors ${
                            s.active
                              ? 'text-green-400 hover:text-text-muted'
                              : 'text-text-muted hover:text-green-400'
                          }`}
                          title={s.active ? 'Ocultar' : 'Mostrar'}
                        >
                          {s.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => { setEditingSection(s); setEditTitle(s.title) }}
                          className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
                          title="Renomear"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          className="p-1 rounded text-text-muted hover:text-danger transition-colors"
                          title="Remover"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de rename inline — handled via input above */}
    </div>
  )
}
