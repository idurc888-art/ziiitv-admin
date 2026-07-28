import type React from 'react'
import { classNames } from '../../lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg'
}

export function Card({ children, className, padding = 'md', ...props }: CardProps) {
  const paddings = { sm: 'p-4 rounded-card', md: 'p-7 rounded-card', lg: 'p-9 rounded-card' }
  return (
    <div {...props} className={classNames(
      'bg-surface',
      paddings[padding],
      className
    )}>
      {children}
    </div>
  )
}
