import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'

interface ContentRow {
  streaming: string
  type: 'movie' | 'series'
  emoji: string
  titles: {
    id: string
    title: string
    poster: string
    rating: number
    channelCount: number
  }[]
}

const STREAMING_ORDER = [
  'Netflix', 'Amazon Prime Video', 'HBO Max', 'Disney+', 'Paramount+',
  'Apple TV+', 'Globoplay', 'Star+', 'Peacock', 'Hulu', 'Discovery+',
  'Crunchyroll', 'Funimation', 'Pluto TV', 'Tubi', 'Plex', 'Roku Channel',
  'Starz', 'Showtime', 'MGM+', 'AMC+', 'BET+', 'Shudder', 'Sundance Now',
  'Acorn TV', 'BritBox', 'Mubi', 'Criterion Channel', 'Fandor', 'Kanopy',
  'Hoopla', 'Tubi', 'Vudu', 'FandangoNOW'
]

const EMOJI_MAP: Record<string, { movie: string; series: string }> = {
  'Netflix': { movie: '🎬', series: '📺' },
  'Amazon Prime Video': { movie: '🎥', series: '🍿' },
  'HBO Max': { movie: '🎭', series: '🎪' },
  'Disney+': { movie: '✨', series: '🏰' },
  'Paramount+': { movie: '⭐', series: '🎞️' },
  'Apple TV+': { movie: '🍎', series: '📱' },
  'Globoplay': { movie: '🌐', series: '📡' },
  'Star+': { movie: '⭐', series: '🌟' },
  'Peacock': { movie: '🦚', series: '🎨' },
  'Hulu': { movie: '🟢', series: '📺' },
  'Discovery+': { movie: '🔍', series: '🌍' },
  'Crunchyroll': { movie: '🍥', series: '🎌' },
  'Funimation': { movie: '🎌', series: '🍜' },
  'Pluto TV': { movie: '🪐', series: '📺' },
  'Tubi': { movie: '📺', series: '🎬' },
  'Plex': { movie: '▶️', series: '📺' },
  'Roku Channel': { movie: '📺', series: '🎬' },
  'Starz': { movie: '⭐', series: '🎭' },
  'Showtime': { movie: '🎬', series: '📺' },
  'MGM+': { movie: '🦁', series: '🎬' },
  'AMC+': { movie: '🎬', series: '📺' },
  'BET+': { movie: '🎵', series: '📺' },
  'Shudder': { movie: '👻', series: '🎃' },
  'Sundance Now': { movie: '🎬', series: '📺' },
  'Acorn TV': { movie: '🌰', series: '📺' },
  'BritBox': { movie: '🇬🇧', series: '☕' },
  'Mubi': { movie: '🎬', series: '🎨' },
  'Criterion Channel': { movie: '🎞️', series: '🎬' },
  'Fandor': { movie: '🎬', series: '📺' },
  'Kanopy': { movie: '📚', series: '🎓' },
  'Hoopla': { movie: '📚', series: '📺' },
  'Vudu': { movie: '🎬', series: '📺' },
  'FandangoNOW': { movie: '🎟️', series: '🎬' }
}

export function ChannelsPreview() {
  const [rows, setRows] = useState<ContentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const [channels, setChannels] = useState<any[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)

  useEffect(() => {
    loadRows()
  }, [])

  const loadRows = async () => {
    setLoading(true)
    try {
      const { data: channelsData, error: channelsError } = await supabase
        .from('channels')
        .select('canonical_id')
        .not('canonical_id', 'is', null)

      if (channelsError) throw channelsError

      const canonicalIds = [...new Set(channelsData?.map(ch => ch.canonical_id))]
      const { data: titlesData, error: titlesError } = await supabase
        .from('canonical_titles')
        .select('id, title, poster, rating, streaming, type')
        .in('id', canonicalIds)

      if (titlesError) throw titlesError

      const titlesMap = new Map(titlesData?.map(t => [t.id, t]))
      const grouped = new Map<string, Map<string, Map<string, any>>>()

      channelsData?.forEach((ch: any) => {
        const ct = titlesMap.get(ch.canonical_id)
        if (!ct) return

        if (!grouped.has(ct.streaming)) {
          grouped.set(ct.streaming, new Map())
        }
        const streamingMap = grouped.get(ct.streaming)!

        if (!streamingMap.has(ct.type)) {
          streamingMap.set(ct.type, new Map())
        }
        const typeMap = streamingMap.get(ct.type)!

        if (!typeMap.has(ct.id)) {
          typeMap.set(ct.id, { ...ct, channelCount: 0 })
        }
        typeMap.get(ct.id)!.channelCount++
      })

      // Converter para rows (igual ao app da TV)
      const rowsData: ContentRow[] = []
      STREAMING_ORDER.forEach(streaming => {
        const streamingData = grouped.get(streaming)
        if (!streamingData) return

        const emojis = EMOJI_MAP[streaming] || { movie: '🎬', series: '📺' }

        // Row de Filmes
        const movies = streamingData.get('movie')
        if (movies && movies.size > 0) {
          rowsData.push({
            streaming,
            type: 'movie',
            emoji: emojis.movie,
            titles: Array.from(movies.values()).sort((a, b) => b.rating - a.rating)
          })
        }

        // Row de Séries
        const series = streamingData.get('series')
        if (series && series.size > 0) {
          rowsData.push({
            streaming,
            type: 'series',
            emoji: emojis.series,
            titles: Array.from(series.values()).sort((a, b) => b.rating - a.rating)
          })
        }
      })

      setRows(rowsData)
    } catch (error) {
      console.error('Error loading rows:', error)
    } finally {
      setLoading(false)
    }
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

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
      {/* Lista de Rows (igual à TV) */}
      <div className="col-span-4 overflow-y-auto bg-gray-900 rounded-lg p-4">
        <h2 className="text-lg font-bold text-white mb-4">
          Preview TV ({rows.length} fileiras)
        </h2>
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={`${row.streaming}-${row.type}`} className="bg-gray-800 rounded-lg p-3">
              <div className="text-white font-medium mb-2">
                {row.emoji} {row.streaming} {row.type === 'movie' ? 'Filmes' : 'Séries'}
              </div>
              <div className="text-sm text-gray-400 mb-2">
                {row.titles.length} títulos
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {row.titles.slice(0, 10).map((title) => (
                  <button
                    key={title.id}
                    onClick={() => loadChannels(title.id)}
                    className={`w-full text-left px-2 py-1 rounded text-xs ${
                      selectedRow === title.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700/50 hover:bg-gray-700 text-gray-300'
                    }`}
                  >
                    {title.title} ({title.channelCount})
                  </button>
                ))}
                {row.titles.length > 10 && (
                  <div className="text-xs text-gray-500 px-2 py-1">
                    +{row.titles.length - 10} mais...
                  </div>
                )}
              </div>
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
