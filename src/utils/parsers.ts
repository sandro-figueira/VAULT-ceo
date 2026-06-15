import Papa from 'papaparse'
import { categorizeTransaction } from './categorizer'

export interface ImportedTransaction {
  date: string
  amount: number
  description: string
  type: 'income' | 'expense'
  category: string
  fitid?: string
  source_id?: string
  confidence?: 'high' | 'medium' | 'low'
  installment?: { current: number; total: number }
  isRecurring?: boolean
  senderDomain?: string  // domain of the Gmail sender — used to save email rules
  anomaly?: string       // non-null when transaction looks unusual vs user history
  raw?: any
}

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────

/** Normalize a header/key for accent- and case-insensitive comparison. */
const normalizeKey = (key: string): string =>
  key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

/**
 * Pick the first matching field from a row, comparing keys case- and
 * accent-insensitively. Bank exports vary wildly in header casing/spelling
 * ("Valor", "valor", "VALOR", "Data Transação", "Histórico"…), so an exact
 * key lookup misses most of them.
 */
const pickField = (row: Record<string, any>, candidates: string[]): any => {
  const keys = Object.keys(row)
  for (const candidate of candidates) {
    const target = normalizeKey(candidate)
    for (const key of keys) {
      if (normalizeKey(key) === target) {
        const value = row[key]
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return value
        }
      }
    }
  }
  return undefined
}

/**
 * Parse a monetary value coming from CSV/XLSX into a signed number.
 *
 * Handles the formats real bank/fintech exports actually use:
 *   - Brazilian:  "1.234,56", "R$ 1.500,00", "1.000"
 *   - US/dot:     "1234.56", "-50.00"  (Nubank, English exports, Excel cells)
 *   - Numbers:    1234.56  (Excel stores amounts as real JS numbers)
 *   - Negatives:  "-100", "(100,00)", "100,00 D"
 *
 * The previous implementation blindly stripped every "." which multiplied any
 * dot-decimal value (and every Excel numeric cell) by 100. We instead detect
 * which separator is the decimal one based on its position.
 *
 * @returns the signed number, or null when the value isn't a real amount.
 */
export const parseAmount = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null

  // Excel cells (and already-parsed values) arrive as real numbers — trust them.
  if (typeof raw === 'number') return isNaN(raw) ? null : raw

  let s = String(raw).trim()
  if (!s) return null

  // Detect sign: leading minus, accounting parentheses, or a trailing "D" (debit).
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  if (/-/.test(s)) negative = true
  if (/(^|\s)D\.?$/i.test(s.trim())) negative = true   // "100,00 D" → debit
  // A trailing "C" means credit/positive — nothing to do.

  // Keep only digits and the two possible separators.
  s = s.replace(/[^0-9.,]/g, '')
  if (!s) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  let normalized: string
  if (lastComma > -1 && lastDot > -1) {
    // Both present → the right-most separator is the decimal one.
    normalized = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')   // BR: 1.234,56
      : s.replace(/,/g, '')                       // US: 1,234.56
  } else if (lastComma > -1) {
    // Only commas: decimal when a single comma is followed by 1–2 digits.
    const decimals = s.length - lastComma - 1
    const single = s.indexOf(',') === lastComma
    normalized = single && decimals > 0 && decimals <= 2
      ? s.replace(',', '.')
      : s.replace(/,/g, '')   // thousands grouping ("1.234" / "1,234,567")
  } else if (lastDot > -1) {
    // Only dots: decimal when a single dot is followed by 1–2 digits.
    const decimals = s.length - lastDot - 1
    const single = s.indexOf('.') === lastDot
    normalized = single && decimals > 0 && decimals <= 2
      ? s
      : s.replace(/\./g, '')  // thousands grouping ("1.500" / "1.234.567")
  } else {
    normalized = s
  }

  const value = parseFloat(normalized)
  if (isNaN(value)) return null
  return negative ? -Math.abs(value) : value
}

/**
 * Parse a date coming from CSV/XLSX into an ISO string. Handles DD/MM/YYYY
 * (and DD-MM-YYYY, 2-digit years), YYYY-MM-DD, and Excel serial numbers.
 * Falls back to "now" only as a last resort so a single bad cell never throws.
 */
export const parseDate = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === '') return new Date().toISOString()

  // Excel serial date (days since 1899-12-30).
  if (typeof raw === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30)
    const d = new Date(excelEpoch + raw * 86400000)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  }

  const s = String(raw).trim()

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YY (Brazilian day-first).
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (dmy) {
    let [, day, month, year] = dmy
    if (year.length === 2) year = Number(year) > 50 ? `19${year}` : `20${year}`
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    const parsed = new Date(iso)
    if (!isNaN(parsed.getTime())) return parsed.toISOString()
  }

  // YYYY-MM-DD (and full ISO timestamps).
  const ymd = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  if (ymd) {
    const [, year, month, day] = ymd
    const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`)
    if (!isNaN(parsed.getTime())) return parsed.toISOString()
  }

  const fallback = new Date(s)
  return isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString()
}

// Common column-name candidates across pt-BR / en bank & fintech exports.
const AMOUNT_FIELDS = ['amount', 'valor', 'quantia', 'value', 'vlr', 'montante', 'preço', 'preco']
const DATE_FIELDS = [
  'date', 'data', 'data transação', 'data transacao', 'data lançamento',
  'data lancamento', 'data movimento', 'dt', 'data da compra', 'data compra',
]
const DESCRIPTION_FIELDS = [
  'description', 'descrição', 'descricao', 'memo', 'histórico', 'historico',
  'lançamento', 'lancamento', 'title', 'título', 'titulo', 'detalhes',
  'estabelecimento', 'nome', 'observação', 'observacao',
]
const CREDIT_FIELDS = ['crédito', 'credito', 'credit', 'entrada', 'receita', 'recebido']
const DEBIT_FIELDS = ['débito', 'debito', 'debit', 'saída', 'saida', 'despesa', 'pago']

/**
 * Turn a parsed CSV/XLSX row into an ImportedTransaction (or null to skip it).
 * Shared by parseCSV and parseXLSX so both formats behave identically.
 */
const rowToTransaction = (row: Record<string, any>): ImportedTransaction | null => {
  // Single amount column first; fall back to separate credit/debit columns.
  let amount = parseAmount(pickField(row, AMOUNT_FIELDS))
  if (amount === null) {
    const credit = parseAmount(pickField(row, CREDIT_FIELDS))
    const debit = parseAmount(pickField(row, DEBIT_FIELDS))
    if (credit !== null && credit !== 0) amount = Math.abs(credit)
    else if (debit !== null && debit !== 0) amount = -Math.abs(debit)
  }

  if (amount === null || amount === 0) return null

  const date = parseDate(pickField(row, DATE_FIELDS))

  const descRaw = pickField(row, DESCRIPTION_FIELDS)
  const description = (descRaw !== undefined ? String(descRaw) : 'Sem descrição').trim() || 'Sem descrição'

  const type: 'income' | 'expense' = amount < 0 ? 'expense' : 'income'
  const category = categorizeTransaction(description, type)

  return {
    date,
    amount: Math.abs(amount),
    description,
    type,
    category,
    raw: row,
  }
}

/**
 * Read a file as text, decoding latin1/windows-1252 when UTF-8 fails. OFX 1.x
 * files are frequently exported in ISO-8859-1, which corrupts accented
 * descriptions (and therefore categorization) when forced through UTF-8.
 */
const readFileAsText = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('windows-1252').decode(buffer)
    } catch {
      return utf8
    }
  }
  return utf8
}

// ──────────────────────────────────────────────────────────────────────────
// Parsers
// ──────────────────────────────────────────────────────────────────────────

export const parseCSV = (file: File): Promise<ImportedTransaction[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const transactions = (results.data as Record<string, any>[])
            .map(rowToTransaction)
            .filter(Boolean) as ImportedTransaction[]
          resolve(transactions)
        } catch (error) {
          reject(error)
        }
      },
      error: (error) => {
        reject(error)
      },
    })
  })
}

export const parseOFX = async (file: File): Promise<ImportedTransaction[]> => {
  const text = await readFileAsText(file)
  const transactions: ImportedTransaction[] = []

  // Split on the opening tag so we tolerate files that omit the closing
  // </STMTTRN> (some bank exporters do). Each chunk holds one transaction.
  const chunks = text.split(/<STMTTRN>/i).slice(1)

  for (const chunk of chunks) {
    // Cut at the closing tag when present; otherwise stop at the next aggregate.
    const content = chunk.split(/<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>/i)[0]

    const getValue = (tag: string): string | null => {
      // OFX can use "<TAG>value" (SGML) or "<TAG>value</TAG>" (XML/OFX 2.x).
      const match = content.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'))
      return match ? match[1].trim() : null
    }

    const amountRaw = getValue('TRNAMT')
    const dateRaw = getValue('DTPOSTED') || getValue('DTUSER')

    if (!amountRaw || !dateRaw) continue

    let amount = parseAmount(amountRaw)
    if (amount === null) continue

    // OFX TRNAMT is normally signed, but some banks emit a positive value and
    // rely on TRNTYPE. Honor an explicit debit type when the sign is missing.
    const trntype = (getValue('TRNTYPE') || '').toUpperCase()
    if (amount > 0 && /DEBIT|FEE|PAYMENT|CHECK|ATM|WITHDRAWAL|DIRECTDEBIT|SRVCHG/.test(trntype)) {
      amount = -amount
    }

    // OFX date: YYYYMMDD or YYYYMMDDHHMMSS[.xxx][tz]
    const year = dateRaw.substring(0, 4)
    const month = dateRaw.substring(4, 6)
    const day = dateRaw.substring(6, 8)
    let date: string
    const parsed = new Date(`${year}-${month}-${day}`)
    date = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()

    const name = getValue('NAME') || ''
    const memo = getValue('MEMO') || ''
    const fitid = getValue('FITID') || undefined

    // Use NAME + MEMO for a richer description, avoiding duplicates.
    const parts = [name, memo].filter(Boolean)
    const description = (parts[0] === parts[1] ? parts[0] : parts.join(' - ')) || 'Sem descrição'

    const type: 'income' | 'expense' = amount < 0 ? 'expense' : 'income'
    const category = categorizeTransaction(description, type)

    transactions.push({
      date,
      amount: Math.abs(amount),
      description,
      type,
      category,
      fitid,
      raw: chunk,
    })
  }

  return transactions
}

export const parseXLSX = async (file: File): Promise<ImportedTransaction[]> => {
  const { read, utils } = await import('xlsx')

  const buffer = await file.arrayBuffer()
  const workbook = read(buffer, { type: 'array' })

  // Use the first sheet.
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('Planilha vazia')

  const sheet = workbook.Sheets[sheetName]
  const rows = utils.sheet_to_json<Record<string, any>>(sheet)

  if (rows.length === 0) throw new Error('Nenhuma linha encontrada na planilha')

  return rows
    .map(rowToTransaction)
    .filter(Boolean) as ImportedTransaction[]
}
