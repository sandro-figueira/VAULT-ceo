import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Upload, FileText, Loader2, ArrowLeft, Check, FileSpreadsheet,
  Trash2, Mail, RefreshCw, Plus, AlertCircle, Zap
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { parseCSV, parseOFX, parseXLSX, type ImportedTransaction } from '@/utils/parsers'
import { useTransactions } from '@/hooks/useTransactions'
import { useAuth } from '@/hooks/useAuth'
import { TRANSACTION_CATEGORIES } from '@/lib/validations'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { gmailAccountsService, type GmailAccount, type ScanAccountResult } from '@/services/gmailAccounts.service'
import { supabase } from '@/lib/supabase'

type Step = 'upload' | 'preview'
type Tab = 'files' | 'gmail'

const SCAN_SESSION_KEY = 'vault_scan_session'

interface ScanSession {
  parsedTransactions: ImportedTransaction[]
  selectedIds: number[]
  scanResults: ScanAccountResult[] | null
}

function loadScanSession(): ScanSession | null {
  try {
    const raw = sessionStorage.getItem(SCAN_SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ScanSession
  } catch {
    return null
  }
}

function saveScanSession(session: ScanSession) {
  try {
    sessionStorage.setItem(SCAN_SESSION_KEY, JSON.stringify(session))
  } catch { /* quota exceeded — fail silently */ }
}

function clearScanSession() {
  try { sessionStorage.removeItem(SCAN_SESSION_KEY) } catch { /* noop */ }
}

const Import = () => {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() =>
    searchParams.get('tab') === 'gmail' ? 'gmail' : 'files'
  )

  // Restore last scan from sessionStorage on first render
  const _session = loadScanSession()
  const [step, setStep] = useState<Step>(_session?.parsedTransactions?.length ? 'preview' : 'upload')
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [parsedTransactions, setParsedTransactions] = useState<ImportedTransaction[]>(
    _session?.parsedTransactions ?? []
  )
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(_session?.selectedIds ?? [])
  )
  const [accounts, setAccounts] = useState<GmailAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [isAddingAccount, setIsAddingAccount] = useState(false)
  const [isScanningGmail, setIsScanningGmail] = useState(false)
  const [gmailDays, setGmailDays] = useState(90)
  const [scanStage, setScanStage] = useState('')
  const [scanProgress, setScanProgress] = useState(0)
  const [scanResults, setScanResults] = useState<ScanAccountResult[] | null>(
    _session?.scanResults ?? null
  )
  const [previewFilter, setPreviewFilter] = useState<'all' | 'review'>('all')
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const { toast } = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { createTransactions } = useTransactions(user?.id)

  const ACCEPTED_EXTENSIONS = ['.csv', '.ofx', '.xlsx', '.xls']

  const refreshAccounts = async (): Promise<GmailAccount[]> => {
    if (!user?.id) return []
    try {
      const list = await gmailAccountsService.list(user.id)
      setAccounts(list)
      return list
    } catch (err: any) {
      toast({ title: 'Erro ao carregar contas', description: err.message, variant: 'destructive' })
      return []
    } finally {
      setAccountsLoading(false)
    }
  }

  const handleAddAccount = async () => {
    setIsAddingAccount(true)
    try {
      const { email } = await gmailAccountsService.connectAccount()
      toast({ title: 'Conta conectada', description: email })
      await refreshAccounts()
    } catch (err: any) {
      toast({ title: 'Erro ao conectar conta', description: err.message, variant: 'destructive' })
    } finally {
      setIsAddingAccount(false)
    }
  }

  const handleDisconnect = async (account: GmailAccount) => {
    if (!confirm(`Desconectar ${account.email}?`)) return
    try {
      await gmailAccountsService.disconnect(account.id)
      toast({ title: 'Conta desconectada', description: account.email })
      await refreshAccounts()
    } catch (err: any) {
      toast({ title: 'Erro ao desconectar', description: err.message, variant: 'destructive' })
    }
  }

  const handleGmailScan = async (connectedAccounts?: GmailAccount[], force = false) => {
    const activeAccounts = connectedAccounts ?? accounts
    if (activeAccounts.length === 0) {
      toast({ title: 'Nenhuma conta conectada', description: 'Adicione uma conta Gmail primeiro.', variant: 'destructive' })
      return
    }

    setIsScanningGmail(true)
    setScanStage(force ? 'Re-escaneando histórico completo...' : 'Buscando novos e-mails...')
    setScanProgress(5)
    setScanResults(null)
    clearScanSession()

    const baseStages = force
      ? [
          { delay: 2000,  text: 'Buscando e-mails financeiros...',   progress: 20 },
          { delay: 6000,  text: 'Analisando conteúdo dos e-mails...', progress: 45 },
          { delay: 12000, text: 'Extraindo valores e categorias...',  progress: 70 },
          { delay: 20000, text: 'Quase lá, finalizando análise...',   progress: 88 },
        ]
      : [
          { delay: 1500, text: 'Buscando novidades...',              progress: 30 },
          { delay: 4000, text: 'Analisando com a AI...',             progress: 65 },
          { delay: 8000, text: 'Quase lá...',                        progress: 88 },
        ]
    const timers = baseStages.map(({ delay, text, progress }) =>
      setTimeout(() => { setScanStage(text); setScanProgress(progress) }, delay)
    )

    try {
      const { transactions, scanned, accounts: results } = await gmailAccountsService.scanAll(gmailDays, force)
      timers.forEach(clearTimeout)
      setScanProgress(100)
      setScanResults(results)
      await refreshAccounts()

      if (transactions.length === 0) {
        toast({
          title: 'Nenhuma transação encontrada',
          description: `Verificamos ${scanned} e-mails em ${results.length} conta${results.length !== 1 ? 's' : ''} sem encontrar valores financeiros.`,
        })
        setIsScanningGmail(false)
        return
      }

      setParsedTransactions(transactions)
      setSelectedIds(new Set(transactions.map((_, i) => i).filter(i => transactions[i].confidence !== 'low')))
      setPreviewFilter('all')
      setAccountFilter('all')
      setStep('preview')
    } catch (err: any) {
      timers.forEach(clearTimeout)
      toast({ title: 'Erro ao escanear', description: err.message, variant: 'destructive' })
    } finally {
      setIsScanningGmail(false)
      setScanStage('')
      setScanProgress(0)
    }
  }

  // Persist scan results to sessionStorage whenever they change
  useEffect(() => {
    if (parsedTransactions.length > 0) {
      saveScanSession({
        parsedTransactions,
        selectedIds: Array.from(selectedIds),
        scanResults,
      })
    }
  }, [parsedTransactions, selectedIds, scanResults])

  useEffect(() => {
    if (!user?.id) return
    refreshAccounts().then((list) => {
      if (searchParams.get('autoscan') === 'true' && list.length > 0) {
        setTab('gmail')
        handleGmailScan(list)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    const validFiles = droppedFiles.filter((file) =>
      ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))
    )

    if (validFiles.length !== droppedFiles.length) {
      toast({
        title: 'Arquivo inválido',
        description: 'Apenas arquivos .csv, .ofx e .xlsx são aceitos.',
        variant: 'destructive',
      })
    }

    setFiles((prev) => [...prev, ...validFiles])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
    }
  }

  const parseFiles = async () => {
    if (files.length === 0) return
    setIsParsing(true)

    const allTransactions: ImportedTransaction[] = []
    const errorMessages: string[] = []

    for (const file of files) {
      try {
        let transactions: ImportedTransaction[] = []
        const name = file.name.toLowerCase()

        if (name.endsWith('.csv')) {
          transactions = await parseCSV(file)
        } else if (name.endsWith('.ofx')) {
          transactions = await parseOFX(file)
        } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
          transactions = await parseXLSX(file)
        } else {
          throw new Error(`Formato não suportado: "${file.name}". Use OFX, CSV, XLS ou XLSX.`)
        }

        if (transactions.length === 0) {
          errorMessages.push(`Nenhuma transação encontrada em "${file.name}".`)
        }
        allTransactions.push(...transactions)
      } catch (err: any) {
        // Avoid logging file contents; only the friendly message is recorded.
        errorMessages.push(err?.message || `Não foi possível processar "${file.name}".`)
      }
    }

    if (allTransactions.length === 0) {
      toast({
        title: 'Nenhuma transação importada',
        description: errorMessages[0] || 'Não foi possível ler transações dos arquivos.',
        variant: 'destructive',
      })
      setIsParsing(false)
      return
    }

    if (errorMessages.length > 0) {
      toast({
        title: 'Alguns arquivos não foram lidos',
        description: `${errorMessages[0]} ${allTransactions.length} transações foram lidas dos demais arquivos.`,
      })
    }

    setParsedTransactions(allTransactions)
    setSelectedIds(new Set(allTransactions.map((_, i) => i)))
    setStep('preview')
    setIsParsing(false)
  }

  const saveEmailRule = async (
    t: ImportedTransaction,
    field: 'category' | 'type',
    newValue: string
  ) => {
    if (!user?.id || !t.source_id?.startsWith('gmail:')) return
    try {
      // Prefer sender domain rule; fall back to description rule
      const rule = t.senderDomain
        ? { trigger_type: 'sender_domain' as const, trigger_value: t.senderDomain }
        : { trigger_type: 'description_contains' as const, trigger_value: t.description.slice(0, 60) }

      const patch = field === 'category'
        ? { category: newValue, type: t.type }
        : { category: t.category, type: newValue as 'income' | 'expense' }

      await supabase.from('user_email_rules' as any).upsert(
        { user_id: user.id, ...rule, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,trigger_type,trigger_value' }
      )
    } catch { /* silent — rule saving is non-critical */ }
  }

  const updateTransactionCategory = (index: number, category: string) => {
    const t = parsedTransactions[index]
    if (t && t.category !== category) saveEmailRule(t, 'category', category)
    setParsedTransactions((prev) =>
      prev.map((t, i) => (i === index ? { ...t, category } : t))
    )
  }

  const updateTransactionType = (index: number, type: 'income' | 'expense') => {
    const t = parsedTransactions[index]
    if (t && t.type !== type) saveEmailRule(t, 'type', type)
    setParsedTransactions((prev) =>
      prev.map((t, i) => (i === index ? { ...t, type } : t))
    )
  }

  const toggleSelect = (index: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const getAccountEmail = (sourceId: string): string | null => {
    if (!sourceId?.startsWith('gmail:')) return null
    const after = sourceId.slice(6)
    const colon = after.indexOf(':')
    if (colon === -1) return null
    const candidate = after.slice(0, colon)
    return candidate.includes('@') ? candidate : null
  }

  // Prefer scanResults as source of truth (includes accounts with 0 transactions).
  // Fall back to deriving from source_ids for file imports.
  const gmailAccounts = useMemo(() => {
    if (scanResults && scanResults.length >= 2) {
      return scanResults.map(r => r.email)
    }
    const emails = new Set<string>()
    parsedTransactions.forEach(t => {
      const email = getAccountEmail(t.source_id)
      if (email) emails.add(email)
    })
    return Array.from(emails)
  }, [parsedTransactions, scanResults])

  const visibleTransactions = useMemo(() =>
    parsedTransactions
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => {
        if (accountFilter !== 'all' && getAccountEmail(t.source_id) !== accountFilter) return false
        if (previewFilter === 'review' && t.confidence !== 'low') return false
        return true
      }),
    [parsedTransactions, accountFilter, previewFilter]
  )

  const toggleSelectAll = () => {
    const visibleIds = visibleTransactions.map(({ i }) => i)
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
    const next = new Set(selectedIds)
    if (allSelected) {
      visibleIds.forEach(id => next.delete(id))
    } else {
      visibleIds.forEach(id => next.add(id))
    }
    setSelectedIds(next)
  }

  const stats = useMemo(() => {
    const selected = parsedTransactions.filter((_, i) => selectedIds.has(i))
    const income = selected.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const expense = selected.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    return { total: selected.length, income, expense }
  }, [parsedTransactions, selectedIds])

  const saveTransactions = async () => {
    const selected = parsedTransactions.filter((_, i) => selectedIds.has(i))
    if (selected.length === 0) {
      toast({ title: 'Nenhuma transação selecionada', variant: 'destructive' })
      return
    }

    setIsProcessing(true)
    try {
      const toCreate = selected.map((t) => ({
        type: t.type,
        amount: t.amount,
        description: t.description,
        category: t.category || 'Outros',
        date: t.date,
        source_id: t.source_id,
      }))

      const created = await createTransactions(toCreate)
      const skipped = toCreate.length - created.length

      // Clear scan session immediately so reopening Import is fresh.
      // useTransactions.onSuccess already shows a success toast — no need to duplicate here.
      clearScanSession()

      if (skipped > 0 && created.length === 0) {
        toast({
          title: 'Tudo já estava importado',
          description: `${skipped} transação(ões) já existiam — atualizando dashboard.`,
        })
      }

      // Navigate first to guarantee the route change happens; state cleanup runs in finally.
      navigate('/dashboard', { replace: true })
    } catch (error: any) {
      toast({
        title: 'Erro na importação',
        description: error?.message || 'Erro ao salvar transações.',
        variant: 'destructive',
      })
    } finally {
      setIsProcessing(false)
      setFiles([])
      setParsedTransactions([])
    }
  }

  const formatCurrency = (value: number) =>
    value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  // ──────────── UPLOAD STEP ────────────
  if (step === 'upload') {
    const hasSavedScan = loadScanSession()?.parsedTransactions?.length

    return (
      <div className="container mx-auto p-4 md:p-6 space-y-6 animate-fade-in max-w-3xl">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Importar Transações</h1>
          <p className="text-sm text-muted-foreground">
            Importe extratos bancários ou escaneie seus e-mails financeiros.
          </p>
        </div>

        {/* Restore last scan banner */}
        {hasSavedScan && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/40">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <Mail className="w-4 h-4 text-primary shrink-0" />
              <span className="text-muted-foreground truncate">
                Você tem um scan anterior com <span className="font-medium text-foreground">{hasSavedScan} transações</span> não importadas.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => setStep('preview')}
            >
              Ver scan
            </Button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setTab('files')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'files'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Upload className="w-4 h-4" />
            Arquivos
          </button>
          <button
            onClick={() => setTab('gmail')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'gmail'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Mail className="w-4 h-4" />
            Gmail
          </button>
        </div>

        {/* ── Gmail Tab ── */}
        {tab === 'gmail' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="w-5 h-5 text-primary" />
                  Contas conectadas
                </CardTitle>
                <CardDescription>
                  Conecte uma ou mais contas Gmail. O Vault escaneia todas em busca de
                  NF-e, PIX, boletos e confirmações de pagamento.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {accountsLoading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Carregando contas...
                  </div>
                ) : accounts.length === 0 ? (
                  <div className="flex flex-col items-center gap-4 py-6 text-center">
                    <div className="p-4 rounded-full bg-primary/10">
                      <Mail className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Nenhuma conta conectada</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Permissão somente leitura — o Vault nunca envia e-mails.
                      </p>
                    </div>
                    <Button onClick={handleAddAccount} disabled={isAddingAccount} className="gap-2">
                      {isAddingAccount ? (
                        <><Loader2 className="w-4 h-4 animate-spin" />Aguardando autorização...</>
                      ) : (
                        <><Plus className="w-4 h-4" />Conectar primeira conta</>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {accounts.map((account) => {
                      const result = scanResults?.find(r => r.email === account.email)
                      return (
                        <div
                          key={account.id}
                          className="flex items-center justify-between p-3 border rounded-lg bg-card gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="p-2 rounded-md bg-muted shrink-0">
                              <Mail className="w-4 h-4 text-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate" title={account.email}>
                                {account.email}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {result?.error ? (
                                  <span className="inline-flex items-center gap-1 text-red-500">
                                    <AlertCircle className="w-3 h-3" />
                                    {result.error}
                                  </span>
                                ) : result ? (
                                  `Escaneou ${result.scanned} e-mails — ${result.found} transações`
                                ) : account.last_scan_at ? (
                                  `Último scan: ${formatDistanceToNow(new Date(account.last_scan_at), { locale: ptBR, addSuffix: true })}`
                                ) : (
                                  'Ainda não escaneada'
                                )}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDisconnect(account)}
                            disabled={isScanningGmail}
                            className="text-muted-foreground hover:text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )
                    })}

                    <Button
                      variant="outline"
                      onClick={handleAddAccount}
                      disabled={isAddingAccount || isScanningGmail}
                      className="w-full gap-2"
                    >
                      {isAddingAccount ? (
                        <><Loader2 className="w-4 h-4 animate-spin" />Aguardando autorização...</>
                      ) : (
                        <><Plus className="w-4 h-4" />Adicionar outra conta</>
                      )}
                    </Button>

                    <div className="flex items-center gap-2 pt-3 border-t">
                      <select
                        value={gmailDays}
                        onChange={(e) => setGmailDays(Number(e.target.value))}
                        disabled={isScanningGmail}
                        className="text-sm bg-transparent border rounded px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value={30}>30 dias</option>
                        <option value={60}>60 dias</option>
                        <option value={90}>90 dias</option>
                        <option value={180}>180 dias</option>
                        <option value={365}>1 ano</option>
                      </select>
                      <div className="flex-1 flex flex-col gap-2">
                        <Button
                          onClick={() => handleGmailScan()}
                          disabled={isScanningGmail || isAddingAccount}
                          className="w-full gap-2"
                        >
                          {isScanningGmail ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />{scanStage || 'Escaneando...'}</>
                          ) : (
                            <><RefreshCw className="w-4 h-4" />
                              Buscar novos e-mails
                            </>
                          )}
                        </Button>
                        {isScanningGmail && (
                          <div className="space-y-1">
                            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                                style={{ width: `${scanProgress}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground text-right">{scanProgress}%</p>
                          </div>
                        )}
                        {!isScanningGmail && accounts.some(a => a.last_scan_at) && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Re-escanear ${gmailDays} dias completos? Pode trazer e-mails já analisados antes (útil quando subimos uma versão nova da AI).`)) {
                                handleGmailScan(undefined, true)
                              }
                            }}
                            className="text-xs text-muted-foreground hover:text-primary underline self-end"
                          >
                            Re-escanear histórico completo
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="border rounded-lg p-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-2">O que é detectado:</p>
                  <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>✓ NF-e / Nota Fiscal</span>
                    <span>✓ PIX recebido/enviado</span>
                    <span>✓ Boletos pagos</span>
                    <span>✓ Confirmações de pagamento</span>
                    <span>✓ Transferências bancárias</span>
                    <span>✓ Faturas de serviço</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Files Tab ── */}
        {tab === 'files' && (
        <div className="space-y-6">
        <Card className="border-dashed border-2 bg-muted/20">
          <CardContent
            className={`flex flex-col items-center justify-center p-8 md:p-12 transition-colors ${
              isDragging ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="p-4 rounded-full bg-primary/10 mb-4">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Arraste e solte seus arquivos aqui</h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
              Suporta <strong>OFX</strong>, <strong>CSV</strong> e <strong>Excel (.xlsx)</strong>. Múltiplos arquivos de uma vez.
            </p>
            <div className="flex gap-3">
              <div className="relative">
                <input
                  type="file"
                  multiple
                  accept=".csv,.ofx,.xlsx,.xls"
                  className="hidden"
                  id="file-upload"
                  onChange={handleFileSelect}
                  disabled={isParsing}
                />
                <label htmlFor="file-upload">
                  <Button variant="outline" className="cursor-pointer" disabled={isParsing} asChild>
                    <span>Selecionar Arquivos</span>
                  </Button>
                </label>
              </div>
            </div>

            <div className="flex gap-4 mt-6 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> OFX</span>
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> CSV</span>
              <span className="flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" /> Excel</span>
            </div>
          </CardContent>
        </Card>

        {files.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Arquivos Selecionados</CardTitle>
              <CardDescription>Revise antes de processar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {files.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-muted">
                      {file.name.endsWith('.xlsx') || file.name.endsWith('.xls') ? (
                        <FileSpreadsheet className="w-4 h-4 text-green-600" />
                      ) : (
                        <FileText className="w-4 h-4 text-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFiles(files.filter((_, i) => i !== index))}
                    disabled={isParsing}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <div className="flex justify-end pt-2">
                <Button onClick={parseFiles} disabled={isParsing}>
                  {isParsing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Lendo arquivos...
                    </>
                  ) : (
                    `Processar ${files.length} arquivo${files.length > 1 ? 's' : ''}`
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        </div>
        )}
      </div>
    )
  }

  // ──────────── PREVIEW STEP ────────────
  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setStep('upload')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Revisar Transações</h1>
            <p className="text-sm text-muted-foreground">
              {parsedTransactions.length} transações encontradas
              {scanResults && scanResults.length > 0 && (
                <span className="ml-1 text-xs">
                  — {scanResults.length} conta{scanResults.length !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
        </div>
        <Button onClick={saveTransactions} disabled={isProcessing || selectedIds.size === 0}>
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Check className="mr-2 h-4 w-4" />
              Importar {selectedIds.size} transações
            </>
          )}
        </Button>
      </div>

      {/* Anomaly summary */}
      {parsedTransactions.some(t => t.anomaly) && (
        <div className="space-y-1.5">
          {parsedTransactions
            .map((t, i) => ({ t, i }))
            .filter(({ t }) => t.anomaly)
            .slice(0, 3)
            .map(({ t, i }) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800/40 dark:bg-orange-900/10 text-sm">
                <Zap className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="font-medium text-orange-700 dark:text-orange-400">{t.description}</span>
                  <span className="text-orange-600 dark:text-orange-500 ml-1">— {t.anomaly}</span>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Selecionadas</p>
          <p className="text-lg font-bold">{stats.total}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Receitas</p>
          <p className="text-lg font-bold text-green-600">{formatCurrency(stats.income)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Despesas</p>
          <p className="text-lg font-bold text-red-500">{formatCurrency(stats.expense)}</p>
        </Card>
      </div>

      {/* Account tabs — only when there are 2+ Gmail accounts */}
      {gmailAccounts.length >= 2 && (
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="flex gap-1 min-w-max pb-1">
            <button
              onClick={() => setAccountFilter('all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
                accountFilter === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <Mail className="w-3 h-3" />
              Todas as contas
              <span className="opacity-70">({parsedTransactions.length})</span>
            </button>
            {gmailAccounts.map(email => {
              const count = parsedTransactions.filter(t => getAccountEmail(t.source_id) === email).length
              const label = email.split('@')[0]
              return (
                <button
                  key={email}
                  onClick={() => setAccountFilter(email)}
                  title={email}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
                    accountFilter === email
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Mail className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">{label}</span>
                  <span className="opacity-70">({count})</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Legend + confidence filter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {parsedTransactions.some(t => t.confidence && t.confidence !== 'high') && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Confiança média</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Confiança baixa</span>
            <span className="flex items-center gap-1"><span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium text-[10px]">2/12</span> Parcela</span>
            <span className="flex items-center gap-1"><span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium text-[10px]">recorrente</span> Recorrência</span>
          </div>
        )}
        {parsedTransactions.some(t => t.confidence === 'low') && (
          <div className="flex gap-1">
            <button
              onClick={() => setPreviewFilter('all')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                previewFilter === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              Todas ({visibleTransactions.length})
            </button>
            <button
              onClick={() => setPreviewFilter('review')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                previewFilter === 'review'
                  ? 'bg-red-500 text-white'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-red-400" />
              Revisão ({visibleTransactions.filter(({ t }) => t.confidence === 'low').length})
            </button>
          </div>
        )}
      </div>

      {/* Transaction Table */}
      <Card>
        <CardContent className="p-0">
          {/* Table Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
            <input
              type="checkbox"
              checked={visibleTransactions.length > 0 && visibleTransactions.every(({ i }) => selectedIds.has(i))}
              onChange={toggleSelectAll}
              className="rounded border-muted-foreground/30"
            />
            <span className="w-20">Data</span>
            <span className="flex-1 min-w-0">Descrição</span>
            <span className="w-24 text-right">Valor</span>
            <span className="w-16 text-center">Tipo</span>
            <span className="w-32">Categoria</span>
          </div>

          {/* Rows */}
          <div className="max-h-[60vh] overflow-y-auto divide-y">
            {visibleTransactions.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma transação nessa conta.
              </div>
            )}
            {visibleTransactions.map(({ t, i }) => {
              const accountEmail = getAccountEmail(t.source_id)
              const accountLabel = accountEmail ? accountEmail.split('@')[0] : null
              const isSelected = selectedIds.has(i)
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                    isSelected ? 'bg-background' : 'bg-muted/30 opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(i)}
                    className="rounded border-muted-foreground/30"
                  />

                  <span className="w-20 text-xs text-muted-foreground shrink-0">
                    {(() => {
                      try {
                        return format(new Date(t.date), 'dd/MM/yy', { locale: ptBR })
                      } catch {
                        return '--/--/--'
                      }
                    })()}
                  </span>

                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" title={t.description}>
                        {t.description}
                      </span>
                      {t.installment && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                          {t.installment.current}/{t.installment.total}
                        </span>
                      )}
                      {t.isRecurring && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium" title="Recorrência detectada — mesmo valor em 3+ meses">
                          recorrente
                        </span>
                      )}
                    </div>
                    {accountLabel && gmailAccounts.length >= 2 && accountFilter === 'all' && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground w-fit">
                        <Mail className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate max-w-[100px]">{accountLabel}</span>
                      </span>
                    )}
                    {t.account && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground w-fit" title={t.account}>
                        <FileText className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate max-w-[140px]">{t.account}</span>
                      </span>
                    )}
                    {t.anomaly && (
                      <span className="flex items-center gap-0.5 text-[10px] text-orange-500 w-fit" title={t.anomaly}>
                        <Zap className="w-2.5 h-2.5 shrink-0" />
                        anomalia
                      </span>
                    )}
                  </div>

                  <div className="w-24 text-right shrink-0 flex items-center justify-end gap-1">
                    {t.confidence && t.confidence !== 'high' && (
                      <span
                        className={`shrink-0 w-2 h-2 rounded-full ${
                          t.confidence === 'medium' ? 'bg-yellow-400' : 'bg-red-400'
                        }`}
                        title={t.confidence === 'medium' ? 'Confiança média — revise o valor' : 'Confiança baixa — revise o valor'}
                      />
                    )}
                    <span className={`font-medium tabular-nums ${
                      t.type === 'income' ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                    </span>
                  </div>

                  <div className="w-16 flex justify-center shrink-0">
                    <button
                      onClick={() => updateTransactionType(i, t.type === 'income' ? 'expense' : 'income')}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.type === 'income'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                      title="Clique para alternar tipo"
                    >
                      {t.type === 'income' ? 'Rec' : 'Desp'}
                    </button>
                  </div>

                  <div className="w-32 shrink-0">
                    <select
                      value={t.category || 'Outros'}
                      onChange={(e) => updateTransactionCategory(i, e.target.value)}
                      className="w-full text-xs bg-transparent border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {TRANSACTION_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Import
