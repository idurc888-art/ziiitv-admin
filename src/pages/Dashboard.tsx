import React, { useEffect, useState } from 'react'
import { Header } from '../components/layout/Header'
import { Stat } from '../components/ui/Stat'
import { Card } from '../components/ui/Card'
import { WatchActivityChart } from '../components/charts/WatchActivityChart'
import { Users, List, Radio, Clock, PlayCircle } from 'lucide-react'
import { formatRelativeTime, formatDuration } from '../lib/utils'
import { supabaseAdmin } from '../lib/supabase'

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

interface Stats {
  users: number
  playlistsToday: number
  channels: number
  watchHoursToday: number
}

interface ActivityItem {
  id: number
  channel_name: string
  user_email: string
  duration_seconds: number
  watched_at: string
}

interface ChartPoint {
  date: string
  hours: number
}

export function Dashboard() {
  const [loading, setLoading]     = useState(true)
  const [stats, setStats]         = useState<Stats>({ users: 0, playlistsToday: 0, channels: 0, watchHoursToday: 0 })
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [activity, setActivity]   = useState<ActivityItem[]>([])

  useEffect(() => {
    async function load() {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayISO = todayStart.toISOString()

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      sevenDaysAgo.setHours(0, 0, 0, 0)
      const sevenDaysISO = sevenDaysAgo.toISOString()

      const [
        usersRes,
        playlistsTodayRes,
        channelsRes,
        watchTodayRes,
        watchChartRes,
        recentRes,
      ] = await Promise.all([
        supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('playlists').select('*', { count: 'exact', head: true })
          .eq('status', 'ready').gte('processed_at', todayISO),
        supabaseAdmin.from('channels').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('watch_events').select('duration_seconds').gte('watched_at', todayISO),
        supabaseAdmin.from('watch_events').select('watched_at, duration_seconds').gte('watched_at', sevenDaysISO),
        supabaseAdmin.from('watch_events').select('id, channel_name, user_id, duration_seconds, watched_at')
          .order('watched_at', { ascending: false }).limit(5),
      ])

      // Stats
      const watchSecondsToday = (watchTodayRes.data || []).reduce((s, e) => s + (e.duration_seconds || 0), 0)

      setStats({
        users:           usersRes.count   ?? 0,
        playlistsToday:  playlistsTodayRes.count ?? 0,
        channels:        channelsRes.count ?? 0,
        watchHoursToday: Math.round((watchSecondsToday / 3600) * 10) / 10,
      })

      // Chart: build 7-day buckets
      const buckets: Record<string, number> = {}
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
        buckets[d.toISOString().slice(0, 10)] = 0
      }
      for (const ev of (watchChartRes.data || [])) {
        const key = ev.watched_at.slice(0, 10)
        if (key in buckets) buckets[key] += (ev.duration_seconds || 0) / 3600
      }
      setChartData(
        Object.entries(buckets).map(([key, hours]) => ({
          date:  DAYS_PT[new Date(key + 'T12:00:00').getDay()],
          hours: Math.round(hours * 10) / 10,
        }))
      )

      // Recent activity — fetch user emails separately to avoid FK dependency
      const events = recentRes.data || []
      const userIds = [...new Set(events.map(e => e.user_id).filter(Boolean))]
      const emailMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: userRows } = await supabaseAdmin.from('users').select('id, email').in('id', userIds)
        for (const u of (userRows || [])) emailMap[u.id] = u.email
      }
      setActivity(events.map(e => ({
        id:               e.id,
        channel_name:     e.channel_name,
        user_email:       emailMap[e.user_id] || '—',
        duration_seconds: e.duration_seconds,
        watched_at:       e.watched_at,
      })))

      setLoading(false)
    }

    load()
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
          value={stats.users}
          icon={<Users className="w-5 h-5" />}
          loading={loading}
        />
        <Stat
          label="Playlists Processadas (Hoje)"
          value={stats.playlistsToday}
          icon={<List className="w-5 h-5" />}
          loading={loading}
        />
        <Stat
          label="Canais Ativos"
          value={stats.channels.toLocaleString('pt-BR')}
          icon={<Radio className="w-5 h-5" />}
          loading={loading}
        />
        <Stat
          label="Horas Assistidas (Hoje)"
          value={stats.watchHoursToday}
          icon={<Clock className="w-5 h-5" />}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2">
          <WatchActivityChart data={chartData} loading={loading} />
        </div>

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
              ) : activity.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm text-text-muted border border-dashed border-border rounded-lg">
                  Nenhuma atividade registrada ainda
                </div>
              ) : (
                activity.map((item) => (
                  <div key={item.id} className="flex items-start gap-4 p-3 rounded-lg border border-border bg-base/50 hover:bg-elevated transition-colors">
                    <div className="w-10 h-10 flex items-center justify-center rounded-full bg-accent-muted text-accent flex-shrink-0 mt-0.5">
                      <PlayCircle className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary truncate">{item.channel_name}</p>
                      <p className="text-sm text-text-secondary truncate">{item.user_email}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-xs text-text-muted">
                        <span>{formatDuration(item.duration_seconds)}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(item.watched_at)}</span>
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
