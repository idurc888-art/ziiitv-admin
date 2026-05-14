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
      'flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed border-border bg-base/50',
      className
    )}>
      <div className="w-12 h-12 rounded-full bg-elevated flex items-center justify-center mb-4 text-text-muted">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-lg font-medium text-text-primary mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-text-secondary max-w-sm mb-6">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="ghost" size="sm">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
