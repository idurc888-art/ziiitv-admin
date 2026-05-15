import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { User as SupabaseUser, Session, Subscription } from '@supabase/supabase-js'

interface AuthState {
  user: SupabaseUser | null
  session: Session | null
  isAdmin: boolean
  isLoading: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation: boolean }>
  signOut: () => Promise<void>
}

// Mantido fora do store para garantir unsubscribe mesmo se initialize() rodar mais de uma vez
let authSubscription: Subscription | null = null

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  isAdmin: false,
  isLoading: true,

  initialize: async () => {
    // Evita listeners duplicados em remounts (Strict Mode, HMR)
    if (authSubscription) {
      authSubscription.unsubscribe()
      authSubscription = null
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single() as { data: { role: string } | null; error: unknown }
      set({
        user: session.user,
        session,
        isAdmin: profile?.role === 'admin',
        isLoading: false,
      })
    } else {
      set({ user: null, session: null, isAdmin: false, isLoading: false })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const { data: profile, error } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single() as { data: { role: string } | null; error: unknown }
        set({
          user: session.user,
          session,
          // Se o banco falhar (rede oscilou, timeout), preserva isAdmin atual —
          // evita derrubar a sessão de um admin num TOKEN_REFRESHED de rotina
          isAdmin: error || !profile ? get().isAdmin : profile.role === 'admin',
          isLoading: false,
        })
      } else {
        set({ user: null, session: null, isAdmin: false, isLoading: false })
      }
    })
    authSubscription = subscription
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  },

  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: error.message, needsConfirmation: false }
    if (data.user) {
      await supabase.from('users').upsert(
        { id: data.user.id, email: data.user.email, role: 'user' },
        { onConflict: 'id', ignoreDuplicates: true }
      )
    }
    return { error: null, needsConfirmation: !data.session }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null, isAdmin: false })
  },
}))
