import React from 'react'
import { classNames } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'lg'
}

export function Card({ children, className, padding = 'md' }: CardProps) {
  const paddings = { sm: 'p-4', md: 'p-6', lg: 'p-8' }
  return (
    <div className={classNames(
      'bg-surface border border-border rounded-xl',
      paddings[padding],
      className
    )}>
      {children}
    </div>
  )
}
