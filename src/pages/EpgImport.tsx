import { useRef, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import {
  Upload, Tv2, CheckCircle2, AlertCircle, Loader2,
  CalendarDays, Clock, Search, RefreshCw, ChevronRight,
} from 'lucide-react'

function normalizeEpgName(name: string): string {
  return name
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[._/\\]/g, ' ')
    .replace(/\b(hd|fhd|sd|h265|br|ao vivo|ao_vivo)\b/gi, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function progressOf(startTs: number, stopTs: number) {
  const now = Math.floor(Date.now() / 1000)
  const dur = stopTs - startTs
  if (dur <= 0 || now < startTs) return 0
  if (now > stopTs) return 100
  return Math.round(((now - startTs) / dur) * 100)
}

interface EpgChannel { id: string; name: string; icon_url: string | null; normalized: string }
interface EpgSchedule { id: number; channel_id: string; title: string; description: string; start_ts: number; stop_ts: number }
interface Stats { channels: number; programmes: number; lastImport: string | null }

export function EpgImport() {
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Import state ───────────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importLogs, setImportLogs] = useState<string[]>([])

  // ── Data state ─────────────────────────────────────────────────────────────
  const [stats, setStats]             = useState<Stats | null>(null)
  const [channels, setChannels]       = useState<EpgChannel[]>([])
  const [search, setSearch]           = useState('')
  const [selectedCh, setSelectedCh]   = useState<EpgChannel | null>(null)
  const [schedule, setSchedule]       = useState<EpgSchedule[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const addLog = (msg: string) => setImportLogs(p => [...p.slice(-50), msg])

  // ── Carrega dados existentes ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoadingData(true)
    try {
      const [{ count: chCount }, { count: prCount }, { data: chRows }] = await Promise.all([
        (supabase as any).from('epg_channels').select('*', { count: 'exact', head: true }),
        (supabase as any).from('epg_schedules').select('*', { count: 'exact', head: true }),
        (supabase as any).from('epg_channels').select('id,name,icon_url,normalized').order('name').limit(300),
      ])
      setStats({
        channels:   chCount  ?? 0,
        programmes: prCount  ?? 0,
        lastImport: null,
      })
      setChannels(chRows ?? [])
    } catch { /* silent */ }
    setLoadingData(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Carrega grade do canal selecionado ─────────────────────────────────────
  useEffect(() => {
    if (!selectedCh) { setSchedule([]); return }
    const now = Math.floor(Date.now() / 1000)
    const dayStart = now - 3600 * 4  // últimas 4h
    const dayEnd   = now + 3600 * 20 // próximas 20h
    ;(supabase as any)
      .from('epg_schedules')
      .select('id,channel_id,title,description,start_ts,stop_ts')
      .eq('channel_id', selectedCh.id)
      .gte('stop_ts',  dayStart)
      .lte('start_ts', dayEnd)
      .order('start_ts')
      .limit(40)
      .then(({ data }: any) => setSchedule(data ?? []))
  }, [selectedCh])

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.xml')) { toast.error('Selecione um arquivo .xml (XMLTV)'); return }

    setImporting(true)
    setImportLogs([])
    setImportProgress(0)

    try {
      addLog(`Lendo ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`)
      const text = await file.text()
      addLog('Parseando XML...')

      const parser = new DOMParser()
      const doc    = parser.parseFromString(text, 'text/xml')
      if (doc.documentElement.nodeName === 'parsererror') throw new Error('XML inválido')

      const channelEls = doc.querySelectorAll('channel')
      const channelMap = new Map<string, { name: string; icon: string; normalized: string }>()

      channelEls.forEach(el => {
        const id   = el.getAttribute('id') || ''
        const name = el.querySelector('display-name')?.textContent || id
        const icon = el.querySelector('icon')?.getAttribute('src') || ''
        if (!id || channelMap.has(id)) return
        channelMap.set(id, { name, icon, normalized: normalizeEpgName(name) })
      })

      addLog(`${channelMap.size} canais encontrados. Extraindo programação...`)

      type Prog = { channel_id: string; channel_normalized: string; start_ts: number; stop_ts: number; title: string; description: string }
      const programmes: Prog[] = []
      doc.querySelectorAll('programme').forEach(el => {
        const channelId = el.getAttribute('channel') || ''
        const startTs   = parseInt(el.getAttribute('start_timestamp') || '0')
        const stopTs    = parseInt(el.getAttribute('stop_timestamp')  || '0')
        const title     = el.querySelector('title')?.textContent || ''
        const desc      = el.querySelector('desc')?.textContent  || ''
        if (!channelId || !startTs || !title) return
        if (!channelMap.has(channelId)) {
          channelMap.set(channelId, { name: channelId, icon: '', normalized: normalizeEpgName(channelId) })
        }
        programmes.push({
          channel_id: channelId,
          channel_normalized: channelMap.get(channelId)!.normalized,
          start_ts: startTs, stop_ts: stopTs, title, description: desc,
        })
      })

      addLog(`${programmes.length} programas. Salvando canais...`)
      setImportProgress(20)

      const channelRows = Array.from(channelMap.entries()).map(([id, c]) => ({
        id, name: c.name, icon_url: c.icon || null, normalized: c.normalized,
      }))

      for (let i = 0; i < channelRows.length; i += 500) {
        const { error } = await (supabase as any)
          .from('epg_channels')
          .upsert(channelRows.slice(i, i + 500), { onConflict: 'id' })
        if (error) throw new Error(`Canais: ${error.message}`)
      }

      addLog(`✅ ${channelRows.length} canais salvos. Limpando grade antiga...`)
      setImportProgress(40)

      await (supabase as any).from('epg_schedules').delete().neq('id', 0)
      addLog('Salvando programação...')
      setImportProgress(50)

      let inserted = 0
      for (let i = 0; i < programmes.length; i += 500) {
        const { error } = await (supabase as any)
          .from('epg_schedules')
          .insert(programmes.slice(i, i + 500))
        if (error) throw new Error(`Programas: ${error.message}`)
        inserted += Math.min(500, programmes.length - i)
        setImportProgress(50 + Math.round((inserted / programmes.length) * 45))
        if (i % 5000 === 0 && i > 0) addLog(`${inserted.toLocaleString('pt-BR')} programas salvos...`)
      }

      setImportProgress(100)
      addLog(`✅ Importação concluída — ${channelRows.length} canais, ${inserted.toLocaleString('pt-BR')} programas`)
      toast.success('EPG importado com sucesso!')
      await loadData()
    } catch (err: any) {
      addLog(`❌ ${err.message}`)
      toast.error(err.message)
    } finally {
      setImporting(false)
    }
  }

  // ── Filtered channels ──────────────────────────────────────────────────────
  const filteredChannels = channels.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  )

  const now = Math.floor(Date.now() / 1000)
  const nowProgramme = schedule.find(s => s.start_ts <= now && s.stop_ts >= now)

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── COLUNA ESQUERDA ─────────────────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col">

        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[10px] bg-accent/15 flex items-center justify-center">
                <CalendarDays className="w-4 h-4 text-accent" />
              </div>
              <span className="font-semibold text-text-primary">EPG — Grade</span>
            </div>
            <button
              onClick={loadData}
              className="p-1.5 rounded-[10px] text-text-muted hover:bg-white/[0.06] transition-colors"
              title="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Stats chips */}
          {stats && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-surface rounded-card p-2.5 text-center">
                <div className="text-lg font-bold text-accent">{stats.channels.toLocaleString('pt-BR')}</div>
                <div className="text-[11px] text-text-muted">Canais</div>
              </div>
              <div className="bg-surface rounded-card p-2.5 text-center">
                <div className="text-lg font-bold text-accent">{stats.programmes.toLocaleString('pt-BR')}</div>
                <div className="text-[11px] text-text-muted">Programas</div>
              </div>
            </div>
          )}

          {/* Upload */}
          <div
            className={`border border-dashed rounded-card p-3 text-center cursor-pointer transition-colors ${importing ? 'border-accent/40 bg-accent/5' : 'border-border hover:border-accent/40'}`}
            onClick={() => !importing && fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          >
            <input ref={fileRef} type="file" accept=".xml" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            {importing ? (
              <div className="flex flex-col items-center gap-1.5">
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
                <span className="text-xs text-text-secondary">{importProgress}%</span>
                <div className="w-full h-1 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${importProgress}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Upload className="w-4 h-4 text-text-muted" />
                <span className="text-xs text-text-secondary">Importar XMLTV (.xml)</span>
              </div>
            )}
          </div>

          {/* Import logs */}
          {importLogs.length > 0 && (
            <div className="mt-3 bg-surface rounded-card p-2.5 font-mono text-[10px] text-text-muted space-y-0.5 max-h-28 overflow-y-auto">
              {importLogs.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {l.startsWith('❌') ? <AlertCircle className="w-3 h-3 text-danger flex-shrink-0" />
                    : l.startsWith('✅') ? <CheckCircle2 className="w-3 h-3 text-success flex-shrink-0" />
                    : <span className="w-3 flex-shrink-0" />}
                  <span>{l}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar canal..."
              className="w-full bg-surface border border-border rounded-[10px] pl-8 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto">
          {loadingData ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="p-6 text-center text-text-muted text-sm">
              {channels.length === 0 ? 'Nenhum EPG importado ainda' : 'Nenhum canal encontrado'}
            </div>
          ) : (
            filteredChannels.map(ch => (
              <button
                key={ch.id}
                onClick={() => setSelectedCh(ch)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.04] ${selectedCh?.id === ch.id ? 'bg-accent/10 border-r-2 border-accent' : ''}`}
              >
                {ch.icon_url ? (
                  <img src={ch.icon_url} className="w-7 h-7 rounded object-contain bg-surface flex-shrink-0"
                    onError={e => { (e.currentTarget as any).style.display = 'none' }} />
                ) : (
                  <div className="w-7 h-7 rounded bg-surface flex items-center justify-center flex-shrink-0">
                    <Tv2 className="w-3.5 h-3.5 text-text-muted" />
                  </div>
                )}
                <div className="flex-1 overflow-hidden">
                  <div className="text-sm font-medium text-text-primary truncate">{ch.name}</div>
                  <div className="text-[10px] text-text-muted truncate">{ch.normalized}</div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── COLUNA DIREITA — Grade do canal ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedCh ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-10 text-text-muted">
            <CalendarDays className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-base font-medium text-text-secondary">Selecione um canal</p>
            <p className="text-sm mt-1">para ver a grade de programação</p>
          </div>
        ) : (
          <div className="p-6">
            {/* Canal header */}
            <div className="flex items-center gap-4 mb-6 pb-5 border-b border-border">
              {selectedCh.icon_url ? (
                <img src={selectedCh.icon_url} className="w-14 h-14 rounded-[10px] object-contain bg-surface p-1 border border-border"
                  onError={e => { (e.currentTarget as any).style.display = 'none' }} />
              ) : (
                <div className="w-14 h-14 rounded-[10px] bg-surface border border-border flex items-center justify-center">
                  <Tv2 className="w-6 h-6 text-text-muted" />
                </div>
              )}
              <div>
                <h2 className="text-xl font-bold text-text-primary">{selectedCh.name}</h2>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-text-muted font-mono bg-surface px-2 py-0.5 rounded">{selectedCh.id}</span>
                  <span className="text-xs text-text-muted">normalizado: <span className="text-text-secondary">{selectedCh.normalized}</span></span>
                </div>
              </div>
              {nowProgramme && (
                <div className="ml-auto flex items-center gap-2 bg-success/10 border border-success/25 rounded-full px-4 py-2">
                  <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                  <span className="text-sm font-medium text-success">Ao vivo agora</span>
                </div>
              )}
            </div>

            {/* Schedule */}
            {schedule.length === 0 ? (
              <div className="text-center text-text-muted text-sm py-10">Nenhuma programação encontrada para este canal</div>
            ) : (
              <div className="space-y-2">
                {schedule.map(s => {
                  const isNow  = s.start_ts <= now && s.stop_ts >= now
                  const isPast = s.stop_ts < now
                  const prog   = isNow ? progressOf(s.start_ts, s.stop_ts) : 0
                  return (
                    <div key={s.id} className={`rounded-card border transition-colors ${
                      isNow  ? 'bg-success/8 border-success/25' :
                      isPast ? 'bg-transparent border-border opacity-50' :
                               'bg-surface border-border'
                    }`}>
                      <div className="flex items-start gap-4 p-4">
                        {/* Horário */}
                        <div className="flex-shrink-0 w-24 text-right">
                          <div className={`text-sm font-bold font-mono ${isNow ? 'text-success' : 'text-text-primary'}`}>
                            {formatTime(s.start_ts)}
                          </div>
                          <div className="text-[10px] text-text-muted font-mono mt-0.5">{formatTime(s.stop_ts)}</div>
                        </div>

                        {/* Conteúdo */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isNow && <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse flex-shrink-0" />}
                            <span className={`text-sm font-semibold truncate ${isNow ? 'text-white' : 'text-text-primary'}`}>{s.title}</span>
                          </div>
                          {s.description && s.description !== 'Sinopse Não Disponível.' && (
                            <p className="text-xs text-text-muted mt-1 line-clamp-2 leading-relaxed">{s.description}</p>
                          )}
                          {isNow && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-success rounded-full" style={{ width: `${prog}%`, transition: 'width 1s linear' }} />
                              </div>
                              <span className="text-[10px] text-success font-mono">{prog}%</span>
                            </div>
                          )}
                        </div>

                        {/* Badge duração */}
                        <div className="flex-shrink-0 text-right">
                          <span className="text-[10px] text-text-muted flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {Math.round((s.stop_ts - s.start_ts) / 60)} min
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
