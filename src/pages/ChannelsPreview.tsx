import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'

// Preview real da Home — antes esta página ignorava completamente qual Home
// estava selecionada e mostrava sempre a mesma grade genérica de streamings.
// Agora ela lê `home_id` da URL (igual `Homes.tsx` já manda em
// `/admin/preview?home_id=...`), busca as seções reais dessa Home e resolve
// cada uma contra as tabelas `channels`/`canonical_titles` — a mesma regra que
// `ziiiTV/src/services/curatedHome.ts` usa no app da TV, só que reimplementada
// aqui do lado do admin (repos separados, sem pacote compartilhado ainda).

interface HomeSection {
  id: string
  title: string
  type: string
  sort_order: number
  active: boolean
  config: { group_title?: string; content_type?: string; streaming?: string } | null
}

interface PreviewItem {
  id: string
  title: string
  poster: string | null
  rating: number | null
  channelCount: number
}

interface PreviewRow {
  section: HomeSection
  items: PreviewItem[]
  /** true pros tipos que dependem de dado dinâmico do usuário (histórico) — não dá pra prever aqui */
  unavailable?: boolean
}

const NO_PREVIEW_TYPES: Record<string, string> = {
  continue_watching: 'Depende do histórico de cada usuário — não aparece aqui, mas é gerado automaticamente na TV.',
  recently_added: 'Ainda não existe data de "adicionado em" por canal — seção não produz conteúdo hoje (ver plano).',
  editorial: 'Curadoria manual item-a-item ainda não tem UI — seção não produz conteúdo hoje.',
}

export function ChannelsPreview() {
  const [searchParams] = useSearchParams()
  const homeId = searchParams.get('home_id')

  const [homeName, setHomeName] = useState<string | null>(null)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const [channels, setChannels] = useState<any[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)

  const loadPreview = useCallback(async () => {
    setLoading(true)
    try {
      let resolvedHomeId = homeId
      if (!resolvedHomeId) {
        const { data: activeHome } = await supabase.from('homes').select('id, name').eq('is_active', true).maybeSingle()
        resolvedHomeId = activeHome?.id ?? null
        if (activeHome) setHomeName(activeHome.name)
      } else {
        const { data: home } = await supabase.from('homes').select('name').eq('id', resolvedHomeId).maybeSingle()
        setHomeName(home?.name ?? null)
      }

      if (!resolvedHomeId) {
        setRows([])
        return
      }

      const { data: sections } = await supabase
        .from('home_sections')
        .select('id, title, type, sort_order, active, config')
        .eq('home_id', resolvedHomeId)
        .eq('active', true)
        .order('sort_order')

      const built: PreviewRow[] = []
      for (const section of (sections || []) as HomeSection[]) {
        if (section.type in NO_PREVIEW_TYPES) {
          built.push({ section, items: [], unavailable: true })
          continue
        }
        built.push({ section, items: await resolveSection(section) })
      }
      setRows(built)
    } catch (err) {
      console.error('Erro ao carregar preview:', err)
    } finally {
      setLoading(false)
    }
  }, [homeId])

  useEffect(() => { loadPreview() }, [loadPreview])

  async function resolveSection(section: HomeSection): Promise<PreviewItem[]> {
    const config = section.config

    if (section.type === 'xtream_group' || section.type === 'live_featured') {
      if (!config?.group_title) return []
      let q = supabase.from('channels').select('id, name, canonical_id').eq('group_name', config.group_title).limit(200)
      if (config.content_type) q = q.eq('content_type', config.content_type)
      const { data: chans } = await q
      return groupChannelsByTitle(chans || [])
    }

    if (section.type === 'by_streaming') {
      if (!config?.streaming) return []
      let q = supabase.from('canonical_titles').select('id, title, poster, rating').eq('streaming', config.streaming).limit(200)
      if (config.content_type) q = q.eq('type', config.content_type)
      const { data: titles } = await q
      return (titles || []).map((t: any) => ({ id: t.id, title: t.title, poster: t.poster, rating: t.rating, channelCount: 0 }))
    }

    if (section.type === 'canonical_movies' || section.type === 'canonical_series' || section.type === 'canonical') {
      const type = section.type === 'canonical_series' ? 'series' : section.type === 'canonical_movies' ? 'movie' : null
      let q = supabase.from('canonical_titles').select('id, title, poster, rating').order('rating', { ascending: false }).limit(200)
      if (type) q = q.eq('type', type)
      const { data: titles } = await q
      return (titles || []).map((t: any) => ({ id: t.id, title: t.title, poster: t.poster, rating: t.rating, channelCount: 0 }))
    }

    return []
  }

  function groupChannelsByTitle(chans: any[]): PreviewItem[] {
    const byId = new Map<string, PreviewItem>()
    for (const ch of chans) {
      const key = ch.canonical_id || ch.id
      const existing = byId.get(key)
      if (existing) { existing.channelCount++; continue }
      byId.set(key, { id: ch.canonical_id || ch.id, title: ch.name, poster: null, rating: null, channelCount: 1 })
    }
    return [...byId.values()]
  }

  const loadChannels = async (canonicalId: string) => {
    setLoadingChannels(true)
    setSelectedRow(canonicalId)
    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq('canonical_id', canonicalId)
        .limit(50)

      if (error) throw error
      setChannels(data || [])
    } catch (error) {
      console.error('Error loading channels:', error)
    } finally {
      setLoadingChannels(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Carregando preview...</div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-center">
        <div className="text-gray-300 font-medium">Nenhuma seção pra mostrar</div>
        <div className="text-sm text-gray-500 max-w-md">
          {homeId
            ? 'Essa Home não tem seções ativas ainda — organize pelo Home Editor.'
            : 'Não há Home ativa nem home_id na URL. Abra o preview a partir de uma Home específica.'}
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
      {/* Lista de Rows — igual à ordem real que a TV vai mostrar */}
      <div className="col-span-4 overflow-y-auto bg-gray-900 rounded-lg p-4">
        <h2 className="text-lg font-bold text-white mb-1">
          Preview — {homeName || 'Home'}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{rows.length} fileiras, na ordem em que aparecem na TV</p>
        <div className="space-y-2">
          {rows.map(({ section, items, unavailable }, idx) => (
            <div key={section.id} className="bg-gray-800 rounded-lg p-3">
              <div className="text-white font-medium mb-1 flex items-center gap-2">
                <span className="text-xs font-mono text-gray-500">{idx + 1}</span>
                {section.title}
              </div>
              {unavailable ? (
                <div className="text-xs text-yellow-500/80 italic">{NO_PREVIEW_TYPES[section.type]}</div>
              ) : (
                <>
                  <div className="text-sm text-gray-400 mb-2">{items.length} títulos</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {items.slice(0, 10).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => loadChannels(item.id)}
                        className={`w-full text-left px-2 py-1 rounded text-xs ${
                          selectedRow === item.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700/50 hover:bg-gray-700 text-gray-300'
                        }`}
                      >
                        {item.title}{item.channelCount > 0 ? ` (${item.channelCount})` : ''}
                      </button>
                    ))}
                    {items.length > 10 && (
                      <div className="text-xs text-gray-500 px-2 py-1">+{items.length - 10} mais...</div>
                    )}
                    {items.length === 0 && (
                      <div className="text-xs text-gray-600 px-2 py-1">Nenhum item encontrado pra essa configuração</div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Canais */}
      <div className="col-span-8 overflow-y-auto bg-gray-900 rounded-lg p-4">
        {!selectedRow ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            Selecione um título para ver os canais
          </div>
        ) : loadingChannels ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            Carregando canais...
          </div>
        ) : (
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-white mb-4">
              {channels.length} canais
            </h2>
            {channels.map((ch) => (
              <Card key={ch.id} className="p-4 cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => window.open(`/channels/${ch.id}`, '_blank')}>
                <div className="flex items-center gap-4">
                  {ch.logo_url && (
                    <img src={ch.logo_url} alt="" className="w-12 h-12 object-contain" />
                  )}
                  <div className="flex-1">
                    <h3 className="font-medium text-white">{ch.name}</h3>
                    <p className="text-sm text-gray-400">{ch.group_name}</p>
                  </div>
                  <div className="text-sm text-gray-400">
                    {ch.streams?.length || 0} stream{(ch.streams?.length || 0) > 1 ? 's' : ''}
                  </div>
                  {ch.canonical_id && <span className="text-xs text-green-400">✓ TMDB</span>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
