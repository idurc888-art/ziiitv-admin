import React, { useState, useRef } from 'react'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { Upload, Copy, Check, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

type Phase =
  | 'loading' | 'parsing' | 'normalizing' | 'matching'
  | 'inserting' | ''

const PHASE_LABEL: Record<Phase, string> = {
  loading:    '⬇️ Carregando M3U...',
  parsing:    '📖 Parseando M3U...',
  normalizing:'🔄 Normalizando streams...',
  matching:   '🎯 Fazendo matching...',
  inserting:  '💾 Salvando no banco...',
  '': '',
}

interface ProgressState { phase: Phase; percent: number; message: string }
interface StatsState { parsed: number; normalized: number; matched: number; movies: number; series: number; liveTV: number }

function hashString(s: string): string {
  let h = 0
  for (let i = 0; i < Math.min(s.length, 200_000); i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return `${s.length}-${h >>> 0}`
}

// ── Web Worker: roda parse+normalize+match fora da UI thread ─────────────────
// workerRef e rejectRef são expostos para que handleCancel possa abortar.
function runM3UWorker(
  content: string,
  catalog: any[],
  onProgress: (p: ProgressState) => void,
  workerRef: React.MutableRefObject<Worker | null>,
  rejectRef: React.MutableRefObject<((reason: any) => void) | null>
): Promise<{ matched: any[]; unmatched: any[]; liveTV: any[]; stats: any }> {
  return new Promise((resolve, reject) => {
    rejectRef.current = reject  // expõe o reject para cancelamento externo

    const worker = new Worker(
      new URL('../workers/m3uWorker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker  // expõe para terminate() externo

    worker.onmessage = (e: MessageEvent) => {
      const { type, phase, percent, message, matched, unmatched, liveTV, stats } = e.data
      if (type === 'progress') {
        onProgress({ phase: phase as Phase, percent, message })
      } else if (type === 'done') {
        workerRef.current = null
        worker.terminate()
        resolve({ matched, unmatched, liveTV: liveTV ?? [], stats })
      } else if (type === 'error') {
        workerRef.current = null
        worker.terminate()
        reject(new Error(message))
      }
    }

    worker.onerror = (err) => {
      workerRef.current = null
      worker.terminate()
      reject(new Error(err.message || 'Worker error'))
    }

    worker.postMessage({ type: 'process', content, catalog })
  })
}

export function UploadPlaylist() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'file' | 'url'>('file')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ProgressState>({ phase: '', percent: 0, message: '' })
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState<StatsState>({ parsed: 0, normalized: 0, matched: 0, movies: 0, series: 0, liveTV: 0 })

  // ── Refs para cancelamento ──────────────────────────────────────────────────
  const workerRef     = useRef<Worker | null>(null)
  const workerReject  = useRef<((r: any) => void) | null>(null)
  const cancelledRef  = useRef(false)
  const playlistIdRef = useRef<string | null>(null)  // para limpar Supabase se cancelar

  const MAX_FILE_SIZE = 100 * 1024 * 1024

  // ── Cancelar e limpar tudo ──────────────────────────────────────────────────
  const handleCancel = async () => {
    cancelledRef.current = true

    // Para o worker imediatamente
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    // Rejeita a Promise pendente do worker
    workerReject.current?.(new Error('Cancelado'))
    workerReject.current = null

    // Limpa dados parciais do Supabase
    const pid = playlistIdRef.current
    if (pid) {
      try {
        // CASCADE faz o resto, mas deletamos channels explicitamente por segurança
        await supabase.from('channels').delete().eq('playlist_id', pid)
        await supabase.from('playlists').delete().eq('id', pid)
        console.log('[Cancel] Limpeza concluída para playlist', pid)
      } catch (e) {
        console.warn('[Cancel] Erro na limpeza:', e)
      }
      playlistIdRef.current = null
    }

    setLoading(false)
    setProgress({ phase: '', percent: 0, message: '' })
    setStats({ parsed: 0, normalized: 0, matched: 0, movies: 0, series: 0, liveTV: 0 })
    toast('Upload cancelado')
  }

  const handleUpload = async () => {
    if (mode === 'file' && !file) { toast.error('Selecione um arquivo .m3u'); return }
    if (mode === 'url' && !url.trim()) { toast.error('Cole a URL da playlist'); return }
    if (mode === 'file' && file && file.size > MAX_FILE_SIZE) {
      toast.error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Use URL`)
      return
    }

    setLoading(true)
    setStats({ parsed: 0, normalized: 0, matched: 0, movies: 0, series: 0, liveTV: 0 })
    cancelledRef.current = false
    playlistIdRef.current = null

    try {
      // ── 1. Download conteúdo ──────────────────────────────────────────────
      setProgress({ phase: 'loading', percent: 0, message: 'Baixando arquivo...' })
      const content = mode === 'file'
        ? await file!.text()
        : await (await fetch(url)).text()

      // ── DEDUP: detectar lista já processada ───────────────────────────────
      const contentHash = hashString(content)
      const urlKey = mode === 'url' ? url.trim() : `file:${file!.name}`

      const { data: existingPlaylists } = await supabase
        .from('playlists')
        .select('id, channel_count, content_hash')
        .or(`url_original.eq.${urlKey},content_hash.eq.${contentHash}`)
        .eq('status', 'ready')
        .limit(1)

      if (existingPlaylists && existingPlaylists.length > 0) {
        const existing = existingPlaylists[0]
        const confirmReuse = window.confirm(
          `Esta lista já foi processada antes (${existing.channel_count} canais).\n\n` +
          `Reutilizar catálogo existente? (Muito mais rápido!)\n` +
          `Cancelar = processar do zero.`
        )
        if (confirmReuse) {
          await reusePlaylist(existing.id, urlKey, contentHash)
          return
        }
      }

      // ── 2. Buscar catálogo Supabase (antes de lançar o Worker) ───────────
      setProgress({ phase: 'matching', percent: 0, message: 'Carregando catálogo...' })
      const { data: catalog } = await supabase
        .from('canonical_titles')
        .select('id, title, alt_titles, match_hints, streaming')
      const catalogItems = catalog || []
      console.log('[Upload] Catalog:', catalogItems.length, 'titles')

      // ── 3. Worker: parse + dedup + normalize + match (fora da UI thread) ──
      const { matched: matchedChannels, unmatched: unmatchedChannels, liveTV: liveTVChannels, stats: ws } =
        await runM3UWorker(content, catalogItems, (p) => setProgress(p), workerRef, workerReject)

      if (cancelledRef.current) return

      const totalToInsert = matchedChannels.length + (unmatchedChannels?.length || 0) + (liveTVChannels?.length || 0)
      console.log('[Upload] Worker done — matched:', matchedChannels.length, 'unmatched:', unmatchedChannels?.length, 'liveTV:', liveTVChannels?.length)
      console.log('[Upload] LiveTV sample:', liveTVChannels?.slice(0,3).map((c:any) => c.name))
      setStats(s => ({ ...s, parsed: ws.parsed, normalized: ws.normalized, matched: matchedChannels.length, movies: ws.movies || 0, series: ws.series || 0, liveTV: ws.liveTV || 0 }))

      // ── 4. Gerar código de pareamento ─────────────────────────────────────
      const { data: codeData, error: codeError } = await supabase.functions.invoke('generate-code')
      if (codeError) throw codeError
      setCode(codeData.code)

      // ── 5. Criar playlist ─────────────────────────────────────────────────
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não autenticado')

      const { data: playlist, error: playlistError } = await supabase
        .from('playlists')
        .insert({ url_original: urlKey, content_hash: contentHash, status: 'processing', user_id: user.id })
        .select().single()

      if (playlistError) throw playlistError
      playlistIdRef.current = playlist.id  // registra para limpeza se cancelar

      if (cancelledRef.current) { await handleCancel(); return }

      // ── 6. Inserir canais matched + unmatched + TV ao vivo em batches de 100 ─
      const toRow = (ch: any, canonical_id: string | null, overrides?: Partial<any>) => ({
        playlist_id:  playlist.id,
        user_id:      user.id,
        name:         ch.name,
        streams:      ch.streams,
        group_name:   ch.group,
        logo_url:     ch.logo,
        canonical_id,
        streaming:    (ch.streaming && ch.streaming !== 'unknown') ? ch.streaming : null,
        content_type: ch.contentType || 'movie',
        // seasons: ch.seasons || null,  // TODO: ALTER TABLE channels ADD COLUMN IF NOT EXISTS seasons jsonb;
        ...overrides,
      })

      // Salva matched (com canonical TMDB) + unmatched (com streaming via group-title) + live TV
      const allToInsert = [
        ...matchedChannels.map((ch: any) => toRow(ch, ch.canonical_id)),
        ...(unmatchedChannels || []).map((ch: any) => toRow(ch, null)),
        ...(liveTVChannels || []).map((ch: any) => toRow(ch, null, { content_type: 'live', streaming: null })),
      ]

      setProgress({ phase: 'inserting', percent: 0, message: `${allToInsert.length} canais...` })
      let inserted = 0

      for (let i = 0; i < allToInsert.length; i += 100) {
        if (cancelledRef.current) { await handleCancel(); return }
        const batch = allToInsert.slice(i, i + 100)

        const { error } = await supabase.from('channels').insert(batch)
        if (!error) {
          inserted += batch.length
          setProgress({
            phase: 'inserting',
            percent: Math.round((inserted / allToInsert.length) * 100),
            message: `${inserted.toLocaleString()} / ${allToInsert.length.toLocaleString()}`,
          })
        } else {
          console.error('[Upload] Batch insert error:', error.message, batch[0])
        }
      }

      // ── 7. Finalizar ─────────────────────────────────────────────────────
      await supabase.from('playlists').update({
        status: 'ready',
        channel_count: inserted,
        processed_at: new Date().toISOString(),
      }).eq('id', playlist.id)

      // Criar Job de Enriquecimento Automático
      const enrichableCount = allToInsert.filter(ch => ch.content_type === 'movie' || ch.content_type === 'series').length
      if (enrichableCount > 0) {
        await supabase.from('enrich_jobs').insert({
          playlist_id: playlist.id,
          status: 'pending',
          total_count: enrichableCount,
          processed_count: 0
        })
      }

      toast.success(`✅ ${inserted} canais salvos!`)
      navigate(`/playlists/${playlist.id}`)

    } catch (error: any) {
      console.error('[Upload] Error:', error)
      toast.error(error.message || 'Erro ao processar playlist')
      setCode(null)
    } finally {
      setLoading(false)
      setProgress({ phase: '', percent: 0, message: '' })
    }
  }

  // ── Reutilizar playlist existente ─────────────────────────────────────────
  const reusePlaylist = async (sourcePlaylistId: string, urlKey: string, contentHash: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não autenticado')

      setProgress({ phase: 'matching', percent: 0, message: 'Buscando playlist existente...' })
      const { data: sourceChannels, error: fetchErr } = await supabase
        .from('channels')
        .select('name, streams, group_name, logo_url, canonical_id, streaming, content_type')
        .eq('playlist_id', sourcePlaylistId)

      if (fetchErr || !sourceChannels) throw new Error('Erro ao buscar playlist existente')

      const { data: codeData, error: codeError } = await supabase.functions.invoke('generate-code')
      if (codeError) throw codeError
      setCode(codeData.code)

      const { data: playlist, error: playlistError } = await supabase
        .from('playlists')
        .insert({ url_original: urlKey, content_hash: contentHash, status: 'processing', user_id: user.id })
        .select().single()

      if (playlistError) throw playlistError

      setProgress({ phase: 'inserting', percent: 0, message: `Clonando ${sourceChannels.length} canais...` })
      let inserted = 0

      for (let i = 0; i < sourceChannels.length; i += 200) {
        const batch = sourceChannels.slice(i, i + 200).map(ch => ({
          ...ch, playlist_id: playlist.id, user_id: user.id,
        }))
        const { error } = await supabase.from('channels').insert(batch)
        if (!error) {
          inserted += batch.length
          setProgress({
            phase: 'inserting',
            percent: Math.round((inserted / sourceChannels.length) * 100),
            message: `${inserted.toLocaleString()} / ${sourceChannels.length.toLocaleString()}`,
          })
        }
      }

      await supabase.from('playlists').update({
        status: 'ready', channel_count: inserted, processed_at: new Date().toISOString(),
      }).eq('id', playlist.id)

      toast.success(`✅ ${inserted} canais reutilizados em segundos!`)
    } catch (err: any) {
      toast.error(err.message || 'Erro ao reutilizar playlist')
      setCode(null)
    } finally {
      setLoading(false)
      setProgress({ phase: '', percent: 0, message: '' })
    }
  }

  const copyCode = () => {
    if (code) {
      navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success('Código copiado!')
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-6">
      <Header
        title="Upload de Playlist"
        description="Processa M3U via Worker, enriquece com TMDB e gera código para a TV"
      />

      <Card className="max-w-2xl">
        <div className="space-y-4">
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
                {m === 'file' ? '📁 Arquivo (até 100MB)' : '🔗 URL (arquivos grandes)'}
              </button>
            ))}
          </div>

          {mode === 'file' ? (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Arquivo M3U</label>
              <input
                type="file" accept=".m3u,.m3u8"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                disabled={loading || !!code}
              />
              {file && (
                <p className="mt-2 text-sm text-gray-400">
                  {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  {file.size > MAX_FILE_SIZE && <span className="text-red-400 ml-2">⚠️ Muito grande! Use URL</span>}
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">URL da Playlist M3U</label>
              <input
                type="url" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="http://exemplo.com/playlist.m3u"
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={loading || !!code}
              />
            </div>
          )}

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
                <Button
                  onClick={handleCancel}
                  variant="danger"
                  className="shrink-0 px-4"
                  title="Cancelar e limpar"
                >
                  <X className="w-4 h-4 mr-1" />
                  Cancelar
                </Button>
              )}
            </div>
          )}

          {loading && progress.phase && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white font-medium">{PHASE_LABEL[progress.phase]}</span>
                <span className="text-gray-400 text-xs">{progress.message}</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{progress.percent}%</span>
                {stats.normalized > 0 && (
                  <span>
                    {stats.normalized.toLocaleString()} únicos
                    {stats.matched > 0 && ` → ${stats.matched.toLocaleString()} matched`}
                    {stats.movies > 0 && ` (🎬 ${stats.movies} filmes`}
                    {stats.series > 0 && ` · 📺 ${stats.series} séries`}
                    {stats.liveTV > 0 && ` · 📡 ${stats.liveTV} TV ao vivo`}
                    {stats.movies > 0 && ')'}
                  </span>
                )}
              </div>
            </div>
          )}

          {code && (
            <div className="mt-6 p-6 bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-lg">
              <h3 className="text-lg font-semibold text-white mb-2">✅ Código Gerado!</h3>
              <p className="text-gray-300 text-sm mb-4">Digite na TV para acessar os canais:</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 px-4 py-3 bg-black/50 rounded-lg">
                  <code className="text-2xl font-mono font-bold text-purple-400">{code}</code>
                </div>
                <Button onClick={copyCode} className="shrink-0 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white">
                  {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>
              <Button onClick={() => { setCode(null); setFile(null); setUrl('') }} className="w-full mt-4 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white">
                Processar Outra Playlist
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
