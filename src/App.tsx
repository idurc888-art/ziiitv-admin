import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './stores/authStore'

import { Layout } from './components/layout/Layout'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AdminRoute } from './components/layout/AdminRoute'
import { Login } from './pages/Login'
import { Unauthorized } from './pages/Unauthorized'

import { Dashboard } from './pages/Dashboard'
import { Users } from './pages/Users'
import { Playlists } from './pages/PlaylistsNew'
import { Channels } from './pages/Channels'
import { ChannelsPreview } from './pages/ChannelsPreview'
import { PlaylistChannels } from './pages/PlaylistChannels'
import { WatchHistory } from './pages/WatchHistory'
import { UploadPlaylist } from './pages/UploadPlaylist'
import { ChannelDetail } from './pages/ChannelDetail'
import { EnrichQueue } from './pages/EnrichQueue'
import { EnrichIndex } from './pages/EnrichIndex'
import { LinkPage } from './pages/LinkPage'
import { Homes } from './pages/Homes'
import { HomeEditor } from './pages/HomeEditor'

import { ClientDashboard } from './pages/client/ClientDashboard'
import { Navigate } from 'react-router-dom'

function RootRedirect() {
  const { isAdmin } = useAuthStore()
  return <Navigate to={isAdmin ? '/admin' : '/client'} replace />
}

export function App() {
  const initialize = useAuthStore((s) => s.initialize)
  const isLoading = useAuthStore((s) => s.isLoading)

  useEffect(() => {
    initialize()
  }, [initialize])

  // Aguarda auth inicializar antes de renderizar rotas
  // Evita flashes, redirects errados e React error #185
  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
        <div style={{ width: 32, height: 32, border: '2px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#6b7280', fontSize: 14 }}>Iniciando...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <>
      <Toaster 
        position="top-right" 
        toastOptions={{
          style: {
            background: '#1a1a24',
            color: '#f0f0f8',
            border: '1px solid #2a2a3a'
          }
        }} 
      />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/link" element={<LinkPage />} />
          
          <Route path="*" element={<Navigate to="/" replace />} />
          <Route element={<ProtectedRoute />}>
            {/* Raiz: redireciona para /admin ou /client conforme o tipo */}
            <Route path="/" element={<RootRedirect />} />

            {/* Rotas de Admin (com Sidebar/Layout) */}
            <Route element={<Layout />}>
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<Dashboard />} />
                <Route path="/admin/homes" element={<Homes />} />
                <Route path="/admin/homes/:id" element={<HomeEditor />} />
                <Route path="/admin/upload" element={<UploadPlaylist />} />
                <Route path="/admin/preview" element={<ChannelsPreview />} />
                <Route path="/admin/users" element={<Users />} />
                <Route path="/admin/playlists" element={<Playlists />} />
                <Route path="/admin/playlists/:id" element={<PlaylistChannels />} />
                <Route path="/admin/channels" element={<Channels />} />
                <Route path="/admin/channels/:id" element={<ChannelDetail />} />
                <Route path="/admin/enrich" element={<EnrichIndex />} />
                <Route path="/admin/enrich/:id" element={<EnrichQueue />} />
                <Route path="/admin/watch-history" element={<WatchHistory />} />
              </Route>
            </Route>

            {/* Rota de Cliente (sem Sidebar — tem seu próprio layout) */}
            <Route path="/client" element={<ClientDashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </>
  )
}
