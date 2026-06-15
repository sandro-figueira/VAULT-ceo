// Login Page — email/password + optional Google
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { loginSchema } from '@/lib/validations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Logo from '@/components/Logo'
import { GoogleButton } from '@/components/GoogleButton'

const Login = () => {
  const { login, loginWithGoogle, isAuthenticated, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Verifique os dados.')
      return
    }

    setSubmitting(true)
    try {
      await login(parsed.data, remember)
    } catch {
      // Friendly toast already shown by the context; keep an inline hint too.
      setError('E-mail ou senha incorretos.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-secondary/10 rounded-full blur-[100px] animate-pulse-glow" style={{ animationDelay: '1.5s' }} />
      </div>

      <Card className="w-full max-w-md relative z-10 border-0 bg-card/95 backdrop-blur-xl shadow-2xl">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center"><Logo size="lg" /></div>
          <div>
            <CardTitle className="text-3xl font-bold">Bem-vindo de volta</CardTitle>
            <CardDescription className="text-base mt-2">Faça login para acessar sua conta</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com" disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                  Esqueci minha senha
                </Link>
              </div>
              <Input
                id="password" type="password" autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" disabled={submitting}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox" checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-muted-foreground/30"
              />
              Lembrar sessão neste dispositivo
            </label>

            <Button type="submit" className="w-full h-11" disabled={submitting}>
              {submitting ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>

          <GoogleButton onClick={() => loginWithGoogle()} label="Entrar com Google" />

          <div className="text-center text-sm text-muted-foreground mt-6">
            Não tem uma conta?{' '}
            <Link to="/signup" className="text-primary font-semibold hover:underline">Cadastre-se</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Login
