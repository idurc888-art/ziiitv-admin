import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { Upload, Copy, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'

type Phase = 'uploading' | 'parsing' | 'processing' | 'saving' | ''

const PHASE_LABEL: Record<Phase, string> = {
  uploading:  '⬆️ Enviando arquivo...',
  parsing:    '📋 Lendo lista no browser...',
  processing: '⚙️ Processando lista...',
  saving:     '💾 Salvando no banco...',
  '': '',
}

interface Stats {
  raw: number
  series: number
  movies: number
  live: number
  inserted: number
}

// Supabase Storage free tier = 50MB por arquivo
// Acima disso, o browser faz o parse e envia em batches para o banco
const STORAGE_MAX_MB = 45
const MAX_FILE_MB    = 500

// Parser M3U mínimo — só extrai name/group/logo/url
function parseMiniM3u(text: string): Array<{ name: string; group: string | null; logo: string | null; url: string }> {
  const channels: Array<{ name: string; group: string | null; logo: string | null; url: string }> = []
  let current: { name: string; group: string | null; logo: string | null } | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF:')) {
      const nameM  = line.match(/,(.+)$/)
      const groupM = line.match(/group-title="([^"]*)"/)
      const logoM  = line.match(/tvg-logo="([^"]*)"/)
      current = {
        name:  nameM  ? nameM[1].trim() : '',
        group: groupM ? groupM[1] : null,
        logo:  logoM  ? logoM[1]  : null,
      }
    } else if (line && !line.startsWith('#') && current?.name) {
      channels.push({ ...current, url: line })
      current = null
    }
  }
  return channels
}

export function UploadPlaylist() {
  const navigate  = useNavigate()
  const [file, setFile]       = useState<File | null>(null)
  const [url, setUrl]         = useState('')
  const [mode, setMode]       = useState<'file' | 'url'>('url')
  const [loading, setLoading] = useState(false)
  const [phase, setPhase]     = useState<Phase>('')
  const [progress, setProgress] = useState(0)
  const [code, setCode]       = useState<string | null>(null)
  const [copied, setCopied]   = useState(false)
  const [stats, setStats]     = useState<Stats | null>(null)
  const cancelledRef          = useRef(false)
  const playlistIdRef         = useRef<string | null>(null)

  const fileSizeMB = file ? file.size / 1024 / 1024 : 0
  const useBrowserParse = fileSizeMB > STORAGE_MAX_MB

  const handleCancel = async () => {
    cancelledRef.current = true
    const pid = playlistIdRef.current
    if (pid) {
      try {
        await supabase.from('raw_channels').delete().eq('playlist_id', pid)
        await supabase.from('channels').delete().eq('playlist_id', pid)
        await supabase.from('playlists').delete().eq('id', pid)
      } catch {}
      playlistIdRef.current = null
    }
    setLoading(false)
    setPhase('')
    setProgress(0)
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
    cancelledRef.current  = false
    playlistIdRef.current = null

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Não autenticado')

      // ── 1. Cria registro da playlist ────────────────────────────────────────
      const urlKey = mode === 'url' ? url.trim() : `file:${file!.name}`
      const { data: playlist, error: plErr } = await supabase
        .from('playlists')
        .insert({ url_original: urlKey, status: 'pending', user_id: user.id })
        .select()
        .single()

      if (plErr) throw plErr
      playlistIdRef.current = playlist.id

      let storagePath: string | null = null
      let usedBrowserParse = false

      // ── 2. Arquivo ──────────────────────────────────────────────────────────
      if (mode === 'file' && file) {
        if (!useBrowserParse) {
          // Arquivo pequeno (≤45MB) → Storage → Python faz tudo
          setPhase('uploading')
          const path = `${user.id}/${playlist.id}.m3u`
          const { error: uploadErr } = await supabase.storage
            .from('playlists')
            .upload(path, file, { contentType: 'application/x-mpegurl', upsert: true })
          if (uploadErr) throw new Error(`Upload falhou: ${uploadErr.message}`)
          storagePath = path
        } else {
          // Arquivo grande (>45MB) → browser lê + parseia + insere em batches no banco
          setPhase('parsing')
          toast(`Arquivo ${fileSizeMB.toFixed(0)}MB — processando no browser...`, { duration: 4000 })

          const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload  = () => resolve(reader.result as string)
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'))
            reader.readAsText(file, 'utf-8')
          })

          if (cancelledRef.current) { await handleCancel(); return }

          const rawChannels = parseMiniM3u(text)

          setPhase('uploading')
          const BATCH = 3000
          for (let i = 0; i < rawChannels.length; i += BATCH) {
            if (cancelledRef.current) { await handleCancel(); return }
            const batch = rawChannels.slice(i, i + BATCH).map(ch => ({
              playlist_id: playlist.id,
              name:        ch.name,
              group_name:  ch.group,
              logo:        ch.logo,
              url:         ch.url,
            }))
            const { error } = await supabase.from('raw_channels').insert(batch)
            if (error) throw new Error(`Erro ao salvar canais: ${error.message}`)
            setProgress(Math.round(((i + batch.length) / rawChannels.length) * 40))
          }
          usedBrowserParse = true
        }

        if (cancelledRef.current) { await handleCancel(); return }
      }

      // ── 3. Chama a API Python ───────────────────────────────────────────────
      setPhase('processing')
      setProgress(45)

      const apiBody: Record<string, unknown> = {
        playlist_id:  playlist.id,
        url:          mode === 'url' ? url.trim() : undefined,
        storage_path: storagePath ?? undefined,
        from_db:      usedBrowserParse ? true : undefined,
      }

      const resp = await fetch('/api/process_playlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(apiBody),
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

      // ── 4. Gera código de pareamento ────────────────────────────────────────
      setPhase('saving')
      const { data: codeData, error: codeErr } = await supabase.functions.invoke('generate-code')
      if (codeErr) throw codeErr
      setCode(codeData.code)
      setProgress(100)

    } catch (err: any) {
      console.error('[Upload]', err)
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
        description="Processa M3U via Worker, enriquece com TMDB e gera código para a TV"
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
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-sm text-gray-400">{file.name} ({fileSizeMB.toFixed(1)} MB)</p>
                  {useBrowserParse && (
                    <span className="text-xs px-2 py-0.5 bg-blue-900/50 text-blue-400 rounded-full">
                      arquivo grande — processado no browser
                    </span>
                  )}
                </div>
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

          {/* Progresso */}
          {loading && (
            <div className="space-y-2">
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
            </div>
          )}

          {/* Stats */}
          {stats && !code && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Entradas brutas',  value: stats.raw.toLocaleString('pt-BR') },
                { label: 'Séries agrupadas', value: stats.series.toLocaleString('pt-BR') },
                { label: 'Filmes',           value: stats.movies.toLocaleString('pt-BR') },
                { label: 'TV ao vivo',       value: stats.live.toLocaleString('pt-BR') },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-lg font-bold text-white">{value}</p>
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
