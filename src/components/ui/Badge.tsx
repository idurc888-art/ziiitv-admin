import React from 'react'
import type { PlaylistStatus } from '../../types'
import { classNames } from '../../lib/utils'

type BadgeVariant = 'active' | 'inactive' | 'processing' | 'error' | 'pending' | 'ready' | 'admin' | 'user'

const styles: Record<BadgeVariant, string> = {
  active:     'bg-aqua-muted   text-aqua',
  ready:      'bg-aqua-muted   text-aqua',
  inactive:   'bg-white/[0.06] text-text-secondary',
  pending:    'bg-white/[0.06] text-text-secondary',
  processing: 'bg-neon-muted   text-neon',
  error:      'bg-danger/[0.12] text-danger',
  admin:      'bg-accent-muted text-accent',
  user:       'bg-white/[0.06] text-text-secondary',
}

const labels: Record<BadgeVariant, string> = {
  active: 'Ativo', inactive: 'Inativo', processing: 'Processando',
  error: 'Erro', pending: 'Pendente', ready: 'Pronto', admin: 'Admin', user: 'Usuário',
}

interface BadgeProps {
  variant: BadgeVariant | PlaylistStatus | string
  label?: string
  dot?: boolean
  className?: string
}

export function Badge({ variant, label, dot = false, className }: BadgeProps) {
  const v = (variant as BadgeVariant) in styles ? (variant as BadgeVariant) : 'inactive'
  return (
    <span className={classNames(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
      styles[v],
      className
    )}>
      {dot && (
        <span className={classNames(
          'w-1.5 h-1.5 rounded-full bg-current',
          v === 'processing' && 'animate-[pulse-dot_1.5s_ease-in-out_infinite]'
        )} />
      )}
      {label ?? labels[v]}
    </span>
  )
}
