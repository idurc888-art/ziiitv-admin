import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { normalizeStreams, parseMiniM3u, buildCatalogIndex, lookupChannel } from '../lib/m3uProcessor'
import type { CatalogIndex } from '../lib/m3uProcessor'
import { Upload, Copy, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'

type Phase = 'parsing' | 'processing' | 'linking' | 'saving' | 'generating' | ''

const PHASE_LABEL: Record<Phase, string> = {
  parsing:    '📋 Lendo lista...',
  processing: '⚙️ Classificando canais, filmes e séries...',
  linking:    '🔗 Vinculando ao catálogo TMDB existente...',
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

async function fetchCatalogIndex(onProgress?: (count: number) => void): Promise<CatalogIndex> {
  const PAGE = 1000
  let all: any[] = []
  let from = 0
  let timedOut = false

  const fetchLoop = async (): Promise<CatalogIndex> => {
    while (!timedOut) {
      const { data, error } = await supabase
        .from('canonical_titles')
        .select('id, title, alt_titles, streaming')
        .range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      all = all.concat(data)
      onProgress?.(all.length)
      if (data.length < PAGE) break
      from += PAGE
    }
    return buildCatalogIndex(all)
  }

  // 20s timeout — returns whatever was collected so far
  const timeoutRace = new Promise<CatalogIndex>(resolve =>
    setTimeout(() => { timedOut = true; resolve(buildCatalogIndex(all)) }, 20000)
  )

  return Promise.race([fetchLoop(), timeoutRace])
}

export function UploadPlaylist() {
  const navigate  = useNavigate()
  const [file, setFile]         = useState<File | null>(null)
  const [url, setUrl]           = useState('')
  const [mode, setMode]         = useState<'file' | 'url'>('url')
  const [loading, setLoading]   = useState(false)
  const [phase, setPhase]       = useState<Phase>('')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs]         = useState<string[]>([])
  const [code, setCode]         = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)
  const [stats, setStats]       = useState<Stats | null>(null)
  const cancelledRef            = useRef(false)
  const playlistIdRef           = useRef<string | null>(null)

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
    if (mode === 'file' && !file)       { toast.error('Selecione um arquivo .m3u'); return }
    if (mode === 'url' && !url.trim())  { toast.error('Cole a URL da playlist'); return }
    if (mode === 'file' && file && fileSizeMB > MAX_FILE_MB) {
      toast.error(`Arquivo maior que ${MAX_FILE_MB}MB`); return
    }

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

      // ── 1. Cria registro da playlist ─────────────────────────────────────────
      addLog('Criando registro da playlist no banco de dados...')
      const urlKey = mode === 'url' ? url.trim() : `file:${file!.name}`
      const { data: playlist, error: plErr } = await supabase
        .from('playlists')
        .insert({ url_original: urlKey, status: 'pending', user_id: user.id })
        .select()
        .single()

      if (plErr) throw plErr
      playlistIdRef.current = playlist.id

      if (mode === 'file' && file) {
        // ── Modo arquivo: tudo no browser com normalizeStreams ─────────────────
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

        // ── Vincula ao catálogo TMDB já existente no banco ────────────────────
        // canonical_titles nunca são deletadas — acumulam a cada enriquecimento.
        // Buscar aqui garante que listas novas herdem todo TMDB já processado.
        addLog('Buscando catálogo TMDB existente (isso pode levar alguns segundos)...')
        setPhase('linking')
        setProgress(35)

        const catalogIndex = await fetchCatalogIndex((count) => {
          addLog(`📚 Catálogo: ${count.toLocaleString('pt-BR')} títulos carregados...`)
        })
        setProgress(38)
        addLog(`Catálogo pronto: ${catalogIndex.raw.length} títulos. Iniciando vinculação...`)

        // Async chunked linking — keeps UI responsive and shows live progress
        const LINK_CHUNK = 2000
        let linked = 0
        const enrichedChannels: any[] = []

        for (let i = 0; i < channels.length; i += LINK_CHUNK) {
          if (cancelledRef.current) { await handleCancel(); return }
          const chunk = channels.slice(i, i + LINK_CHUNK)
          for (const ch of chunk) {
            const canonicalId = lookupChannel(ch.name, ch.streaming, catalogIndex)
            if (canonicalId) linked++
            enrichedChannels.push({ ...ch, canonicalId })
          }
          const pct = Math.round((enrichedChannels.length / channels.length) * 100)
          addLog(`🔗 Vinculando... ${enrichedChannels.length.toLocaleString('pt-BR')}/${channels.length.toLocaleString('pt-BR')} canais — ${linked} com TMDB (${pct}%)`)
          setProgress(38 + Math.round((enrichedChannels.length / channels.length) * 4))
          await new Promise(r => setTimeout(r, 0))
        }
        addLog(`✅ Vinculação concluída. ${linked} canais com TMDB associado.`)

        if (cancelledRef.current) { await handleCancel(); return }

        // ── Salva em batches de 1000 ──────────────────────────────────────────
        addLog('Iniciando salvamento no banco de dados em lotes de 1000...')
        setPhase('saving')
        const BATCH = 1000
        let inserted = 0

        for (let i = 0; i < enrichedChannels.length; i += BATCH) {
          if (cancelledRef.current) { await handleCancel(); return }

          const batch = enrichedChannels.slice(i, i + BATCH).map(ch => ({
            playlist_id:  playlist.id,
            user_id:      user.id,
            name:         ch.name,
            group_name:   ch.group,
            logo_url:     ch.logo,
            streaming:    ch.streaming,
            streams:      ch.streams,
            content_type: (ch.contentType === 'show' || ch.contentType === 'standup') ? 'series' : ch.contentType,
            canonical_id: ch.canonicalId ?? null,
            active:       true,
          }))

          const batchNum = Math.floor(i / BATCH) + 1
          const totalBatches = Math.ceil(enrichedChannels.length / BATCH)
          addLog(`💾 Lote ${batchNum}/${totalBatches} — salvando ${batch.length} canais...`)
          const { error } = await (supabase as any).from('channels').insert(batch) as { error: { message: string } | null }
          if (error) throw new Error(`Erro ao salvar canais: ${error.message}`)
          inserted += batch.length
          setProgress(40 + Math.round((inserted / enrichedChannels.length) * 45))
          addLog(`✅ Lote ${batchNum}/${totalBatches} salvo. Total: ${inserted.toLocaleString('pt-BR')}/${enrichedChannels.length.toLocaleString('pt-BR')} canais`)
        }
        addLog(`Salvamento concluído com sucesso. Todos os ${enrichedChannels.length} canais inseridos.`)

        // ── Marca playlist como pronta ────────────────────────────────────────
        await (supabase as any)
          .from('playlists')
          .update({ status: 'ready', processed_at: new Date().toISOString() })
          .eq('id', playlist.id)

        const series = channels.filter(c => c.contentType === 'series' || c.contentType === 'show' || c.contentType === 'standup').length
        const movies = channels.filter(c => c.contentType === 'movie').length
        const live   = channels.filter(c => c.contentType === 'live').length

        setStats({ raw: rawChannels.length, series, movies, live, inserted, discarded: normStats.discarded, linked })
        setProgress(90)

      } else {
        // ── Modo URL: chama Python ────────────────────────────────────────────
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

      // ── Gera código de pareamento ─────────────────────────────────────────────
      addLog('Gerando código de pareamento para acesso na TV...')
      setPhase('generating')
      const { data: codeData, error: codeErr } = await supabase.functions.invoke('generate-code')
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

          {/* Modo: URL ou arquivo */}
          <div className="flex gap-2">
            {(['file', 'url'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition ${
                  mode === m ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
                disabled={loading || !!code}
              >
                {m === 'file' ? `📁 Arquivo (até ${MAX_FILE_MB}MB)` : '🔗 URL da playlist'}
              </button>
            ))}
          </div>

          {/* Input */}
          {mode === 'url' ? (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">URL da Playlist M3U</label>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="http://exemplo.com/playlist.m3u"
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={loading || !!code}
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Arquivo M3U</label>
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

          {/* Botões */}
          {!code && (
            <div className="flex gap-2">
              <Button
                onClick={handleUpload}
                disabled={loading || (mode === 'file' && !file) || (mode === 'url' && !url.trim())}
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
          {loading && (
            <div className="space-y-4">
              {phase && (
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-white text-sm font-medium">{PHASE_LABEL[phase]}</span>
                </div>
              )}
              {progress > 0 && (
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              {/* Terminal de Logs */}
              {logs.length > 0 && (
                <div className="bg-black/50 border border-gray-800 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs text-gray-400 flex flex-col gap-1.5 shadow-inner">
                  {logs.map((log, i) => {
                    const isError = log.includes('[ERRO]')
                    const isSuccess = log.includes('concluído') || log.includes('sucesso')
                    const isSystem = log.startsWith('[') && !isError
                    
                    const logMsg = log.replace(/^\[[\d:]+\]\s*/, '')
                    const timeMatch = log.match(/^\[([\d:]+)\]/)
                    const time = timeMatch ? timeMatch[1] : ''

                    return (
                      <div key={i} className="animate-in fade-in slide-in-from-bottom-1 flex gap-2">
                        <span className="text-gray-600 shrink-0">[{time}]</span>
                        <span className={`
                          ${isError ? 'text-red-400' : ''}
                          ${isSuccess ? 'text-green-400' : ''}
                          ${!isError && !isSuccess ? 'text-gray-300' : ''}
                        `}>
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
                { label: 'Entradas brutas',    value: stats.raw.toLocaleString('pt-BR'),       color: 'text-white' },
                { label: 'Séries agrupadas',   value: stats.series.toLocaleString('pt-BR'),    color: 'text-white' },
                { label: 'Filmes',             value: stats.movies.toLocaleString('pt-BR'),    color: 'text-white' },
                { label: 'TV ao vivo',         value: stats.live.toLocaleString('pt-BR'),      color: 'text-white' },
                { label: 'TMDB vinculados',    value: stats.linked.toLocaleString('pt-BR'),    color: stats.linked > 0 ? 'text-yellow-400' : 'text-white' },
                { label: 'Descartados',        value: stats.discarded.toLocaleString('pt-BR'), color: stats.discarded > 0 ? 'text-yellow-400' : 'text-white' },
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
                    {stats.linked > 0 && ` · ${stats.linked.toLocaleString('pt-BR')} já com TMDB ✨`}
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
