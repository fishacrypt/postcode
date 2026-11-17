import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type User } from './api'

interface AuthState {
  user: User | null
  loading: boolean
  refresh: () => Promise<unknown>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: User | null }>('/auth/me'), staleTime: 60_000, retry: false })
  const value: AuthState = {
    user: me.data?.user ?? null,
    loading: me.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    signOut: async () => {
      await api.post('/auth/logout')
      qc.clear()
      await qc.invalidateQueries({ queryKey: ['me'] })
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}

export function homeFor(role: User['role']): string {
  if (role === 'business') return '/business'
  if (role === 'admin') return '/admin'
  if (role === 'issuer') return '/issuer'
  return '/app'
}
