// Authentication Context / Provider
//
// Single source of truth for auth state. Wraps the app once, keeps a single
// onAuthStateChange subscription, and exposes the auth API consumed across the
// app via useAuth(). Works fully with email/password — Google is optional.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { authService } from '@/services/auth.service'
import type { User } from '@/types'
import type { SignupInput, LoginInput } from '@/lib/validations'
import { useToast } from '@/hooks/use-toast'
import { posthog } from '@/lib/posthog'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  isAuthenticated: boolean
  signup: (data: SignupInput) => Promise<void>
  login: (data: LoginInput, remember?: boolean) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { toast } = useToast()

  useEffect(() => {
    let active = true

    // Hydrate from any persisted session on first load.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return
      setSession(session)
      if (session?.user) setUser(await authService.getCurrentUser())
      setLoading(false)
    })

    // React to sign in / out / token refresh for the lifetime of the app.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return
      setSession(session)

      if (session?.user) {
        const currentUser = await authService.getCurrentUser()
        setUser(currentUser)
        if (event === 'SIGNED_IN') {
          posthog.identify(session.user.id, { email: session.user.email })
          posthog.capture('user_signed_in')
        }
      } else {
        setUser(null)
        if (event === 'SIGNED_OUT') posthog.reset()
      }
    })

    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const signup = async (data: SignupInput) => {
    try {
      const result = await authService.signup(data)
      posthog.capture('user_signup', { method: 'email' })

      // If email confirmation is required, there's no active session yet.
      if (!result.session) {
        toast({
          title: 'Conta criada!',
          description: 'Enviamos um e-mail de confirmação. Verifique sua caixa de entrada.',
        })
        navigate('/login')
      } else {
        toast({ title: 'Conta criada com sucesso!', description: 'Bem-vindo ao Vault.' })
        navigate('/dashboard')
      }
    } catch (error: any) {
      toast({ title: 'Erro ao criar conta', description: friendlyAuthError(error), variant: 'destructive' })
      throw error
    }
  }

  const login = async (data: LoginInput, remember = true) => {
    try {
      await authService.login(data, remember)
      posthog.capture('user_login', { method: 'email' })
      toast({ title: 'Login realizado!', description: 'Bem-vindo de volta.' })
      navigate('/dashboard')
    } catch (error: any) {
      toast({ title: 'Erro ao fazer login', description: friendlyAuthError(error), variant: 'destructive' })
      throw error
    }
  }

  const loginWithGoogle = async () => {
    try {
      posthog.capture('user_login_attempt', { method: 'google' })
      await authService.loginWithGoogle()
      // Full-page redirect to Google happens here.
    } catch (error: any) {
      toast({ title: 'Erro ao conectar com Google', description: friendlyAuthError(error), variant: 'destructive' })
      throw error
    }
  }

  const logout = async () => {
    try {
      await authService.logout()
      setUser(null)
      setSession(null)
      toast({ title: 'Logout realizado', description: 'Até logo!' })
      navigate('/login')
    } catch (error: any) {
      toast({ title: 'Erro ao fazer logout', description: friendlyAuthError(error), variant: 'destructive' })
    }
  }

  const resetPassword = async (email: string) => {
    await authService.resetPassword(email)
  }

  const updatePassword = async (newPassword: string) => {
    await authService.updatePassword(newPassword)
  }

  return (
    <AuthContext.Provider
      value={{
        user, session, loading,
        isAuthenticated: !!session,
        signup, login, loginWithGoogle, logout, resetPassword, updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}

/** Maps common Supabase auth errors to friendly pt-BR messages. */
export function friendlyAuthError(error: any): string {
  const msg = String(error?.message || '').toLowerCase()
  if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (msg.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.'
  if (msg.includes('user already registered') || msg.includes('already been registered')) return 'Este e-mail já está cadastrado. Faça login.'
  if (msg.includes('password should be at least')) return 'A senha é muito curta (mínimo 6 caracteres).'
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) return 'E-mail inválido.'
  if (msg.includes('network')) return 'Falha de conexão. Verifique sua internet e tente novamente.'
  return error?.message || 'Algo deu errado. Tente novamente.'
}
