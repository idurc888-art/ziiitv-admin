import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './stores/authStore'

import { Layout } from './components/layout/Layout'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
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
import { LinkPage } from './pages/LinkPage'
import { Homes } from './pages/Homes'
import { HomeEditor } from './pages/HomeEditor'

export function App() {
  const { initialize, initialized } = useAuthStore((s) => ({
    initialize: s.initialize,
    initialized: s.initialized
  }))

  useEffect(() => {
    initialize()
  }, [initialize])

  // Garante que o app não renderiza rotas antes do auth estar pronto
  // evitando flashes e redirects incorretos sem refresh
  if (!initialized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm">Iniciando...</p>
        </div>
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
          
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/homes" element={<Homes />} />
              <Route path="/homes/:id" element={<HomeEditor />} />
              <Route path="/upload" element={<UploadPlaylist />} />
              <Route path="/preview" element={<ChannelsPreview />} />
              <Route path="/users" element={<Users />} />
              <Route path="/playlists" element={<Playlists />} />
              <Route path="/playlists/:id" element={<PlaylistChannels />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/channels/:id" element={<ChannelDetail />} />
              <Route path="/enrich/:id" element={<EnrichQueue />} />
              <Route path="/watch-history" element={<WatchHistory />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </>
  )
}
