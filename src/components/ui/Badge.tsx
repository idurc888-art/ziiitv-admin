import React from 'react'
import type { PlaylistStatus } from '../../types'
import { classNames } from '../../lib/utils'

type BadgeVariant = 'active' | 'inactive' | 'processing' | 'error' | 'pending' | 'ready' | 'admin' | 'user'

const styles: Record<BadgeVariant, string> = {
  active:     'bg-success/15 text-success border-success/30',
  ready:      'bg-success/15 text-success border-success/30',
  inactive:   'bg-text-muted/15 text-text-muted border-text-muted/30',
  pending:    'bg-text-secondary/15 text-text-secondary border-text-secondary/30',
  processing: 'bg-warning/15 text-warning border-warning/30',
  error:      'bg-danger/15 text-danger border-danger/30',
  admin:      'bg-accent/15 text-accent border-accent/30',
  user:       'bg-text-secondary/15 text-text-secondary border-text-secondary/30',
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
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
      styles[v],
      className
    )}>
      {dot && variant === 'processing' && (
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
      )}
      {dot && variant !== 'processing' && (
        <span className={classNames('w-1.5 h-1.5 rounded-full', v === 'active' || v === 'ready' ? 'bg-success' : v === 'error' ? 'bg-danger' : 'bg-text-muted')} />
      )}
      {label ?? labels[v]}
    </span>
  )
}
