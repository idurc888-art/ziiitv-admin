import React from 'react'
import { Card } from '../ui/Card'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { classNames } from '../../lib/utils'

interface DataPoint {
  date: string
  hours: number
}

interface WatchActivityChartProps {
  data: DataPoint[]
  loading?: boolean
  className?: string
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-surface border border-border p-3 rounded-lg shadow-xl">
        <p className="text-text-secondary text-sm mb-1">{label}</p>
        <p className="text-accent font-medium">
          {payload[0].value.toFixed(1)} horas assistidas
        </p>
      </div>
    )
  }
  return null
}

export function WatchActivityChart({ data, loading, className }: WatchActivityChartProps) {
  return (
    <Card padding="lg" className={classNames('flex flex-col', className)}>
      <div className="mb-6">
        <h3 className="text-lg font-medium text-text-primary">Atividade de Visualização</h3>
        <p className="text-sm text-text-secondary">Horas assistidas nos últimos 7 dias</p>
      </div>

      <div className="flex-1 w-full h-[300px] min-h-[300px]">
        {loading ? (
          <div className="w-full h-full skeleton rounded-lg" />
        ) : data.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center border border-dashed border-border rounded-lg">
            <span className="text-text-muted text-sm">Sem dados suficientes</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#555568" 
                tick={{ fill: '#8888aa', fontSize: 12 }} 
                tickLine={false}
                axisLine={false}
                dy={10}
              />
              <YAxis 
                stroke="#555568" 
                tick={{ fill: '#8888aa', fontSize: 12 }} 
                tickLine={false}
                axisLine={false}
                dx={-10}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a2a3a', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Line 
                type="monotone" 
                dataKey="hours" 
                stroke="#6c5ce7" 
                strokeWidth={3}
                dot={{ r: 4, fill: '#6c5ce7', strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#7d6ff0', stroke: '#111118', strokeWidth: 2 }}
                animationDuration={1000}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
