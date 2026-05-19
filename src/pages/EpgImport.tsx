import React, { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { Upload, Tv2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

function normalizeEpgName(name: string): string {
  return name
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[._/\\]/g, ' ')
    .replace(/\b(hd|fhd|sd|h265|br|ao vivo|ao_vivo)\b/gi, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

interface Stats {
  channels: number
  programmes: number
  inserted: number
}

export function EpgImport() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState(0)

  const addLog = (msg: string) => setLogs(p => [...p.slice(-40), msg])

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.xml') && !file.name.endsWith('.gz')) {
      toast.error('Selecione um arquivo .xml (XMLTV)')
      return
    }

    setLoading(true)
    setStats(null)
    setLogs([])
    setProgress(0)

    try {
      addLog(`Lendo arquivo: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`)

      const text = await file.text()
      addLog('Parseando XML...')

      const parser = new DOMParser()
      const doc = parser.parseFromString(text, 'text/xml')

      if (doc.documentElement.nodeName === 'parsererror') {
        throw new Error('XML inválido')
      }

      // ── Extrai canais ─────────────────────────────────────────────────────
      const channelEls = doc.querySelectorAll('channel')
      const channelMap = new Map<string, { name: string; icon: string; normalized: string }>()

      channelEls.forEach(el => {
        const id   = el.getAttribute('id') || ''
        const name = el.querySelector('display-name')?.textContent || id
        const icon = el.querySelector('icon')?.getAttribute('src') || ''
        if (!id) return
        if (!channelMap.has(id)) {
          channelMap.set(id, { name, icon, normalized: normalizeEpgName(name) })
        }
      })

      addLog(`${channelMap.size} canais encontrados. Extraindo programação...`)

      // ── Extrai programmes ─────────────────────────────────────────────────
      const progEls = doc.querySelectorAll('programme')
      type ProgEntry = { channel_id: string; channel_normalized: string; start_ts: number; stop_ts: number; title: string; description: string }
      const programmes: ProgEntry[] = []

      progEls.forEach(el => {
        const channelId = el.getAttribute('channel') || ''
        const startTs   = parseInt(el.getAttribute('start_timestamp') || '0')
        const stopTs    = parseInt(el.getAttribute('stop_timestamp')  || '0')
        const title     = el.querySelector('title')?.textContent || ''
        const desc      = el.querySelector('desc')?.textContent  || ''

        if (!channelId || !startTs || !title) return

        // Auto-registra canal que aparece em programme mas não em channel
        if (!channelMap.has(channelId)) {
          channelMap.set(channelId, {
            name:       channelId,
            icon:       '',
            normalized: normalizeEpgName(channelId),
          })
        }

        const normalized = channelMap.get(channelId)!.normalized
        programmes.push({ channel_id: channelId, channel_normalized: normalized, start_ts: startTs, stop_ts: stopTs, title, description: desc })
      })

      addLog(`${programmes.length} programas encontrados. Salvando canais...`)
      setProgress(20)

      // ── Salva canais em batches ───────────────────────────────────────────
      const channelRows = Array.from(channelMap.entries()).map(([id, c]) => ({
        id, name: c.name, icon_url: c.icon || null, normalized: c.normalized,
      }))

      const BATCH = 500
      for (let i = 0; i < channelRows.length; i += BATCH) {
        const { error } = await (supabase as any)
          .from('epg_channels')
          .upsert(channelRows.slice(i, i + BATCH), { onConflict: 'id' })
        if (error) throw new Error(`Canais: ${error.message}`)
      }

      addLog(`✅ ${channelRows.length} canais salvos. Limpando grade antiga...`)
      setProgress(40)

      // Limpa schedules antigos antes de inserir novos
      await (supabase as any).from('epg_schedules').delete().neq('id', 0)
      addLog('Grade antiga removida. Salvando programação...')
      setProgress(50)

      // ── Salva programmes em batches ───────────────────────────────────────
      let inserted = 0
      const PROG_BATCH = 500
      for (let i = 0; i < programmes.length; i += PROG_BATCH) {
        const { error } = await (supabase as any)
          .from('epg_schedules')
          .insert(programmes.slice(i, i + PROG_BATCH))
        if (error) throw new Error(`Programas (lote ${Math.floor(i / PROG_BATCH)}): ${error.message}`)
        inserted += Math.min(PROG_BATCH, programmes.length - i)
        setProgress(50 + Math.round((inserted / programmes.length) * 45))
        if (i % 5000 === 0 && i > 0) addLog(`${inserted.toLocaleString('pt-BR')} programas salvos...`)
      }

      setProgress(100)
      setStats({ channels: channelRows.length, programmes: programmes.length, inserted })
      addLog(`✅ Importação concluída!`)
      toast.success('EPG importado com sucesso!')
    } catch (err: any) {
      addLog(`❌ Erro: ${err.message}`)
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
          <Tv2 className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Importar EPG</h1>
          <p className="text-sm text-text-muted mt-0.5">Grade de programação para canais ao vivo (formato XMLTV)</p>
        </div>
      </div>

      {/* Upload area */}
      <div
        className="border-2 border-dashed border-border rounded-2xl p-10 text-center cursor-pointer hover:border-accent/50 transition-colors mb-6"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
      >
        <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-accent animate-spin" />
            <p className="text-text-secondary">Processando... {progress}%</p>
            <div className="w-64 h-2 bg-surface rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-10 h-10 text-text-muted" />
            <p className="text-text-primary font-medium">Arraste o arquivo EPG aqui</p>
            <p className="text-text-muted text-sm">ou clique para selecionar · formato XMLTV (.xml)</p>
          </div>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Canais', value: stats.channels },
            { label: 'Programas', value: stats.programmes },
            { label: 'Salvos', value: stats.inserted },
          ].map(s => (
            <div key={s.label} className="bg-surface rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-accent">{s.value.toLocaleString('pt-BR')}</div>
              <div className="text-sm text-text-muted mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div className="bg-surface rounded-xl p-4 font-mono text-xs text-text-secondary space-y-1 max-h-64 overflow-y-auto">
          {logs.map((l, i) => (
            <div key={i} className="flex items-start gap-2">
              {l.startsWith('❌') ? <AlertCircle className="w-3.5 h-3.5 text-danger mt-0.5 flex-shrink-0" />
                : l.startsWith('✅') ? <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 flex-shrink-0" />
                : <span className="w-3.5 flex-shrink-0" />}
              <span>{l}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
