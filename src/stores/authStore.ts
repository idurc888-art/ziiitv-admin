import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { User as SupabaseUser, Session } from '@supabase/supabase-js'

interface AuthState {
  user: SupabaseUser | null
  session: Session | null
  isAdmin: boolean
  isLoading: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isAdmin: false,
  isLoading: true,

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    console.log('[Auth] Session:', session)
    if (session) {
      const { data: profile, error } = await supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single()
      console.log('[Auth] Profile:', profile, 'Error:', error)
      set({
        user: session.user,
        session,
        isAdmin: profile?.role === 'admin',
        isLoading: false,
      })
      console.log('[Auth] isAdmin:', profile?.role === 'admin')
    } else {
      set({ user: null, session: null, isAdmin: false, isLoading: false })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('[Auth] State change:', _event, session)
      if (session) {
        const { data: profile, error } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single()
        console.log('[Auth] Profile after change:', profile, 'Error:', error)
        set({
          user: session.user,
          session,
          isAdmin: profile?.role === 'admin',
          isLoading: false,
        })
      } else {
        set({ user: null, session: null, isAdmin: false, isLoading: false })
      }
    })
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null, isAdmin: false })
  },
}))
