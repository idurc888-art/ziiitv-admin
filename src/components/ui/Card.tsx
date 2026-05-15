import React from 'react'
import { classNames } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'lg'
}

export function Card({ children, className, padding = 'md' }: CardProps) {
  const paddings = { sm: 'p-4 rounded-2xl', md: 'p-7 rounded-card', lg: 'p-9 rounded-card' }
  return (
    <div className={classNames(
      'bg-surface',
      paddings[padding],
      className
    )}>
      {children}
    </div>
  )
}
