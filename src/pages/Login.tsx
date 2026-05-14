import React, { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Tv2, Mail, Lock } from 'lucide-react'
import toast from 'react-hot-toast'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, session, isAdmin } = useAuthStore()
  const navigate = useNavigate()

  // Se já tem sessão e é admin, manda pro painel
  if (session && isAdmin) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return

    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)

    if (error) {
      toast.error('Credenciais inválidas.')
    } else {
      toast.success('Login bem sucedido!')
      navigate('/')
    }
  }

  return (
    <div className="min-h-screen bg-base flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Tv2 className="w-12 h-12 text-accent" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-display font-bold tracking-tight text-text-primary">
          ziiiTV Admin
        </h2>
        <p className="mt-2 text-center text-sm text-text-secondary">
          Acesso restrito para administradores
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="shadow-xl">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <Input
              id="email"
              label="E-mail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={<Mail className="w-5 h-5" />}
              placeholder="admin@ziiitv.com"
            />

            <Input
              id="password"
              label="Senha"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<Lock className="w-5 h-5" />}
              placeholder="••••••••"
            />

            <Button
              type="submit"
              className="w-full justify-center"
              size="lg"
              loading={loading}
            >
              Entrar no painel
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
