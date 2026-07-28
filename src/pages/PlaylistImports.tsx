import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Database, Eye, FileWarning,
  Loader2, RefreshCw, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Upload, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Header } from '../components/layout/Header'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabase'

interface ImportMetrics {
  raw_count: number
  normalized_count: number
  live_count: number
  movie_count: number
  series_count: number
  unknown_count: number
  duplicate_url_count: number
  parse_issue_count: number
  auto_match_count: number
  review_count: number
  unmatched_count: number
  previous_normalized_count: number | null
  change_ratio: number | null
  warnings: unknown[]
}

interface ImportRun {
  id: string
  playlist_id: string
  status: string
  source_kind: 'm3u' | 'xtream'
  source_mode: 'file' | 'url' | 'api'
  parser_version: string
  matcher_version: string
  progress: number
  current_stage: string | null
  attempt_count: number
  validation_status: 'pending' | 'passed' | 'review_required'
  activation_blockers: Array<{ code?: string; [key: string]: unknown }>
  error_code: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
  activated_at: string | null
  activation_forced: boolean
  activation_reason: string | null
  playlists?: { url_original: string } | null
  playlist_import_metrics?: ImportMetrics | ImportMetrics[] | null
}

interface ReviewItem {
  id: string
  display_title: string
  content_type: string
  group_title: string | null
  release_year: number | null
  match_status: string
  classification_confidence: number
  suggestion?: SuggestedCandidate
}

interface SuggestedCandidate {
  id: string
  title: string
  year: number | string | null
  type: string
  confidence: number
}

interface MatchDecisionRow {
  item_id: string
  candidate_id: string | null
  confidence: number
  canonical_titles: { title: string; year: number | string | null; type: string } | null
}

const TERMINAL = new Set(['active', 'superseded', 'failed', 'cancelled', 'rolled_back'])
const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila', fetching: 'Baixando', parsing: 'Interpretando', normalizing: 'Normalizando',
  matching: 'Relacionando catálogo', validating: 'Validando', ready_for_activation: 'Pronta para publicar',
  active: 'Publicada', superseded: 'Versão anterior', failed: 'Falhou', cancelled: 'Cancelada', rolled_back: 'Revertida',
}

function metric(run: ImportRun): ImportMetrics | null {
  const value = run.playlist_import_metrics
  return Array.isArray(value) ? value[0] || null : value || null
}

function runTone(run: ImportRun): string {
  if (run.status === 'failed') return 'text-danger bg-danger/10 border-danger/20'
  if (run.validation_status === 'review_required') return 'text-neon bg-neon/10 border-neon/20'
  if (run.status === 'active' || run.validation_status === 'passed') return 'text-neon bg-neon/10 border-neon/20'
  return 'text-accent bg-accent/10 border-accent/20'
}

const RUN_SELECT = `
  id, playlist_id, status, source_kind, source_mode, parser_version, matcher_version,
  progress, current_stage, attempt_count, validation_status, activation_blockers,
  error_code, error_message, created_at, completed_at, activated_at, activation_forced,
  activation_reason, playlists!playlist_id(url_original), playlist_import_metrics(*)
`

export function PlaylistImports() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<ImportRun[]>([])
  const [loading, setLoading] = useState(true)
  const [moduleUnavailable, setModuleUnavailable] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('playlist_import_runs').select(RUN_SELECT).order('created_at', { ascending: false }).limit(100)
    if (error) {
      const missingTable = error.code === 'PGRST205' || error.message?.includes('playlist_import_runs')
      setModuleUnavailable(missingTable)
      if (!missingTable) toast.error(`Importações: ${error.message}`)
    } else {
      setModuleUnavailable(false)
      setRuns((data || []) as ImportRun[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(initialLoad)
  }, [load])

  return <div className="animate-in fade-in duration-500 space-y-6">
    <Header title="Central de Importação" description="Cada execução é isolada, mensurável e reversível antes de alimentar a apresentação."
      action={<Button onClick={() => navigate('/admin/upload')} icon={<Upload className="h-4 w-4" />}>Nova importação</Button>} />
    {loading ? <Loading /> : moduleUnavailable ? <ModuleUnavailable /> : runs.length === 0 ? <Empty /> : <div className="space-y-3">{runs.map((run) => <RunCard key={run.id} run={run} />)}</div>}
  </div>
}

function RunCard({ run }: { run: ImportRun }) {
  const metrics = metric(run)
  return <Link to={`/admin/playlists/${run.playlist_id}/imports/${run.id}`} className="block">
    <Card className="border border-transparent transition-colors hover:border-border" padding="sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border ${runTone(run)}`}><Database className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold text-text-primary">{run.playlists?.url_original || 'Playlist'}</p><span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${runTone(run)}`}>{STATUS_LABEL[run.status] || run.status}</span></div>
          <p className="mt-1 text-xs text-text-muted">{run.source_kind.toUpperCase()} · parser {run.parser_version} · {new Date(run.created_at).toLocaleString('pt-BR')}</p>
        </div>
        <div className="grid grid-cols-3 gap-5 text-right text-xs">
          <Summary value={metrics?.normalized_count ?? '—'} label="Itens" />
          <Summary value={metrics?.review_count ?? '—'} label="Revisar" />
          <Summary value={`${run.progress}%`} label="Progresso" />
        </div>
      </div>
    </Card>
  </Link>
}

export function PlaylistImportDetail() {
  const { id: playlistId, importId } = useParams<{ id: string; importId: string }>()
  const [run, setRun] = useState<ImportRun | null>(null)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [searchingItem, setSearchingItem] = useState<ReviewItem | null>(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogResults, setCatalogResults] = useState<SuggestedCandidate[]>([])
  const [searchingCatalog, setSearchingCatalog] = useState(false)

  const load = useCallback(async (quiet = false) => {
    if (!importId) return
    const { data, error } = await supabase.from('playlist_import_runs').select(RUN_SELECT).eq('id', importId).single()
    if (error) {
      if (!quiet) toast.error(error.message)
      setLoading(false)
      return
    }
    const next = data as ImportRun
    setRun(next)
    if (next.status === 'ready_for_activation' || TERMINAL.has(next.status)) {
      const { data: items } = await supabase.from('normalized_playlist_items')
        .select('id,display_title,content_type,group_title,release_year,match_status,classification_confidence')
        .eq('import_id', importId).in('match_status', ['review_required', 'unmatched']).order('display_title').limit(100)
      const itemRows = (items || []) as ReviewItem[]
      const itemIds = itemRows.map(item => item.id)
      let decisionRows: MatchDecisionRow[] = []
      if (itemIds.length > 0) {
        const { data: decisions } = await supabase.from('canonical_match_decisions')
          .select('item_id,candidate_id,confidence,canonical_titles(title,year,type)')
          .eq('import_id', importId).eq('status', 'review_required').in('item_id', itemIds)
        decisionRows = (decisions || []) as MatchDecisionRow[]
      }
      const suggestions = new Map(decisionRows.filter(decision => decision.candidate_id && decision.canonical_titles).map(decision => [
        decision.item_id,
        {
          id: decision.candidate_id as string,
          title: decision.canonical_titles!.title,
          year: decision.canonical_titles!.year,
          type: decision.canonical_titles!.type,
          confidence: Number(decision.confidence),
        },
      ]))
      setReviewItems(itemRows.map(item => ({ ...item, suggestion: suggestions.get(item.id) })))
    }
    setLoading(false)
  }, [importId])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(initialLoad)
  }, [load])

  const runStatus = run?.status
  useEffect(() => {
    if (!runStatus || TERMINAL.has(runStatus)) return
    const timer = window.setInterval(() => load(true), 2500)
    return () => window.clearInterval(timer)
  }, [load, runStatus])

  async function promote(force = false) {
    if (!run) return
    let reason: string | null = null
    if (force) {
      reason = window.prompt('Motivo obrigatório para publicação com alertas:')?.trim() || null
      if (!reason) return
    }
    setActing(true)
    const { error } = await supabase.rpc('promote_playlist_import', { p_import_id: run.id, p_force: force, p_reason: reason })
    if (error) toast.error(error.message)
    else { toast.success('Versão publicada atomicamente.'); await load() }
    setActing(false)
  }

  async function rollback() {
    if (!run || !playlistId || !window.confirm('Reativar esta versão anterior? A versão atual continuará preservada.')) return
    setActing(true)
    const { error } = await supabase.rpc('rollback_playlist_import', { p_playlist_id: playlistId, p_target_import_id: run.id })
    if (error) toast.error(error.message)
    else { toast.success('Rollback concluído.'); await load() }
    setActing(false)
  }

  async function cancel() {
    if (!run || !window.confirm('Cancelar esta importação? O catálogo atualmente publicado não será alterado.')) return
    setActing(true)
    const { error } = await supabase.rpc('cancel_playlist_import', { p_import_id: run.id })
    if (error) toast.error(error.message)
    else { toast.success('Cancelamento solicitado.'); await load() }
    setActing(false)
  }

  async function resolveIdentity(item: ReviewItem, action: 'matched' | 'rejected', canonicalId: string | null) {
    setActing(true)
    const { error } = await supabase.rpc('resolve_playlist_identity', {
      p_item_id: item.id, p_action: action, p_canonical_id: canonicalId,
    })
    if (error) toast.error(error.message)
    else {
      toast.success(action === 'matched' ? 'Associação salva para as próximas importações.' : 'Sugestão rejeitada e registrada.')
      setSearchingItem(null)
      setCatalogResults([])
      await load()
    }
    setActing(false)
  }

  async function searchCatalog() {
    if (!searchingItem || catalogSearch.trim().length < 2) return
    setSearchingCatalog(true)
    const { data, error } = await supabase.from('canonical_titles')
      .select('id,title,year,type').eq('type', searchingItem.content_type)
      .ilike('title', `%${catalogSearch.trim()}%`).order('popularity', { ascending: false }).limit(12)
    if (error) toast.error(error.message)
    else setCatalogResults(((data || []) as Array<{ id: string; title: string; year: number | string | null; type: string }>).map(candidate => ({ ...candidate, confidence: 1 })))
    setSearchingCatalog(false)
  }

  if (loading) return <Loading />
  if (!run) return <Empty />
  const metrics = metric(run)
  const isProcessing = !TERMINAL.has(run.status) && run.status !== 'ready_for_activation'

  return <div className="animate-in fade-in duration-500 space-y-6">
    <Link to="/admin/imports" className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary"><ArrowLeft className="h-4 w-4" /> Central de Importação</Link>
    <Header title={run.playlists?.url_original || 'Auditoria da playlist'} description={`Execução ${run.id.slice(0, 8)} · ${STATUS_LABEL[run.status] || run.status}`}
      action={<div className="flex gap-2"><Button variant="ghost" onClick={() => load()} icon={<RefreshCw className="h-4 w-4" />}>Atualizar</Button>{isProcessing && <Button variant="danger" loading={acting} onClick={cancel}>Cancelar</Button>}{run.status === 'ready_for_activation' && run.validation_status === 'passed' && <Button loading={acting} onClick={() => promote(false)} icon={<ShieldCheck className="h-4 w-4" />}>Publicar versão</Button>}{run.status === 'ready_for_activation' && run.validation_status === 'review_required' && <Button loading={acting} onClick={() => promote(true)} icon={<AlertTriangle className="h-4 w-4" />}>Publicar com justificativa</Button>}{['superseded', 'rolled_back'].includes(run.status) && <Button loading={acting} onClick={rollback} icon={<RotateCcw className="h-4 w-4" />}>Restaurar versão</Button>}</div>} />

    <Card className="border border-border">
      <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Etapa atual</p><p className="mt-1 font-semibold text-text-primary">{STATUS_LABEL[run.status] || run.current_stage || run.status}</p></div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${runTone(run)}`}>{run.validation_status === 'review_required' ? 'Revisão obrigatória' : run.validation_status === 'passed' ? 'Validação aprovada' : `${run.progress}%`}</span></div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-elevated"><div className={`h-full transition-all ${run.validation_status === 'review_required' ? 'bg-neon' : 'bg-accent'}`} style={{ width: `${run.progress}%` }} /></div>
      {isProcessing && <p className="mt-3 flex items-center gap-2 text-xs text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> O catálogo atualmente publicado não foi alterado.</p>}
      {run.error_message && <p className="mt-4 rounded-card border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{run.error_code}: {run.error_message}</p>}
    </Card>

    {metrics && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Brutos" value={metrics.raw_count} /><Metric label="Normalizados" value={metrics.normalized_count} /><Metric label="Ao vivo" value={metrics.live_count} /><Metric label="Filmes" value={metrics.movie_count} /><Metric label="Séries" value={metrics.series_count} /><Metric label="Desconhecidos" value={metrics.unknown_count} warning={metrics.unknown_count > 0} /></div>}

    {run.activation_blockers.length > 0 && <Card className="border border-neon/20 bg-neon/[0.04]"><h2 className="flex items-center gap-2 font-semibold text-neon"><FileWarning className="h-5 w-5" /> Bloqueios encontrados</h2><div className="mt-4 space-y-2">{run.activation_blockers.map((blocker, index) => <div key={`${blocker.code}-${index}`} className="rounded-card bg-base/50 p-3 text-sm text-text-secondary"><strong className="text-text-primary">{blockerLabel(blocker.code)}</strong><span className="ml-2 text-xs text-text-muted">{JSON.stringify(blocker)}</span></div>)}</div></Card>}

    <Card>
      <div className="flex items-center justify-between"><div><h2 className="font-semibold text-text-primary">Fila de tratamento</h2><p className="mt-1 text-xs text-text-muted">Somente títulos ambíguos ou sem correspondência; URLs e credenciais nunca aparecem.</p></div><SlidersHorizontal className="h-5 w-5 text-text-muted" /></div>
      {reviewItems.length === 0 ? <p className="mt-5 flex items-center gap-2 text-sm text-text-secondary"><CheckCircle2 className="h-4 w-4 text-neon" /> Nenhum item pendente entre os primeiros resultados.</p> : <div className="mt-5 divide-y divide-border">{reviewItems.map((item) => <div key={item.id} className="grid gap-3 py-4 xl:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]"><div><p className="text-sm font-medium text-text-primary">{item.display_title}{item.release_year ? ` (${item.release_year})` : ''}</p><p className="text-xs text-text-muted">{item.group_title || 'Sem grupo'} · {item.content_type}</p></div><div>{item.suggestion ? <><p className="text-xs text-text-muted">Sugestão {Math.round(item.suggestion.confidence * 100)}%</p><p className="mt-0.5 text-sm text-text-primary">{item.suggestion.title}{item.suggestion.year ? ` (${item.suggestion.year})` : ''}</p></> : <p className="text-xs text-text-muted">Sem sugestão segura</p>}</div><div className="flex flex-wrap gap-2">{item.suggestion && <Button size="sm" loading={acting} onClick={() => resolveIdentity(item, 'matched', item.suggestion!.id)}>Aceitar</Button>}<Button size="sm" variant="ghost" onClick={() => { setSearchingItem(item); setCatalogSearch(item.display_title); setCatalogResults([]) }} icon={<Search className="h-3.5 w-3.5" />}>Escolher outro</Button><Button size="sm" variant="danger" loading={acting} onClick={() => resolveIdentity(item, 'rejected', null)}>Rejeitar</Button></div></div>)}</div>}
    </Card>

    {run.status === 'active' && <Card className="border border-accent/20 bg-accent/[0.04]"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-text-primary">Catálogo publicado</h2><p className="mt-1 text-sm text-text-secondary">Agora organize seções e confira o resultado antes do teste Samsung.</p></div><div className="flex gap-2"><Link to="/admin/homes"><Button variant="ghost" icon={<SlidersHorizontal className="h-4 w-4" />}>Organizar Home</Button></Link><Link to="/admin/preview"><Button icon={<Eye className="h-4 w-4" />}>Abrir Preview</Button></Link></div></div></Card>}

    {searchingItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><Card className="w-full max-w-2xl border border-border"><div className="flex items-start justify-between"><div><h2 className="font-semibold text-text-primary">Associar “{searchingItem.display_title}”</h2><p className="mt-1 text-xs text-text-muted">Busca limitada a {searchingItem.content_type}; a decisão será reutilizada.</p></div><button onClick={() => setSearchingItem(null)} className="rounded-[10px] p-2 text-text-muted hover:bg-elevated"><X className="h-4 w-4" /></button></div><div className="mt-5 flex gap-2"><input value={catalogSearch} onChange={event => setCatalogSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') searchCatalog() }} autoFocus className="min-w-0 flex-1 rounded-[10px] border border-border bg-elevated px-4 py-2 text-sm text-text-primary outline-none focus:border-accent" /><Button loading={searchingCatalog} onClick={searchCatalog} icon={<Search className="h-4 w-4" />}>Buscar</Button></div><div className="mt-4 max-h-80 space-y-2 overflow-y-auto">{catalogResults.map(candidate => <button key={candidate.id} onClick={() => resolveIdentity(searchingItem, 'matched', candidate.id)} className="flex w-full items-center justify-between rounded-[10px] border border-border bg-elevated p-3 text-left hover:border-accent"><span className="text-sm font-medium text-text-primary">{candidate.title}</span><span className="text-xs text-text-muted">{candidate.type}{candidate.year ? ` · ${candidate.year}` : ''}</span></button>)}</div></Card></div>}
  </div>
}

function Summary({ value, label }: { value: string | number; label: string }) { return <div><p className="font-mono text-sm font-semibold text-text-primary">{value}</p><p className="mt-0.5 text-text-muted">{label}</p></div> }
function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) { return <Card padding="sm" className="border border-border"><p className={`font-mono text-xl font-bold ${warning ? 'text-neon' : 'text-text-primary'}`}>{value.toLocaleString('pt-BR')}</p><p className="mt-1 text-xs text-text-muted">{label}</p></Card> }
function Loading() { return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div> }
function Empty() { return <Card><div className="py-12 text-center"><Clock3 className="mx-auto h-8 w-8 text-text-muted" /><p className="mt-3 text-sm text-text-secondary">Nenhuma importação encontrada.</p></div></Card> }
function ModuleUnavailable() {
  return <Card className="border border-neon/20 bg-neon/5">
    <div className="flex items-start gap-4 py-4">
      <AlertTriangle className="mt-0.5 h-6 w-6 flex-none text-neon" />
      <div>
        <p className="font-semibold text-text-primary">Módulo QI220 aguardando instalação no Supabase</p>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          O painel já está atualizado, mas as tabelas versionadas ainda não foram aplicadas no banco recuperado.
          A playlist ativa permanece intacta até a migração e o shadow import serem validados.
        </p>
      </div>
    </div>
  </Card>
}
function blockerLabel(code?: string): string { return ({ catalog_drop_over_50_percent: 'Queda superior a 50% no catálogo', parse_issue_ratio_high: 'Taxa de erros de leitura acima do limite', unknown_ratio_high: 'Mais da metade dos itens sem tipo confiável', ambiguous_match_review_pending: 'Associações ambíguas aguardam tratamento' } as Record<string, string>)[code || ''] || code || 'Validação pendente' }
