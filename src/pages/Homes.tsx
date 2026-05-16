import React, { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toast } from 'react-hot-toast'
import { Header } from '../components/layout/Header'
import {
  LayoutTemplate,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  Eye,
} from 'lucide-react'

interface Home {
  id: string
  name: string
  slug: string
  description: string | null
  is_active: boolean
  created_at: string
  sections_count?: number
}

export function Homes() {
  const navigate = useNavigate()
  const [homes, setHomes] = useState<Home[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingHome, setEditingHome] = useState<Home | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', description: '' })
  const [saving, setSaving] = useState(false)

  const fetchHomes = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('homes')
      .select('*, home_sections(count)')
      .order('created_at', { ascending: false })
    if (error) {
      toast.error('Erro ao carregar homes')
    } else {
      const mapped = (data || []).map((h: any) => ({
        ...h,
        sections_count: h.home_sections?.[0]?.count ?? 0
      }))
      setHomes(mapped)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchHomes() }, [fetchHomes])

  function openNew() {
    setEditingHome(null)
    setForm({ name: '', slug: '', description: '' })
    setShowModal(true)
  }

  function openEdit(h: Home) {
    setEditingHome(h)
    setForm({ name: h.name, slug: h.slug, description: h.description || '' })
    setShowModal(true)
  }

  function slugify(val: string) {
    return val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  }

  async function handleSave() {
    if (!form.name.trim() || !form.slug.trim()) {
      toast.error('Nome e slug são obrigatórios')
      return
    }
    setSaving(true)
    if (editingHome) {
      const { error } = await supabase
        .from('homes')
        .update({ name: form.name, slug: form.slug, description: form.description || null })
        .eq('id', editingHome.id)
      if (error) toast.error('Erro ao salvar')
      else { toast.success('Home atualizada!'); setShowModal(false); fetchHomes() }
    } else {
      const { error } = await supabase
        .from('homes')
        .insert({ name: form.name, slug: form.slug, description: form.description || null, is_active: false })
      if (error) toast.error('Erro ao criar: ' + (error.message || ''))
      else { toast.success('Home criada!'); setShowModal(false); fetchHomes() }
    }
    setSaving(false)
  }

  async function handleActivate(id: string) {
    await supabase.from('homes').update({ is_active: false }).neq('id', 'none')
    await supabase.from('homes').update({ is_active: true }).eq('id', id)
    toast.success('Home ativada na TV!')
    fetchHomes()
  }

  async function handleDelete(id: string) {
    if (!confirm('Deletar esta home? As seções vinculadas serão removidas.')) return
    const { error } = await supabase.from('homes').delete().eq('id', id)
    if (error) toast.error('Erro ao deletar')
    else { toast.success('Home deletada'); fetchHomes() }
  }

  async function handleDuplicate(h: Home) {
    const newSlug = h.slug + '-copia-' + Date.now().toString().slice(-4)
    const { data: newHome, error } = await supabase
      .from('homes')
      .insert({ name: h.name + ' (Cópia)', slug: newSlug, description: h.description, is_active: false })
      .select()
      .single()
    if (error || !newHome) { toast.error('Erro ao duplicar'); return }
    const { data: sections } = await supabase
      .from('home_sections')
      .select('*')
      .eq('home_id', h.id)
    if (sections && sections.length > 0) {
      const newSections = sections.map((s: any) => ({
        home_id: newHome.id,
        title: s.title,
        type: s.type,
        sort_order: s.sort_order,
        active: s.active,
        config: s.config
      }))
      await supabase.from('home_sections').insert(newSections)
    }
    toast.success('Home duplicada!')
    fetchHomes()
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <Header
        title="Homes"
        description="Crie e gerencie as telas iniciais da TV"
        action={
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nova Home
          </button>
        }
      />

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      ) : homes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <LayoutTemplate className="w-12 h-12 text-text-faint mb-4" />
          <h3 className="text-text-primary font-medium mb-1">Nenhuma home criada</h3>
          <p className="text-text-muted text-sm mb-6">Crie sua primeira home para configurar a tela inicial da TV</p>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm"
          >
            <Plus className="w-4 h-4" /> Criar primeira home
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {homes.map(h => (
            <div
              key={h.id}
              className={`bg-surface border rounded-xl p-5 flex items-center gap-4 transition-all ${
                h.is_active ? 'border-accent/40 bg-accent/5' : 'border-border'
              }`}
            >
              {/* Status */}
              <div className="flex-shrink-0">
                {h.is_active ? (
                  <CheckCircle2 className="w-6 h-6 text-accent" />
                ) : (
                  <Circle className="w-6 h-6 text-text-faint" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="font-semibold text-text-primary truncate">{h.name}</h2>
                  {h.is_active && (
                    <span className="px-2 py-0.5 bg-accent/10 text-accent text-xs rounded-full font-medium">
                      Ativa na TV
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted">
                  slug: <span className="font-mono text-text-secondary">{h.slug}</span>
                  {h.description && <> · {h.description}</>}
                  {' · '}{h.sections_count ?? 0} seções
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {!h.is_active && (
                  <button
                    onClick={() => handleActivate(h.id)}
                    className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors font-medium"
                  >
                    Ativar
                  </button>
                )}
                <button
                  onClick={() => navigate(`/admin/preview?home_id=${h.id}`)}
                  className="p-2 rounded-lg text-text-muted hover:bg-elevated hover:text-accent transition-colors"
                  title="Preview na TV"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <Link
                  to={`/admin/homes/${h.id}`}
                  className="p-2 rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary transition-colors"
                  title="Editar seções"
                >
                  <Pencil className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => handleDuplicate(h)}
                  className="p-2 rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary transition-colors"
                  title="Duplicar"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={() => openEdit(h)}
                  className="p-2 rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary transition-colors"
                  title="Renomear"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {!h.is_active && (
                  <button
                    onClick={() => handleDelete(h.id)}
                    className="p-2 rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger transition-colors"
                    title="Deletar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal criar/editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-text-primary">
              {editingHome ? 'Editar Home' : 'Nova Home'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Nome *</label>
                <input
                  className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                  placeholder="Ex: Home Principal, Home Kids..."
                  value={form.name}
                  onChange={e => {
                    const name = e.target.value
                    setForm(f => ({ ...f, name, slug: editingHome ? f.slug : slugify(name) }))
                  }}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Slug * (identificador único)</label>
                <input
                  className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-accent"
                  placeholder="home-principal"
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Descrição (opcional)</label>
                <input
                  className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                  placeholder="Ex: Home padrão com filmes e séries..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-text-secondary text-sm hover:bg-elevated transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingHome ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
