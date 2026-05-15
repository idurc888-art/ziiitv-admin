import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { Tv, List, Link2, LogOut, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

interface Device {
  device_id: string
  device_name: string | null
  device_model: string | null
  linked_at: string | null
  status: string
  playlist_url: string | null
}

export function ClientDashboard() {
  const { user, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [devices, setDevices] = useState<Device[]>([])

  useEffect(() => {
    if (!user) return
    const load = async () => {
      const { data } = await supabase
        .from('pair_tokens')
        .select('device_id, device_name, device_model, linked_at, status, playlist_url')
        .eq('user_id', user.id)
        .eq('status', 'linked')
        .order('linked_at', { ascending: false })
      setDevices(data || [])
      setLoading(false)
    }
    load()
  }, [user])

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0a', color: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-start', padding: '48px 16px', fontFamily: 'Outfit, sans-serif',
    }}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 560, marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              ziiiTV <span style={{ color: '#ff2d92' }}>cliente</span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 700, marginTop: 4, letterSpacing: '-0.02em' }}>
              Olá, {user?.email?.split('@')[0] || 'usuário'} 👋
            </h1>
          </div>
          <button
            onClick={() => signOut()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 10,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
            }}
          >
            <LogOut style={{ width: 14, height: 14 }} /> Sair
          </button>
        </div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>{user?.email}</p>
      </div>

      {/* Devices card */}
      <div style={{
        width: '100%', maxWidth: 560,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 18, padding: 28, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Tv style={{ width: 20, height: 20, color: '#ff2d92' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>TVs Conectadas</span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <Loader2 style={{ width: 24, height: 24, color: '#ff2d92', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : devices.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            padding: '32px 0', color: 'rgba(255,255,255,0.35)', textAlign: 'center',
          }}>
            <AlertCircle style={{ width: 36, height: 36, color: 'rgba(255,255,255,0.15)' }} />
            <div style={{ fontSize: 15 }}>Nenhuma TV vinculada ainda.</div>
            <div style={{ fontSize: 13 }}>Abra o ZiiiTV na TV e escaneie o QR Code.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {devices.map((d) => (
              <div key={d.device_id} style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: '14px 18px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <CheckCircle2 style={{ width: 18, height: 18, color: '#2dd4bf', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                    {d.device_name || d.device_model || 'Samsung Smart TV'}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    ID: {d.device_id.slice(0, 8)}… · Vinculado em {formatDate(d.linked_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Playlist card */}
      <div style={{
        width: '100%', maxWidth: 560,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 18, padding: 28, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <List style={{ width: 20, height: 20, color: '#ff8c42' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lista de Canais</span>
        </div>
        {devices.length > 0 && devices[0].playlist_url ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all', marginBottom: 16 }}>
            {devices[0].playlist_url}
          </div>
        ) : (
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>
            Nenhuma lista ativa.
          </div>
        )}
        <button
          onClick={() => navigate('/link')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', padding: '14px 0', borderRadius: 12,
            background: '#ff2d92', border: 'none', color: '#fff',
            fontWeight: 700, fontSize: 15, cursor: 'pointer', letterSpacing: '-0.01em',
          }}
        >
          <Link2 style={{ width: 16, height: 16 }} />
          {devices.length > 0 ? 'Trocar Lista / Vincular Nova TV' : 'Vincular Minha TV'}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
