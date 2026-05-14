import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getDetailedTMDBData } from '../lib/tmdbFetch'
import { Play, Pause, Zap, CheckCircle } from 'lucide-react'

// --- Duplicated TMDB logic for independence ---
const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY || 'b68afbadedebf0889f00a0cf577d3e5a'

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
    .replace(/^\d{1,4}\s*[-:.)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}
// ----------------------------------------------

interface Props {
  playlistId: string
}

export function AutoEnrichBanner({ playlistId }: Props) {
  const [job, setJob] = useState<any>(null)
  const [running, setRunning] = useState(false)
  const [processed, setProcessed] = useState(0)
  const [linked, setLinked] = useState(0)
  
  const stopRef = useRef(false)
  const runningLock = useRef(false)

  useEffect(() => {
    // Load job on mount
    supabase.from('enrich_jobs').select('*')
      .eq('playlist_id', playlistId)
      .neq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setJob(data)
          setProcessed(data.processed_count || 0)
          setLinked(data.linked_count || 0)
          if (data.status === 'pending' || data.status === 'running') {
            startLoop(data)
          }
        }
      })

    return () => { stopRef.current = true }
  }, [playlistId])

  const startLoop = async (currentJob: any) => {
    if (runningLock.current) return
    runningLock.current = true
    stopRef.current = false
    setRunning(true)

    // update status
    if (currentJob.status !== 'running') {
      await supabase.from('enrich_jobs').update({ status: 'running' }).eq('id', currentJob.id)
    }

    let offset = currentJob.processed_count || 0
    let totalLinked = currentJob.linked_count || 0

    while (!stopRef.current) {
      // Fetch 20
      const { data: channels } = await supabase.from('channels')
        .select('id, name, content_type')
        .eq('playlist_id', playlistId)
        .in('content_type', ['movie', 'series'])
        .is('canonical_id', null)
        .range(offset, offset + 19)

      if (!channels || channels.length === 0) {
        // Done
        await supabase.from('enrich_jobs').update({ status: 'done', processed_count: offset, linked_count: totalLinked }).eq('id', currentJob.id)
        setJob({ ...currentJob, status: 'done', processed_count: offset, linked_count: totalLinked })
        setRunning(false)
        break
      }

      for (let i = 0; i < channels.length; i++) {
        if (stopRef.current) break
        const ch = channels[i]
        const searchName = cleanForSearch(ch.name)

        if (searchName && searchName.length > 2) {
          try {
            const type = ch.content_type === 'series' ? 'tv' : 'movie'
            const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(searchName)}&language=pt-BR&page=1`
            const res = await fetch(url)
            const data = await res.json()
            
            let results = (data.results || []).filter((r: any) => r.media_type !== 'person' && (!type || r.media_type === type))
            if (!results.length) results = (data.results || []).filter((r: any) => r.media_type !== 'person')

            if (results.length > 0) {
              let best = results[0], bestScore = 0
              for (const r of results.slice(0, 5)) {
                const sc = Math.max(
                  similarity(searchName, (r.title || r.name || '').toLowerCase()), 
                  similarity(searchName, (r.original_title || r.original_name || '').toLowerCase())
                )
                if (sc > bestScore) { bestScore = sc; best = r }
              }

              // Auto-Link ONLY
              if (bestScore >= 0.82) {
                const title = best.title || best.name || ''
                const year = (best.release_date || best.first_air_date || '').slice(0, 4)
                const slug = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
                const streamVal = best.media_type === 'tv' ? 'serie' : 'filme'
                const canonicalId = `${streamVal}-${slug}`

                // --- Deep Fetch ---
                const details = await getDetailedTMDBData(best.id, best.media_type === 'tv' ? 'series' : 'movie')

                await supabase.from('canonical_titles').upsert({
                  id: canonicalId, slug, title, streaming: streamVal,
                  type: best.media_type === 'tv' ? 'series' : 'movie',
                  tmdb_id: best.id, year, rating: best.vote_average,
                  overview: best.overview,
                  poster: best.poster_path ? `https://image.tmdb.org/t/p/w342${best.poster_path}` : null,
                  backdrop: best.backdrop_path ? `https://image.tmdb.org/t/p/w780${best.backdrop_path}` : null,
                  ...(details || {})
                }, { onConflict: 'id' })

                await supabase.from('channels').update({
                  canonical_id: canonicalId,
                  content_type: best.media_type === 'tv' ? 'series' : 'movie',
                }).eq('id', ch.id)

                totalLinked++
                setLinked(totalLinked)
              }
            }
          } catch (e) {
            console.error('TMDB API Error:', e)
          }
        }

        // Throttle 250ms
        await new Promise(r => setTimeout(r, 250))
      }

      if (stopRef.current) break

      offset += channels.length
      setProcessed(offset)
      // Checkpoint save every 20
      await supabase.from('enrich_jobs').update({ processed_count: offset, linked_count: totalLinked }).eq('id', currentJob.id)
    }

    runningLock.current = false
  }

  const toggleAction = () => {
    if (running) {
      stopRef.current = true
      setRunning(false)
      if (job) supabase.from('enrich_jobs').update({ status: 'paused' }).eq('id', job.id)
    } else {
      startLoop(job)
    }
  }

  if (!job || job.status === 'done') return null

  const pct = Math.round((processed / Math.max(1, job.total_count)) * 100)

  return (
    <div className="bg-gradient-to-r from-gray-900 to-indigo-950 border border-indigo-500/30 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 mb-6 shadow-lg shadow-indigo-900/10">
      <div className={`p-3 rounded-xl ${running ? 'bg-yellow-500/20 text-yellow-500 animate-pulse' : 'bg-gray-800 text-gray-500'}`}>
        <Zap className="w-6 h-6" />
      </div>
      <div className="flex-1 w-full">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-white flex items-center gap-2">
            Auto-Enriquecimento ZiiiTV Ouro
            {running ? (
              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold animate-pulse">Running</span>
            ) : (
              <span className="text-[10px] bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Paused</span>
            )}
          </h3>
          <span className="text-sm font-bold text-indigo-400">{pct}% ({processed.toLocaleString()} / {job.total_count.toLocaleString()})</span>
        </div>
        
        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mt-2 relative">
           <div className={`h-full transition-all duration-300 ${running ? 'bg-gradient-to-r from-yellow-500 to-orange-500' : 'bg-gray-600'}`} style={{ width: `${pct}%` }} />
        </div>
        
        <div className="flex items-center gap-4 mt-2 text-xs">
          <span className="text-gray-400">Tempo estimado depende do limite TMDB (250ms/chamada). Pode fechar a janela, ele continua ou pausa de onde parou.</span>
          <div className="ml-auto flex items-center gap-1.5 text-green-400 font-bold bg-green-900/30 px-2 py-1 rounded">
             <CheckCircle className="w-3.5 h-3.5" />
             {linked} vinculados com precisão máxima
          </div>
        </div>
      </div>
      <div className="shrink-0 flex items-center">
         <button onClick={toggleAction} className={`p-3 rounded-full flex items-center justify-center transition-all ${running ? 'bg-red-900/50 hover:bg-red-600/80 text-red-400 hover:text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
           {running ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
         </button>
      </div>
    </div>
  )
}
