import React from 'react'
import { Card } from './Card'
import { classNames } from '../../lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface StatProps {
  label: string
  value: string | number
  trend?: number // percentage
  icon?: React.ReactNode
  loading?: boolean
}

export function Stat({ label, value, trend, icon, loading }: StatProps) {
  return (
    <Card padding="md" className="flex flex-col gap-2 relative overflow-hidden">
      <div className="flex items-center justify-between text-text-secondary mb-2">
        <span className="text-sm font-medium">{label}</span>
        {icon && <div className="text-text-muted">{icon}</div>}
      </div>
      
      {loading ? (
        <div className="h-10 w-24 skeleton" />
      ) : (
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-display font-semibold text-text-primary">
            {value}
          </span>
          {trend !== undefined && (
            <span className={classNames(
              'flex items-center text-xs font-medium px-1.5 py-0.5 rounded',
              trend >= 0 ? 'text-success bg-success/10' : 'text-danger bg-danger/10'
            )}>
              {trend >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
              {Math.abs(trend)}%
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
