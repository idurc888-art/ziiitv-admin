import React from 'react'
import { classNames } from '../../lib/utils'

interface HeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function Header({ title, description, action, className }: HeaderProps) {
  return (
    <header className={classNames('mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4', className)}>
      <div>
        <h1 className="text-2xl font-display font-bold text-text-primary tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-text-secondary mt-1">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex-shrink-0">
          {action}
        </div>
      )}
    </header>
  )
}
