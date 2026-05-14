import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { AutoEnrichBanner } from '../components/AutoEnrichBanner'
import { supabase } from '../lib/supabase'
import { globalChannelCache, globalPlaylistCache } from '../lib/channelCache'
import { ArrowLeft, Tv, Film, Star, BarChart2, Shield, Search, ChevronRight, Activity, Percent, ArrowDownToLine, Zap } from 'lucide-react'

interface Channel {
  id: string
  name: string
  streams: { u: string; q: string }[]
  group_name: string | null
  logo_url: string | null
  content_type: string | null
  streaming: string | null
  canonical_titles: {
    title: string
    poster: string | null
    rating: number | null
    type: string | null
    overview: string | null
    tmdb_id?: number | null
  } | null
}

interface Playlist {
  id: string
  url_original: string
  status: string
  channel_count: number
  created_at: string
  processed_at: string | null
}

export function PlaylistChannels() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // "dashboard" | "streaming:netflix" | "category:filmes"
  const [activeView, setActiveView] = useState('dashboard')

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 54 // Multiple of 1, 2 and 3 columns

  useEffect(() => {
    setPage(1)
  }, [activeView, search])

  useEffect(() => {
    if (id) load(id)
  }, [id])

  const load = async (playlistId: string) => {
    setLoading(true)
    try {
      if (globalChannelCache[playlistId] && globalPlaylistCache[playlistId]) {
        setPlaylist(globalPlaylistCache[playlistId])
        setChannels(globalChannelCache[playlistId])
        setLoading(false)
        return
      }

      const [{ data: pl }] = await Promise.all([
        supabase.from('playlists').select('*').eq('id', playlistId).single(),
      ])
      
      let allChannels: Channel[] = []
      let offset = 0
      const limit = 1000
      let hasMore = true
      
      while (hasMore) {
        const { data: chs, error } = await supabase
          .from('channels')
          .select('id, name, streams, group_name, logo_url, content_type, streaming, canonical_titles(title, poster, rating, type, overview)')
          .eq('playlist_id', playlistId)
          .order('name')
          .range(offset, offset + limit - 1)
          
        if (error) throw error
        if (chs && chs.length > 0) {
          allChannels = allChannels.concat(chs as any[])
          offset += limit
          if (chs.length < limit) hasMore = false
        } else {
          hasMore = false
        }
      }

      globalPlaylistCache[playlistId] = pl
      globalChannelCache[playlistId] = allChannels

      setPlaylist(pl)
      setChannels(allChannels)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const {
    totalOriginalLinks,
    totalTitles,
    totalMatched,
    platforms,
    categories,
    matchedCategories
  } = useMemo(() => {
    let totalOriginalLinks = 0
    let totalMatched = 0
    const platformMap: Record<string, Channel[]> = {}
    const categoryMap: Record<string, Channel[]> = {
      filmes: [],
      series: [],
      live: [],
      outros: []
    }
    const matchedMap: Record<string, Channel[]> = {
      todos: [],
      filmes: [],
      series: [],
      live: []
    }

    channels.forEach(ch => {
      totalOriginalLinks += (ch.streams?.length || 1)
      if (ch.canonical_titles) {
        totalMatched++
        matchedMap.todos.push(ch)
        if (ch.content_type === 'movie') matchedMap.filmes.push(ch)
        else if (ch.content_type === 'series') matchedMap.series.push(ch)
        else if (ch.content_type === 'live') matchedMap.live.push(ch)
      }

      if (ch.streaming) {
        if (!platformMap[ch.streaming]) platformMap[ch.streaming] = []
        platformMap[ch.streaming].push(ch)
      }

      if (ch.content_type === 'movie') categoryMap.filmes.push(ch)
      else if (ch.content_type === 'series') categoryMap.series.push(ch)
      else if (ch.content_type === 'live') categoryMap.live.push(ch)
      else categoryMap.outros.push(ch)
    })

    return {
      totalOriginalLinks,
      totalTitles: channels.length,
      totalMatched,
      platforms: platformMap,
      categories: categoryMap,
      matchedCategories: matchedMap
    }
  }, [channels])

  const compressionRatio = totalOriginalLinks > 0 
    ? ((1 - (totalTitles / totalOriginalLinks)) * 100).toFixed(1)
    : '0.0'

  const matchedPercent = totalTitles > 0 
    ? ((totalMatched / totalTitles) * 100).toFixed(1)
    : '0.0'

  const filteredChannels = useMemo(() => {
    let list: Channel[] = []
    if (activeView === 'dashboard') return []
    
    if (activeView.startsWith('match:')) {
      const cat = activeView.split(':')[1]
      list = matchedCategories[cat] || []
    } else if (activeView.startsWith('streaming:')) {
      const platform = activeView.split(':')[1]
      list = platforms[platform] || []
    } else if (activeView.startsWith('category:')) {
      const cat = activeView.split(':')[1]
      list = categories[cat] || []
    } else if (activeView === 'all') {
      list = channels
    }

    if (search.trim()) {
      const term = search.toLowerCase()
      return list.filter(ch => 
        ch.name.toLowerCase().includes(term) || 
        (ch.canonical_titles?.title || '').toLowerCase().includes(term)
      )
    }
    return list
  }, [activeView, channels, platforms, categories, matchedCategories, search])

  if (loading) {
    return (
      <div className="space-y-6">
        <Header title="Detalhes da Playlist" description="Carregando..." />
        <Card><p className="text-gray-400">Carregando dados da inteligência ZiiiTV...</p></Card>
      </div>
    )
  }

  const renderDashboard = () => (
    <div className="space-y-6 animate-in fade-in">
      {/* Enrich CTA */}
      <div className="flex justify-end">
        <button
          onClick={() => navigate(`/enrich/${id}`)}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-black font-bold text-sm rounded-xl transition-all shadow-lg shadow-orange-900/30">
          <Zap className="w-4 h-4" /> Enriquecer com TMDB
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <ArrowDownToLine className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="text-gray-300 font-medium">Links M3U Processados</h3>
          </div>
          <div className="text-4xl font-bold text-white mb-1">{totalOriginalLinks.toLocaleString()}</div>
          <div className="text-sm text-gray-400">Streams/URLs sujas identificadas</div>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border-indigo-500/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-500/20 rounded-lg">
              <Shield className="w-5 h-5 text-indigo-400" />
            </div>
            <h3 className="text-gray-300 font-medium">Títulos Consolidados</h3>
          </div>
          <div className="text-4xl font-bold text-indigo-300 mb-1">{totalTitles.toLocaleString()}</div>
          <div className="text-sm text-indigo-300/70">Cards/Filmes únicos no ZiiiTV</div>
        </Card>

        <Card className="bg-gradient-to-br from-green-900/40 to-emerald-900/40 border-green-500/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Percent className="w-5 h-5 text-green-400" />
            </div>
            <h3 className="text-gray-300 font-medium">Taxa de Compressão</h3>
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-4xl font-bold text-green-400 mb-1">{compressionRatio}%</div>
          </div>
          <div className="text-sm text-green-400/70">Redução mantendo o mesmo conteúdo</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500" /> Catálogo TMDB
          </h3>
          <div className="space-y-4">
             <div className="flex justify-between text-sm">
                <span className="text-gray-400">Títulos Identificados</span>
                <span className="font-medium text-white">{totalMatched.toLocaleString()} ({matchedPercent}%)</span>
             </div>
             <div className="w-full bg-gray-800 rounded-full h-2">
               <div className="bg-gradient-to-r from-yellow-500 to-orange-500 h-full rounded-full" style={{ width: `${matchedPercent}%` }} />
             </div>
             <p className="text-sm text-gray-500 pt-2 border-t border-gray-800">
               Estes são os títulos que o ZiiiTV conseguiu limpar, formatar e obter capas HD, sinopses e nota de avaliação reais da internet.
             </p>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" /> Distribuição ZiiiTV
          </h3>
          <div className="space-y-3">
             {[
               { label: 'Filmes', val: categories.filmes.length, color: 'text-blue-400', icon: Film },
               { label: 'Séries', val: categories.series.length, color: 'text-pink-400', icon: Tv },
               { label: 'Ao Vivo', val: categories.live.length, color: 'text-orange-400', icon: Activity },
               { label: 'Outros', val: categories.outros.length, color: 'text-gray-400', icon: Shield },
             ].map(item => (
               <div key={item.label} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/40">
                 <div className="flex items-center gap-3">
                   <item.icon className={`w-4 h-4 ${item.color}`} />
                   <span className="text-gray-300 font-medium">{item.label}</span>
                 </div>
                 <span className="text-white font-bold">{item.val.toLocaleString()}</span>
               </div>
             ))}
          </div>
        </Card>
      </div>
    </div>
  )

  const renderChannelList = () => {
    const paginatedChannels = filteredChannels.slice(0, page * PAGE_SIZE)

    return (
      <div className="space-y-4 animate-in fade-in">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-white capitalize flex items-center gap-2">
            {activeView.split(':')[1] || 'Canais'} 
            <span className="px-2 py-0.5 bg-gray-800 text-gray-400 rounded-full text-xs font-normal">
              {filteredChannels.length}
            </span>
          </h2>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input 
              type="text" 
              placeholder="Buscar canal..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 w-64"
            />
          </div>
        </div>
        
        {filteredChannels.length === 0 ? (
          <Card className="py-12 text-center text-gray-500">Nenhum canal encontrado.</Card>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
              {paginatedChannels.map(ch => {
                 const hasTMDB = !!ch.canonical_titles?.tmdb_id;
                 return (
                 <div key={ch.id} onClick={() => navigate(`/channels/${ch.id}`)} className={`flex items-start gap-3 p-3 rounded-xl transition relative overflow-hidden group cursor-pointer ${
                   hasTMDB 
                     ? 'bg-gradient-to-r from-yellow-500/10 to-transparent border border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.05)] hover:border-yellow-400' 
                     : 'bg-gray-800/40 border border-gray-700/50 hover:bg-gray-800/70'
                 }`}>
                   {/* Poster */}
                   <div className="w-16 h-24 shrink-0 rounded-lg bg-gray-900 overflow-hidden relative shadow-lg">
                     {(ch.canonical_titles?.poster || ch.logo_url) ? (
                       <img
                         src={
                           ch.canonical_titles?.poster
                             ? ch.canonical_titles.poster.startsWith('http')
                               ? ch.canonical_titles.poster
                               : `https://image.tmdb.org/t/p/w154${ch.canonical_titles.poster}`
                             : ch.logo_url!
                         }
                         alt=""
                         className="w-full h-full object-cover"
                         onError={e => (e.currentTarget.style.display = 'none')}
                       />
                     ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 text-gray-600">
                          <Tv className="w-6 h-6 mb-1" />
                          <span className="text-[10px]">S/ Imagem</span>
                        </div>
                     )}
                   </div>

                   {/* Info */}
                   <div className="flex-1 min-w-0 pt-1">
                     <div className="text-white text-sm font-semibold truncate mb-1 flex items-center gap-2">
                       {ch.canonical_titles?.title || ch.name}
                       {hasTMDB && (
                         <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                           ✅ TMDB
                         </span>
                       )}
                     </div>
                     
                     <div className="flex items-center gap-2 mb-2">
                       {ch.canonical_titles?.rating && (
                         <div className="flex items-center gap-1 bg-black/40 px-1.5 py-0.5 rounded text-[10px]">
                           <Star className="w-3 h-3 text-yellow-400" />
                           <span className="text-yellow-400 font-medium">{ch.canonical_titles.rating.toFixed(1)}</span>
                         </div>
                       )}
                       <span className="text-xs text-gray-500 capitalize">{ch.content_type === 'movie' ? 'Filme' : ch.content_type === 'series' ? 'Série' : ch.content_type}</span>
                       {ch.streaming && <span className="text-[10px] uppercase text-purple-400 font-medium truncate">{ch.streaming}</span>}
                     </div>

                     {/* Qualities */}
                     <div className="flex flex-wrap gap-1 mt-auto">
                       {(ch.streams || []).slice(0, 4).map((s, i) => (
                         <span key={i} className="text-[10px] font-medium px-1.5 py-0.5 bg-gray-700/50 text-gray-300 rounded border border-gray-600/50">
                           {s.q}
                         </span>
                       ))}
                       {(ch.streams?.length || 0) > 4 && (
                         <span className="text-[10px] text-gray-500 px-1 pt-0.5">+{ch.streams.length - 4}</span>
                       )}
                     </div>
                   </div>
                 </div>
              )})}
            </div>
            
            {filteredChannels.length > paginatedChannels.length && (
              <div className="pt-4 pb-8 flex justify-center">
                <Button onClick={() => setPage(p => p + 1)} className="w-1/2 bg-gray-800 text-gray-300 hover:bg-gray-700">
                  Carregar Mais ({filteredChannels.length - paginatedChannels.length} restantes)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const NavItem = ({ icon: Icon, label, id, count }: any) => {
    const isAct = activeView === id
    return (
      <button 
        onClick={() => { setActiveView(id); setSearch('') }}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all ${
          isAct 
            ? 'bg-purple-600/20 text-purple-300 font-medium border border-purple-500/20' 
            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <Icon className={`w-4 h-4 ${isAct ? 'text-purple-400' : 'text-gray-500'}`} />
          <span className="capitalize">{label}</span>
        </div>
        {count !== undefined && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${isAct ? 'bg-purple-500/30' : 'bg-gray-800'}`}>
            {count}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-gray-800 pb-4">
        <Button onClick={() => navigate('/playlists')} className="rounded-full w-8 h-8 p-0 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
           <h1 className="text-xl font-bold text-white flex items-center gap-2">
             M3U ZiiiTV Report 
           </h1>
           <p className="text-sm text-gray-500">{playlist?.url_original}</p>
        </div>
      </div>

      <AutoEnrichBanner playlistId={id!} />

      <div className="flex flex-col md:flex-row gap-6 items-start h-[calc(100vh-160px)]">
        {/* Sidebar */}
        <Card className="w-full md:w-64 shrink-0 p-3 flex flex-col gap-6 sticky top-4 max-h-[calc(100vh-160px)] overflow-y-auto custom-scrollbar">
           
           <div>
             <div className="text-xs font-bold text-yellow-500 uppercase tracking-wider mb-2 px-3 flex items-center gap-1">
               <Star className="w-3.5 h-3.5 text-yellow-500" /> ZIIITV OURO MATCH
             </div>
             <div className="space-y-1 bg-yellow-500/5 rounded-xl p-1 border border-yellow-500/20">
               <NavItem id="match:todos" label="Todos Matched" icon={Star} count={matchedCategories.todos.length} />
               <NavItem id="match:filmes" label="Filmes" icon={Film} count={matchedCategories.filmes.length} />
               <NavItem id="match:series" label="Séries" icon={Tv} count={matchedCategories.series.length} />
               <NavItem id="match:live" label="TV Ao Vivo" icon={Activity} count={matchedCategories.live.length} />
             </div>
           </div>

           <div>
             <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 px-3">Principal</div>
             <div className="space-y-1">
               <NavItem id="dashboard" label="ZiiiTV Report" icon={BarChart2} />
               <NavItem id="all" label="Todos os Canais" icon={Search} count={totalTitles} />
             </div>
           </div>

           <div>
             <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 px-3">Categorias</div>
             <div className="space-y-1">
               <NavItem id="category:filmes" label="Filmes" icon={Film} count={categories.filmes.length} />
               <NavItem id="category:series" label="Séries" icon={Tv} count={categories.series.length} />
               <NavItem id="category:live" label="TV Ao Vivo" icon={Activity} count={categories.live.length} />
               <NavItem id="category:outros" label="Sem Categoria" icon={ChevronRight} count={categories.outros.length} />
             </div>
           </div>

           {Object.keys(platforms).length > 0 && (
             <div>
               <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 px-3">Streamings Localizados</div>
               <div className="space-y-1">
                 {Object.entries(platforms)
                   .sort(([a], [b]) => a.localeCompare(b))
                   .map(([key, list]) => (
                     <NavItem key={key} id={`streaming:${key}`} label={key} icon={Star} count={list.length} />
                 ))}
               </div>
             </div>
           )}

        </Card>

        {/* Content Area */}
        <div className="flex-1 min-w-0 h-full overflow-y-auto pb-20 custom-scrollbar pr-2">
           {activeView === 'dashboard' ? renderDashboard() : renderChannelList()}
        </div>
      </div>
    </div>
  )
}
