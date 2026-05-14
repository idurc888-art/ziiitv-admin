import React, { useEffect, useState } from 'react'
import { Header } from '../components/layout/Header'
import { Stat } from '../components/ui/Stat'
import { Card } from '../components/ui/Card'
import { WatchActivityChart } from '../components/charts/WatchActivityChart'
import { Users, List, Radio, Clock, PlayCircle } from 'lucide-react'
import { formatRelativeTime, formatDuration } from '../lib/utils'

// Mock data while Supabase is not fully seeded
const mockStats = {
  users: { total: 124, trend: 12 },
  playlists: { today: 8, trend: -5 },
  channels: { active: 14502, trend: 0 },
  watchHours: { today: 42.5, trend: 24 },
}

const mockChartData = [
  { date: 'Seg', hours: 12 },
  { date: 'Ter', hours: 19 },
  { date: 'Qua', hours: 15 },
  { date: 'Qui', hours: 22 },
  { date: 'Sex', hours: 35 },
  { date: 'Sáb', hours: 48 },
  { date: 'Dom', hours: 42 },
]

const mockRecentActivity = [
  { id: 1, user: 'mario@test.com', channel: 'HBO Max', duration: 7200, time: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: 2, user: 'joao@test.com', channel: 'ESPN', duration: 5400, time: new Date(Date.now() - 1000 * 60 * 45).toISOString() },
  { id: 3, user: 'maria@test.com', channel: 'Telecine Premium', duration: 9000, time: new Date(Date.now() - 1000 * 60 * 120).toISOString() },
  { id: 4, user: 'admin@ziiitv.com', channel: 'Premiere 1', duration: 3600, time: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
]

export function Dashboard() {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulando tempo de resposta da query DB
    const timer = setTimeout(() => setLoading(false), 800)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="animate-in fade-in duration-500">
      <Header 
        title="Dashboard" 
        description="Visão geral do sistema e atividade nas últimas 24 horas"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Stat 
          label="Total de Usuários" 
          value={mockStats.users.total} 
          trend={mockStats.users.trend} 
          icon={<Users className="w-5 h-5" />}
          loading={loading}
        />
        <Stat 
          label="Playlists Processadas (Hoje)" 
          value={mockStats.playlists.today} 
          trend={mockStats.playlists.trend} 
          icon={<List className="w-5 h-5" />}
          loading={loading}
        />
        <Stat 
          label="Canais Ativos" 
          value={mockStats.channels.active.toLocaleString('pt-BR')} 
          icon={<Radio className="w-5 h-5" />}
          loading={loading}
        />
        <Stat 
          label="Horas Assistidas (Hoje)" 
          value={mockStats.watchHours.today} 
          trend={mockStats.watchHours.trend} 
          icon={<Clock className="w-5 h-5" />}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Gráfico */}
        <div className="xl:col-span-2">
          <WatchActivityChart data={mockChartData} loading={loading} />
        </div>

        {/* Atividade Recente */}
        <div className="xl:col-span-1">
          <Card padding="lg" className="h-full flex flex-col">
            <div className="mb-6">
              <h3 className="text-lg font-medium text-text-primary">Atividade Recente</h3>
              <p className="text-sm text-text-secondary">O que está passando agora</p>
            </div>
            
            <div className="flex-1 flex flex-col gap-4">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-4 p-3 rounded-lg border border-border bg-base/50">
                    <div className="w-10 h-10 skeleton rounded-full" />
                    <div className="flex-1 flex flex-col gap-2">
                       <div className="h-4 w-32 skeleton rounded" />
                       <div className="h-3 w-20 skeleton rounded" />
                    </div>
                  </div>
                ))
              ) : (
                mockRecentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-4 p-3 rounded-lg border border-border bg-base/50 hover:bg-elevated transition-colors">
                    <div className="w-10 h-10 flex items-center justify-center rounded-full bg-accent-muted text-accent flex-shrink-0 mt-0.5">
                      <PlayCircle className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary truncate">{activity.channel}</p>
                      <p className="text-sm text-text-secondary truncate">{activity.user}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-xs text-text-muted">
                        <span>{formatDuration(activity.duration)}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(activity.time)}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
