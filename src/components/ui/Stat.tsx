import React from 'react'
import { Card } from './Card'
import { classNames } from '../../lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

type Tone = 'pink' | 'aqua' | 'neon'

const toneStyles: Record<Tone, string> = {
  pink: 'bg-accent-muted text-accent',
  aqua: 'bg-aqua-muted   text-aqua',
  neon: 'bg-neon-muted   text-neon',
}

interface StatProps {
  label: string
  value: string | number
  trend?: number
  icon?: React.ReactNode
  tone?: Tone
  loading?: boolean
}

export function Stat({ label, value, trend, icon, tone = 'pink', loading }: StatProps) {
  return (
    <Card padding="md" className="flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
          {label}
        </span>
        {icon && (
          <div className={classNames(
            'w-9 h-9 rounded-[10px] flex items-center justify-center',
            toneStyles[tone]
          )}>
            {icon}
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-9 w-32 skeleton" />
      ) : (
        <div className="flex items-baseline gap-3">
          <span className="text-[38px] font-display font-bold leading-none tracking-tightest text-text-primary">
            {value}
          </span>
          {trend !== undefined && (
            <span className={classNames(
              'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
              trend >= 0 ? 'text-aqua bg-aqua-muted' : 'text-danger bg-danger/[0.12]'
            )}>
              {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(trend)}%
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
