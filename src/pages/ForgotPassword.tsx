// Forgot Password — sends a reset email via Supabase
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '@/hooks/useAuth'
import { friendlyAuthError } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, MailCheck } from 'lucide-react'
import Logo from '@/components/Logo'

const emailSchema = z.string().email('E-mail inválido')

const ForgotPassword = () => {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }

    setSubmitting(true)
    try {
      await resetPassword(parsed.data)
      setSent(true) // Always show success to avoid leaking which emails exist.
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
            <CardTitle className="text-2xl font-bold">Recuperar senha</CardTitle>
            <CardDescription className="mt-2">
              Enviaremos um link de redefinição para o seu e-mail.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {sent ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="p-3 rounded-full bg-success/10">
                  <MailCheck className="w-8 h-8 text-success" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Se houver uma conta para <span className="font-medium text-foreground">{email}</span>,
                você receberá um e-mail com o link de redefinição em instantes.
              </p>
              <Link to="/login" className="inline-block text-sm text-primary font-semibold hover:underline">
                Voltar para o login
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
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" disabled={submitting} />
              </div>
              <Button type="submit" className="w-full h-11" disabled={submitting}>
                {submitting ? 'Enviando...' : 'Enviar link de redefinição'}
              </Button>
              <Link to="/login" className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" /> Voltar para o login
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default ForgotPassword
