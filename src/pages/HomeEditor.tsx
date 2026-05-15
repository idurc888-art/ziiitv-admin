import React, { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from 'react-hot-toast'
import {
  ArrowLeft,
  Plus,
  GripVertical,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2
} from 'lucide-react'

const SECTION_TYPES = [
  { value: 'continue_watching', label: 'Continuar Assistindo' },
  { value: 'editorial', label: 'Editorial (Admin escolhe)' },
  { value: 'canonical_movies', label: 'Filmes do Catálogo' },
  { value: 'canonical_series', label: 'Séries do Catálogo' },
  { value: 'by_streaming', label: 'Por Streaming (Netflix, Prime...)' },
  { value: 'by_genre', label: 'Por Gênero' },
  { value: 'recently_added', label: 'Adicionados Recentemente' },
  { value: 'live_featured', label: 'TV ao Vivo em Destaque' },
]

interface Section {
  id: string
  home_id: string
  title: string
  type: string
  sort_order: number
  active: boolean
  config: any
}

interface HomeInfo {
  id: string
  name: string
  is_active: boolean
}

export function HomeEditor() {
  const { id } = useParams<{ id: string }>()
  const [homeInfo, setHomeInfo] = useState<HomeInfo | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingSection, setEditingSection] = useState<Section | null>(null)
  const [sectionForm, setSectionForm] = useState({ title: '', type: 'editorial', config_streaming: '', config_genre: '' })
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [{ data: home }, { data: secs }] = await Promise.all([
      supabase.from('homes').select('id, name, is_active').eq('id', id).single(),
      supabase.from('home_sections').select('*').eq('home_id', id).order('sort_order')
    ])
    setHomeInfo(home)
    setSections(secs || [])
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  function openAdd() {
    setEditingSection(null)
    setSectionForm({ title: '', type: 'editorial', config_streaming: '', config_genre: '' })
    setShowAddModal(true)
  }

  function openEdit(s: Section) {
    setEditingSection(s)
    setSectionForm({
      title: s.title,
      type: s.type,
      config_streaming: s.config?.streaming || '',
      config_genre: s.config?.genre || ''
    })
    setShowAddModal(true)
  }

  function buildConfig(form: typeof sectionForm) {
    const cfg: any = {}
    if (form.config_streaming) cfg.streaming = form.config_streaming
    if (form.config_genre) cfg.genre = form.config_genre
    return Object.keys(cfg).length ? cfg : null
  }

  async function handleSaveSection() {
    if (!sectionForm.title.trim()) { toast.error('Título obrigatório'); return }
    setSaving(true)
    const config = buildConfig(sectionForm)
    const payload = {
      home_id: id,
      title: sectionForm.title,
      type: sectionForm.type,
      active: true,
      config,
      sort_order: editingSection ? editingSection.sort_order : sections.length
    }
    if (editingSection) {
      const { error } = await supabase.from('home_sections').update(payload).eq('id', editingSection.id)
      if (error) toast.error('Erro ao salvar')
      else { toast.success('Seção atualizada!'); setShowAddModal(false); fetchData() }
    } else {
      const { error } = await supabase.from('home_sections').insert(payload)
      if (error) toast.error('Erro ao criar')
      else { toast.success('Seção criada!'); setShowAddModal(false); fetchData() }
    }
    setSaving(false)
  }

  async function handleToggle(s: Section) {
    await supabase.from('home_sections').update({ active: !s.active }).eq('id', s.id)
    setSections(prev => prev.map(sec => sec.id === s.id ? { ...sec, active: !sec.active } : sec))
  }

  async function handleDelete(s: Section) {
    if (!confirm(`Deletar seção "${s.title}"?`)) return
    await supabase.from('home_sections').delete().eq('id', s.id)
    toast.success('Seção removida')
    fetchData()
  }

  async function moveSection(index: number, dir: -1 | 1) {
    const newSecs = [...sections]
    const target = index + dir
    if (target < 0 || target >= newSecs.length) return
    const a = newSecs[index]
    const b = newSecs[target]
    newSecs[index] = { ...b, sort_order: a.sort_order }
    newSecs[target] = { ...a, sort_order: b.sort_order }
    setSections(newSecs)
    await Promise.all([
      supabase.from('home_sections').update({ sort_order: a.sort_order }).eq('id', b.id),
      supabase.from('home_sections').update({ sort_order: b.sort_order }).eq('id', a.id)
    ])
  }

  const typeMeta = (type: string) => SECTION_TYPES.find(t => t.value === type)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/homes" className="p-2 rounded-lg text-text-muted hover:bg-elevated transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-text-primary">
              {homeInfo?.name || 'Carregando...'}
            </h1>
            {homeInfo?.is_active && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-xs rounded-full font-medium">
                <CheckCircle2 className="w-3 h-3" /> Ativa na TV
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted">Editor de seções — arranje e configure os trilhos da home</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Adicionar Seção
        </button>
      </div>

      {/* Sections */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      ) : sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-text-muted text-sm mb-4">Nenhuma seção ainda. Adicione a primeira!</p>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm">
            <Plus className="w-4 h-4" /> Adicionar Seção
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.sort((a, b) => a.sort_order - b.sort_order).map((s, i) => (
            <div
              key={s.id}
              className={`bg-surface border rounded-xl p-4 flex items-center gap-4 transition-all ${
                s.active ? 'border-border' : 'border-border opacity-50'
              }`}
            >
              {/* Drag handle & order */}
              <div className="flex flex-col items-center gap-0.5 text-text-faint">
                <button onClick={() => moveSection(i, -1)} disabled={i === 0} className="hover:text-text-primary disabled:opacity-20 transition-colors">
                  <ChevronUp className="w-4 h-4" />
                </button>
                <GripVertical className="w-4 h-4" />
                <button onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1} className="hover:text-text-primary disabled:opacity-20 transition-colors">
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Order number */}
              <div className="w-7 h-7 rounded-full bg-elevated flex items-center justify-center text-xs text-text-muted font-mono flex-shrink-0">
                {i + 1}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text-primary text-sm">{s.title}</p>
                <p className="text-xs text-text-muted">
                  {typeMeta(s.type)?.label || s.type}
                  {s.config?.streaming && <> · {s.config.streaming}</>}
                  {s.config?.genre && <> · {s.config.genre}</>}
                </p>
              </div>

              {/* Toggle active */}
              <button
                onClick={() => handleToggle(s)}
                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                  s.active
                    ? 'bg-success/10 text-success hover:bg-success/20'
                    : 'bg-elevated text-text-muted hover:bg-border'
                }`}
              >
                {s.active ? 'Visível' : 'Oculta'}
              </button>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(s)}
                  className="p-2 rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(s)}
                  className="p-2 rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal seção */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-text-primary">
              {editingSection ? 'Editar Seção' : 'Nova Seção'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Título da seção *</label>
                <input
                  className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                  placeholder="Ex: Em Destaque, Filmes de Ação..."
                  value={sectionForm.title}
                  onChange={e => setSectionForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Tipo</label>
                <select
                  className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                  value={sectionForm.type}
                  onChange={e => setSectionForm(f => ({ ...f, type: e.target.value }))}
                >
                  {SECTION_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {sectionForm.type === 'by_streaming' && (
                <div>
                  <label className="block text-xs text-text-muted mb-1">Streaming</label>
                  <input
                    className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    placeholder="netflix, prime, disney..."
                    value={sectionForm.config_streaming}
                    onChange={e => setSectionForm(f => ({ ...f, config_streaming: e.target.value }))}
                  />
                </div>
              )}
              {sectionForm.type === 'by_genre' && (
                <div>
                  <label className="block text-xs text-text-muted mb-1">Gênero</label>
                  <input
                    className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    placeholder="ação, comédia, terror..."
                    value={sectionForm.config_genre}
                    onChange={e => setSectionForm(f => ({ ...f, config_genre: e.target.value }))}
                  />
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-text-secondary text-sm hover:bg-elevated transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveSection}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingSection ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
