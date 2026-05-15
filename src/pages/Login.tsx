import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { Tv2, Mail, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

type Mode = 'login' | 'signup'

export function Login() {
  const { signIn, signUp, session, isAdmin } = useAuthStore()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  if (session) return <Navigate to={isAdmin ? '/admin' : '/client'} replace />
  if (confirmed) return <EmailSent email={email} />

  const switchMode = (m: Mode) => {
    setMode(m)
    setEmail('')
    setPassword('')
    setConfirm('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'signup' && password !== confirm) {
      toast.error('As senhas não coincidem.')
      return
    }
    if (password.length < 6) {
      toast.error('A senha deve ter ao menos 6 caracteres.')
      return
    }

    setLoading(true)

    if (mode === 'login') {
      const { error } = await signIn(email, password)
      setLoading(false)
      if (error) {
        toast.error('E-mail ou senha incorretos.')
      } else {
        navigate('/', { replace: true })
      }
    } else {
      const { error, needsConfirmation } = await signUp(email, password)
      setLoading(false)
      if (error) {
        toast.error(error)
      } else if (needsConfirmation) {
        setConfirmed(true)
      } else {
        toast.success('Conta criada! Bem-vindo ao ZiiiTV.')
        navigate('/client', { replace: true })
      }
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0a', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
      fontFamily: 'Outfit, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #ff2d92 0%, #ff8c42 100%)',
            marginBottom: 16,
          }}>
            <Tv2 style={{ width: 28, height: 28, color: '#fff' }} />
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
            ziiiTV
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            {mode === 'login' ? 'Entre na sua conta' : 'Crie sua conta gratuita'}
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 20, padding: 32,
        }}>

          {/* Tabs */}
          <div style={{
            display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)',
            borderRadius: 12, padding: 4, marginBottom: 28,
          }}>
            {(['login', 'signup'] as Mode[]).map(m => (
              <button key={m} onClick={() => switchMode(m)} style={{
                flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
                fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: 14,
                cursor: 'pointer', transition: 'all 0.18s',
                background: mode === m ? '#ff2d92' : 'transparent',
                color: mode === m ? '#fff' : 'rgba(255,255,255,0.4)',
              }}>
                {m === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Email */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 6 }}>
                E-mail
              </label>
              <div style={{ position: 'relative' }}>
                <Mail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'rgba(255,255,255,0.3)' }} />
                <input
                  type="email" required value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '12px 14px 12px 42px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12, color: '#fff', fontSize: 15, fontFamily: 'Outfit, sans-serif',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Senha */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 6 }}>
                Senha
              </label>
              <div style={{ position: 'relative' }}>
                <Lock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'rgba(255,255,255,0.3)' }} />
                <input
                  type={showPass ? 'text' : 'password'} required value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '12px 42px 12px 42px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12, color: '#fff', fontSize: 15, fontFamily: 'Outfit, sans-serif',
                    outline: 'none',
                  }}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgba(255,255,255,0.3)',
                }}>
                  {showPass ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                </button>
              </div>
            </div>

            {/* Confirmar senha (só no cadastro) */}
            {mode === 'signup' && (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 6 }}>
                  Confirmar senha
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'rgba(255,255,255,0.3)' }} />
                  <input
                    type={showPass ? 'text' : 'password'} required value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '12px 14px 12px 42px',
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${confirm && confirm !== password ? 'rgba(255,60,60,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 12, color: '#fff', fontSize: 15, fontFamily: 'Outfit, sans-serif',
                      outline: 'none',
                    }}
                  />
                </div>
                {confirm && confirm !== password && (
                  <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 4 }}>As senhas não coincidem</div>
                )}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                marginTop: 4, padding: '14px', borderRadius: 12, border: 'none',
                background: loading ? 'rgba(255,45,146,0.5)' : '#ff2d92',
                color: '#fff', fontWeight: 700, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.01em', transition: 'background 0.18s',
              }}
            >
              {loading ? '...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>
          ZiiiTV · Sua TV, do seu jeito
        </div>
      </div>
    </div>
  )
}

function EmailSent({ email }: { email: string }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0a', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: 'Outfit, sans-serif',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 64, height: 64, borderRadius: 20,
          background: 'rgba(45,212,191,0.15)', marginBottom: 20,
        }}>
          <CheckCircle2 style={{ width: 32, height: 32, color: '#2dd4bf' }} />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 10 }}>
          Confirme seu e-mail
        </h2>
        <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          Enviamos um link de confirmação para <strong style={{ color: '#fff' }}>{email}</strong>. Clique no link para ativar sua conta e fazer login.
        </p>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', marginTop: 20 }}>
          Não recebeu? Verifique a caixa de spam.
        </p>
      </div>
    </div>
  )
}
