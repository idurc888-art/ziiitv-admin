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
    <header className={classNames('mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4', className)}>
      <div>
        <h1 className="text-[34px] font-display font-bold text-text-primary leading-[1.1] tracking-tightest">
          {title}
        </h1>
        {description && (
          <p className="text-[15px] text-text-secondary mt-2 max-w-[540px]">{description}</p>
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
