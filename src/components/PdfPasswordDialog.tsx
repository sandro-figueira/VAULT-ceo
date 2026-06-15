import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Lock, Loader2, AlertCircle } from 'lucide-react'

interface PdfPasswordDialogProps {
  open: boolean
  fileName: string
  /** User-facing error (e.g. "Senha incorreta. Tente novamente."). */
  error?: string | null
  loading?: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}

/**
 * Prompts for a PDF password. The password is held only in local component
 * state and is cleared whenever the dialog closes — it is never persisted to
 * Supabase, localStorage, sessionStorage, or logged anywhere.
 */
export function PdfPasswordDialog({
  open, fileName, error, loading, onSubmit, onCancel,
}: PdfPasswordDialogProps) {
  const [password, setPassword] = useState('')

  // Clear the in-memory password whenever the dialog is closed.
  useEffect(() => {
    if (!open) setPassword('')
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || loading) return
    onSubmit(password)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPassword(''); onCancel() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-primary" />
            PDF protegido por senha
          </DialogTitle>
          <DialogDescription>
            O arquivo <span className="font-medium text-foreground">{fileName}</span> está
            protegido. Digite a senha para que o Vault possa ler o extrato. A senha é usada
            apenas neste dispositivo e não é armazenada.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pdf-password">Senha do PDF</Label>
            <Input
              id="pdf-password"
              type="password"
              autoFocus
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite a senha do extrato"
              disabled={loading}
            />
            {error && (
              <p className="flex items-center gap-1.5 text-sm text-red-500">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!password || loading} className="gap-2">
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Abrindo...</>
              ) : (
                <><Lock className="w-4 h-4" />Abrir PDF</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
