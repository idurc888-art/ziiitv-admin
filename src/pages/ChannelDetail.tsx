import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/Button'
import { ArrowLeft, Search, Save, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { updateChannelInCache } from '../lib/channelCache'

const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY || 'b68afbadedebf0889f00a0cf577d3e5a'
const TMDB_BASE = `https://api.themoviedb.org/3`

interface Channel {
  id: string
  name: string
  group_name: string | null
  logo_url: string | null
  streaming: string | null
  content_type: string | null
  canonical_id: string | null
  playlist_id: string
  streams: any[]
  canonical_titles: any | null
}

interface TMDBResult {
  id: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  release_date?: string
  first_air_date?: string
  vote_average: number
  vote_count?: number
  popularity?: number
  genre_ids?: number[]
  media_type: 'movie' | 'tv'
}

export function ChannelDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [channel, setChannel] = useState<Channel | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tmdbSearch, setTmdbSearch] = useState('')
  const [tmdbResults, setTmdbResults] = useState<TMDBResult[]>([])
  const [searching, setSearching] = useState(false)

  // Campos editáveis
  const [editName, setEditName] = useState('')
  const [editStreaming, setEditStreaming] = useState('')
  const [editContentType, setEditContentType] = useState('')
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)

  useEffect(() => {
    loadChannel()
  }, [id])

  const loadChannel = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('channels')
      .select('*, canonical_titles(*), playlist_id')
      .eq('id', id)
      .single()

    if (error) { toast.error('Canal não encontrado'); navigate(-1); return }
    setChannel(data)
    setEditName(data.name)
    setEditStreaming(data.streaming || '')
    setEditContentType(data.content_type || 'movie')
    setTmdbSearch(data.name)
    setLoading(false)
  }

  const searchTMDB = async () => {
    if (!tmdbSearch.trim()) return
    setSearching(true)
    setTmdbResults([])
    try {
      const url = `${TMDB_BASE}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(tmdbSearch)}&language=pt-BR&page=1`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`)
      const data = await res.json()
      const filtered = (data.results || []).filter((r: any) => r.media_type !== 'person').slice(0, 8)
      setTmdbResults(filtered)
      if (filtered.length === 0) toast('Nenhum resultado encontrado no TMDB', { icon: '⚠️' })
    } catch (e: any) {
      console.error('[TMDB search error]', e)
      toast.error(`Erro TMDB: ${e.message}`)
    }
    setSearching(false)
  }

  const linkTMDB = async (result: TMDBResult) => {
    if (!channel) return
    setSaving(true)
    try {
      const title = result.title || result.name || ''
      const year = (result.release_date || result.first_air_date || '').slice(0, 4)
      const slug = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const streamVal = editStreaming || (result.media_type === 'tv' ? 'serie' : 'filme')
      const canonicalId = `${streamVal}-${slug}`

      // Upsert canonical_titles
      const { error: ctError } = await supabase.from('canonical_titles').upsert({
        id: canonicalId,
        slug,
        title,
        type: result.media_type === 'tv' ? 'series' : 'movie',
        streaming: streamVal,
        tmdb_id: result.id,
        year,
        rating: result.vote_average,
        overview: result.overview,
        poster: result.poster_path ? `https://image.tmdb.org/t/p/w342${result.poster_path}` : null,
        backdrop: result.backdrop_path ? `https://image.tmdb.org/t/p/w780${result.backdrop_path}` : null,
      }, { onConflict: 'id' })

      if (ctError) throw ctError

      const updatedInfo = {
        canonical_id: canonicalId,
        name: editName,
        streaming: editStreaming || null,
        content_type: result.media_type === 'tv' ? 'series' : 'movie',
      }

      // Atualizar canal
      const { error: chError } = await supabase.from('channels').update(updatedInfo).eq('id', channel.id)

      if (chError) throw chError

      // Atualiza cache em memória para navegação instantânea
      updateChannelInCache(channel.playlist_id, channel.id, {
        ...updatedInfo,
        canonical_titles: {
          title,
          type: result.media_type === 'tv' ? 'series' : 'movie',
          streaming: editStreaming || null,
          tmdb_id: result.id,
          year,
          rating: result.vote_average,
          overview: result.overview,
          poster: result.poster_path ? `https://image.tmdb.org/t/p/w342${result.poster_path}` : null,
          backdrop: result.backdrop_path ? `https://image.tmdb.org/t/p/w780${result.backdrop_path}` : null,
        }
      })

      toast.success(`Vinculado: ${title} (${year})`)
      loadChannel()
    } catch (e: any) {
      console.error('[linkTMDB error]', e)
      toast.error(`Erro ao vincular: ${e?.message || JSON.stringify(e)}`)
    }
    setSaving(false)
  }

  const saveEdits = async () => {
    if (!channel) return
    setSaving(true)
    
    const updates = {
      name: editName,
      streaming: editStreaming || null,
      content_type: editContentType,
    }

    const { error } = await supabase.from('channels').update(updates).eq('id', channel.id)

    if (error) {
      toast.error(error.message)
    } else { 
      updateChannelInCache(channel.playlist_id, channel.id, updates)
      toast.success('Salvo!')
      loadChannel() 
    }
    setSaving(false)
  }

  if (loading) return <div className="p-8 text-white">Carregando...</div>
  if (!channel) return null

  const ct = channel.canonical_titles

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header title="Detalhes do Canal" />
      <div className="max-w-5xl mx-auto p-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6">
          <ArrowLeft size={16} /> Voltar
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Coluna esquerda: dados atuais ── */}
          <div className="lg:col-span-1 space-y-4">
            {/* Poster */}
            <div className="aspect-[2/3] bg-gray-800 rounded-lg overflow-hidden">
              {ct?.poster ? (
                <img src={ct.poster} alt={ct.title} className="w-full h-full object-cover" />
              ) : channel.logo_url ? (
                <img src={channel.logo_url} alt={channel.name} className="w-full h-full object-contain p-4" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600 text-4xl">🎬</div>
              )}
            </div>

            {/* Info TMDB Horizontal Hero */}
            {ct && ct.backdrop && (
              <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden relative shadow-lg">
                <div className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 flex items-center rounded text-gray-300">
                  <span className="text-[10px] font-medium uppercase tracking-wider">Capa Hero (Horizontal)</span>
                </div>
                <img src={ct.backdrop} alt="" className="w-full h-full object-cover" />
              </div>
            )}

            {/* Info TMDB */}
            {ct && (
              <div className="bg-gray-800 rounded-lg p-4 space-y-2 text-sm">
                <div className="font-bold text-lg">{ct.title}</div>
                <div className="text-gray-400">{ct.year} · ⭐ {ct.rating?.toFixed(1)}</div>
                <div className="text-gray-300 text-xs leading-relaxed line-clamp-4">{ct.overview}</div>
                <a href={`https://www.themoviedb.org/${ct.type === 'series' ? 'tv' : 'movie'}/${ct.tmdb_id}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs">
                  <ExternalLink size={12} /> Ver no TMDB
                </a>
              </div>
            )}
          </div>

          {/* ── Coluna direita: edição + TMDB ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Streams / Temporadas */}
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h2 className="font-bold text-lg border-b border-gray-700 pb-2">
                {channel.content_type === 'series' ? 'Temporadas & Episódios' : 'Streams'}
                <span className="text-xs font-normal text-gray-500 ml-2">{channel.streams?.length || 0} URLs</span>
              </h2>

              {channel.content_type === 'series' ? (() => {
                // Agrupar por temporada detectada na string `q`
                const seasonMap: Record<string, { q: string; u: string }[]> = {}
                ;(channel.streams || []).forEach((s: any) => {
                  const m = (s.q || '').match(/S(\d{1,2})|T(\d{1,2})|(?:^|\s)(\d{1,2})(?=\s*[-x])/i)
                  const season = m ? `S${String(parseInt(m[1] || m[2] || m[3] || '1')).padStart(2, '0')}` : 'S01'
                  if (!seasonMap[season]) seasonMap[season] = []
                  seasonMap[season].push(s)
                })
                const sortedSeasons = Object.keys(seasonMap).sort()
                const activeSeason = selectedSeason || sortedSeasons[0] || 'S01'

                return (
                  <div>
                    {/* Season tabs */}
                    <div className="flex flex-wrap gap-1 mb-3">
                      {sortedSeasons.map(s => (
                        <button key={s}
                          onClick={() => setSelectedSeason(s)}
                          className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                            activeSeason === s
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                          }`}
                        >
                          Temp {parseInt(s.slice(1))}
                        </button>
                      ))}
                    </div>
                    {/* Episode list */}
                    <div className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar">
                      {(seasonMap[activeSeason] || []).map((s, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-xs bg-gray-900 px-3 py-2 rounded hover:bg-gray-700 transition-colors">
                          <span className="font-mono text-purple-300 shrink-0 w-20 truncate">{s.q}</span>
                          <span className="text-gray-500 truncate flex-1 font-mono text-[10px]">{s.u}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })() : (
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {(channel.streams || []).map((s: any, i: number) => (
                    <div key={i} className="text-xs font-mono text-gray-400 bg-gray-900 p-1 rounded truncate">
                      [{s.q}] {s.u}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Edição */}
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h2 className="font-bold text-lg border-b border-gray-700 pb-2">Editar</h2>
              <div>
                <label className="text-gray-400 text-xs">Nome</label>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs">Streaming</label>
                  <input value={editStreaming} onChange={e => setEditStreaming(e.target.value)}
                    className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs">Tipo</label>
                  <select value={editContentType} onChange={e => setEditContentType(e.target.value)}
                    className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
                    <option value="movie">Filme</option>
                    <option value="series">Série</option>
                    <option value="live">Ao Vivo</option>
                  </select>
                </div>
              </div>
              <Button onClick={saveEdits} disabled={saving} className="w-full">
                <Save size={14} className="mr-2" /> {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>

            {/* Busca TMDB */}
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h2 className="font-bold text-lg border-b border-gray-700 pb-2">
                Vincular TMDB {ct && <span className="text-green-400 text-sm ml-2">✓ Vinculado</span>}
              </h2>
              <div className="flex gap-2">
                <input value={tmdbSearch} onChange={e => setTmdbSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchTMDB()}
                  placeholder="Buscar no TMDB..."
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm" />
                <Button onClick={searchTMDB} disabled={searching}>
                  <Search size={14} /> {searching ? '...' : 'Buscar'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {tmdbResults.map(r => (
                  <button key={r.id} onClick={() => linkTMDB(r)}
                    className="flex flex-col gap-0 bg-gray-900 border border-transparent hover:border-purple-500 rounded-lg overflow-hidden text-left transition-all relative group">
                    {/* Imagem Horizontal */}
                    <div className="w-full aspect-video bg-gray-800 relative">
                       {r.backdrop_path ? (
                         <img src={`https://image.tmdb.org/t/p/w300${r.backdrop_path}`} alt="" className="w-full h-full object-cover" />
                       ) : (
                         <div className="w-full h-full flex items-center justify-center text-gray-700 text-[10px]">S/ Capa Hero</div>
                       )}
                       {/* Gradiente */}
                       <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-gray-900 to-transparent" />
                    </div>
                    {/* Info */}
                    <div className="flex gap-2 px-3 pb-3 -mt-6 relative z-10 w-full">
                      {r.poster_path ? (
                        <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt=""
                          className="w-10 h-14 object-cover rounded shadow border border-gray-700 bg-gray-800 flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-14 bg-gray-800 border border-gray-700 rounded flex-shrink-0" />
                      )}
                      <div className="min-w-0 pt-7 flex-1">
                        <div className="text-xs font-bold text-white truncate drop-shadow-md">{r.title || r.name}</div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] text-gray-400 font-medium">{(r.release_date || r.first_air_date || '').slice(0, 4)}</span>
                          <span className="text-[10px] uppercase text-purple-400 font-bold">{r.media_type === 'tv' ? 'Série' : 'Filme'}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
