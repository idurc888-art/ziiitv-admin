import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { Loader2 } from 'lucide-react'

export function AdminRoute() {
  const { isAdmin, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-base">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (!isAdmin) {
    // Se logado mas não admin, joga pro dashboard de cliente
    return <Navigate to="/client" replace />
  }

  return <Outlet />
}
