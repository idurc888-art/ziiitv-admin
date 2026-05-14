import { useState, useEffect, type FormEvent, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Step = 'loading' | 'form' | 'success' | 'expired' | 'error'
type Mode = 'm3u' | 'xtream'

interface PairTokenRow {
  device_id: string
  status: string
  expires_at: string
}

const PINK = '#ff006e'
const DARK = '#0a0a0f'

export function LinkPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [step, setStep]         = useState<Step>('loading')
  const [mode, setMode]         = useState<Mode>('m3u')
  const [deviceId, setDeviceId] = useState('')
  const [url, setUrl]           = useState('')
  const [host, setHost]         = useState('')
  const [user, setUser]         = useState('')
  const [pass, setPass]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) { setStep('error'); setErrorMsg('Token não encontrado na URL.'); return }

    supabase
      .from('pair_tokens')
      .select('device_id, status, expires_at')
      .eq('token', token)
      .single()
      .then(({ data, error }: { data: PairTokenRow | null, error: any }) => {
        if (error || !data) { setStep('error'); setErrorMsg('Código inválido ou expirado.'); return }
        if (data.status === 'linked')  { setStep('success'); return }
        if (data.status === 'expired' || new Date(data.expires_at) < new Date()) { setStep('expired'); return }
        setDeviceId(data.device_id)
        setStep('form')
      })
  }, [token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErrorMsg('')

    let playlistUrl = ''
    let playlistType: 'm3u' | 'xtream' = 'm3u'

    if (mode === 'xtream') {
      if (!host.trim() || !user.trim() || !pass.trim()) {
        setErrorMsg('Preencha Host, Usuário e Senha.')
        setSubmitting(false)
        return
      }
      const h = host.trim().replace(/\/$/, '')
      playlistUrl = `${h}/get.php?username=${encodeURIComponent(user.trim())}&password=${encodeURIComponent(pass.trim())}&type=m3u_plus&output=ts`
      playlistType = 'xtream'
    } else {
      if (!url.trim()) {
        setErrorMsg('Cole a URL da sua lista M3U.')
        setSubmitting(false)
        return
      }
      playlistUrl = url.trim()
    }

    // 1. Atualiza pair_tokens → dispara Realtime na TV
    const { error: tokenError } = await supabase
      .from('pair_tokens')
      .update({
        status: 'linked',
        playlist_url: playlistUrl,
        playlist_type: playlistType,
        ...(mode === 'xtream' ? { xtream_host: host.trim(), xtream_user: user.trim(), xtream_pass: pass.trim() } : {}),
        linked_at: new Date().toISOString(),
      })
      .eq('token', token)

    if (tokenError) {
      setErrorMsg('Erro ao vincular. Tente novamente.')
      setSubmitting(false)
      return
    }

    // 2. Persiste em tv_sessions → garante que próximos boots carreguem a lista
    if (deviceId) {
      await supabase
        .from('tv_sessions')
        .upsert({
          device_id: deviceId,
          playlist_url: playlistUrl,
          playlist_type: playlistType,
          ...(mode === 'xtream' ? { xtream_host: host.trim(), xtream_user: user.trim(), xtream_pass: pass.trim() } : {}),
          last_seen_at: new Date().toISOString(),
        }, { onConflict: 'device_id' })
    }

    setStep('success')
  }

  const input: CSSProperties = {
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 12, padding: '14px 16px', fontSize: 14, color: '#fff',
    outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace',
  }

  return (
    <div style={{
      minHeight: '100dvh', background: DARK,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '24px 20px',
      fontFamily: "'Outfit', system-ui, sans-serif", color: '#fff',
    }}>
      <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 40 }}>
        <span style={{ color: PINK, textShadow: `0 0 24px rgba(255,0,110,0.5)` }}>ZIII</span>TV
      </div>

      <div style={{ width: '100%', maxWidth: 440 }}>

        {step === 'loading' && (
          <div style={{ textAlign: 'center', opacity: 0.5 }}>Verificando código...</div>
        )}

        {step === 'form' && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Vincular sua lista</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                Escolha o tipo de lista e preencha os dados para ativar na TV.
              </div>
            </div>

            {/* Seletor de modo */}
            <div style={{ display: 'flex', gap: 8 }}>
              {(['m3u', 'xtream'] as Mode[]).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)} style={{
                  flex: 1, padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', border: 'none',
                  background: mode === m ? PINK : 'rgba(255,255,255,0.07)',
                  color: mode === m ? '#fff' : 'rgba(255,255,255,0.5)',
                }}>
                  {m === 'm3u' ? 'URL M3U' : 'Xtream Codes'}
                </button>
              ))}
            </div>

            {mode === 'm3u' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
                  URL M3U ou M3U8
                </label>
                <input
                  type="url" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="http://servidor.com/lista.m3u?user=...&pass=..."
                  required style={input}
                />
              </div>
            )}

            {mode === 'xtream' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Host / Servidor</label>
                  <input type="url" value={host} onChange={e => setHost(e.target.value)}
                    placeholder="http://servidor.com:8080" required style={input} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Usuário</label>
                    <input type="text" value={user} onChange={e => setUser(e.target.value)}
                      placeholder="usuario" required style={input} />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Senha</label>
                    <input type="password" value={pass} onChange={e => setPass(e.target.value)}
                      placeholder="senha" required style={input} />
                  </div>
                </div>
              </>
            )}

            {errorMsg && (
              <div style={{ background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.3)', borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#ff6b6b' }}>
                {errorMsg}
              </div>
            )}

            <button type="submit" disabled={submitting} style={{
              background: submitting ? 'rgba(255,0,110,0.4)' : PINK,
              border: 'none', borderRadius: 12, padding: '16px',
              fontSize: 16, fontWeight: 700, color: '#fff',
              cursor: submitting ? 'not-allowed' : 'pointer', transition: 'background 200ms',
            }}>
              {submitting ? 'Vinculando...' : 'Vincular à TV'}
            </button>

            <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>
              Código: {token}
            </div>
          </form>
        )}

        {step === 'success' && (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '2px solid rgba(34,197,94,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
              ✓
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>TV vinculada!</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                Sua lista foi configurada com sucesso.<br />Pode fechar esta página e voltar para a TV.
              </div>
            </div>
          </div>
        )}

        {step === 'expired' && (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 48 }}>⏳</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fbbf24' }}>Código expirado</div>
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)' }}>Volte à TV e gere um novo QR code.</div>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 48 }}>❌</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f87171' }}>Código inválido</div>
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)' }}>
              {errorMsg || 'Este código não existe ou já foi utilizado.'}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
