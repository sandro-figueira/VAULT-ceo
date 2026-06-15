// Reset Password — sets a new password after the email recovery link
//
// Supabase opens this page with a recovery session in the URL (detectSessionInUrl
// establishes it and fires PASSWORD_RECOVERY). The user then sets a new password.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { friendlyAuthError } from '@/contexts/AuthContext'
import { resetPasswordSchema } from '@/lib/validations'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Logo from '@/components/Logo'

const ResetPassword = () => {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // A valid session (from the recovery link) is required to change the password.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        setReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const parsed = resetPasswordSchema.safeParse({ password, confirmPassword })
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }

    setSubmitting(true)
    try {
      await updatePassword(parsed.data.password)
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      setError(friendlyAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-0 bg-card/95 backdrop-blur-xl shadow-2xl">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center"><Logo size="lg" /></div>
          <div>
            <CardTitle className="text-2xl font-bold">Definir nova senha</CardTitle>
            <CardDescription className="mt-2">Escolha uma nova senha para sua conta.</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {!ready ? (
            <div className="text-center space-y-3 py-4">
              <p className="text-sm text-muted-foreground">
                Abra esta página pelo link enviado ao seu e-mail. Se já abriu,
                aguarde um instante...
              </p>
              <Link to="/forgot-password" className="inline-block text-sm text-primary font-semibold hover:underline">
                Reenviar link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">Nova senha</Label>
                <Input id="password" type="password" autoComplete="new-password" required value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" disabled={submitting} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
                <Input id="confirmPassword" type="password" autoComplete="new-password" required value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repita a senha" disabled={submitting} />
              </div>
              <Button type="submit" className="w-full h-11" disabled={submitting}>
                {submitting ? 'Salvando...' : 'Salvar nova senha'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default ResetPassword
