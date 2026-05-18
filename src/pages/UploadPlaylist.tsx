import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { normalizeStreams, parseMiniM3u } from '../lib/m3uProcessor'
import { Upload, Copy, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'

type Phase = 'parsing' | 'processing' | 'saving' | 'generating' | ''
type Mode  = 'file' | 'url' | 'xtream'

const PHASE_LABEL: Record<Phase, string> = {
  parsing:    '📋 Lendo lista...',
  processing: '⚙️ Classificando canais, filmes e séries...',
  saving:     '💾 Salvando no banco...',
  generating: '🎯 Gerando código...',
  '': '',
}

interface Stats {
  raw:       number
  series:    number
  movies:    number
  live:      number
  inserted:  number
  discarded: number
  linked:    number
}

const MAX_FILE_MB = 500
const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY as string

function parseXtreamUrl(url: string): { host: string; username: string; password: string } | null {
  try {
    const u = new URL(url)
    const username = u.searchParams.get('username')
    const password = u.searchParams.get('password')
    if (!username || !password) return null
    return { host: `${u.protocol}//${u.host}`, username, password }
  } catch { return null }
}

async function fetchTmdbDetails(tmdbId: number, type: 'movie' | 'series') {
  const mediaType = type === 'series' ? 'tv' : 'movie'
  try {
    const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_KEY}&language=pt-BR&append_to_response=credits`)
    if (!res.ok) return null
    const d = await res.json()
    return {
      overview:  d.overview || '',
      poster:    d.poster_path   ? `https://image.tmdb.org/t/p/w342${d.poster_path}`   : null,
      backdrop:  d.backdrop_path ? `https://image.tmdb.org/t/p/w780${d.backdrop_path}` : null,
      rating:    d.vote_average || 0,
      year:      (d.release_date || d.first_air_date || '').slice(0, 4),
      genres:    (d.genres || []).map((g: any) => g.name),
      cast:      (d.credits?.cast || []).slice(0, 5).map((c: any) => c.name),
      director:  (d.credits?.crew || []).find((c: any) => c.job === 'Director')?.name || null,
      runtime:   d.runtime || d.episode_run_time?.[0] || null,
    }
  } catch { return null }
}

export function UploadPlaylist() {
  const navigate = useNavigate()

  const [file, setFile]             = useState<File | null>(null)
  const [url, setUrl]               = useState('')
  const [mode, setMode]             = useState<Mode>('url')
  const [xtreamHost, setXtreamHost] = useState('')
  const [xtreamUser, setXtreamUser] = useState('')
  const [xtreamPass, setXtreamPass] = useState('')
  const [loading, setLoading]       = useState(false)
  const [phase, setPhase]           = useState<Phase>('')
  const [progress, setProgress]     = useState(0)
  const [logs, setLogs]             = useState<string[]>([])
  const [code, setCode]             = useState<string | null>(null)
  const [copied, setCopied]         = useState(false)
  const [stats, setStats]           = useState<Stats | null>(null)
  const cancelledRef                = useRef(false)
  const playlistIdRef               = useRef<string | null>(null)

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('pt-BR', { hour12: false })
    setLogs(prev => [...prev, `[${time}] ${msg}`])
  }

  const fileSizeMB = file ? file.size / 1024 / 1024 : 0

  const handleCancel = async () => {
    cancelledRef.current = true
    const pid = playlistIdRef.current
    if (pid) {
      try {
        await supabase.from('channels').delete().eq('playlist_id', pid)
        await supabase.from('playlists').delete().eq('id', pid)
      } catch {}
      playlistIdRef.current = null
    }
    setLoading(false)
    setPhase('')
    setProgress(0)
    addLog('Upload cancelado pelo usuário.')
    toast('Upload cancelado')
  }

  const handleUpload = async () => {
    if (mode === 'file'   && !file)                                                                     { toast.error('Selecione um arquivo .m3u'); return }
    if (mode === 'url'    && !url.trim())                                                               { toast.error('Cole a URL da playlist'); return }
    if (mode === 'xtream' && (!xtreamHost.trim() || !xtreamUser.trim() || !xtreamPass.trim()))         { toast.error('Preencha Host, Usuário e Senha'); return }
    if (mode === 'file'   && file && fileSizeMB > MAX_FILE_MB)                                         { toast.error(`Arquivo maior que ${MAX_FILE_MB}MB`); return }

    setLoading(true)
    setStats(null)
    setProgress(0)
    setLogs([])
    cancelledRef.current  = false
    playlistIdRef.current = null

    try {
      addLog('Iniciando processamento da playlist...')
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Não autenticado')

      const host   = xtreamHost.trim().replace(/\/+$/, '')
      const xtream = mode === 'xtream'
        ? { host, username: xtreamUser.trim(), password: xtreamPass.trim() }
        : parseXtreamUrl(url.trim())

      const urlKey = mode === 'file'   ? `file:${file!.name}`
                   : mode === 'xtream' ? `xtream:${host}`
                   :                     url.trim()

      addLog('Criando registro da playlist no banco de dados...')
      const { data: playlist, error: plErr } = await supabase
        .from('playlists')
        .insert({ url_original: urlKey, status: 'pending', user_id: user.id })
        .select()
        .single()

      if (plErr) throw plErr
      playlistIdRef.current = playlist.id

      // ── Modo arquivo ──────────────────────────────────────────────────────────
      if (mode === 'file' && file) {
        addLog(`Lendo arquivo local: ${file.name} (${fileSizeMB.toFixed(1)} MB)...`)
        setPhase('parsing')
        setProgress(5)

        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload  = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('Erro ao ler arquivo'))
          reader.readAsText(file, 'utf-8')
        })

        if (cancelledRef.current) { await handleCancel(); return }

        addLog('Arquivo lido com sucesso. Analisando formato M3U...')
        const rawChannels = parseMiniM3u(text)
        setProgress(15)
        setPhase('processing')

        addLog(`Encontradas ${rawChannels.length} entradas brutas. Classificando em filmes, séries e canais...`)
        const { channels, stats: normStats } = normalizeStreams(rawChannels)
        setProgress(30)
        addLog(`Classificação concluída: ${channels.length} canais únicos. (${normStats.discarded} itens descartados)`)

        if (cancelledRef.current) { await handleCancel(); return }

        addLog(`Salvando ${channels.length.toLocaleString('pt-BR')} canais no banco (${Math.ceil(channels.length / 1000)} lotes)...`)
        setPhase('saving')
        setProgress(35)
        const BATCH = 1000
        let inserted = 0
        const totalBatches = Math.ceil(channels.length / BATCH)

        for (let i = 0; i < channels.length; i += BATCH) {
          if (cancelledRef.current) { await handleCancel(); return }
          const batchNum = Math.floor(i / BATCH) + 1
          const batch = channels.slice(i, i + BATCH).map(ch => ({
            playlist_id:  playlist.id,
            user_id:      user.id,
            name:         ch.name,
            group_name:   ch.group,
            logo_url:     ch.logo,
            streaming:    ch.streaming,
            streams:      ch.streams,
            content_type: (ch.contentType === 'show' || ch.contentType === 'standup') ? 'series' : ch.contentType,
            canonical_id: null,
            active:       true,
          }))

          addLog(`💾 Lote ${batchNum}/${totalBatches} — ${batch.length} canais...`)
          const { error } = await (supabase as any).from('channels').insert(batch) as { error: { message: string } | null }
          if (error) throw new Error(`Lote ${batchNum}: ${error.message}`)
          inserted += batch.length
          setProgress(35 + Math.round((inserted / channels.length) * 50))
          addLog(`✅ Lote ${batchNum}/${totalBatches} — ${inserted.toLocaleString('pt-BR')}/${channels.length.toLocaleString('pt-BR')} canais salvos`)
        }

        addLog(`✅ Todos os ${channels.length.toLocaleString('pt-BR')} canais salvos. TMDB vinculado após upload.`)

        await (supabase as any)
          .from('playlists')
          .update({ status: 'ready', processed_at: new Date().toISOString() })
          .eq('id', playlist.id)

        const seriesCount = channels.filter(c => c.contentType === 'series' || c.contentType === 'show' || c.contentType === 'standup').length
        const moviesCount = channels.filter(c => c.contentType === 'movie').length
        const liveCount   = channels.filter(c => c.contentType === 'live').length

        setStats({ raw: rawChannels.length, series: seriesCount, movies: moviesCount, live: liveCount, inserted, discarded: normStats.discarded, linked: 0 })
        setProgress(90)

      // ── Modo Xtream (mode==='xtream' OU URL com credenciais embutidas) ─────────
      } else if (xtream) {
        addLog(`🎯 Xtream: ${xtream.host}`)
        setPhase('parsing')
        setProgress(5)

        addLog('Buscando filmes, séries e canais ao vivo...')
        const { data: xtreamData, error: xtreamErr } = await supabase.functions.invoke('fetch-xtream', {
          body: { host: xtream.host, username: xtream.username, password: xtream.password },
        })
        if (xtreamErr) throw new Error(xtreamErr.message)
        if (!xtreamData?.success) {
          if (xtreamData?.debug) {
            const d = xtreamData.debug
            addLog(`🔍 VOD (${d.vod_status}): ${d.vod_raw}`)
            addLog(`🔍 Series (${d.series_status}): ${d.series_raw}`)
            addLog(`🔍 Live (${d.live_status}): ${d.live_raw}`)
          }
          throw new Error(xtreamData?.error || 'Erro ao conectar no servidor Xtream')
        }

        const vod: any[]    = xtreamData.vod    ?? []
        const series: any[] = xtreamData.series ?? []
        const live: any[]   = xtreamData.live   ?? []

        addLog(`📦 ${vod.length} filmes | ${series.length} séries | ${live.length} ao vivo`)
        setProgress(20)
        setPhase('processing')

        const channels: any[] = []

        for (const v of vod) {
          channels.push({
            playlist_id:  playlist.id,
            user_id:      user.id,
            name:         v.name,
            group_name:   v.category_name || 'Filmes',
            logo_url:     v.stream_icon || '',
            streaming:    null,
            streams:      [{ u: `${xtream.host}/movie/${xtream.username}/${xtream.password}/${v.stream_id}.mp4`, q: 'UNKNOWN' }],
            content_type: 'movie',
            canonical_id: null,
            active:       true,
            _tmdb_id:     v.tmdb || v.tmdb_id || null,
            _type:        'movie' as const,
          })
        }

        for (const s of series) {
          channels.push({
            playlist_id:  playlist.id,
            user_id:      user.id,
            name:         s.name,
            group_name:   s.category_name || 'Séries',
            logo_url:     s.cover || '',
            streaming:    null,
            streams:      [],
            content_type: 'series',
            canonical_id: null,
            active:       true,
            _tmdb_id:     s.tmdb || s.tmdb_id || null,
            _type:        'series' as const,
          })
        }

        for (const l of live) {
          channels.push({
            playlist_id:  playlist.id,
            user_id:      user.id,
            name:         l.name,
            group_name:   l.category_name || 'Ao Vivo',
            logo_url:     l.stream_icon || '',
            streaming:    null,
            streams:      [{ u: `${xtream.host}/live/${xtream.username}/${xtream.password}/${l.stream_id}.ts`, q: 'UNKNOWN' }],
            content_type: 'live',
            canonical_id: null,
            active:       true,
            _tmdb_id:     null,
            _type:        null,
          })
        }

        setProgress(35)
        setPhase('saving')

        const withTmdb    = channels.filter(c => c._tmdb_id && c._type)
        const withoutTmdb = channels.filter(c => !c._tmdb_id || !c._type)

        addLog(`🔗 ${withTmdb.length} canais com tmdb_id — enriquecendo automaticamente...`)

        let linked = 0
        const ENRICH_BATCH = 20

        for (let i = 0; i < withTmdb.length; i += ENRICH_BATCH) {
          if (cancelledRef.current) { await handleCancel(); return }
          const batch = withTmdb.slice(i, i + ENRICH_BATCH)

          await Promise.all(batch.map(async (ch) => {
            try {
              const details     = await fetchTmdbDetails(ch._tmdb_id, ch._type)
              const slug        = ch.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
              const canonicalId = `${ch._type === 'series' ? 'serie' : 'filme'}-${slug}`

              await supabaseAdmin.from('canonical_titles').upsert({
                id: canonicalId, slug, title: ch.name,
                type: ch._type,
                streaming: null,
                tmdb_id: ch._tmdb_id,
                ...(details || {}),
              }, { onConflict: 'id' })

              ch.canonical_id = canonicalId
              linked++
            } catch { /* não bloqueia */ }
          }))

          setProgress(35 + Math.round((i / withTmdb.length) * 40))
          addLog(`✅ ${Math.min(i + ENRICH_BATCH, withTmdb.length)}/${withTmdb.length} enriquecidos`)
        }

        const allToSave = [...withTmdb, ...withoutTmdb].map(({ _tmdb_id, _type, ...ch }) => ch)
        const BATCH = 1000
        let inserted = 0

        for (let i = 0; i < allToSave.length; i += BATCH) {
          if (cancelledRef.current) { await handleCancel(); return }
          const { error } = await (supabase as any).from('channels').insert(allToSave.slice(i, i + BATCH))
          if (error) throw new Error(error.message)
          inserted += Math.min(BATCH, allToSave.length - i)
          setProgress(75 + Math.round((inserted / allToSave.length) * 15))
        }

        await (supabase as any).from('playlists').update({ status: 'ready', processed_at: new Date().toISOString() }).eq('id', playlist.id)

        setStats({ raw: channels.length, series: series.length, movies: vod.length, live: live.length, inserted, discarded: 0, linked })
        setProgress(90)
        addLog(`🎉 Xtream importado! ${linked} canais enriquecidos automaticamente.`)

      // ── Modo URL M3U normal ───────────────────────────────────────────────────
      } else {
        addLog('Enviando solicitação de processamento de URL para a nuvem...')
        setPhase('processing')
        setProgress(20)

        const resp = await fetch('/api/process_playlist', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ playlist_id: playlist.id, url: url.trim() }),
        })

        if (cancelledRef.current) return

        const result = await resp.json()
        if (!resp.ok || !result.success) {
          throw new Error(result.error || `Erro ${resp.status}`)
        }

        if (result.skipped) {
          toast('Lista idêntica — nada mudou')
          navigate(`/playlists/${playlist.id}`)
          return
        }

        setStats(result)
        setProgress(90)
        addLog('Processamento em nuvem finalizado.')
      }

      // ── Gera código de pareamento (todos os modos) ────────────────────────────
      addLog('Gerando código de pareamento para acesso na TV...')
      setPhase('generating')
      const { data: codeData, error: codeErr } = await supabase.functions.invoke('generate-code', {
        body: { playlist_id: playlistIdRef.current },
      })
      if (codeErr) throw codeErr
      setCode(codeData.code)
      setProgress(100)
      addLog(`Código gerado com sucesso: ${codeData.code}`)

    } catch (err: any) {
      addLog(`[ERRO] ${err.message}`)
      const msg: string = err.message || 'Erro ao processar playlist'
      const friendly = msg.includes('403')
        ? 'Provedor IPTV bloqueou o acesso. Baixe o arquivo .m3u e use o modo Arquivo.'
        : msg
      toast.error(friendly, { duration: 8000 })
      setCode(null)
      setStats(null)
    } finally {
      setLoading(false)
      setPhase('')
    }
  }

  const copyCode = () => {
    if (!code) return
    navigator.clipboard.writeText(code)
    setCopied(true)
    toast.success('Código copiado!')
    setTimeout(() => setCopied(false), 2000)
  }

  const reset = () => {
    setCode(null)
    setStats(null)
    setFile(null)
    setUrl('')
    setXtreamHost('')
    setXtreamUser('')
    setXtreamPass('')
    setProgress(0)
  }

  return (
    <div className="space-y-6">
      <Header
        title="Upload de Playlist"
        description="Classifica, vincula ao catálogo TMDB e gera código para a TV"
      />

      <Card className="max-w-2xl">
        <div className="space-y-4">

          {/* Modo */}
          <div className="flex gap-2">
            {(['file', 'url', 'xtream'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition ${
                  mode === m ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
                disabled={loading || !!code}
              >
                {m === 'file' ? '📁 Arquivo' : m === 'url' ? '🔗 URL M3U' : '📡 Xtream'}
              </button>
            ))}
          </div>

          {/* Input por modo */}
          {mode === 'url' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">URL da Playlist M3U</label>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="http://exemplo.com/get.php?username=X&password=Y&type=m3u_plus"
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={loading || !!code}
              />
            </div>
          )}

          {mode === 'file' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Arquivo M3U (até {MAX_FILE_MB}MB)</label>
              <input
                type="file"
                accept=".m3u,.m3u8"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                disabled={loading || !!code}
              />
              {file && (
                <p className="mt-1 text-sm text-gray-400">{file.name} ({fileSizeMB.toFixed(1)} MB)</p>
              )}
            </div>
          )}

          {mode === 'xtream' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Host</label>
                <input
                  type="url"
                  value={xtreamHost}
                  onChange={e => setXtreamHost(e.target.value)}
                  placeholder="http://servidor.com:8080"
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  disabled={loading || !!code}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-300 mb-1">Usuário</label>
                  <input
                    type="text"
                    value={xtreamUser}
                    onChange={e => setXtreamUser(e.target.value)}
                    placeholder="usuario"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={loading || !!code}
                    autoComplete="off"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-300 mb-1">Senha</label>
                  <input
                    type="password"
                    value={xtreamPass}
                    onChange={e => setXtreamPass(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={loading || !!code}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Botões */}
          {!code && (
            <div className="flex gap-2">
              <Button
                onClick={handleUpload}
                disabled={
                  loading ||
                  (mode === 'file'   && !file) ||
                  (mode === 'url'    && !url.trim()) ||
                  (mode === 'xtream' && (!xtreamHost.trim() || !xtreamUser.trim() || !xtreamPass.trim()))
                }
                className="flex-1"
              >
                <Upload className="w-4 h-4 mr-2" />
                {loading ? 'Processando...' : 'Processar Playlist'}
              </Button>
              {loading && (
                <Button onClick={handleCancel} variant="danger" className="shrink-0 px-4">
                  <X className="w-4 h-4 mr-1" />
                  Cancelar
                </Button>
              )}
            </div>
          )}

          {/* Progresso e Logs */}
          {(loading || logs.length > 0) && !code && (
            <div className="space-y-4">
              {loading && phase && (
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-white text-sm font-medium">{PHASE_LABEL[phase]}</span>
                </div>
              )}
              {loading && progress > 0 && (
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              {logs.length > 0 && (
                <div className="bg-black/50 border border-gray-800 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs text-gray-400 flex flex-col gap-1.5 shadow-inner">
                  {logs.map((log, i) => {
                    const isError   = log.includes('[ERRO]')
                    const isSuccess = log.includes('concluído') || log.includes('sucesso')
                    const logMsg    = log.replace(/^\[[\d:]+\]\s*/, '')
                    const timeMatch = log.match(/^\[([\d:]+)\]/)
                    const time      = timeMatch ? timeMatch[1] : ''
                    return (
                      <div key={i} className="animate-in fade-in slide-in-from-bottom-1 flex gap-2">
                        <span className="text-gray-600 shrink-0">[{time}]</span>
                        <span className={isError ? 'text-red-400' : isSuccess ? 'text-green-400' : 'text-gray-300'}>
                          {logMsg}
                        </span>
                      </div>
                    )
                  })}
                  <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth' })} />
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          {stats && !code && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Entradas brutas', value: stats.raw.toLocaleString('pt-BR'),       color: 'text-white' },
                { label: 'Séries',          value: stats.series.toLocaleString('pt-BR'),    color: 'text-white' },
                { label: 'Filmes',          value: stats.movies.toLocaleString('pt-BR'),    color: 'text-white' },
                { label: 'TV ao vivo',      value: stats.live.toLocaleString('pt-BR'),      color: 'text-white' },
                {
                  label: 'TMDB vinculados',
                  value: stats.linked > 0 ? stats.linked.toLocaleString('pt-BR') : '— (após upload)',
                  color: stats.linked > 0 ? 'text-green-400' : 'text-gray-500',
                },
                { label: 'Descartados', value: stats.discarded.toLocaleString('pt-BR'), color: stats.discarded > 0 ? 'text-yellow-400' : 'text-white' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className={`text-lg font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Código gerado */}
          {code && (
            <div className="p-6 bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-lg space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Código Gerado!</h3>
                {stats && (
                  <p className="text-sm text-gray-400">
                    {stats.series.toLocaleString('pt-BR')} séries · {stats.movies.toLocaleString('pt-BR')} filmes · {stats.live.toLocaleString('pt-BR')} TV ao vivo
                    {stats.linked > 0
                      ? ` · ${stats.linked.toLocaleString('pt-BR')} vinculados ao TMDB ✨`
                      : ` · TMDB será vinculado em Playlists ✨`}
                  </p>
                )}
              </div>
              <p className="text-gray-300 text-sm">Digite na TV para acessar os canais:</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 px-4 py-3 bg-black/50 rounded-lg">
                  <code className="text-2xl font-mono font-bold text-purple-400">{code}</code>
                </div>
                <Button onClick={copyCode} className="shrink-0 bg-gray-800 text-gray-300 hover:bg-gray-700">
                  {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>
              <Button onClick={reset} className="w-full bg-gray-800 text-gray-300 hover:bg-gray-700">
                Processar Outra Playlist
              </Button>
            </div>
          )}

        </div>
      </Card>
    </div>
  )
}
