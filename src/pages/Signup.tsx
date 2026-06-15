// Signup Page — full name, email, password, confirm + optional Google
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { signupFormSchema } from '@/lib/validations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import Logo from '@/components/Logo'
import { GoogleButton } from '@/components/GoogleButton'

const Signup = () => {
  const { signup, loginWithGoogle, isAuthenticated, loading } = useAuth()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const parsed = signupFormSchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Verifique os dados.')
      return
    }

    setSubmitting(true)
    try {
      await signup({
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        password: parsed.data.password,
      })
    } catch {
      // Friendly toast already shown by the context.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-secondary/10 rounded-full blur-[100px] animate-pulse-glow" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="w-full max-w-md mb-4 relative z-10">
        <Link to="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <div className="flex justify-center"><Logo size="md" /></div>
      </div>

      <Card className="w-full max-w-md relative z-10 border-0 bg-card/95 backdrop-blur-xl shadow-2xl">
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-3xl font-bold">Criar Conta</CardTitle>
          <CardDescription>Comece a gerenciar seu fluxo de caixa</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="fullName">Nome completo</Label>
              <Input id="fullName" autoComplete="name" required value={form.fullName}
                onChange={update('fullName')} placeholder="Seu nome" disabled={submitting} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" autoComplete="email" required value={form.email}
                onChange={update('email')} placeholder="voce@empresa.com" disabled={submitting} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" autoComplete="new-password" required value={form.password}
                onChange={update('password')} placeholder="Mínimo 6 caracteres" disabled={submitting} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" required value={form.confirmPassword}
                onChange={update('confirmPassword')} placeholder="Repita a senha" disabled={submitting} />
            </div>

            <Button type="submit" className="w-full h-11" disabled={submitting}>
              {submitting ? 'Criando conta...' : 'Criar conta'}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>

          <GoogleButton onClick={() => loginWithGoogle()} label="Cadastrar com Google" />

          <div className="text-center text-sm text-muted-foreground mt-6">
            Já tem uma conta?{' '}
            <Link to="/login" className="text-primary font-semibold hover:underline">Fazer login</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Signup
