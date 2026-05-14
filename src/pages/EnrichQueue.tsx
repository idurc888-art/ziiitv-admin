import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { getDetailedTMDBData } from '../lib/tmdbFetch'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { ArrowLeft, Zap, CheckCircle, XCircle, Clock, SkipForward, Star } from 'lucide-react'
import toast from 'react-hot-toast'

const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY || 'b68afbadedebf0889f00a0cf577d3e5a'

// ── Jaro-Winkler similarity (sem lib externa) ──────────────────────────────
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const len1 = s1.length, len2 = s2.length
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0)
  const s1m = new Array(len1).fill(false)
  const s2m = new Array(len2).fill(false)
  let matches = 0, transpositions = 0
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist)
    const end = Math.min(i + matchDist + 1, len2)
    for (let j = start; j < end; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue
      s1m[i] = s2m[j] = true; matches++; break
    }
  }
  if (!matches) return 0
  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1m[i]) continue
    while (!s2m[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }
  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3
}

function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim()
  const s2 = b.toLowerCase().trim()
  const j = jaro(s1, s2)
  const prefix = Math.min([...s1].findIndex((c, i) => c !== s2[i]), 4)
  return j + prefix * 0.1 * (1 - j)
}

function cleanForSearch(name: string): string {
  return name
    .replace(/\b(4K|UHD|HD|SD|FHD|DUB|LEG|DUBLADO|LEGENDADO|NACIONAL|PT-BR|BR|ORIGINAL|VIP|PLUS)\b/gi, '')
    .replace(/S\d{1,2}E\d{1,3}/gi, '')
    .replace(/T\d{1,2}E\d{1,3}/gi, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\[\d{4}\]/g, '')
    .replace(/^\d{1,4}\s*[-:.)]\s*/, '') // remove prefixo numérico tipo "042 - "
    .replace(/\s+/g, ' ')
    .trim()
}

interface RawChannel { id: string; name: string; content_type: string | null; playlist_id: string; group_name: string | null }
interface ReviewItem {
  channel: RawChannel
  tmdbResult: any
  score: number
}

type BatchSize = 10 | 20 | 50 | 100

export function EnrichQueue() {
  const { id: playlistId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [batchSize, setBatchSize] = useState<number>(100)
  const [typeFilter, setTypeFilter] = useState<'movie' | 'series'>('movie')
  const [groupFilter, setGroupFilter] = useState('')
  const [page, setPage] = useState(1)
  const [running, setRunning] = useState(false)
  const [stopped, setStopped] = useState(false)

  const [availableGroups, setAvailableGroups] = useState<string[]>([])

  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState({ linked: 0, review: 0, skipped: 0 })
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([])
  const [autoLinkedItems, setAutoLinkedItems] = useState<ReviewItem[]>([])
  const [categoryStats, setCategoryStats] = useState<{ total: number; pending: number } | null>(null)
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null)

  const stopRef = useRef(false)

  // Load available groups for the dropdown
  useEffect(() => {
    if (!playlistId) return
    const fetchGroups = async () => {
      const { data } = await supabase.from('channels').select('group_name, content_type').eq('playlist_id', playlistId)
      if (data) {
        const filtered = data.filter(d => (typeFilter === 'movie' ? d.content_type === 'movie' : d.content_type === 'series') && d.group_name)
        const unique = Array.from(new Set(filtered.map(d => d.group_name as string))).sort()
        setAvailableGroups(unique)
      }
    }
    fetchGroups()
  }, [playlistId, typeFilter])

  // Load category stats (total + pending sem TMDB)
  useEffect(() => {
    if (!playlistId) return
    const fetchStats = async () => {
      setCategoryStats(null)
      let q = supabase.from('channels').select('id, canonical_id', { count: 'exact' })
        .eq('playlist_id', playlistId).eq('content_type', typeFilter)
      if (groupFilter) q = q.ilike('group_name', `%${groupFilter}%`)
      const { count: total } = await q

      let qp = supabase.from('channels').select('id', { count: 'exact' })
        .eq('playlist_id', playlistId).eq('content_type', typeFilter).is('canonical_id', null)
      if (groupFilter) qp = qp.ilike('group_name', `%${groupFilter}%`)
      const { count: pending } = await qp

      setCategoryStats({ total: total ?? 0, pending: pending ?? 0 })
    }
    fetchStats()
  }, [playlistId, typeFilter, groupFilter])

  const run = useCallback(async () => {
    if (!playlistId) return
    stopRef.current = false
    setStopped(false)
    setRunning(true)
    setProgress(0)
    setStats({ linked: 0, review: 0, skipped: 0 })
    setReviewQueue([])
    setAutoLinkedItems([])

    // 1. Busca canais sem canonical_id DE ACORDO COM O TIPO ESCOLHIDO E PÁGINA
    let query = supabase
      .from('channels')
      .select('id, name, content_type, playlist_id, group_name')
      .eq('playlist_id', playlistId)
      .eq('content_type', typeFilter)
      .is('canonical_id', null)

    if (groupFilter.trim()) {
      query = query.ilike('group_name', `%${groupFilter.trim()}%`)
    }

    const startIdx = (page - 1) * batchSize
    const endIdx = startIdx + batchSize - 1
    query = query.range(startIdx, endIdx)

    const { data: channels, error } = await query
    if (error || !channels?.length) {
      toast('Nenhum canal sem TMDB encontrado!', { icon: '✅' })
      setRunning(false)
      return
    }

    setTotal(channels.length)
    let linked = 0, review = 0, skipped = 0

    for (let i = 0; i < channels.length; i++) {
      if (stopRef.current) { setStopped(true); break }
      const ch = channels[i]
      setProgress(i + 1)

      const searchName = cleanForSearch(ch.name)
      if (!searchName || searchName.length < 2) { skipped++; continue }

      try {
        const type = ch.content_type === 'series' ? 'tv' : ch.content_type === 'movie' ? 'movie' : ''
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(searchName)}&language=pt-BR&page=1`
        const res = await fetch(url)
        const data = await res.json()
        let results = (data.results || []).filter((r: any) => r.media_type !== 'person' && (!type || r.media_type === type))

        // Se não achou com filtro de tipo, tenta sem filtro
        if (!results.length && type) {
          results = (data.results || []).filter((r: any) => r.media_type !== 'person')
        }

        // Tenta com idioma inglês se ainda sem resultado
        if (!results.length) {
          const res2 = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(searchName)}&page=1`)
          const data2 = await res2.json()
          results = (data2.results || []).filter((r: any) => r.media_type !== 'person')
        }

        if (!results.length) { skipped++; continue }

        // Score contra top 5 incluindo título original
        let best = results[0], bestScore = 0
        for (const r of results.slice(0, 5)) {
          const rTitle = (r.title || r.name || '').toLowerCase()
          const rOrig  = (r.original_title || r.original_name || '').toLowerCase()
          const sc = Math.max(similarity(searchName, rTitle), similarity(searchName, rOrig))
          if (sc > bestScore) { bestScore = sc; best = r }
        }

        if (bestScore >= 0.82) {
          await linkChannel(ch, best)
          setAutoLinkedItems(q => [...q, { channel: ch, tmdbResult: best, score: bestScore }])
          linked++
        } else if (bestScore >= 0.55) {
          setReviewQueue(q => [...q, { channel: ch, tmdbResult: best, score: bestScore }])
          review++
        } else {
          skipped++
        }
      } catch {
        skipped++
      }

      // Throttle para não derrubar a API do TMDB
      await new Promise(r => setTimeout(r, 220))

      setStats({ linked, review, skipped })
    }

    setRunning(false)
    toast.success(`Concluído! ✅ ${linked} vinculados | 👀 ${review} revisão | ❌ ${skipped} pulados`)
  }, [playlistId, batchSize, typeFilter, groupFilter])

  const linkChannel = async (ch: RawChannel, result: any) => {
    const title = result.title || result.name || ''
    const year = (result.release_date || result.first_air_date || '').slice(0, 4)
    const slug = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const stream = ch.content_type === 'series' ? 'serie' : 'filme'
    const canonicalId = `${stream}-${slug}`

    // --- Deep Fetch ---
    const details = await getDetailedTMDBData(result.id, result.media_type === 'tv' ? 'series' : 'movie')

    const { error: ctErr } = await supabase.from('canonical_titles').upsert({
      id: canonicalId, slug, title,
      streaming: stream,
      type: result.media_type === 'tv' ? 'series' : 'movie',
      tmdb_id: result.id, year,
      rating: result.vote_average,
      overview: result.overview,
      poster: result.poster_path ? `https://image.tmdb.org/t/p/w342${result.poster_path}` : null,
      backdrop: result.backdrop_path ? `https://image.tmdb.org/t/p/w780${result.backdrop_path}` : null,
      ...(details || {})
    }, { onConflict: 'id' })

    if (ctErr) throw ctErr

    const { error: chErr, count } = await supabase.from('channels').update({
      canonical_id: canonicalId,
      content_type: result.media_type === 'tv' ? 'series' : 'movie',
    }, { count: 'exact' }).eq('id', ch.id)

    if (chErr) throw chErr
    if (!count) throw new Error(`Canal "${ch.name}" não foi atualizado — verifique RLS`)
  }

  const approveReview = async (item: ReviewItem) => {
    try {
      await linkChannel(item.channel, item.tmdbResult)
      setReviewQueue(q => q.filter(x => x.channel.id !== item.channel.id))
      setStats(s => ({ ...s, linked: s.linked + 1, review: s.review - 1 }))
      toast.success(`Vinculado: ${item.tmdbResult.title || item.tmdbResult.name}`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const rejectReview = (item: ReviewItem) => {
    setReviewQueue(q => q.filter(x => x.channel.id !== item.channel.id))
    setStats(s => ({ ...s, review: s.review - 1, skipped: s.skipped + 1 }))
  }

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0

  return (
    <div className="space-y-6">

      {/* Modal de detalhe */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setSelectedItem(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-lg w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex gap-4">
              {selectedItem.tmdbResult.poster_path && (
                <img src={`https://image.tmdb.org/t/p/w185${selectedItem.tmdbResult.poster_path}`} className="w-24 rounded-lg object-cover" alt="" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-500 mb-1">Da lista M3U:</div>
                <div className="text-sm font-mono text-yellow-300 mb-3">{selectedItem.channel.name}</div>
                <div className="text-xs text-gray-500 mb-1">Match TMDB:</div>
                <div className="text-lg font-bold text-white">{selectedItem.tmdbResult.title || selectedItem.tmdbResult.name}</div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-gray-400">{(selectedItem.tmdbResult.release_date || selectedItem.tmdbResult.first_air_date || '').slice(0, 4)}</span>
                  <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded font-mono">{Math.round(selectedItem.score * 100)}% match</span>
                  <span className="text-xs bg-blue-900/50 text-blue-400 px-2 py-0.5 rounded">{selectedItem.tmdbResult.media_type === 'tv' ? 'Série' : 'Filme'}</span>
                  {selectedItem.tmdbResult.vote_average > 0 && (
                    <span className="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded">⭐ {selectedItem.tmdbResult.vote_average.toFixed(1)}</span>
                  )}
                </div>
              </div>
            </div>
            {selectedItem.tmdbResult.overview && (
              <p className="text-sm text-gray-400 leading-relaxed line-clamp-4">{selectedItem.tmdbResult.overview}</p>
            )}
            <div className="text-xs text-gray-600 font-mono">group: {selectedItem.channel.group_name}</div>
            <button onClick={() => setSelectedItem(null)} className="w-full py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition">Fechar</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 border-b border-gray-800 pb-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" /> Motor de Enriquecimento TMDB
          </h1>
          <p className="text-sm text-gray-500 mb-2">Auto-vinculação inteligente por pontuação de similaridade</p>
          
          {categoryStats && (
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5 bg-gray-800 px-3 py-1 rounded-md border border-gray-700">
                <span className="text-xs text-gray-400">Total na Categoria:</span>
                <span className="text-sm font-bold text-white">{categoryStats.total.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-yellow-900/20 px-3 py-1 rounded-md border border-yellow-500/20">
                <span className="text-xs text-yellow-500">Pendentes (Sem TMDB):</span>
                <span className="text-sm font-bold text-yellow-400">{categoryStats.pending.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Config */}
      <Card className="p-5 flex flex-wrap gap-6 items-end">
        <div>
          <label className="text-xs text-gray-400 mb-2 block">Tamanho do Lote</label>
          <div className="flex gap-2 items-center">
            {([50, 100, 200]).map(n => (
              <button key={n} onClick={() => setBatchSize(n)}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${batchSize === n ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {n}
              </button>
            ))}
            <input 
              type="number" 
              value={batchSize} 
              onChange={e => setBatchSize(Math.max(1, Number(e.target.value)))}
              className="w-20 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-bold focus:border-purple-500 focus:outline-none text-center"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-yellow-400 mb-2 block font-bold">⚠️ O que deseja buscar no TMDB agora?</label>
          <div className="flex gap-2">
            {([['movie', '🎬 Apenas Filmes'], ['series', '📺 Apenas Séries']] as [string, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setTypeFilter(v as any)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${typeFilter === v ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-blue-400 mb-2 block font-bold">Filtro de Categoria na M3U</label>
          <select 
            value={groupFilter} 
            onChange={e => setGroupFilter(e.target.value)}
            disabled={running || availableGroups.length === 0}
            className="w-48 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">-- Todas as Categorias --</option>
            {availableGroups.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400 mb-2 block">Página de Lotes</label>
          <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg p-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} className="px-3 py-1 hover:bg-gray-800 rounded text-gray-400 transition">-</button>
            <span className="text-sm font-bold text-white min-w-[20px] text-center">{page}</span>
            <button onClick={() => setPage(p => p + 1)} className="px-3 py-1 hover:bg-gray-800 rounded text-gray-400 transition">+</button>
          </div>
        </div>

        <Button onClick={running ? () => { stopRef.current = true } : run}
          className={`ml-auto px-8 py-3 font-bold text-base ${running ? 'bg-red-700 hover:bg-red-600' : 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400'}`}>
          {running ? '⏹ Parar' : '⚡ Iniciar Processamento'}
        </Button>
      </Card>

      {/* Progress */}
      {(running || progress > 0) && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">{running ? 'Processando...' : stopped ? 'Parado' : 'Concluído'}</span>
            <span className="text-white font-bold">{progress}/{total} ({pct}%)</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all duration-300 rounded-full"
              style={{ width: `${pct}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-4 pt-2">
            {[
              { icon: CheckCircle, label: 'Auto-Vinculados', val: stats.linked, color: 'text-green-400' },
              { icon: Clock, label: 'Para Revisar', val: stats.review, color: 'text-yellow-400' },
              { icon: XCircle, label: 'Pulados', val: stats.skipped, color: 'text-gray-500' },
            ].map(({ icon: Icon, label, val, color }) => (
              <div key={label} className="flex flex-col items-center p-3 bg-gray-800/50 rounded-xl">
                <Icon className={`w-5 h-5 ${color} mb-1`} />
                <span className={`text-2xl font-bold ${color}`}>{val}</span>
                <span className="text-xs text-gray-500 mt-1">{label}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Review Queue */}
      {reviewQueue.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-yellow-400 flex items-center gap-2">
            <Clock className="w-5 h-5" /> Fila de Revisão — {reviewQueue.length} itens aguardando
          </h2>
          {reviewQueue.map((item) => (
            <Card key={item.channel.id} className="p-4 flex gap-4 items-start border border-yellow-500/20 bg-yellow-500/5 cursor-pointer hover:border-yellow-400/40 transition" onClick={() => setSelectedItem(item)}>
              {/* TMDB backdrop */}
              <div className="w-48 shrink-0 aspect-video bg-gray-800 rounded-lg overflow-hidden">
                {item.tmdbResult.backdrop_path ? (
                  <img src={`https://image.tmdb.org/t/p/w300${item.tmdbResult.backdrop_path}`} className="w-full h-full object-cover" alt="" />
                ) : item.tmdbResult.poster_path ? (
                  <img src={`https://image.tmdb.org/t/p/w154${item.tmdbResult.poster_path}`} className="w-full h-full object-contain p-2" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-3xl">🎬</div>
                )}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-500 mb-0.5">Nome M3U</div>
                <div className="text-sm text-gray-300 font-mono truncate mb-3">{item.channel.name}</div>
                <div className="text-xs text-gray-500 mb-0.5">Resultado TMDB</div>
                <div className="text-base font-bold text-white">{item.tmdbResult.title || item.tmdbResult.name}</div>
                <div className="flex items-center gap-2 mt-1 mb-3">
                  <span className="text-xs text-gray-400">{(item.tmdbResult.release_date || item.tmdbResult.first_air_date || '').slice(0, 4)}</span>
                  <Star className="w-3 h-3 text-yellow-400" />
                  <span className="text-xs text-yellow-400">{item.tmdbResult.vote_average?.toFixed(1)}</span>
                  <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${item.score >= 0.80 ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
                    {Math.round(item.score * 100)}% confiança
                  </span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{item.tmdbResult.overview}</p>
              </div>
              {/* Actions */}
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={e => { e.stopPropagation(); approveReview(item) }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm font-bold rounded-lg transition">
                  <CheckCircle className="w-4 h-4" /> Vincular
                </button>
                <button onClick={e => { e.stopPropagation(); rejectReview(item) }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-bold rounded-lg transition">
                  <SkipForward className="w-4 h-4" /> Pular
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Auto Linked */}
      {autoLinkedItems.length > 0 && (
        <div className="space-y-3 mt-8">
          <h2 className="text-lg font-bold text-green-400 flex items-center gap-2">
            <CheckCircle className="w-5 h-5" /> Auto-Vinculados — {autoLinkedItems.length} itens identificados e salvos
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {autoLinkedItems.reverse().map((item) => (
              <Card key={item.channel.id} className="p-3 flex gap-3 items-center border border-green-500/20 bg-green-500/5 cursor-pointer hover:border-green-400/40 transition" onClick={() => setSelectedItem(item)}>
                <div className="w-16 shrink-0 aspect-[2/3] bg-gray-800 rounded overflow-hidden">
                  {item.tmdbResult.poster_path ? (
                    <img src={`https://image.tmdb.org/t/p/w92${item.tmdbResult.poster_path}`} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">🎬</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-500 mb-0.5 truncate border-b border-gray-800 pb-1">{item.channel.name}</div>
                  <div className="text-sm font-bold text-white truncate mt-1">{item.tmdbResult.title || item.tmdbResult.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">{(item.tmdbResult.release_date || item.tmdbResult.first_air_date || '').slice(0, 4)}</span>
                    <span className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded font-mono">
                      {Math.round(item.score * 100)}%
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
