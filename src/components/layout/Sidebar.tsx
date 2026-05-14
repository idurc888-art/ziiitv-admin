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
  Upload,
  Eye
} from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/upload', icon: Upload, label: 'Upload Playlist' },
  { to: '/preview', icon: Eye, label: 'Preview Canais' },
  { to: '/users', icon: Users, label: 'Usuários' },
  { to: '/playlists', icon: List, label: 'Playlists' },
  { to: '/channels', icon: Radio, label: 'Canais' },
  { to: '/watch-history', icon: History, label: 'Watch History' },
]

export function Sidebar() {
  const { user, signOut } = useAuthStore()

  return (
    <aside className="w-20 lg:w-64 h-full bg-surface border-r border-border flex flex-col transition-all duration-300 flex-shrink-0">
      {/* Logo Area */}
      <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-border">
        <Tv2 className="w-8 h-8 text-accent flex-shrink-0" />
        <span className="hidden lg:block ml-3 font-display font-bold text-xl tracking-tight text-text-primary">
          ziiiTV <span className="text-accent font-medium text-sm ml-1">admin</span>
        </span>
      </div>

      {/* Nav Links */}
      <div className="flex-1 overflow-y-auto py-6 px-3 flex flex-col gap-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => classNames(
              'flex items-center justify-center lg:justify-start px-3 py-2.5 rounded-lg transition-colors group',
              isActive 
                ? 'bg-accent-muted text-accent font-medium' 
                : 'text-text-secondary hover:bg-elevated hover:text-text-primary'
            )}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            <span className="hidden lg:block ml-3 text-sm">{item.label}</span>
          </NavLink>
        ))}
      </div>

      {/* Footer / User Profile */}
      <div className="p-4 border-t border-border">
        <div className="flex flex-col lg:flex-row items-center justify-center lg:justify-between gap-4">
          <div className="hidden lg:block overflow-hidden">
            <p className="text-sm font-medium text-text-primary truncate">
              {user?.email}
            </p>
            <p className="text-xs text-text-muted mt-0.5">Administrador</p>
          </div>
          <button
            onClick={() => signOut()}
            className="p-2 rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger transition-colors flex-shrink-0"
            title="Sair"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
