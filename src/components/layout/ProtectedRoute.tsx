import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { Loader2 } from 'lucide-react'

export function ProtectedRoute() {
  const { session, isAdmin, isLoading } = useAuthStore()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-base">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!isAdmin) {
    return <Navigate to="/unauthorized" replace />
  }

  return <Outlet />
}
