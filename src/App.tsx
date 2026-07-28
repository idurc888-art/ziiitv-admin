import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './stores/authStore'

import { Layout } from './components/layout/Layout'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AdminRoute } from './components/layout/AdminRoute'
import { Navigate } from 'react-router-dom'

const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })))
const Unauthorized = lazy(() => import('./pages/Unauthorized').then(module => ({ default: module.Unauthorized })))
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })))
const Users = lazy(() => import('./pages/Users').then(module => ({ default: module.Users })))
const Playlists = lazy(() => import('./pages/PlaylistsNew').then(module => ({ default: module.Playlists })))
const Channels = lazy(() => import('./pages/Channels').then(module => ({ default: module.Channels })))
const ChannelsPreview = lazy(() => import('./pages/ChannelsPreview').then(module => ({ default: module.ChannelsPreview })))
const PlaylistChannels = lazy(() => import('./pages/PlaylistChannels').then(module => ({ default: module.PlaylistChannels })))
const WatchHistory = lazy(() => import('./pages/WatchHistory').then(module => ({ default: module.WatchHistory })))
const UploadPlaylist = lazy(() => import('./pages/UploadPlaylist').then(module => ({ default: module.UploadPlaylist })))
const ChannelDetail = lazy(() => import('./pages/ChannelDetail').then(module => ({ default: module.ChannelDetail })))
const EnrichQueue = lazy(() => import('./pages/EnrichQueue').then(module => ({ default: module.EnrichQueue })))
const EnrichIndex = lazy(() => import('./pages/EnrichIndex').then(module => ({ default: module.EnrichIndex })))
const LinkPage = lazy(() => import('./pages/LinkPage').then(module => ({ default: module.LinkPage })))
const Homes = lazy(() => import('./pages/Homes').then(module => ({ default: module.Homes })))
const HomeEditor = lazy(() => import('./pages/HomeEditor').then(module => ({ default: module.HomeEditor })))
const EpgImport = lazy(() => import('./pages/EpgImport').then(module => ({ default: module.EpgImport })))
const PlaylistImports = lazy(() => import('./pages/PlaylistImports').then(module => ({ default: module.PlaylistImports })))
const PlaylistImportDetail = lazy(() => import('./pages/PlaylistImports').then(module => ({ default: module.PlaylistImportDetail })))
const ClientDashboard = lazy(() => import('./pages/client/ClientDashboard').then(module => ({ default: module.ClientDashboard })))

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
        <Suspense fallback={<RouteLoading />}>
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
                <Route path="/admin/imports" element={<PlaylistImports />} />
                <Route path="/admin/playlists/:id/imports/:importId" element={<PlaylistImportDetail />} />
                <Route path="/admin/preview" element={<ChannelsPreview />} />
                <Route path="/admin/users" element={<Users />} />
                <Route path="/admin/playlists" element={<Playlists />} />
                <Route path="/admin/playlists/:id" element={<PlaylistChannels />} />
                <Route path="/admin/channels" element={<Channels />} />
                <Route path="/admin/channels/:id" element={<ChannelDetail />} />
                <Route path="/admin/enrich" element={<EnrichIndex />} />
                <Route path="/admin/enrich/:id" element={<EnrichQueue />} />
                <Route path="/admin/watch-history" element={<WatchHistory />} />
                <Route path="/admin/epg" element={<EpgImport />} />
              </Route>
            </Route>

            {/* Rota de Cliente (sem Sidebar — tem seu próprio layout) */}
            <Route path="/client" element={<ClientDashboard />} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </>
  )
}

function RouteLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-base"><div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
}
