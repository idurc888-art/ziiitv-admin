import React from 'react'
import { classNames } from '../../lib/utils'
import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({
  icon: Icon, title, description, actionLabel, onAction, className
}: EmptyStateProps) {
  return (
    <div className={classNames(
      'flex flex-col items-center justify-center px-8 py-16 text-center rounded-card bg-surface',
      className
    )}>
      <div className="w-14 h-14 rounded-[14px] bg-aqua-muted text-aqua flex items-center justify-center mb-5">
        <Icon className="w-7 h-7" />
      </div>
      <h3 className="text-xl font-display font-semibold text-text-primary mb-2 tracking-[-0.02em]">{title}</h3>
      {description && (
        <p className="text-sm text-text-secondary max-w-sm mb-7 leading-relaxed">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="ghost" size="sm">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
