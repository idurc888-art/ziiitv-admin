import React from 'react'
import { NavLink } from 'react-router-dom'
import { classNames } from '../../lib/utils'
import { useAuthStore } from '../../stores/authStore'
import {
  Tv2,
  LayoutDashboard,
  Users,
  List,
  Radio,
  History,
  LogOut,
  Eye,
  LayoutTemplate,
  Sparkles,
  Link2,
} from 'lucide-react'

const ADMIN_GROUPS = [
  {
    label: 'Visão Geral',
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
    ],
  },
  {
    label: 'Biblioteca',
    items: [
      { to: '/admin/playlists',  icon: List,      label: 'Playlists' },
      { to: '/admin/channels',   icon: Radio,     label: 'Canais' },
      { to: '/admin/enrich',     icon: Sparkles,  label: 'Enriquecimento' },
    ],
  },
  {
    label: 'TV',
    items: [
      { to: '/admin/homes',    icon: LayoutTemplate, label: 'Homes' },
      { to: '/admin/preview',  icon: Eye,            label: 'Preview' },
      { to: '/link',           icon: Link2,          label: 'Vincular TV' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/admin/users',         icon: Users,   label: 'Usuários' },
      { to: '/admin/watch-history', icon: History, label: 'Histórico' },
    ],
  },
]

const CLIENT_GROUPS = [
  {
    label: 'Painel do Cliente',
    items: [
      { to: '/client', icon: LayoutDashboard, label: 'Minha Conta', end: true },
    ],
  },
]

export function Sidebar() {
  const { user, isAdmin, signOut } = useAuthStore()
  const initials = (user?.email || 'A').slice(0, 1).toUpperCase()

  return (
    <aside className="w-60 h-full bg-base border-r border-border flex flex-col flex-shrink-0 px-4 py-6">
      {/* Brand */}
      <div className="flex items-center gap-3 px-2 pb-7">
        <div className="w-8 h-8 rounded-[9px] bg-accent text-white flex items-center justify-center">
          <Tv2 className="w-[18px] h-[18px]" />
        </div>
        <div className="font-display font-bold text-[17px] tracking-[-0.03em]">
          ziiiTV
          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted align-[2px]">
            {isAdmin ? 'admin' : 'cliente'}
          </span>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-px">
        {(isAdmin ? ADMIN_GROUPS : CLIENT_GROUPS).map((grp) => (
          <React.Fragment key={grp.label}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted px-3 pt-4 pb-2">
              {grp.label}
            </div>
            {grp.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={(it as any).end}
                className={({ isActive }) => classNames(
                  'flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
                )}
              >
                <it.icon className="w-[18px] h-[18px] flex-shrink-0" />
                <span>{it.label}</span>
              </NavLink>
            ))}
          </React.Fragment>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-4 p-3 bg-surface rounded-xl flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-neon flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="text-[13px] font-medium text-text-primary truncate">{user?.email}</p>
          <p className="text-[11px] text-text-muted mt-0.5">{isAdmin ? 'Administrador' : 'Cliente'}</p>
        </div>
        <button
          onClick={() => signOut()}
          className="p-1.5 rounded-lg text-text-muted hover:bg-danger/[0.12] hover:text-danger transition-colors flex-shrink-0"
          title="Sair"
        >
          <LogOut className="w-[18px] h-[18px]" />
        </button>
      </div>
    </aside>
  )
}
