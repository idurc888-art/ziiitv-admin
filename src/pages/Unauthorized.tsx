import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/ui/EmptyState'
import { ShieldAlert } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

export function Unauthorized() {
  const navigate = useNavigate()
  const { signOut } = useAuthStore()

  return (
    <div className="h-screen w-full bg-base flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <EmptyState
          icon={ShieldAlert}
          title="Acesso Negado"
          description="Sua conta não tem permissões de administrador para acessar este painel."
          actionLabel="Fazer logout e voltar"
          onAction={() => {
            signOut()
            navigate('/login')
          }}
        />
      </div>
    </div>
  )
}
