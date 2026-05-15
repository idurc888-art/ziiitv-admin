import React, { useState, useEffect, useRef, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Step = 'loading' | 'type_token' | 'login' | 'email_sent' | 'login_confirm' | 'form' | 'success' | 'expired' | 'error'
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

  const [step, setStep]         = useState<Step>(token ? 'loading' : 'type_token')
  const [mode, setMode]         = useState<Mode>('m3u')
  const [deviceId, setDeviceId] = useState('')
  const [userId, setUserId]     = useState('')
  const [url, setUrl]           = useState('')
  const [host, setHost]         = useState('')
  const [user, setUser]         = useState('')
  const [pass, setPass]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [authTab, setAuthTab]   = useState<'login' | 'signup'>('login')
  const [inputToken, setInputToken] = useState('')
  const [activeToken, setActiveToken] = useState(token)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const deviceIdRef = useRef('')
  deviceIdRef.current = deviceId

  // Verifica token + sessão de auth ao carregar
  useEffect(() => {
    if (!activeToken) return

    async function init() {
      setStep('loading')
      // Verifica se já tem sessão ativa (ex: retorno do OAuth Google)
      const { data: { session } } = await supabase.auth.getSession()

      const { data, error } = await supabase
        .from('pair_tokens')
        .select('device_id, status, expires_at')
        .eq('token', activeToken)
        .single()

      if (error || !data) { setStep('error'); setErrorMsg('Código inválido ou expirado.'); return }
      if ((data as PairTokenRow).status === 'linked')  { setStep('success'); return }
      if ((data as PairTokenRow).status === 'expired' || new Date((data as PairTokenRow).expires_at) < new Date()) {
        setStep('expired'); return
      }

      setDeviceId((data as PairTokenRow).device_id)

      if (session?.user) {
        setUserId(session.user.id)
        setStep('form')
      } else {
        setStep('login')
      }
    }

    init()
  }, [activeToken])

  // Detecta login via OAuth (retorno do Google redirect)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user && (step === 'login' || step === 'email_sent')) {
        setUserId(session.user.id)
        setStep('form')
      }
    })
    return () => subscription.unsubscribe()
  }, [step])

  async function handleGoogleLogin() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setErrorMsg('')

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    })

    setSubmitting(false)
    if (error) { setErrorMsg('Erro ao enviar o link. Tente novamente.'); return }
    setStep('email_sent')
  }

  async function handleEmailPassword(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')
    if (!email.trim() || !password) return
    if (authTab === 'signup' && password !== confirmPass) { setErrorMsg('As senhas não coincidem.'); return }
    if (password.length < 6) { setErrorMsg('Senha deve ter ao menos 6 caracteres.'); return }
    setSubmitting(true)

    if (authTab === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) { setErrorMsg('E-mail ou senha incorretos.'); setSubmitting(false); return }
      // onAuthStateChange já vai mover para 'form'
    } else {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
      if (error) { setErrorMsg(error.message); setSubmitting(false); return }
      if (data.user) {
        await supabase.from('users').upsert({ id: data.user.id, email: data.user.email, role: 'user' }, { onConflict: 'id' })
      }
      if (!data.session) {
        setStep('login_confirm')
        setSubmitting(false)
        return
      }
      // onAuthStateChange vai mover para 'form'
    }
    setSubmitting(false)
  }

  async function handleSubmit(e: React.FormEvent) {
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
        user_id: userId || null,
        ...(mode === 'xtream' ? { xtream_host: host.trim(), xtream_user: user.trim(), xtream_pass: pass.trim() } : {}),
        linked_at: new Date().toISOString(),
      })
      .eq('token', activeToken)

    if (tokenError) {
      setErrorMsg('Erro ao vincular. Tente novamente.')
      setSubmitting(false)
      return
    }

    // 2. Persiste em tv_sessions
    if (deviceId) {
      await supabase
        .from('tv_sessions')
        .upsert({
          device_id: deviceId,
          playlist_url: playlistUrl,
          playlist_type: playlistType,
          user_id: userId || null,
          ...(mode === 'xtream' ? { xtream_host: host.trim(), xtream_user: user.trim(), xtream_pass: pass.trim() } : {}),
          last_seen_at: new Date().toISOString(),
        }, { onConflict: 'device_id' })
    }

    // 3. Enriquecimento TMDB em background (fire-and-forget)
    supabase.functions.invoke('process-playlist', {
      body: {
        device_id:     deviceId,
        user_id:       userId || null,
        playlist_url:  playlistUrl,
        playlist_type: playlistType,
        ...(mode === 'xtream' ? { xtream_host: host.trim(), xtream_user: user.trim(), xtream_pass: pass.trim() } : {}),
      },
    }).catch(() => {})

    setStep('success')
  }

  const input: CSSProperties = {
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 12, padding: '14px 16px', fontSize: 14, color: '#fff',
    outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace',
  }

  const inputTokenStyle: CSSProperties = {
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 12, padding: '14px 16px', fontSize: 24, color: '#ff006e',
    outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace',
    textAlign: 'center', letterSpacing: '4px', textTransform: 'uppercase'
  }

  const btnPrimary: CSSProperties = {
    background: PINK, border: 'none', borderRadius: 12, padding: '16px',
    fontSize: 16, fontWeight: 700, color: '#fff', cursor: 'pointer',
    width: '100%', transition: 'opacity 200ms',
  }

  const btnSecondary: CSSProperties = {
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 600,
    color: '#fff', cursor: 'pointer', width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
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

        {step === 'type_token' && (
          <form onSubmit={(e) => { e.preventDefault(); setActiveToken(inputToken.trim().toUpperCase()) }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Vincular sua TV</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                Abra o aplicativo ZiiiTV na sua televisão e digite o código de 6 letras que aparece na tela.
              </div>
            </div>
            <input
              type="text"
              value={inputToken}
              onChange={e => setInputToken(e.target.value)}
              placeholder="Ex: ABCDEF"
              maxLength={6}
              required
              style={inputTokenStyle}
            />
            <button type="submit" style={btnPrimary}>
              Continuar
            </button>
          </form>
        )}

        {step === 'login' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
                {authTab === 'login' ? 'Entre na sua conta' : 'Crie sua conta grátis'}
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
                Para vincular sua lista de canais à TV
              </div>
            </div>

            {/* Google */}
            <button type="button" onClick={handleGoogleLogin} style={{ ...btnSecondary, marginBottom: 16 }}>
              <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
                <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l6-6C34.5 6.5 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9l6-6C34.5 6.5 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 10-1.9 13.7-5.1l-6.3-5.3C29.5 35.3 26.9 36 24 36c-5.2 0-9.6-3-11.3-7.2l-6.6 5.1C9.7 39.7 16.3 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.6 4.6-4.9 6l6.3 5.3C40.3 35.7 44 30.3 44 24c0-1.3-.1-2.7-.4-4z"/>
              </svg>
              Continuar com Google
            </button>

            {/* Divisor */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>ou use seu e-mail</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            </div>

            {/* Tabs login/signup */}
            <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 4, marginBottom: 16 }}>
              {(['login', 'signup'] as const).map(t => (
                <button key={t} type="button" onClick={() => { setAuthTab(t); setErrorMsg('') }} style={{
                  flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 600, fontSize: 13, transition: 'all 0.15s',
                  background: authTab === t ? PINK : 'transparent',
                  color: authTab === t ? '#fff' : 'rgba(255,255,255,0.4)',
                }}>
                  {t === 'login' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>

            <form onSubmit={handleEmailPassword} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" required style={input}
              />
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Senha" required style={{ ...input, paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 0, fontSize: 13,
                }}>
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
              {authTab === 'signup' && (
                <input
                  type={showPass ? 'text' : 'password'} value={confirmPass}
                  onChange={e => setConfirmPass(e.target.value)}
                  placeholder="Confirmar senha" required
                  style={{ ...input, borderColor: confirmPass && confirmPass !== password ? 'rgba(255,80,80,0.5)' : undefined }}
                />
              )}
              {errorMsg && (
                <div style={{ background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#ff6b6b' }}>
                  {errorMsg}
                </div>
              )}
              <button type="submit" disabled={submitting} style={{ ...btnPrimary, marginTop: 4, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? '...' : authTab === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            </form>
          </div>
        )}

        {step === 'login_confirm' && (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 52 }}>📬</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Confirme seu e-mail</div>
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
              Enviamos um link para <strong style={{ color: '#fff' }}>{email}</strong>.<br />
              Clique no link e volte aqui para continuar.
            </div>
          </div>
        )}

        {step === 'email_sent' && (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 52 }}>📬</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Verifique seu e-mail</div>
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
              Enviamos um link de acesso para<br />
              <strong style={{ color: '#fff' }}>{email}</strong><br />
              Clique no link para continuar.
            </div>
          </div>
        )}

        {step === 'form' && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Vincular sua lista</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                Escolha o tipo de lista e preencha os dados para ativar na TV.
              </div>
            </div>

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

            <button type="submit" disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.5 : 1 }}>
              {submitting ? 'Vinculando...' : 'Vincular à TV'}
            </button>

            <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>
              Código: {activeToken}
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
